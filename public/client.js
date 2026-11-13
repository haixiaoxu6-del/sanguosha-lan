'use strict';

const $ = (sel) => document.querySelector(sel);
const SUIT_CN = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };
const CARD_TYPE_CN = { basic: '基本', trick: '锦囊', delayed: '延时', equip: '装备' };
const ROLE_CN = { landlord: '地主', farmer: '农民', player: '玩家', ai: 'AI' };
const PHASE_CN = { judge: '判定', draw: '摸牌', play: '出牌', discard: '弃牌', over: '结束' };

const params = new URLSearchParams(location.search);

const ui = {
  state: null,
  room: localStorage.getItem('sgs_room') || '',
  playerId: localStorage.getItem('sgs_player') || '',
  name: localStorage.getItem('sgs_name') || '',
  code: '',
  modes: [
    { id: 'doudizhu', name: '斗地主', players: 3, enabled: true, desc: '1 地主 vs 2 农民' },
    { id: 'duel_pvp', name: '1v1 联机', players: 2, enabled: true, desc: '两个真人单挑' },
    { id: 'duel', name: '人机对战', players: 2, enabled: true, desc: '1v1 打 AI' },
    { id: 'identity', name: '身份局', players: 0, enabled: false, desc: '敬请期待' },
  ],
  selectedCard: null,
  selectedTarget: null,
  pendingAction: null,
  discardSet: new Set(),
  tiesuoTargets: [],
  zhangba: false,
  zhangbaCards: [],
  jiedaoFirst: null,
  activeSkill: null,
  yijueStage: null,
  yijueCard: null,
  hanbingSet: new Set(),
  fxKey: null,
  fxLastId: 0,
  respondBusy: false,
  playDeadline: null,
  playTimerRaf: null,
  playAutoEnded: false,
  timerKind: null,
  timerDeadline: null,
  timerAutoDone: false,
  selectedGeneral: null,
  skillView: null,
  error: '',
  connecting: false,
  es: null,
  suppressClick: false,
  drag: null,
  starting: false,
  startStatus: '',
  judgmentSeen: 0,
  lastSig: '',
  sound: localStorage.getItem('sgs_sound') !== '0',
  audio: {},
};

// 预加载特效素材
['sha', 'shan', 'slash', 'burst', 'thunder1', 'thunder2', 'thunder3'].forEach(n => {
  const im = new Image();
  im.src = '/assets/fx/' + n + '.png';
});

if (params.get('room')) ui.code = params.get('room').toUpperCase();

// ---------------- 网络 ----------------
async function post(url, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return await r.json();
  } catch (e) {
    return { ok: false, error: '网络断开，请重试' };
  } finally {
    clearTimeout(timer);
  }
}

async function loadModes() {
  try {
    const r = await fetch('/api/modes').then(x => x.json());
    if (r.ok && Array.isArray(r.modes)) ui.modes = r.modes;
  } catch (e) { /* ignore */ }
}

let pollTimer = null;
let refreshNow = null;

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  refreshNow = null;
}

function stateSignature(ns) {
  if (!ns) return '';
  const you = ns.you && typeof ns.you === 'object' ? ns.you : null;
  return JSON.stringify([
    ns.started, ns.selecting, ns.mode, ns.room, ns.phase, ns.turn, ns.currentPlayer,
    ns.pending ? [ns.pending.type, ns.pending.playerId, ns.pending.count, ns.pending.prompt] : null,
    ns.pick ? ns.pick.cards.map(c => c.id) : null,
    you ? [you.hp, you.maxHp, you.hand.map(c => c.id), you.judge.map(c => c.id), you.shaUsed] : null,
    ns.players ? ns.players.map(p => [p.id, p.hp, p.maxHp, p.handCount, p.judgeCount, p.alive, p.isCurrent, p.connected, p.generalId]) : null,
    ns.gameOver ? [ns.gameOver.winner, ns.gameOver.text] : null,
    ns.lastJudgment ? ns.lastJudgment.seq : null,
    ns.log ? ns.log[ns.log.length - 1] : null,
    ns.canStart, ns.hostId
  ]);
}

function applyState(ns) {
  // 判定结果未确认前，暂停应用后续状态（AI 的后续动作也等确认后再播）
  if (ui.state && ui.state.lastJudgment && ui.judgmentSeen < ui.state.lastJudgment.seq) {
    ui.pendingState = ns;
    return;
  }
  const oldLog = ui.state && Array.isArray(ui.state.log) ? ui.state.log : [];
  const newLines = diffLog(oldLog, ns.log || []);
  ui.state = ns;
  if (ns.lastJudgment && ns.lastJudgment.seq > (ui.judgmentSeen || 0)) {
    if (ui.judgeTimer) clearTimeout(ui.judgeTimer);
    const seq = ns.lastJudgment.seq;
    ui.judgeTimer = setTimeout(() => {
      ui.judgmentSeen = seq;
      const b = ui.pendingState;
      ui.pendingState = null;
      if (b) applyState(b); else render();
    }, 3000);
  }
  if (!(ns.pending && ns.pending.type === 'huogong')) {
    document.querySelectorAll('.play-card.persist').forEach(e => e.remove());
  }
  if (ns.gameOver || !ns.started) {
    if (ui.centerCards) {
      ui.centerCards.forEach(x => { if (x.timer) clearTimeout(x.timer); if (x.el) x.el.remove(); });
      ui.centerCards = [];
    }
    document.querySelectorAll('.center-slot, #centerRow, .play-card, .center-card').forEach(e => e.remove());
  }
  ui.connecting = false;
  ui.starting = false;
  ui.startStatus = '';
  ui.selectedCard = null;
  ui.selectedTarget = null;
  ui.pendingAction = null;
  ui.discardSet.clear();
  ui.error = '';
  render();
  processFx(ns);
  if (ns.lastReveal && ns.lastReveal.seq > (ui.revealSeen || 0)) {
    ui.revealSeen = ns.lastReveal.seq;
    const rv = ns.lastReveal;
    const src = document.querySelector('.gc-wrap[data-player-id="' + rv.playerId + '"]');
    showCenterCard(rv.card, src, false);
  }
  if (newLines.length) {
    newLines.slice(-4).forEach((line, i) => setTimeout(() => triggerFx(line, ns), i * 180));
  }
}

// ---- 结构化特效事件：杀/闪字、剑光、蓝色闪电 ----
function processFx(s) {
  if (!s || !s.started) return;
  const key = s.room + '|' + myId(s);
  const evs = Array.isArray(s.events) ? s.events : [];
  const maxId = evs.length ? evs[evs.length - 1].id : 0;
  // 进入对局的第一帧：只记录当前进度，不重放历史特效
  if (!ui.fxStarted || ui.fxKey !== key) {
    ui.fxStarted = true;
    ui.fxKey = key;
    ui.fxLastId = maxId;
    return;
  }
  if (maxId < ui.fxLastId) { ui.fxLastId = maxId; return; }
  for (const ev of evs) {
    if (ev.id > ui.fxLastId) playFx(ev);
  }
  ui.fxLastId = maxId;
}

function fxImg(name, cls) {
  const img = document.createElement('img');
  img.src = '/assets/fx/' + name + '.png';
  img.className = 'fx-img' + (cls ? ' ' + cls : '');
  img.draggable = false;
  return img;
}

function playFx(ev) {
  if (!ev || !ev.playerId) return;
  // 摸牌牌背动画暂时关闭：它会在中心留下深色牌背，先保证出牌展示干净
  if (ev.type === 'card') {
    const s = ui.state;
    const self = s && ev.playerId === myId(s);
    const exact = self ? document.querySelector('.dz-hand .card[data-card-id="' + ev.card.id + '"]') : null;
    const src = exact || (self
      ? (document.querySelector('.dz-hand') || document.querySelector('.gc-self'))
      : document.querySelector('.gc-wrap[data-player-id="' + ev.playerId + '"]'));
    showCenterCard(ev.card, src, false, ev.playerId);
    return;
  }
  if (ev.type === 'sha') {
    playOn(ev.playerId, [fxImg('sha', 'sha')]);
    if (ev.element === 'thunder' && ev.targetId) {
      playOn(ev.targetId, [fxImg('thunder1', 'thunder'), fxImg('thunder2', 'thunder')]);
    }
    return;
  }
  if (ev.type === 'shan') {
    playOn(ev.playerId, [fxImg('shan', 'shan')]);
    return;
  }
  if (ev.type === 'damage') {
    const imgs = [fxImg('burst', 'burst'), fxImg('slash', 'slash')];
    if (ev.element === 'thunder') imgs.push(fxImg('thunder1', 'thunder'));
    playOn(ev.playerId, imgs);
  }
}

function playOn(playerId, imgs) {  const el = document.querySelector('.gc-wrap[data-player-id="' + playerId + '"]');
  if (!el) return;
  const r = el.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'fx-layer';
  layer.style.left = r.left + 'px';
  layer.style.top = r.top + 'px';
  layer.style.width = r.width + 'px';
  layer.style.height = r.height + 'px';
  imgs.forEach(i => layer.appendChild(i));
  const fx = document.getElementById('fx') || document.body;
  fx.appendChild(layer);
  setTimeout(() => layer.remove(), 1000);
}

function connect() {
  if (ui.es) { try { ui.es.close(); } catch (e) { /* ignore */ } }
  ui.es = null;
  stopPolling();
  ui.connecting = true;
  ui.error = '';
  ui.lastSig = '';
  render();

  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
    if (!ui.room || !ui.playerId) return;
    const res = await fetchState();
    if (res.fatal) {
      stopPolling();
      ui.state = null;
      ui.room = '';
      ui.playerId = '';
      localStorage.removeItem('sgs_room');
      localStorage.removeItem('sgs_player');
      ui.connecting = false;
      ui.error = '房间已失效（服务器可能重启过），请重新建房';
      render();
      return;
    }
    if (res.error) {
      // 手机流量切换/短暂断网：不踢房间，保持手牌和牌桌，只显示重连中
      if (!ui.connecting) { ui.connecting = true; render(); }
      return;
    }
    const wasConnecting = ui.connecting;
    ui.connecting = false;
    const ns = res.state;
    const sig = stateSignature(ns);
    if (sig === ui.lastSig) {
      if (wasConnecting) render();
      return;
    }
    ui.lastSig = sig;
    applyState(ns);
    } finally {
      busy = false;
    }
  };
  refreshNow = tick;
  tick();
  pollTimer = setInterval(tick, 500);
}

// ---------------- 音效 / 特效 ----------------
const CARD_ART = {
  杀: 'sha', 闪: 'shan', 桃: 'tao', 决斗: 'juedou',
  过河拆桥: 'guohe', 顺手牵羊: 'shunshou', 无中生有: 'wuzhong',
  南蛮入侵: 'nanman', 万箭齐发: 'wanjian', 兵粮寸断: 'bingliang',
  无懈可击: 'wuxie',
};
const AUDIO_FILE = {
  card: 'card', damage: 'damage', die: 'die', draw: 'draw', discard: 'discard',
  judge: 'judge', recover: 'recover', win: 'win', lose: 'lose',
  wusheng: 'wusheng', paoxiao: 'paoxiao', longdan: 'longdan', yingzi: 'yingzi',
};

function playSound(key) {
  if (!ui.sound) return;
  const file = AUDIO_FILE[key] || key;
  const src = `/assets/audio/${file}.mp3`;
  let a = ui.audio[src];
  if (!a) {
    a = new Audio(src);
    a.volume = 0.35;
    a.preload = 'auto';
    ui.audio[src] = a;
  }
  try { a.currentTime = 0; a.play().catch(() => {}); } catch (e) { /* ignore */ }
}

function fxRoot() { return document.getElementById('fx'); }

function playerByName(s, name) {
  return s && Array.isArray(s.players) ? s.players.find(p => p.name === name) : null;
}

function targetRect(id) {
  const el = document.querySelector(`[data-player-id="${id}"]`);
  return el ? el.getBoundingClientRect() : null;
}

function shakePlayer(id) {
  const el = document.querySelector(`[data-player-id="${id}"]`);
  if (!el) return;
  el.classList.add('gc-hit');
  setTimeout(() => el.classList.remove('gc-hit'), 520);
}

function showCardFx(cardName, sourceName, targetName, s) {
  const root = fxRoot();
  if (!root) return;
  const target = targetName ? playerByName(s, targetName) : null;
  if (!target) return;
  const rect = targetRect(target.id);
  if (!rect) return;
  if (cardName === '杀') {
    const slash = document.createElement('div');
    slash.className = 'fx-slash';
    slash.style.left = `${rect.left + rect.width / 2}px`;
    slash.style.top = `${rect.top + rect.height / 2}px`;
    root.appendChild(slash);
    setTimeout(() => slash.remove(), 600);
    shakePlayer(target.id);
  } else if (cardName === '闪') {
    const shield = document.createElement('div');
    shield.className = 'fx-shield';
    shield.style.left = `${rect.left + rect.width / 2}px`;
    shield.style.top = `${rect.top + rect.height / 2}px`;
    root.appendChild(shield);
    setTimeout(() => shield.remove(), 750);
  }
}

function showResponseFx(cardName, name, s) {
  const p = playerByName(s, name);
  if (!p) return;
  showCardFx(cardName, name, null, s);
  const rect = targetRect(p.id);
  const root = fxRoot();
  if (root && rect) {
    if (cardName === '闪') {
      const shield = document.createElement('div');
      shield.className = 'fx-shield';
      shield.style.left = `${rect.left + rect.width / 2}px`;
      shield.style.top = `${rect.top + rect.height / 2}px`;
      root.appendChild(shield);
      setTimeout(() => shield.remove(), 750);
    } else if (cardName === '杀') {
      const slash = document.createElement('div');
      slash.className = 'fx-slash';
      slash.style.left = `${rect.left + rect.width / 2}px`;
      slash.style.top = `${rect.top + rect.height / 2}px`;
      root.appendChild(slash);
      setTimeout(() => slash.remove(), 600);
    }
  }
  if (cardName === '闪' && p.general && p.general.skills.includes('longdan')) playSound('longdan');
}

function showDamageFx(name, amount, s) {
  const p = playerByName(s, name);
  if (!p) return;
  const root = fxRoot();
  const rect = targetRect(p.id);
  if (root && rect) {
    const n = document.createElement('div');
    n.className = 'fx-number damage';
    n.textContent = `-${amount}`;
    n.style.left = `${rect.left + rect.width / 2}px`;
    n.style.top = `${rect.top + rect.height / 2}px`;
    root.appendChild(n);
    setTimeout(() => n.remove(), 1150);
  }
  if (root) {
    const flash = document.createElement('div');
    flash.className = 'fx-flash damage';
    root.appendChild(flash);
    setTimeout(() => flash.remove(), 500);
  }
  shakePlayer(p.id);
}

function showHealFx(name, s) {
  const p = playerByName(s, name);
  if (!p) return;
  const root = fxRoot();
  const rect = targetRect(p.id);
  if (!root || !rect) return;
  const glow = document.createElement('div');
  glow.className = 'fx-glow';
  glow.style.left = `${rect.left + rect.width / 2}px`;
  glow.style.top = `${rect.top + rect.height / 2}px`;
  root.appendChild(glow);
  setTimeout(() => glow.remove(), 850);

  const n = document.createElement('div');
  n.className = 'fx-number heal';
  n.textContent = '+1';
  n.style.left = `${rect.left + rect.width / 2}px`;
  n.style.top = `${rect.top + rect.height / 2}px`;
  root.appendChild(n);
  setTimeout(() => n.remove(), 1150);
}

function showSkillFx(name) {
  const root = fxRoot();
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'fx-skill';
  el.textContent = name;
  root.appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

function showDeathFx(name, s) {
  const p = playerByName(s, name);
  if (!p) return;
  shakePlayer(p.id);
  showSkillFx('阵亡');
}

function diffLog(oldLog, newLog) {
  if (!Array.isArray(newLog) || newLog.length === 0) return [];
  if (!Array.isArray(oldLog) || oldLog.length === 0) return newLog.slice(-1);
  const last = oldLog[oldLog.length - 1];
  const idx = newLog.lastIndexOf(last);
  if (idx >= 0) return newLog.slice(idx + 1).slice(-4);
  return newLog.slice(-1);
}

function triggerFx(line, s) {
  let m;
  if ((m = line.match(/^(.+?) 对 (.+?) 使用【(.+?)】/))) {
    showCardFx(m[3], m[1], m[2], s);
    const src = playerByName(s, m[1]);
    if (m[3] === '杀' && src && src.general && src.general.skills.includes('wusheng')) playSound('wusheng');
    else if (m[3] === '杀' && src && src.general && (src.general.skills.includes('paoxiao') || src.general.skills.includes('re_paoxiao'))) playSound('paoxiao');
    else playSound('card');
    if (m[3] === '桃') { showHealFx(m[1], s); playSound('recover'); }
    return;
  }
  if ((m = line.match(/^(.+?) 使用【(.+?)】/))) {
    showCardFx(m[2], m[1], null, s);
    playSound('card');
    if (m[2] === '桃') { showHealFx(m[1], s); playSound('recover'); }
    return;
  }
  if ((m = line.match(/^(.+?) 打出【(.+?)】/))) {
    showResponseFx(m[2], m[1], s);
    playSound('card');
    return;
  }
  if ((m = line.match(/^(.+?) 受到(\d+)点伤害/))) {
    showDamageFx(m[1], Number(m[2]), s);
    playSound('damage');
    return;
  }
  if ((m = line.match(/^(.+?) 判定【(.+?)】/))) {
    playSound('judge');
    return;
  }
  if ((m = line.match(/^(.+?) 阵亡/))) {
    showDeathFx(m[1], s);
    playSound('die');
    return;
  }
  if ((m = line.match(/^(.+?) 发动【(.+?)】/))) {
    showSkillFx(m[2]);
    const key = ({ 武圣: 'wusheng', 咆哮: 'paoxiao', 龙胆: 'longdan', 英姿: 'yingzi' })[m[2]] || 'card';
    playSound(key);
    return;
  }
  if (/摸\d+张牌/.test(line)) { playSound('draw'); return; }
  if (/弃置了|弃置 \d+ 张牌/.test(line)) { playSound('discard'); return; }
  if (line.includes('游戏开始')) { showSkillFx('游戏开始'); playSound('draw'); }
}

async function createRoom(mode) {
  const r = await post('/api/create', { name: ui.name || '玩家', mode });
  if (!r.ok) { ui.error = r.error; render(); return; }
  ui.room = r.room;
  ui.playerId = r.playerId;
  localStorage.setItem('sgs_room', ui.room);
  localStorage.setItem('sgs_player', ui.playerId);
  localStorage.setItem('sgs_name', ui.name || '玩家');
  connect();
}

async function joinRoom() {
  const code = ($('#codeInput')?.value || ui.code || '').trim().toUpperCase();
  if (!code) { ui.error = '请输入房间号'; render(); return; }
  const r = await post('/api/join', { name: ui.name || '玩家', room: code });
  if (!r.ok) { ui.error = r.error; render(); return; }
  ui.room = r.room;
  ui.playerId = r.playerId;
  localStorage.setItem('sgs_room', ui.room);
  localStorage.setItem('sgs_player', ui.playerId);
  localStorage.setItem('sgs_name', ui.name || '玩家');
  connect();
}

async function fetchState() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`/api/state?room=${encodeURIComponent(ui.room)}&player=${encodeURIComponent(ui.playerId)}&t=${Date.now()}`, {
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (res.status === 404 || res.status === 403) return { fatal: true };
    if (!res.ok) return { error: true };
    const r = await res.json();
    if (!r.ok) return { fatal: true };
    return { state: r.state };
  } catch (e) {
    return { error: true };
  } finally {
    clearTimeout(timer);
  }
}

async function startGame(generalId) {
  if (ui.starting) return;
  ui.starting = true;
  ui.error = '';
  ui.startStatus = '正在请求服务器…';
  render();

  const body = { room: ui.room, player: ui.playerId };
  if (generalId) body.generalId = generalId;

  let r;
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('请求超时')), 6000));
    r = await Promise.race([post('/api/start', body), timeout]);
  } catch (e) {
    ui.starting = false;
    ui.startStatus = '';
    ui.error = '开始失败：' + e.message + '（当前地址 ' + location.origin + '）';
    render();
    return;
  }

  if (!r.ok) {
    ui.starting = false;
    ui.startStatus = '';
    ui.error = r.error || '开始失败';
    if (r.error === '房间不存在') {
      ui.state = null;
      ui.room = '';
      ui.playerId = '';
      localStorage.removeItem('sgs_room');
      localStorage.removeItem('sgs_player');
    }
    render();
    return;
  }

  if (r.waiting) {
    ui.starting = false;
    ui.startStatus = r.reason || '已选择，等待对手…';
    render();
    if (refreshNow) setTimeout(refreshNow, 50);
    return;
  }

  ui.startStatus = '服务器已开局，正在同步…';
  render();

  // 轮询状态，绕过 SSE
  for (let i = 0; i < 12; i++) {
    const st = await fetchState();
    if (st.fatal) {
      ui.starting = false;
      ui.startStatus = '';
      ui.state = null;
      ui.room = '';
      ui.playerId = '';
      localStorage.removeItem('sgs_room');
      localStorage.removeItem('sgs_player');
      ui.error = '房间已失效（服务器可能重启过），请重新建房';
      render();
      return;
    }
    if (st.state && st.state.started) {
      ui.state = st.state;
      ui.starting = false;
      ui.startStatus = '';
      ui.error = '';
      render();
      return;
    }
    await new Promise(res => setTimeout(res, 250));
  }

  ui.starting = false;
  ui.startStatus = '';
  ui.error = '服务器已开局，但状态同步失败，请刷新页面';
  render();
}

window.__startDuel = () => {
  if (ui.starting) return;
  if (!ui.selectedGeneral) {
    ui.error = '请先选择武将';
    render();
    return;
  }
  startGame(ui.selectedGeneral);
};

async function sendAction(action) {
  if (action && (action.type === 'play' || action.type === 'respond')) {
    ui.activeSkill = null;
    ui.yijueStage = null;
    ui.yijueCard = null;
  }
  if (action && (action.type === 'play' || action.type === 'respond') && action.cardId) {
    // 出牌飞行动画由引擎 card 事件统一触发，避免重复/凭空出现
  }
  if (action && (action.targetId || (Array.isArray(action.targetIds) && action.targetIds.length))) {
    const from = document.querySelector('.gc-self') || document.querySelector('.dz-hand .card.selected');
    const ids = action.targetIds || [action.targetId];
    for (const id of ids) {
      const to = document.querySelector(`.gc-wrap[data-player-id="${id}"]`);
      if (to) showTargetArrow(from, to);
    }
  }
  const r = await post('/api/action', { room: ui.room, player: ui.playerId, action });
  if (!r.ok) { ui.error = r.error; render(); return; }
  if (action && (action.type === 'play' || action.type === 'respond')) {
    ui.timerDeadline = Date.now() + 20000;
    ui.timerAutoDone = false;
  }
  if (r.state) {
    ui.lastSig = stateSignature(r.state);
    applyState(r.state);
  } else if (refreshNow) {
    setTimeout(refreshNow, 20);
  }
}

function leave() {
  if (ui.es) { try { ui.es.close(); } catch (e) { /* ignore */ } }
  ui.es = null;
  ui.skillView = null;
  stopPolling();
  ui.state = null;
  ui.room = '';
  ui.playerId = '';
  localStorage.removeItem('sgs_room');
  localStorage.removeItem('sgs_player');
  const fx = document.getElementById('fx');
  if (fx) fx.innerHTML = '';
  render();
}

// ---------------- 渲染 ----------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function myId(s) {
  if (!s) return null;
  return s.you && typeof s.you === 'object' ? s.you.id : s.you;
}

function bannerText(line, s) {
  const me = s && Array.isArray(s.players) ? s.players.find(p => p.id === myId(s)) : null;
  if (me && me.name === '玩家') return String(line).replace(/^玩家 /, '你 ');
  return line;
}

function hearts(hp, max) {
  const h = Math.max(0, hp);
  return `<span class="hearts">${'♥'.repeat(h)}</span><span class="hearts-empty">${'♡'.repeat(Math.max(0, max - h))}</span>`;
}

function render() {
  const app = $('#app');
  if (!ui.state) { app.innerHTML = lobbyHtml(); requestAnimationFrame(layoutHand); return; }
  if (!ui.state.started) {
    app.innerHTML = ui.state.selecting ? (generalHtml() + skillModalHtml()) : roomHtml();
    requestAnimationFrame(layoutHand);
    return;
  }
  app.innerHTML = gameHtml() + skillModalHtml();
  if (ui.error) { addToast(ui.error); ui.error = ''; }
  syncTimers();
  syncZoneModal(ui.state);
  requestAnimationFrame(layoutHand);
}

function addToast(msg) {
  const fx = document.getElementById('fx');
  if (!fx) return;
  const el = document.createElement('div');
  el.className = 'game-toast';
  el.textContent = msg;
  fx.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function centerFaceHtml(card) {
  return `<div class="card ${card.color === 'red' ? 'red' : 'black'}" style="--art:url('/assets/cards/${card.art}')">
    <div class="c-top"><span class="c-suit">${SUIT_CN[card.suit]}</span><span class="c-num">${card.number}</span><span class="c-type">${CARD_TYPE_CN[card.type] || ''}</span></div>
    <div class="c-name">${card.name}</div><div class="c-art"></div>
  </div>`;
}

function centerRowEl() {
  let row = document.getElementById('centerRow');
  if (!row) {
    row = document.createElement('div');
    row.id = 'centerRow';
    row.className = 'center-row';
    document.body.appendChild(row);
  }
  return row;
}

function removeCenterSlot(slot) {
  if (slot.timer) clearTimeout(slot.timer);
  ui.centerCards = (ui.centerCards || []).filter(x => x !== slot);
  if (slot.equip && slot.ownerId && slot.el) {
    const gc = document.querySelector('.gc-wrap[data-player-id="' + slot.ownerId + '"]');
    const face = slot.el.querySelector('.card');
    if (gc && face) {
      const tr = face.getBoundingClientRect();
      const gr = gc.getBoundingClientRect();
      const dx = (gr.left + gr.width / 2) - (tr.left + tr.width / 2);
      const dy = (gr.top + gr.height / 2) - (tr.top + tr.height / 2);
      try { face.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(.45)`, opacity: 0 }], { duration: 800, easing: 'ease-in', fill: 'forwards' }); } catch (e) {}
      setTimeout(() => slot.el.remove(), 850);
      return;
    }
  }
  if (slot.el) slot.el.remove();
}

function showCenterCard(card, fromEl, persist, ownerId) {
  if (!card) return;
  if (!ui.centerCards) ui.centerCards = [];
  // 火攻展示：单独持久层，不占中心队列
  if (persist) {
    document.querySelectorAll('.play-card.persist').forEach(e => e.remove());
    const mask = document.createElement('div');
    mask.className = 'play-card persist';
    mask.dataset.cardId = card.id;
    mask.innerHTML = `<div class="play-card-inner">${centerFaceHtml(card)}</div>`;
    document.body.appendChild(mask);
    return;
  }
  if (ui.centerCards.some(x => x.id === card.id)) return;
  // 最多三张；第四张进来时，最早的一张直接消失
  if (ui.centerCards.length >= 3) {
    const first = ui.centerCards.shift();
    removeCenterSlot(first);
  }
  const row = centerRowEl();
  const el = document.createElement('div');
  el.className = 'center-slot';
  el.dataset.cardId = card.id;
  el.innerHTML = centerFaceHtml(card);
  row.appendChild(el);
  const isEquip = card.type === 'equip';
  const entry = { id: card.id, el, timer: null, equip: isEquip, ownerId: ownerId || null };
  entry.timer = setTimeout(() => removeCenterSlot(entry), isEquip ? 1500 : 4000);
  ui.centerCards.push(entry);
  if (fromEl && fromEl.getBoundingClientRect) {
    const face = el.querySelector('.card');
    if (face) {
      const tr = face.getBoundingClientRect();
      const sr = fromEl.getBoundingClientRect();
      if (sr.width > 0 && tr.width > 0) {
        const dx = (sr.left + sr.width / 2) - (tr.left + tr.width / 2);
        const dy = (sr.top + sr.height / 2) - (tr.top + tr.height / 2);
        const sc = Math.max(0.2, Math.min(1, sr.width / Math.max(1, tr.width)));
        try {
          face.animate(
            [{ transform: `translate(${dx}px, ${dy}px) scale(${sc})`, opacity: .45 },
             { transform: 'translate(0,0) scale(1)', opacity: 1 }],
            { duration: 1200, easing: 'cubic-bezier(.2,.7,.3,1)' }
          );
        } catch (e) { /* ignore */ }
      }
    }
  }
}

function startPlayTimerTick() {
  if (ui.playTimerRaf) { cancelAnimationFrame(ui.playTimerRaf); ui.playTimerRaf = null; }
  ui.playTimerRaf = requestAnimationFrame(function tick() {
    ui.playTimerRaf = null;
    const fill = document.getElementById('ptFill');
    const left = ui.timerDeadline ? ui.timerDeadline - Date.now() : 0;
    if (fill) fill.style.width = Math.max(0, Math.min(100, left / 200)) + '%';
    if (left <= 0) {
      if (!ui.timerAutoDone) {
        ui.timerAutoDone = true;
        onTimerExpired();
      }
      return;
    }
    ui.playTimerRaf = requestAnimationFrame(tick);
  });
}

function onTimerExpired() {
  const s = ui.state;
  if (!s) return;
  const me = myId(s);
  const p = s.pending;
  if (p && p.playerId === me) {
    switch (p.type) {
      case 'discard': {
        const ids = s.you.hand.slice(0, p.count || 0).map(c => c.id);
        sendAction({ type: 'discard', cardIds: ids });
        return;
      }
      case 'pick': {
        const cards = (s.pick && s.pick.cards) || [];
        if (cards.length) sendAction({ type: 'respond', cardId: cards[Math.floor(Math.random() * cards.length)].id });
        else sendAction({ type: 'respond', pass: true });
        return;
      }
      case 'wugu': {
        const cards = (s.wugu && s.wugu.cards) || [];
        if (cards.length) sendAction({ type: 'respond', cardId: cards[0].id });
        else sendAction({ type: 'respond', pass: true });
        return;
      }
      case 'yajiao': sendAction({ type: 'respond', targetId: me }); return;
      case 'yajiao_discard': {
        const ids = s.you.hand.slice(0, 1).map(c => c.id);
        sendAction({ type: 'respond', cardIds: ids });
        return;
      }
      case 'yijue': {
        if (s.you.hand.length) sendAction({ type: 'respond', cardId: s.you.hand[0].id });
        else sendAction({ type: 'respond', pass: true });
        return;
      }
      default:
        sendAction({ type: 'respond', pass: true });
        return;
    }
  }
  if (s.phase === 'play' && s.currentPlayer === me && !s.pending) sendAction({ type: 'endPlay' });
}

function syncTimers() {
  const s = ui.state;
  if (!s || !s.started) return;
  const me = myId(s);
  const myPending = !!(s.pending && s.pending.playerId === me);
  const myPlay = s.phase === 'play' && s.currentPlayer === me && !s.pending;
  if (myPending) {
    if (ui.timerKind !== 'pending') {
      ui.timerKind = 'pending';
      ui.timerDeadline = Date.now() + 20000;
      ui.timerAutoDone = false;
    }
    startPlayTimerTick();
  } else if (myPlay) {
    if (ui.timerKind !== 'play') {
      ui.timerKind = 'play';
      ui.timerDeadline = Date.now() + 20000;
      ui.timerAutoDone = false;
    }
    startPlayTimerTick();
  } else {
    ui.timerKind = null;
    ui.timerDeadline = null;
    ui.timerAutoDone = false;
  }
}

function showTargetArrow(fromEl, toEl) {
  const fx = document.getElementById('fx');
  if (!fx || !fromEl || !toEl) return;
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  const x1 = a.left + a.width / 2, y1 = a.top + a.height / 2;
  const x2 = b.left + b.width / 2, y2 = b.top + b.height / 2;
  const w = window.innerWidth, h = window.innerHeight;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const size = 20;
  const p2 = `${x2 - size * Math.cos(ang - 0.45)},${y2 - size * Math.sin(ang - 0.45)}`;
  const p3 = `${x2 - size * Math.cos(ang + 0.45)},${y2 - size * Math.sin(ang + 0.45)}`;
  const path = `M${x1},${y1} L${x2},${y2}`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'target-arrow');
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML = `
    <defs>
      <linearGradient id="taGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#ff8a2a" stop-opacity="0"/>
        <stop offset="35%" stop-color="#ffb347" stop-opacity=".85"/>
        <stop offset="100%" stop-color="#fff3c4" stop-opacity="1"/>
      </linearGradient>
      <filter id="taGlow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="7" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <path d="${path}" fill="none" stroke="url(#taGrad)" stroke-width="16" stroke-linecap="round" opacity=".4" filter="url(#taGlow)"/>
    <path d="${path}" fill="none" stroke="#ffd27a" stroke-width="4" stroke-linecap="round" opacity=".95"/>
    <polygon points="${x2},${y2} ${p2} ${p3}" fill="#fff3c4" filter="url(#taGlow)"/>
  `;
  fx.appendChild(svg);
  setTimeout(() => svg.remove(), 760);
}

function skillModalHtml() {
  const p = ui.skillView;
  if (!p || !p.general) return '';
  const g = p.general;
  const eq = p.equips || {};
  const eqRows = [
    { label: '武器', c: eq.weapon, range: true },
    { label: '防具', c: eq.armor },
    { label: '+1马', c: eq.horse1 },
    { label: '-1马', c: eq.horse2 },
  ].filter(x => x.c);
  return `<div class="modal-mask skill-mask">
    <div class="modal skill-modal">
      <div class="skill-head">
        <img class="skill-portrait" src="/assets/generals/${g.portrait}" alt="">
        <div class="skill-meta">
          <h2>${g.name}<span>${g.faction}</span></h2>
          <div class="skill-sub">${p.hp ?? g.hp}/${p.maxHp ?? g.hp} 血${p.handCount != null ? ` · 手牌 ${p.handCount}` : ''}</div>
        </div>
      </div>
      <div class="skill-desc-list">
        ${(g.skills || []).map(id => `<div class="skill-desc-item"><b>${skillName(id)}</b><p>${escapeHtml((g.skillDescs && g.skillDescs[id]) || g.desc || '')}</p></div>`).join('')}
      </div>
      ${eqRows.length ? `<div class="skill-equips">
        <h3>装备</h3>
        ${eqRows.map(x => `<div class="skill-equip">
          <div class="skill-equip-name">${x.label}：${x.c.name}${x.range && x.c.range ? `（范围${x.c.range}）` : ''}</div>
          <p>${escapeHtml(x.c.desc || '')}</p>
        </div>`).join('')}
      </div>` : ''}
      <button class="btn primary" data-skill-close="1">返回</button>
      <div class="skill-hint">左键任意位置返回</div>
    </div>
  </div>`;
}

function layoutHand() {
  document.querySelectorAll('.dz-hand').forEach(hand => {
    hand.style.gap = '0px';
    const cards = [...hand.querySelectorAll('.card')];
    hand.style.setProperty('--hand-overlap', '0px');
    if (cards.length < 2) return;
    const avail = hand.clientWidth;
    const cardW = cards[0].offsetWidth;
    if (!avail || !cardW) return;
    const total = cards.length * cardW;
    if (total <= avail) return;
    const minStep = Math.max(30, Math.round(cardW * 0.38));
    const maxOverlap = Math.max(0, cardW - minStep);
    const need = Math.ceil((total - avail) / (cards.length - 1));
    const overlap = Math.min(maxOverlap, Math.max(0, need));
    hand.style.setProperty('--hand-overlap', overlap + 'px');
  });
}

function renderLocal() {
  const s = ui.state;
  if (!s || !s.started) { render(); return; }
  const meId = myId(s);
  const you = s.you;
  const selectedCard = you.hand.find(c => c.id === ui.selectedCard);
  const hasTargetAction = !!(selectedCard && playActions(selectedCard).some(a => a.needsTarget));
  const canTarget = !!(ui.pendingAction && ui.pendingAction.needsTarget) || hasTargetAction;
  document.querySelectorAll('.card[data-card-id]').forEach(el => {
    const id = el.dataset.cardId;
    el.classList.toggle('selected', id === ui.selectedCard || ui.zhangbaCards.includes(id) || id === ui.yijueCard);
    el.classList.toggle('discard-selected', ui.discardSet.has(id));
  });
  document.querySelectorAll('.gc-wrap[data-player-id]').forEach(el => {
    const id = el.dataset.playerId;
    const p = s.players.find(x => x.id === id);
    el.classList.toggle('target', ui.selectedTarget === id);
    el.classList.toggle('targetable', !!(canTarget && p && p.alive && id !== meId));
  });
  const prompt = document.querySelector('.dz-prompt');
  if (prompt) {
    const current = s.players.find(p => p.id === s.currentPlayer);
    const pending = s.pending;
    const myPending = pending && pending.playerId === meId;
    const isMyTurn = s.currentPlayer === meId;
    prompt.innerHTML = controlsHtml(s, you, current, pending, myPending, isMyTurn);
  }
  // 涯角：直接给武将牌绑定点选，避免被其他点击逻辑吞掉
  if (s.pending && s.pending.type === 'yajiao' && s.pending.playerId === meId) {    document.querySelectorAll('.gc-wrap[data-player-id]').forEach(el => {
      el.classList.add('targetable');
      el.style.cursor = 'pointer';
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (ui.yajiaoSent) return;
        ui.yajiaoSent = true;
        sendAction({ type: 'respond', targetId: el.dataset.playerId });
        setTimeout(() => { ui.yajiaoSent = false; }, 1000);
      });
    });
  }
  // 响应求【闪】/【杀】：直接在手牌上绑定，先点技能再点牌必定生效
  if (s.pending && s.pending.playerId === meId && ['shan', 'wanjian', 'duel', 'nanman'].includes(s.pending.type)) {
    document.querySelectorAll('.dz-hand .card[data-card-id]').forEach(el => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const cid = el.dataset.cardId;
        const card = you.hand.find(c => c.id === cid);
        if (!card) return;
        const needShan = s.pending.type === 'shan' || s.pending.type === 'wanjian';
        const ok = needShan ? canUseAsShan(card) : canUseAsSha(card);
        if (!ok) {
          if (you.yijueSealed) addToast('你被【义绝】封印：本回合不能使用或打出手牌');
          else addToast(needShan ? '这张牌不能当【闪】：先点【龙胆】/【武圣】再选牌' : '这张牌不能当【杀】：先点技能再选牌');
          return;
        }
        if (ui.respondBusy) return;
        ui.respondBusy = true;
        sendAction({ type: 'respond', cardId: cid });
        setTimeout(() => { ui.respondBusy = false; }, 700);
      });
    });
  }
  // 出牌阶段 10 秒限时条
  syncTimers();
  syncZoneModal(s);
  requestAnimationFrame(layoutHand);
}

function lobbyHtml() {
  const modes = ui.modes || [];
  return `<div class="lobby"><div class="lobby-card" style="width:min(720px,100%)">
    <h1>三国杀 <span>网页联机版</span></h1>
    <p class="tagline">斗地主 · 1v1 联机 · 手机流量也能联机</p>
    ${ui.error ? `<div class="error">${escapeHtml(ui.error)}</div>` : ''}
    <label class="field">昵称<input id="nameInput" maxlength="12" placeholder="你的名字" value="${escapeHtml(ui.name)}"></label>
    <div class="mode-grid">
      ${modes.map(m => `<div class="mode-card ${m.enabled ? '' : 'disabled'}" data-mode="${m.id}">
        <div class="mode-name">${escapeHtml(m.name)}</div>
        <div class="mode-desc">${escapeHtml(m.desc || '')}</div>
        ${m.enabled
          ? `<button class="btn primary" data-action="create" data-mode="${m.id}">创建</button>`
          : '<div class="sub">敬请期待</div>'}
      </div>`).join('')}
    </div>
    <div class="divider">或加入好友的房间</div>
    <label class="field">房间号<input id="codeInput" maxlength="4" placeholder="4 位房间号" value="${escapeHtml(ui.code)}" style="text-transform:uppercase"></label>
    <button class="btn big" data-action="join">加入房间</button>
    ${ui.connecting ? '<div class="sub" style="text-align:center;margin-top:12px">连接中…</div>' : ''}
    <div class="rules"><b>斗地主：</b>3 人，1 地主 2 农民；地主 +1 血、先手、多摸 1 张；地主死农民胜，两个农民死地主胜。<br><b>1v1 联机：</b>2 个真人，各选一个武将，先 0 血输；建房后把房间号发给朋友。<br><b>人机对战：</b>你先选将，AI 从剩下随机选，1v1，先 0 血输。</div>
    <div class="sub" style="text-align:center;margin-top:10px;opacity:.45">v135</div>
  </div></div>`;
}

function roomHtml() {
  const s = ui.state;
  const isHost = s.hostId === myId(s);
  const slots = [0, 1, 2].map(i => {
    const p = s.players[i];
    if (!p) return `<div class="lobby-player" style="opacity:.4"><span class="seat">${i + 1}</span><span>等待玩家…</span></div>`;
    return `<div class="lobby-player"><span class="seat">${i + 1}</span><span>${escapeHtml(p.name)}</span>${p.id === s.hostId ? '<span class="host-tag">房主</span>' : ''}${p.connected ? '<span class="online">在线</span>' : '<span class="offline">离线</span>'}</div>`;
  }).join('');

  return `<div class="lobby"><div class="lobby-card">
    <h1>斗地主 <span>房间</span></h1>
    ${ui.error ? `<div class="error">${escapeHtml(ui.error)}</div>` : ''}
    ${ui.connecting ? '<div class="sub" style="text-align:center;margin-bottom:8px;color:#e8b45a">网络断开，正在重连…</div>' : ''}
    <div class="room-code">房间号：<b>${s.room}</b></div>
    <div class="copy-row"><button class="btn ghost" data-action="copy">复制邀请链接</button></div>
    <div class="player-list">${slots}</div>
    <div class="lobby-hint">${s.players.length}/3 人 · 满 3 人开始</div>
    ${isHost
      ? `<button class="btn primary big" data-action="start" ${s.canStart ? '' : 'disabled'}>开始游戏</button>`
      : '<div class="waiting-text">等待房主开始…</div>'}
    <div style="height:10px"></div>
    <button class="btn ghost big" data-action="leave">离开房间</button>
  </div></div>`;
}

function generalHtml() {
  const s = ui.state;
  const list = s.generals || [];
  const isPvp = s.mode === 'duel_pvp';
  const meId = myId(s);
  const meP = s.players.find(p => p.id === meId);
  const opp = s.players.find(p => p.id !== meId);
  const oppGenId = opp && opp.generalId ? opp.generalId : '';
  const oppGen = list.find(g => g.id === oppGenId);
  const myGenId = meP && meP.generalId ? meP.generalId : '';
  const chosenId = myGenId || ui.selectedGeneral;
  const selected = list.find(g => g.id === chosenId);
  const locked = isPvp && !!myGenId;

  const roomBlock = isPvp ? `
    <div class="room-code">房间号：<b>${s.room}</b></div>
    <div class="copy-row"><button class="btn ghost" data-action="copy">复制邀请链接</button></div>
    <div class="player-list">
      ${s.players.map((p, i) => `<div class="lobby-player"><span class="seat">${i + 1}</span><span>${escapeHtml(p.name)}</span>${p.id === s.hostId ? '<span class="host-tag">房主</span>' : ''}${p.generalId ? '<span class="online">已选武将</span>' : '<span class="offline">未选</span>'}</div>`).join('')}
      ${s.players.length < 2 ? '<div class="lobby-player" style="opacity:.4"><span class="seat">2</span><span>等待对手加入…</span></div>' : ''}
    </div>
    <div class="lobby-hint">${s.players.length}/2 人${oppGen ? ` · 对手已选 ${escapeHtml(oppGen.name)}` : ' · 等待对手加入/选择'}</div>` : '';

  return `<div class="lobby"><div class="lobby-card" style="width:min(820px,100%)">
    <h1>${isPvp ? '1v1 联机' : '选择武将'}</h1>
    <p class="tagline">${isPvp ? '双方各选一个武将，选完自动开始' : '你先选，AI 从剩下的随机选'}</p>
    ${ui.error ? `<div class="error">${escapeHtml(ui.error)}</div>` : ''}
    ${ui.connecting ? '<div class="sub" style="text-align:center;margin-bottom:8px;color:#e8b45a">网络断开，正在重连…</div>' : ''}
    ${ui.startStatus ? `<div class="sub" style="text-align:center;margin-bottom:8px">${escapeHtml(ui.startStatus)}</div>` : ''}
    ${roomBlock}
    <div class="sub" style="text-align:center;margin-bottom:8px;opacity:.45">地址：${location.origin} · v135</div>
    <div class="general-grid">
      ${list.map(g => {
        const taken = isPvp && oppGenId === g.id;
        return `<div class="general-card ${chosenId === g.id ? 'selected' : ''} ${taken ? 'taken' : ''}" data-general-id="${g.id}"${taken ? ' data-taken="1"' : ''}>
          <div class="gc-scaler">
            <div class="gc-wrap">
              <div class="gc-side">
                <div class="gc-side-top"><div class="gc-side-faction">${g.faction}</div><div class="gc-side-name">${g.name}</div></div>
                <div class="gc-side-hp">${hpFishHtml(g.hp, g.hp)}</div>
              </div>
              <div class="gc">
                <div class="gc-art"><img class="gc-portrait" src="/assets/generals/${g.portrait}" alt="${g.name}" draggable="false"></div>
                <div class="gc-hair"><img class="gc-portrait" src="/assets/generals/${g.portrait}" alt="" draggable="false"></div>
                ${taken ? '<div class="g-taken">对手已选</div>' : ''}
              </div>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="sub" style="text-align:center;margin-bottom:8px">已选：${selected ? selected.name : '未选择'}${locked ? '（已确定，等待对手）' : ''}</div>
    <button class="btn primary big" onclick="window.__startDuel()" ${chosenId && !ui.starting && !locked ? '' : 'disabled'}>${
      isPvp
        ? (locked ? '已选择，等待对手…' : (ui.starting ? '提交中…' : '确定选择'))
        : (ui.starting ? '开始中…' : '开始对战')
    }</button>
    <div style="height:10px"></div>
    <button class="btn ghost big" data-action="leave">返回大厅</button>
    <div class="sub" style="text-align:center;margin-top:10px;opacity:.45">v135</div>
  </div></div>`;
}

function gameHtml() {
  return tableGameHtml();
}

function skillName(id) {
  return ({
    wusheng: '武圣', paoxiao: '咆哮', longdan: '龙胆', yingzi: '英姿',
    re_wusheng: '武圣', re_paoxiao: '咆哮', re_longdan: '龙胆',
    liyong: '厉勇', yijue: '义绝', yajiao: '涯角',
  })[id] || id;
}

function hpFishHtml(hp, max) {
  const cls = hp >= max ? 'full' : hp === 1 ? 'last' : 'hurt';
  const empty = '<span class="hp-fish empty"></span>'.repeat(Math.max(0, max - hp));
  const filled = `<span class="hp-fish ${cls}"></span>`.repeat(Math.max(0, hp));
  return `<span class="hp-fish-col">${empty}${filled}</span>`;
}

function generalCardHtml(p, s, extra = '') {
  const meId = myId(s);
  const roleText = s.mode === 'duel'
    ? (p.role === 'player' ? '你' : '敌')
    : s.mode === 'duel_pvp'
      ? '对手'
      : (p.role === 'landlord' ? '主' : '农');
  const showRole = p.id !== meId && s.mode !== 'duel' && s.mode !== 'duel_pvp';
  const selected = s.you.hand.find(c => c.id === ui.selectedCard);
  const canTarget = !!(ui.pendingAction && ui.pendingAction.needsTarget)
    || !!(selected && playActions(selected).some(a => a.needsTarget));
  const hp = Math.max(0, p.hp);
  const eq = p.equips || {};
  const eqRow = (slot, c, label, range) => `<div class="gc-equip ${slot}">${
    c ? `<b>${label}${c.name}</b>${range && c.range ? `<span>${c.range}</span>` : ''}` : ''
  }</div>`;
  const eqHtml = `<div class="gc-equips">
    ${eqRow('weapon', eq.weapon, '', true)}
    ${eqRow('armor', eq.armor, '')}
    ${eqRow('horse1', eq.horse1, '+1 ')}
    ${eqRow('horse2', eq.horse2, '-1 ')}
  </div>`;
  return `<div class="gc-wrap ${extra} ${p.jiu ? 'jiu' : ''} ${p.isCurrent ? 'current' : ''} ${ui.selectedTarget === p.id ? 'target' : ''} ${canTarget && p.alive && p.id !== meId ? 'targetable' : ''}" data-player-id="${p.id}">
    <div class="gc-side">
      <div class="gc-side-top">
        <div class="gc-side-faction">${p.general.faction}</div>
        <div class="gc-side-name">${p.general.name}</div>
      </div>
      <div class="gc-side-hp">${hpFishHtml(hp, p.maxHp)}</div>
      <div class="gc-side-hand">
        <span class="hand-fan">
          <span class="fan-card c1"></span>
          <span class="fan-card c2"><span class="hand-num">${p.handCount}</span></span>
          <span class="fan-card c3"></span>
        </span>
      </div>
    </div>
    <div class="gc ${p.isCurrent ? 'current' : ''} ${!p.alive ? 'dead' : ''}">
      <div class="gc-art"><img class="gc-portrait" src="/assets/generals/${p.general.portrait}" alt="${p.general.name}" draggable="false"></div>
      <div class="gc-hair"><img class="gc-portrait" src="/assets/generals/${p.general.portrait}" alt="" draggable="false"></div>
      ${p.chained ? '<div class="gc-chained"></div>' : ''}
      ${p.yijueSealed ? '<div class="gc-seal">义绝·封印</div>' : ''}
      ${p.judges && p.judges.length ? `<div class="gc-judges">判定：${p.judges.map(n => `<span>${n}</span>`).join('')}</div>` : ''}
      ${eqHtml}
      ${showRole ? `<div class="gc-role ${p.role}">${roleText}</div>` : ''}
      ${p.isCurrent ? '<div class="gc-turn">行动中</div>' : ''}
      ${!p.alive ? '<div class="gc-dead">阵亡</div>' : ''}
    </div>
  </div>`;
}

function tableGameHtml() {
  const s = ui.state;
  const you = s.you;
  const me = s.players.find(p => p.id === myId(s));
  const opponents = s.players.filter(p => p.id !== myId(s));
  const current = s.players.find(p => p.id === s.currentPlayer);
  const pending = s.pending;
  const myPending = pending && pending.playerId === myId(s);
  const isMyTurn = s.currentPlayer === myId(s);

  return `<div class="game dz">
    <header class="topbar">
      <div class="brand">三国杀 <span>${s.mode === 'duel' ? '人机对战' : s.mode === 'duel_pvp' ? '1v1 联机' : '斗地主'}</span></div>
      <div class="top-meta">
        <span class="room-badge">房间 ${s.room}</span>
        <span class="turn-badge">第 ${s.turn} 轮</span>
        <span class="phase-badge">${PHASE_CN[s.phase] || s.phase}</span>
      </div>
      <button class="btn ghost" data-action="toggle-sound" title="音效">${ui.sound ? '🔊' : '🔇'}</button>
    </header>
    <button class="btn ghost exit-btn" data-action="leave">退出</button>
    ${ui.connecting ? '<div class="banner reconnect">网络断开，正在重连…</div>' : ''}
    ${s.gameOver ? gameOverHtml() : ''}
    <main class="dz-table">
      <section class="dz-opponents">
        ${opponents.map(p => generalCardHtml(p, s)).join('')}
      </section>
      ${s.log && s.log.length ? `<div class="banner">${escapeHtml(bannerText(s.log[s.log.length - 1], s))}</div>` : ''}
    </main>
    <div class="bottom-hud">
      <section class="dz-prompt">
        ${controlsHtml(s, you, current, pending, myPending, isMyTurn)}
      </section>
      <section class="dz-self">
        <div class="dz-hand">${you.hand.map(c => cardHtml(c, s)).join('') || '<div class="empty">没有手牌</div>'}</div>
        <div class="dz-skill-col">
          ${(me.general.skills || []).map(x => { const used = (x === 'yijue' && s.you && s.you.yijueUsed); return `<button class="skill-btn ${ui.activeSkill === x || (x === 'yijue' && ui.yijueStage) ? 'active' : ''} ${used ? 'used' : ''}" data-skill-act="${x}" ${used ? 'disabled' : ''}>${skillName(x)}${used ? '（已用）' : ''}</button>`; }).join('')}
        </div>
        ${generalCardHtml(me, s, 'gc-self')}
      </section>
    </div>
    <footer class="hint">${you.general.desc}</footer>
    ${judgmentHtml(s)}
    ${wuguHtml(s)}
  </div>`;
}

function judgmentHtml(s) {
  const j = s.lastJudgment;
  if (!j || ui.judgmentSeen === j.seq) return '';
  const m = /【([^】]+)】/.exec(j.text || '');
  const reason = m ? m[1] : '判定';
  const result = j.card ? `${SUIT_CN[j.card.suit]}${j.card.number} ${j.card.name}` : '无牌';
  return `<div class="judge-overlay"><div class="judge-panel">
    <div class="judge-title">判定</div>
    <div class="judge-row">
      <div class="judge-col"><div class="judge-card reason">${reason}</div><small>判定牌</small></div>
      <div class="judge-col"><div class="judge-card">${result}</div><small>判定结果</small></div>
    </div>
    <div class="judge-text">${escapeHtml(j.text || '')}</div>
  </div></div>`;
}

function dzOpponentHtml(p, s) {
  const isTarget = ui.selectedTarget === p.id;
  const selected = s.you.hand.find(c => c.id === ui.selectedCard);
  const hasTargetAction = !!(selected && playActions(selected).some(a => a.needsTarget));
  const canTarget = !!(ui.pendingAction && ui.pendingAction.needsTarget) || hasTargetAction;
  const me = s.players.find(x => x.id === myId(s));
  const relation = (s.mode === 'duel' || s.mode === 'duel_pvp') ? '敌人' : (me.role === 'landlord' ? '敌人' : (p.role === 'landlord' ? '敌人' : '队友'));
  return `<div class="dz-opponent ${p.alive ? '' : 'dead'} ${p.isCurrent ? 'current' : ''} ${isTarget ? 'target' : ''} ${canTarget && p.alive ? 'targetable' : ''}" data-player-id="${p.id}">
    <img class="crest" src="/assets/ui/crest-gold.png" alt="" draggable="false">
    <div class="dz-role ${p.role}">${ROLE_CN[p.role] || p.role}</div>
    <div class="portrait-wrap">
      <img class="dz-portrait" src="/assets/generals/${p.general.portrait}" alt="${p.general.name}" draggable="false">
      <div class="name-banner">${p.general.name}</div>
    </div>
    <div class="dz-name">${escapeHtml(p.name)}</div>
    <div class="dz-hp">${hearts(p.hp, p.maxHp)}</div>
    <div class="dz-meta">手牌 ${p.handCount}${p.judgeCount ? ` · 判定 ${p.judgeCount}` : ''}</div>
    <div class="dz-relation">${relation}</div>
    ${p.isCurrent ? '<div class="dz-turn">行动中</div>' : ''}
    ${!p.alive ? '<div class="dz-dead">阵亡</div>' : ''}
  </div>`;
}

function duelGameHtml() {
  const s = ui.state;
  const you = s.you;
  const current = s.players.find(p => p.id === s.currentPlayer);
  const pending = s.pending;
  const myPending = pending && pending.playerId === myId(s);
  const isMyTurn = s.currentPlayer === myId(s);

  return `<div class="game">
    <header class="topbar">
      <div class="brand">三国杀 <span>${s.mode === 'duel' ? '人机对战' : s.mode === 'duel_pvp' ? '1v1 联机' : '斗地主'}</span></div>
      <div class="top-meta">
        <span class="room-badge">房间 ${s.room}</span>
        <span class="turn-badge">第 ${s.turn} 轮</span>
        <span class="phase-badge">${PHASE_CN[s.phase] || s.phase}</span>
      </div>
      <button class="btn ghost" data-action="leave">离开</button>
    </header>
    ${s.gameOver ? gameOverHtml() : ''}
    <main class="board">
      <section class="players">${s.players.map(p => playerHtml(p, s)).join('')}</section>
      <aside class="log"><h3>战报</h3><div class="log-list">${s.log.map(l => `<div class="log-line">${escapeHtml(l)}</div>`).join('')}</div></aside>
    </main>
    <section class="self">
      <div class="self-head">
        <div class="self-general">
          <img class="avatar small" src="/assets/generals/${you.general.portrait}" alt="${you.general.name}" draggable="false">
          <span class="g-name">${you.general.name}</span>
          <span class="g-faction">${you.general.faction}</span>
          <span class="g-role">${ROLE_CN[you.role] || you.role}</span>
        </div>
        <div class="self-hp">${hearts(you.hp, you.maxHp)}</div>
      </div>
      <div class="hand">${you.hand.map(c => cardHtml(c, s)).join('') || '<div class="empty">没有手牌</div>'}</div>
      ${you.judge.length ? `<div class="judge-area">判定区：${you.judge.map(c => `<span class="judge-tag">${c.name}</span>`).join('')}</div>` : ''}
    </section>
    <section class="controls">${controlsHtml(s, you, current, pending, myPending, isMyTurn)}</section>
    <footer class="hint">${you.general.desc}</footer>
  </div>`;
}

function gameOverHtml() {
  const g = ui.state.gameOver;
  return `<div class="gameover"><div class="go-card">
    <div class="go-title">${g.text}</div>
    <div class="go-sub">${g.winner === 'player' ? '你赢了' : g.winner === 'ai' ? 'AI 赢了' : ''}</div>
    <button class="btn primary" data-action="leave">返回大厅</button>
  </div></div>`;
}

function playerHtml(p, s) {
  const isMe = p.id === myId(s);
  const isTarget = ui.selectedTarget === p.id;
  const canTarget = !!(ui.pendingAction && ui.pendingAction.needsTarget);
  return `<div class="player ${p.alive ? '' : 'dead'} ${p.isCurrent ? 'current' : ''} ${isTarget ? 'target' : ''} ${canTarget && p.alive && !isMe ? 'targetable' : ''}" data-player-id="${p.id}">
    <div class="p-top">
      <span class="p-name">${escapeHtml(p.name)}${isMe ? '<span class="you-tag">你</span>' : ''}</span>
      <span class="p-role ${p.role}">${ROLE_CN[p.role] || p.role}</span>
    </div>
    <div class="p-body">
      <img class="avatar" src="/assets/generals/${p.general.portrait}" alt="${p.general.name}" draggable="false">
      <div class="p-info">
        <div class="p-general"><span class="g-name">${p.general.name}</span><span class="g-faction">${p.general.faction}</span></div>
        <div class="p-hp">${hearts(p.hp, p.maxHp)}</div>
        <div class="p-meta"><span>手牌 ${p.handCount}</span>${p.judgeCount ? `<span>判定 ${p.judgeCount}</span>` : ''}</div>
      </div>
    </div>
    ${p.isCurrent ? '<div class="turn-dot">行动中</div>' : ''}
    ${!p.alive ? '<div class="dead-mask">阵亡</div>' : ''}
  </div>`;
}

function cardHtml(c, s) {
  const selected = ui.selectedCard === c.id;
  const discardSelected = ui.discardSet.has(c.id);
  const usable = isCardUsable(c, s);
  const color = c.color === 'red' ? 'red' : 'black';
  const long = c.name.length >= 4;
  return `<div class="card ${color} namelen-${c.name.length} ${selected ? 'selected' : ''} ${discardSelected ? 'discard-selected' : ''} ${usable ? 'usable' : 'muted'}" data-card-id="${c.id}" style="--art:url('/assets/cards/${c.art}')">
    <div class="c-top">
      <span class="c-num">${c.number}</span>
      <span class="c-suit">${SUIT_CN[c.suit]}</span>
    </div>
    <div class="c-name">${c.name}</div>
    ${c.type === 'basic' ? '' : `<div class="c-tag"><span>${c.type === 'equip' ? '装备' : CARD_TYPE_CN[c.type] || ''}</span></div>`}
    <div class="c-art"></div>
  </div>`;
}

function canUseAsSha(card) {
  const g = ui.state?.you?.general;
  if (!g) return false;
  if (ui.state?.you?.yijueSealed) return false;
  if (['sha', 'huosha', 'leisha'].includes(card.key)) return true;
  const a = ui.activeSkill;
  if ((a === 'wusheng' || a === 're_wusheng') && card.color === 'red') return true;
  if ((a === 'longdan' || a === 're_longdan') && card.key === 'shan') return true;
  return false;
}

function canUseAsShan(card) {
  const g = ui.state?.you?.general;
  if (!g) return false;
  if (ui.state?.you?.yijueSealed) return false;
  if (card.key === 'shan') return true;
  const a = ui.activeSkill;
  if ((a === 'longdan' || a === 're_longdan') && card.key === 'sha') return true;
  return false;
}

function pickTiesuoTarget(cardId, id) {
  if (!ui.tiesuoTargets) ui.tiesuoTargets = [];
  if (!ui.tiesuoTargets.includes(id)) ui.tiesuoTargets.push(id);
  ui.selectedTarget = id;
  renderLocal();
  if (ui.tiesuoTargets.length >= 2) {
    const ids = ui.tiesuoTargets.slice();
    ui.tiesuoTargets = [];
    sendAction({ type: 'play', cardId, as: 'tiesuo', targetIds: ids });
  }
}

function playActions(card) {
  const you = ui.state?.you;
  if (!you) return [];
  const acts = [];
  const canSha = canUseAsSha(card);
  const zhuge = you.equips && you.equips.weapon && you.equips.weapon.key === 'zhuge';
  const shaAllowed = you.general.skills.includes('paoxiao') || you.general.skills.includes('re_paoxiao') || zhuge || you.shaUsed < 1;
  const fangtian = !!(you.equips && you.equips.weapon && you.equips.weapon.key === 'fangtian' && card.key === 'sha' && you.hand.length === 1);
  const a = ui.activeSkill;
  let shaLabel = fangtian ? '出【杀】（方天画戟·双目标）' : '出【杀】';
  if (!['sha', 'huosha', 'leisha'].includes(card.key)) {
    if ((a === 'wusheng' || a === 're_wusheng') && card.color === 'red') shaLabel = '武圣：当【杀】使用';
    else if ((a === 'longdan' || a === 're_longdan') && card.key === 'shan') shaLabel = '龙胆：当【杀】使用';
  }
  const conversion = !['sha', 'huosha', 'leisha'].includes(card.key)
    && ((a === 'wusheng' || a === 're_wusheng') && card.color === 'red' || (a === 'longdan' || a === 're_longdan') && card.key === 'shan');
  if (canSha && shaAllowed) {
    const act = { label: shaLabel, as: 'sha', needsTarget: true, fangtian };
    // 已发动武圣/龙胆时，转化【杀】优先于卡牌原本功能（装备/锦囊等）
    if (conversion) acts.unshift(act); else acts.push(act);
  }
  if (canSha && shaAllowed && you.equips && you.equips.weapon && you.equips.weapon.key === 'zhuque' && card.key === 'sha') {
    acts.push({ label: '火【杀】（朱雀羽扇）', as: 'sha', fire: true, needsTarget: true });
  }
  if (card.type === 'equip') acts.push({ label: `装备【${card.name}】`, as: card.key, needsTarget: false });
  if (card.key === 'jiu' && (you.jiuUsed || 0) < 1) acts.push({ label: '使用【酒】', as: 'jiu', needsTarget: false });
  if (card.key === 'tiesuo') acts.push({ label: '重铸【铁索连环】', as: 'tiesuo_recast', needsTarget: false });
  if (card.key === 'tao' && you.hp < you.maxHp) acts.push({ label: '使用【桃】', as: 'tao', needsTarget: false });
  const tricks = ['juedou', 'guohe', 'shunshou', 'wuzhong', 'nanman', 'wanjian', 'bingliang', 'jiedao', 'taoyuan', 'wugu', 'lebu', 'shandian', 'huogong', 'tiesuo'];
  if (tricks.includes(card.key)) {
    const needsTarget = ['juedou', 'guohe', 'shunshou', 'bingliang', 'jiedao', 'lebu', 'huogong', 'tiesuo'].includes(card.key);
    acts.push({ label: `使用【${card.name}】`, as: card.key, needsTarget });
  }
  return acts;
}

function isCardUsable(card, s) {
  if (s.pending && s.pending.playerId === myId(s)) {
    const type = s.pending.type;
    if (type === 'discard') return true;
    if (type === 'yajiao_discard') return true;
    if (type === 'cixiong') return true;
    if (type === 'guanshi') return true;
    if (type === 'yijue') return true;
    if (type === 'shan' || type === 'wanjian') return canUseAsShan(card);
    if (type === 'duel' || type === 'nanman') return canUseAsSha(card);
    if (type === 'tao') return card.key === 'tao' || (card.key === 'jiu' && s.pending.dyingId === myId(s));
    if (type === 'wuxie') return card.key === 'wuxie';
    return false;
  }
  if (s.phase === 'play' && s.currentPlayer === myId(s)) return playActions(card).length > 0;
  return false;
}

function zonesHtml(z, opts) {
  if (!z) return '';
  const sel = id => opts.multi && ui.hanbingSet.has(id);
  const face = (c) => `<div class="zone-card ${sel(c.id) ? 'selected' : ''}" data-zone-card="${c.id}">
    <span class="zc-suit ${c.color === 'red' ? 'red' : ''}">${SUIT_CN[c.suit]}${c.number}</span>
    <b>${c.name}</b></div>`;
  const back = (c) => `<div class="zone-card back ${sel(c.id) ? 'selected' : ''}" data-zone-card="${c.id}"><span>?</span></div>`;
  const empty = (t) => `<div class="zone-slot">${t}</div>`;
  const eqNames = { weapon: '武器牌', armor: '防具牌', horse1: '+1马', horse2: '-1马' };
  const eqRow = `<div class="zone-row"><div class="zone-label">装备牌</div><div class="zone-cards">${
    Object.keys(eqNames).map(k => z.equips[k] ? face(z.equips[k]) : empty(eqNames[k])).join('')
  }</div></div>`;
  const judgeRow = opts.showJudge
    ? `<div class="zone-row"><div class="zone-label">延时锦囊牌</div><div class="zone-cards">${
        z.judge.length ? z.judge.map(face).join('') : '<div class="zone-empty">无</div>'
      }</div></div>`
    : '';
  return `<div class="zones-panel">
    <div class="zone-row"><div class="zone-label">手牌</div><div class="zone-cards">${
      z.hand.length ? z.hand.map(back).join('') : '<div class="zone-empty">无</div>'
    }</div></div>
    ${eqRow}${judgeRow}
  </div>`;
}

function zoneModalHtml(s, pending) {
  if (pending.type === 'hanbing' && s.hanbing) {
    return `<div class="zone-modal" id="zoneModal">
      <div class="zm-title">${escapeHtml(pending.prompt || '寒冰剑')}</div>
      ${zonesHtml(s.hanbing.zones, { multi: true, showJudge: false })}
      <div class="zm-sub">已选 ${ui.hanbingSet.size} / ${s.hanbing.count}（至少 1 张）</div>
      <div class="btn-row">
        <button class="btn primary" data-action="hanbing-confirm" ${ui.hanbingSet.size >= 1 && ui.hanbingSet.size <= s.hanbing.count ? '' : 'disabled'}>弃置所选</button>
        <button class="btn ghost" data-action="hanbing-pass">放弃（正常造成伤害）</button>
      </div>
    </div>`;
  }
  if (pending.type === 'pick' && s.pick) {
    return `<div class="zone-modal" id="zoneModal">
      <div class="zm-title">${escapeHtml(pending.prompt || '')}</div>
      ${zonesHtml(s.pick.zones, { multi: false, showJudge: true })}
      <div class="zm-sub">点击一张牌${s.pick.mode === 'guohe' ? '弃置' : '获得'}（手牌为背面）</div>
    </div>`;
  }
  return '';
}

function syncZoneModal(s) {
  const layer = document.getElementById('fx');
  if (!layer) return;
  const old = document.getElementById('zoneModal');
  const show = !!(s && s.started && s.pending && s.pending.playerId === myId(s)
    && (s.pending.type === 'pick' || s.pending.type === 'hanbing'));
  if (!show) { if (old) old.remove(); return; }
  const html = zoneModalHtml(s, s.pending);
  if (!html) { if (old) old.remove(); return; }
  if (old) old.outerHTML = html;
  else layer.insertAdjacentHTML('beforeend', html);
}

function controlsHtml(s, you, current, pending, myPending, isMyTurn) {
  const body = _controlsHtml(s, you, current, pending, myPending, isMyTurn);
  if (pending && myPending) {
    const bar = `<div class="play-timer"><div class="pt-fill" id="ptFill"></div><div class="pt-text">${escapeHtml(pending.prompt || '')}</div></div>`;
    return `<div class="pending-wrap">${bar}${body}</div>`;
  }
  return body;
}

function _controlsHtml(s, you, current, pending, myPending, isMyTurn) {
  if (s.gameOver) return '';
  if (pending && myPending) {
    if (pending.type === 'discard') {
      return `<div class="control-box">
        <div class="prompt">${pending.prompt}</div>
        <div class="sub">已选 ${ui.discardSet.size} / ${pending.count}</div>
        <div class="btn-row">
          <button class="btn primary" data-action="discard-confirm" ${ui.discardSet.size === pending.count ? '' : 'disabled'}>确认弃牌</button>
          <button class="btn ghost" data-action="cancel">取消</button>
        </div>
      </div>`;
    }
    if (pending.type === 'hanbing' && s.hanbing) {
      return `<div class="control-box waiting"><div class="prompt">${escapeHtml(pending.prompt || '寒冰剑')}</div></div>`;
    }

    if (pending.type === 'yajiao') {
      return `<div class="control-box pick-box">
        <div class="prompt">${escapeHtml(pending.prompt || '涯角：选择一名角色')}</div>
        <div class="sub">点击任意武将（可以给自己）</div>
      </div>`;
    }

    if (pending.type === 'yajiao_discard') {
      return `<div class="control-box">
        <div class="prompt">${escapeHtml(pending.prompt || '请弃置一张牌')}</div>
        <div class="sub">已选 ${ui.discardSet.size} / 1</div>
        <div class="btn-row">
          <button class="btn primary" data-action="yajiao-discard-confirm" ${ui.discardSet.size === 1 ? '' : 'disabled'}>确认弃牌</button>
        </div>
      </div>`;
    }

    if (pending.type === 'yijue') {
      return `<div class="control-box pick-box">
        <div class="prompt">${escapeHtml(pending.prompt || '义绝：请选择一张手牌展示')}</div>
        <div class="sub">点击一张手牌展示给对方</div>
      </div>`;
    }

    if (pending.type === 'jiedao') {
      return `<div class="control-box pick-box">
        <div class="prompt">${escapeHtml(pending.prompt || '借刀杀人')}</div>
        <div class="sub">点击手牌中的【杀】对其出杀，或交出武器</div>
        <button class="btn ghost" data-action="jiedao-pass">交出武器</button>
      </div>`;
    }

    if (pending.type === 'wugu' && s.wugu) {
      return `<div class="control-box">
        <div class="prompt">五谷丰登：请在屏幕中央选择一张牌</div>
      </div>`;
    }

    if (pending.type === 'huogong' && s.huogong) {
      if (!document.querySelector('.play-card.persist[data-card-id="' + s.huogong.shown.id + '"]')) {
        showCenterCard(s.huogong.shown, null, true);
      }
      return `<div class="control-box">
        <div class="prompt">火攻：目标展示了【${s.huogong.shown.name}】，是否弃置一张同花色手牌？</div>
        <div class="btn-row">
          ${(s.huogong.same || []).map(c => `<button class="btn" data-pick-id="${c.id}">${SUIT_CN[c.suit]}${c.number} ${c.name}</button>`).join('')}
          <button class="btn ghost" data-action="huogong-pass">跳过</button>
        </div>
        <div class="sub">不弃置则不造成伤害</div>
      </div>`;
    }

    if (pending.type === 'cixiong') {
      return `<div class="control-box">
        <div class="prompt">${escapeHtml(pending.prompt || '')}</div>
        <div class="sub">点击一张手牌弃置，或点下方让对方摸牌</div>
        <div class="btn-row"><button class="btn ghost" data-action="cixiong-pass">让其摸一张牌</button></div>
      </div>`;
    }

    if (pending.type === 'guanshi') {
      return `<div class="control-box">
        <div class="prompt">${escapeHtml(pending.prompt || '')}</div>
        <div class="sub">已选 ${ui.discardSet.size} / 2</div>
        <div class="btn-row">
          <button class="btn primary" data-action="guanshi-confirm" ${ui.discardSet.size === 2 ? '' : 'disabled'}>弃两张牌并强制命中</button>
          <button class="btn ghost" data-action="guanshi-pass">放弃</button>
        </div>
      </div>`;
    }

    if (pending.type === 'qinglong' || pending.type === 'qilin' || pending.type === 'yijue_heal') {
      const prefix = pending.type === 'qinglong' ? 'qinglong' : (pending.type === 'qilin' ? 'qilin' : 'yijue-heal');
      const yesText = pending.type === 'yijue_heal' ? '令其回复' : '发动';
      return `<div class="control-box">
        <div class="prompt">${escapeHtml(pending.prompt || '')}</div>
        <div class="btn-row">
          <button class="btn primary" data-action="${prefix}-yes">${yesText}</button>
          <button class="btn ghost" data-action="${prefix}-no">放弃</button>
        </div>
      </div>`;
    }

    if (pending.type === 'pick') {
      const pick = s.pick;
      if (!pick) return `<div class="control-box waiting"><div class="prompt">${escapeHtml(pending.prompt || '')}</div></div>`;
      return `<div class="control-box waiting"><div class="prompt">${escapeHtml(pending.prompt || '')}</div></div>`;
    }
    return `<div class="prompt-line">
      <span class="prompt">${escapeHtml(pending.prompt || '')}${you.yijueSealed ? '（义绝封印中，不能使用手牌）' : ''}${ui.activeSkill ? `　已发动【${skillName(ui.activeSkill)}】` : ''}</span>
      <button class="btn ghost" data-action="cancel">取消</button>
    </div>`;
  }
  if (pending && !myPending) {
    const p = s.players.find(x => x.id === pending.playerId);
    return `<div class="control-box waiting"><div class="prompt">等待 ${p ? p.name : '其他玩家'} 响应…</div></div>`;
  }
  if (s.phase === 'play' && isMyTurn) {
    const selected = you.hand.find(c => c.id === ui.selectedCard);
    let tip = ui.activeSkill ? `已发动【${skillName(ui.activeSkill)}】，请选择对应的牌` : '出牌阶段，请选择1张牌';
    if (ui.yijueStage === 'card') tip = '义绝：请点击一张要弃置的牌';
    else if (ui.yijueStage === 'target') tip = '义绝：请点击目标角色（需有手牌）';
    if (selected) {
      const act = playActions(selected)[0];
      if (!act) tip = `已选【${selected.name}】，这张牌现在不能使用`;
      else if (ui.pendingAction && ui.pendingAction.needsTarget) tip = `已选【${selected.name}】，请点击目标`;
      else if (ui.jiedaoFirst) tip = '借刀杀人：请点击被出杀的角色';
      else if (act.needsTarget) tip = `已选【${selected.name}】，点目标出牌，或再点一次使用`;
      else tip = `已选【${selected.name}】，再点一次使用，或点其他牌换选`;
    }
    const zhangba = you.equips && you.equips.weapon && you.equips.weapon.key === 'zhangba' && you.hand.length >= 2;
    const fangtianPick = !!(ui.pendingAction && ui.pendingAction.fangtian);
    const fireOpt = !!selected && !ui.pendingAction && you.equips && you.equips.weapon
      && you.equips.weapon.key === 'zhuque' && selected.key === 'sha';
    return `<div class="play-bar">
      <div class="play-timer"><div class="pt-fill" id="ptFill"></div><div class="pt-text">${ui.zhangba ? '丈八蛇矛：请点选两张手牌' : tip}</div></div>
      ${fangtianPick ? `<button class="btn primary" data-action="fangtian-confirm">确定目标（${ui.pendingAction.fangtianIds.length}）</button>` : ''}
      ${fireOpt ? '<button class="btn ghost" data-action="fire-sha">火【杀】</button>' : ''}
      ${zhangba ? '<button class="btn ghost" data-action="zhangba">丈八蛇矛</button>' : ''}
      <button class="btn endplay-text" data-action="end-play">结束出牌</button>
    </div>`;
  }
  return `<div class="control-box waiting"><div class="prompt">等待 ${current ? current.name : '其他玩家'} 出牌…</div></div>`;
}

// ---------------- 交互 ----------------
function isHandCard(el) {
  return !!el.closest('.hand') || !!el.closest('.dz-hand');
}

function tryDragPlay(cardId, playerId) {
  const s = ui.state;
  if (!s || s.phase !== 'play' || s.currentPlayer !== myId(s) || s.pending) return false;
  const card = s.you.hand.find(c => c.id === cardId);
  if (!card) return false;
  const acts = playActions(card);
  const skillSha = ui.activeSkill ? acts.find(a => a.as === 'sha') : null;
  const act = skillSha || acts.find(a => a.as === card.key && a.needsTarget) || acts.find(a => a.needsTarget);
  if (!act) return false;
  sendAction({ type: 'play', cardId, as: act.as, targetId: playerId });
  return true;
}

document.addEventListener('input', (e) => {
  if (e.target.id === 'nameInput') ui.name = e.target.value;
  if (e.target.id === 'codeInput') ui.code = e.target.value;
});

document.addEventListener('mousedown', (e) => {
  if (e.target.closest('[data-general-id]')) { e.preventDefault(); return; }
  const cardEl = e.target.closest('[data-card-id]');
  if (!cardEl || !isHandCard(cardEl)) return;
  ui.drag = { id: cardEl.dataset.cardId, x: e.clientX, y: e.clientY, moved: false };
});

document.addEventListener('mousemove', (e) => {
  if (!ui.drag) return;
  if (Math.abs(e.clientX - ui.drag.x) > 8 || Math.abs(e.clientY - ui.drag.y) > 8) ui.drag.moved = true;
});

document.addEventListener('mouseup', (e) => {
  if (!ui.drag) return;
  const d = ui.drag;
  ui.drag = null;
  if (!d.moved) return;
  const playerEl = e.target.closest('[data-player-id]');
  if (playerEl) {
    if (tryDragPlay(d.id, playerEl.dataset.playerId)) {
      ui.suppressClick = true;
      setTimeout(() => { ui.suppressClick = false; }, 0);
    }
  }
});

document.addEventListener('contextmenu', (e) => {
  const card = e.target.closest('.general-card[data-general-id]');
  if (!card) return;
  e.preventDefault();
  const list = (ui.state && ui.state.generals) || [];
  const g = list.find(x => x.id === card.dataset.generalId);
  if (!g) return;
  ui.skillView = { general: g, equips: {}, hp: g.hp, maxHp: g.hp };
  render();
});

document.addEventListener('click', (e) => {
  if (ui.skillView) { ui.skillView = null; render(); return; }
  if (ui.suppressClick) { ui.suppressClick = false; return; }
  const hbEl = e.target.closest('[data-hanbing-id]');
  if (hbEl) {
    const id = hbEl.dataset.hanbingId;
    if (ui.hanbingSet.has(id)) ui.hanbingSet.delete(id);
    else ui.hanbingSet.add(id);
    renderLocal();
    return;
  }
  const zcEl = e.target.closest('[data-zone-card]');
  if (zcEl) {
    const id = zcEl.dataset.zoneCard;
    const pend = ui.state && ui.state.pending;
    if (pend && pend.type === 'hanbing') {
      if (ui.hanbingSet.has(id)) ui.hanbingSet.delete(id);
      else if (ui.hanbingSet.size < (ui.state.hanbing?.count || 2)) ui.hanbingSet.add(id);
      renderLocal();
      return;
    }
    if (pend && pend.type === 'pick') {
      sendAction({ type: 'respond', cardId: id });
      return;
    }
  }
  if (e.target.closest('[data-skill-act]') && ui.state && ui.state.started) {
    const me = ui.state.players.find(p => p.id === myId(ui.state));
    const id = e.target.closest('[data-skill-act]').dataset.skillAct;
    const LOCK = ['paoxiao', 're_paoxiao', 'liyong', 'yingzi'];
    if (LOCK.includes(id)) {
      if (me) { ui.skillView = me; render(); }
      return;
    }
    if (id === 'yijue') {
      ui.yijueStage = ui.yijueStage ? null : 'card';
      ui.yijueCard = null;
      ui.activeSkill = null;
      ui.selectedCard = null;
      ui.pendingAction = null;
      render();
      return;
    }
    ui.activeSkill = ui.activeSkill === id ? null : id;
    ui.selectedCard = null;
    ui.pendingAction = null;
    ui.jiedaoFirst = null;
    render();
    return;
  }

  const modeEl = e.target.closest('[data-mode]');
  if (modeEl && e.target.closest('[data-action="create"]')) {
    createRoom(modeEl.dataset.mode);
    return;
  }

  const generalEl = e.target.closest('[data-general-id]');
  if (generalEl) {
    if (generalEl.dataset.taken) return;
    ui.selectedGeneral = generalEl.dataset.generalId;
    render();
    return;
  }

  const pickEl = e.target.closest('[data-pick-id]');
  if (pickEl) {
    sendAction({ type: 'respond', cardId: pickEl.dataset.pickId });
    return;
  }

    const cardEl = e.target.closest('[data-card-id]');
  if (cardEl) {
    const id = cardEl.dataset.cardId;
    const s = ui.state;
    if (!s) return;
    if (ui.yijueStage === 'target') {
      const cc = s.you.hand.find(x => x.id === id);
      if (cc) { ui.yijueCard = id; ui.yijueStage = 'card'; renderLocal(); return; }
    }
    if (ui.yijueStage === 'card') {
      const c = s.you.hand.find(x => x.id === id);
      if (!c) return;
      ui.yijueCard = id;
      ui.yijueStage = 'target';
      renderLocal();
      return;
    }
    if (s.pending && s.pending.playerId === myId(s) && (s.pending.type === 'discard' || s.pending.type === 'yajiao_discard' || s.pending.type === 'guanshi')) {
      if (ui.discardSet.has(id)) ui.discardSet.delete(id);
      else if (ui.discardSet.size < s.pending.count) ui.discardSet.add(id);
      renderLocal();
      return;
    }
    if (s.pending && s.pending.playerId === myId(s) && s.pending.type !== 'pick') {
      const responseCard = s.you.hand.find(c => c.id === id);
      if (responseCard) {
        const valid = (s.pending.type === 'shan' || s.pending.type === 'wanjian') ? canUseAsShan(responseCard)
          : (s.pending.type === 'duel' || s.pending.type === 'nanman') ? canUseAsSha(responseCard)
          : s.pending.type === 'jiedao' ? canUseAsSha(responseCard)
          : s.pending.type === 'yijue' ? true
          : s.pending.type === 'cixiong' ? true
          : s.pending.type === 'wuxie' ? responseCard.key === 'wuxie'
          : s.pending.type === 'tao' ? (responseCard.key === 'tao' || (responseCard.key === 'jiu' && s.pending.dyingId === myId(s))) : false;
        if (valid) { sendAction({ type: 'respond', cardId: id }); return; }
        if (s.you.yijueSealed) addToast('你被【义绝】封印：本回合不能使用或打出手牌');
        else if (ui.activeSkill) addToast('这张牌不能用于当前响应');
      }
      ui.selectedCard = id;
      renderLocal();
      return;
    }
    const card = s.you.hand.find(c => c.id === id);
    if (ui.zhangba) {
      if (!card) return;
      if (ui.zhangbaCards.includes(id)) ui.zhangbaCards = ui.zhangbaCards.filter(x => x !== id);
      else if (ui.zhangbaCards.length < 2) ui.zhangbaCards.push(id);
      if (ui.zhangbaCards.length === 2) {
        ui.pendingAction = { as: 'zhangba_sha', needsTarget: true, cardIds: ui.zhangbaCards.slice() };
        ui.zhangba = false;
      }
      renderLocal();
      return;
    }
    if (s.phase === 'play' && s.currentPlayer === myId(s) && !s.pending && card) {
      if (ui.selectedCard === id) {
        const act = playActions(card)[0];
        if (act) {
          if (act.needsTarget) {
            ui.pendingAction = { as: act.as, needsTarget: true };
            ui.selectedTarget = null;
            renderLocal();
          } else {
            sendAction({ type: 'play', cardId: id, as: act.as });
            ui.selectedCard = null;
            ui.pendingAction = null;
          }
        }
        return;
      }
      ui.selectedCard = id;
      ui.selectedTarget = null;
      ui.pendingAction = null;
      ui.jiedaoFirst = null;
      renderLocal();
      return;
    }
    ui.selectedCard = (ui.selectedCard === id ? null : id);
    ui.selectedTarget = null;
    ui.pendingAction = null;
    renderLocal();
    return;
  }

  const playerEl = e.target.closest('[data-player-id]');
  if (playerEl) {
    const id = playerEl.dataset.playerId;
    const p = ui.state.players.find(x => x.id === id);

    if (ui.yijueStage === 'target' && p && p.alive) {
      if (id === myId(ui.state)) { ui.error = '义绝不能选择自己'; render(); return; }
      const cardId = ui.yijueCard;
      ui.yijueStage = null;
      ui.yijueCard = null;
      sendAction({ type: 'play', as: 'yijue', cardIds: [cardId], targetId: id });
      return;
    }

    if (ui.state.pending && ui.state.pending.type === 'yajiao'
      && ui.state.pending.playerId === myId(ui.state) && p && p.alive) {
      if (ui.yajiaoSent) return;
      ui.yajiaoSent = true;
      sendAction({ type: 'respond', targetId: id });
      setTimeout(() => { ui.yajiaoSent = false; }, 1000);
      return;
    }

    // 选牌后直接点目标立绘出牌
    const selfCard = ui.selectedCard ? ui.state.you.hand.find(c => c.id === ui.selectedCard) : null;
    const isTiesuo = (ui.pendingAction && ui.pendingAction.as === 'tiesuo') || (selfCard && selfCard.key === 'tiesuo');
    const allowSelf = !!isTiesuo || !!(selfCard && selfCard.key === 'jiedao') || !!(ui.pendingAction && ui.pendingAction.as === 'jiedao');
    const canPick = p && p.alive && (id !== myId(ui.state) || allowSelf);

    if (!ui.pendingAction && ui.selectedCard && canPick) {
      const card = selfCard;
      const acts = card ? playActions(card) : [];
      const skillSha = ui.activeSkill ? acts.find(a => a.as === 'sha') : null;
      const act = skillSha || acts.find(a => a.as === card.key && a.needsTarget) || acts.find(a => a.needsTarget);
      if (act) {
        if (act.as === 'tiesuo') { pickTiesuoTarget(card.id, id); return; }
        if (act.as === 'jiedao') {
          if (!ui.jiedaoFirst) {
            const t = ui.state.players.find(x => x.id === id);
            if (!t || !t.equips || !t.equips.weapon) { ui.error = '请选择装备武器的角色'; render(); return; }
            ui.jiedaoFirst = id;
            ui.selectedTarget = id;
            renderLocal();
            return;
          }
          if (id === ui.jiedaoFirst) { ui.error = '出杀目标必须是另一名角色'; render(); return; }
          const first = ui.jiedaoFirst;
          ui.jiedaoFirst = null;
          sendAction({ type: 'play', cardId: card.id, as: 'jiedao', targetId: first, victimId: id });
          return;
        }
        if (act.fangtian) {
          ui.pendingAction = { as: 'sha', needsTarget: true, fangtian: true, fangtianIds: [id] };
          ui.selectedTarget = id;
          renderLocal();
          return;
        }
        sendAction({ type: 'play', cardId: card.id, as: act.as, fire: !!act.fire, targetId: id });
        return;
      }
    }

    // 已经进入选目标模式
    if (ui.pendingAction && ui.pendingAction.needsTarget && canPick) {
      if (ui.pendingAction.as === 'tiesuo') { pickTiesuoTarget(ui.selectedCard, id); return; }
      if (ui.pendingAction.as === 'zhangba_sha') {
        sendAction({ type: 'play', as: 'zhangba_sha', cardIds: ui.pendingAction.cardIds, targetId: id });
        ui.pendingAction = null;
        return;
      }
      if (ui.pendingAction.fangtian) {
        if (!ui.pendingAction.fangtianIds.includes(id) && ui.pendingAction.fangtianIds.length < 3) {
          ui.pendingAction.fangtianIds.push(id);
        }
        renderLocal();
        return;
      }
      ui.selectedTarget = id;
      renderLocal();
      sendAction({ type: 'play', cardId: ui.selectedCard, as: ui.pendingAction.as, fire: !!ui.pendingAction.fire, targetId: id });
      return;
    }
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'create') { createRoom(btn.dataset.mode); return; }
  if (action === 'join') { joinRoom(); return; }
  if (action === 'copy') {
    const link = location.origin + '/?room=' + ui.state.room;
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => { ui.error = '邀请链接已复制'; render(); });
    return;
  }
  if (action === 'start') { startGame(); return; }
  if (action === 'start-duel') { startGame(btn.dataset.general || ui.selectedGeneral); return; }
  if (action === 'leave') { leave(); return; }
  if (action === 'toggle-sound') {
    ui.sound = !ui.sound;
    localStorage.setItem('sgs_sound', ui.sound ? '1' : '0');
    render();
    return;
  }

  if (action === 'huogong-pass') {
    sendAction({ type: 'respond', pass: true });
    return;
  }

  if (action === 'huogong-pick') {
    const btn = e.target.closest('[data-card-id]');
    const cid = btn && btn.getAttribute('data-card-id');
    if (cid) sendAction({ type: 'respond', cardId: cid });
    return;
  }

  if (action === 'jiedao-pass') {
    sendAction({ type: 'respond', pass: true });
    return;
  }

  if (action === 'cixiong-pass') {
    sendAction({ type: 'respond', pass: true });
    return;
  }

  if (action === 'guanshi-confirm') {
    sendAction({ type: 'respond', cardIds: [...ui.discardSet] });
    ui.discardSet.clear();
    return;
  }

  if (action === 'guanshi-pass') {
    sendAction({ type: 'respond', pass: true });
    return;
  }

  if (action === 'qinglong-yes' || action === 'qilin-yes' || action === 'yijue-heal-yes') {
    sendAction({ type: 'respond' });
    return;
  }

  if (action === 'qinglong-no' || action === 'qilin-no' || action === 'yijue-heal-no') {
    sendAction({ type: 'respond', pass: true });
    return;
  }

  if (action === 'fangtian-confirm') {
    const ids = (ui.pendingAction && ui.pendingAction.fangtianIds) || [];
    if (ids.length) sendAction({ type: 'play', cardId: ui.selectedCard, as: 'sha', targetIds: ids });
    ui.pendingAction = null;
    return;
  }

  if (action === 'fire-sha') {
    ui.pendingAction = { as: 'sha', fire: true, needsTarget: true };
    renderLocal();
    return;
  }

  if (action === 'hanbing-confirm') {
    sendAction({ type: 'respond', cardIds: [...ui.hanbingSet] });
    ui.hanbingSet.clear();
    return;
  }

  if (action === 'respond-card') {
    sendAction({ type: 'respond', cardId: btn.dataset.cardId });
    return;
  }

  if (action === 'respond-card') {
    sendAction({ type: 'respond', cardId: btn.dataset.cardId });
    return;
  }

  if (action === 'hanbing-pass') {
    sendAction({ type: 'respond', pass: true });
    return;
  }

  if (action === 'yajiao-discard-confirm') {
    sendAction({ type: 'respond', cardIds: [...ui.discardSet] });
    ui.discardSet.clear();
    return;
  }

  if (action === 'zhangba') {
    ui.zhangba = !ui.zhangba;
    ui.zhangbaCards = [];
    ui.pendingAction = null;
    ui.selectedCard = null;
    renderLocal();
    return;
  }

  if (action === 'play') {
    const as = btn.dataset.as;
    const needsTarget = btn.dataset.target === '1';
    if (needsTarget) {
      ui.pendingAction = { as, needsTarget: true };
      ui.selectedTarget = null;
      render();
    } else {
      sendAction({ type: 'play', cardId: ui.selectedCard, as });
    }
    return;
  }
  if (action === 'play-confirm') {
    sendAction({ type: 'play', cardId: ui.selectedCard, as: ui.pendingAction.as, targetId: ui.selectedTarget });
    return;
  }
  if (action === 'confirm-play') {
    const cs = ui.state;
    if (!cs) return;
    if (ui.pendingAction && ui.selectedTarget) {
      sendAction({ type: 'play', cardId: ui.selectedCard, as: ui.pendingAction.as, targetId: ui.selectedTarget });
      return;
    }
    const card = cs.you.hand.find(c => c.id === ui.selectedCard);
    if (!card) return;
    const acts = playActions(card);
    if (acts.length === 1) {
      if (acts[0].needsTarget) {
        ui.pendingAction = acts[0];
        ui.selectedTarget = null;
        render();
      } else {
        sendAction({ type: 'play', cardId: card.id, as: acts[0].as });
      }
    }
    return;
  }
  if (action === 'cancel') {
    const cs = ui.state;
    if (cs && cs.pending && cs.pending.playerId === myId(cs)) {
      if (cs.pending.type === 'discard') {
        ui.discardSet.clear();
        renderLocal();
        return;
      }
      if (cs.pending.type === 'pick') return;
      sendAction({ type: 'respond', pass: true });
      return;
    }
    ui.selectedCard = null;
    ui.selectedTarget = null;
    ui.pendingAction = null;
    renderLocal();
    return;
  }
  if (action === 'close-judgment') {
    if (ui.state && ui.state.lastJudgment) ui.judgmentSeen = ui.state.lastJudgment.seq;
    const buffered = ui.pendingState;
    ui.pendingState = null;
    render();
    if (buffered) applyState(buffered);
    return;
    render();
    return;
  }
  if (action === 'end-play') { sendAction({ type: 'endPlay' }); return; }

  if (action === 'respond-shan' || action === 'respond-sha' || action === 'respond-tao' || action === 'respond-wuxie') {
    sendAction({ type: 'respond', cardId: ui.selectedCard });
    return;
  }
  if (action === 'respond-pass') { sendAction({ type: 'respond', pass: true }); return; }
  if (action === 'respond-cancel') {
    ui.selectedCard = null;
    renderLocal();
    return;
  }

  if (action === 'discard-confirm') {
    sendAction({ type: 'discard', cardIds: [...ui.discardSet] });
    return;
  }
  if (action === 'discard-cancel') {
    ui.discardSet.clear();
    renderLocal();
    return;
  }
});

// ---------------- 启动 ----------------
window.addEventListener('resize', () => requestAnimationFrame(layoutHand));
window.addEventListener('orientationchange', () => setTimeout(layoutHand, 250));

document.addEventListener('contextmenu', (e) => {
  const el = e.target.closest('[data-player-id]');
  if (!el || !ui.state || !ui.state.started) return;
  const p = ui.state.players.find(x => x.id === el.dataset.playerId);
  if (!p) return;
  e.preventDefault();
  ui.skillView = p;
  render();
});

let pressTimer = null;
const clearPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
document.addEventListener('touchstart', (e) => {
  const el = e.target.closest('[data-player-id]');
  if (!el || !ui.state || !ui.state.started) return;
  const id = el.dataset.playerId;
  pressTimer = setTimeout(() => {
    const p = ui.state.players.find(x => x.id === id);
    if (!p) return;
    ui.suppressClick = true;
    ui.skillView = p;
    render();
  }, 550);
}, { passive: true });
document.addEventListener('touchend', clearPress);
document.addEventListener('touchmove', clearPress, { passive: true });

document.getElementById('rotateBtn')?.addEventListener('click', async () => {
  try {
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) await el.requestFullscreen();
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
  } catch (e) {
    // iOS 不支持锁定方向，手动旋转手机即可
  }
});

loadModes().then(() => {
  if (ui.room && ui.playerId) connect();
  else render();
});














// 摸牌：两张重叠牌背从屏幕中心飞向手牌区
function playDrawFx(ev) {
  const s = ui.state;
  if (!s) return;
  const self = ev.playerId === myId(s);
  const target = self
    ? document.querySelector('.dz-hand')
    : document.querySelector('.gc-wrap[data-player-id="' + ev.playerId + '"]');
  if (!target) return;
  const tr = target.getBoundingClientRect();
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const wrap = document.createElement('div');
  wrap.className = 'draw-fly';
  wrap.style.left = cx + 'px';
  wrap.style.top = cy + 'px';
  wrap.innerHTML = '<img class="df-card a" src="/assets/ui/cardback3.png"><img class="df-card b" src="/assets/ui/cardback3.png">';
  (document.getElementById('fx') || document.body).appendChild(wrap);
  const dx = (tr.left + tr.width / 2) - cx;
  const dy = (tr.top + tr.height / 2) - cy;
  requestAnimationFrame(() => {
    wrap.style.transition = 'transform 1.8s cubic-bezier(.2,.7,.3,1), opacity 1.8s ease';
    wrap.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.55)';
    wrap.style.opacity = '0';
  });
  setTimeout(() => wrap.remove(), 2100);
}






// 五谷丰登：屏幕中央的大号待选牌（手牌同款牌面）
function wuguHtml(s) {
  if (!(s.pending && s.pending.type === 'wugu' && s.pending.playerId === myId(s) && s.wugu)) return '';
  const cards = s.wugu.cards || [];
  return `<div class="modal-mask wugu-mask"><div class="wugu-modal">
    <h2>五谷丰登 · 选择一张牌</h2>
    <div class="wugu-cards">
      ${cards.map(c => `<div class="card ${c.color === 'red' ? 'red' : 'black'}" data-pick-id="${c.id}" style="--art:url('/assets/cards/${c.art}')">
        <div class="c-top"><span class="c-suit">${SUIT_CN[c.suit]}</span><span class="c-num">${c.number}</span><span class="c-type">${CARD_TYPE_CN[c.type] || ''}</span></div>
        <div class="c-name">${c.name}</div><div class="c-art"></div>
      </div>`).join('')}
    </div>
  </div></div>`;
}








































function showEquipFlight(card, playerId, fromEl) {
  if (!card) return;
  const holder = document.createElement('div');
  holder.className = 'equip-fly';
  holder.innerHTML = centerFaceHtml(card);
  document.body.appendChild(holder);
  const face = holder.querySelector('.card');
  if (!face) { holder.remove(); return; }
  const tr = face.getBoundingClientRect();
  if (fromEl && fromEl.getBoundingClientRect) {
    const sr = fromEl.getBoundingClientRect();
    if (sr.width > 0) {
      const dx = (sr.left + sr.width / 2) - (tr.left + tr.width / 2);
      const dy = (sr.top + sr.height / 2) - (tr.top + tr.height / 2);
      const sc = Math.max(0.2, Math.min(1, sr.width / Math.max(1, tr.width)));
      try { face.animate([{ transform: `translate(${dx}px,${dy}px) scale(${sc})`, opacity: .5 }, { transform: 'translate(0,0) scale(1)', opacity: 1 }], { duration: 1200, easing: 'cubic-bezier(.2,.7,.3,1)' }); } catch (e) {}
    }
  }
  setTimeout(() => {
    const gc = document.querySelector('.gc-wrap[data-player-id="' + playerId + '"]');
    if (gc) {
      const gr = gc.getBoundingClientRect();
      const dx = (gr.left + gr.width / 2) - (tr.left + tr.width / 2);
      const dy = (gr.top + gr.height / 2) - (tr.top + tr.height / 2);
      try { face.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(.45)`, opacity: 0 }], { duration: 900, easing: 'ease-in', fill: 'forwards' }); } catch (e) {}
    }
    setTimeout(() => holder.remove(), 950);
  }, 3200);
}





// 兜底计时器：每 100ms 刷新进度条，避免 rAF 被中断导致倒计时不动
setInterval(() => {
  const fill = document.getElementById('ptFill');
  if (!fill || !ui.timerDeadline) return;
  const left = ui.timerDeadline - Date.now();
  fill.style.width = Math.max(0, Math.min(100, left / 200)) + '%';
  if (left <= 0 && !ui.timerAutoDone) {
    ui.timerAutoDone = true;
    try { onTimerExpired(); } catch (e) { /* ignore */ }
  }
}, 100);





