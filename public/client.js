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
  const oldLog = ui.state && Array.isArray(ui.state.log) ? ui.state.log : [];
  const newLines = diffLog(oldLog, ns.log || []);
  ui.state = ns;
  ui.connecting = false;
  ui.starting = false;
  ui.startStatus = '';
  ui.selectedCard = null;
  ui.selectedTarget = null;
  ui.pendingAction = null;
  ui.discardSet.clear();
  ui.error = '';
  render();
  if (newLines.length) {
    newLines.slice(-4).forEach((line, i) => setTimeout(() => triggerFx(line, ns), i * 180));
  }
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

let playCardTimer = null;
function showCardFx(cardName, sourceName, targetName, s) {
  const root = fxRoot();
  if (!root) return;
  let el = root.querySelector('.fx-card');
  if (!el) {
    el = document.createElement('div');
    el.className = 'fx-card';
    root.appendChild(el);
  }
  const art = CARD_ART[cardName] || 'sha';
  el.innerHTML = `<img src="/assets/cards/${art}.png" alt=""><div class="fx-card-name">${escapeHtml(cardName)}</div>`;
  // 重新触发 1 秒动画；1 秒内再有牌打出就覆盖并重新计时
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  if (playCardTimer) clearTimeout(playCardTimer);
  playCardTimer = setTimeout(() => {
    el.remove();
    playCardTimer = null;
  }, 1000);

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
    else if (m[3] === '杀' && src && src.general && src.general.skills.includes('paoxiao')) playSound('paoxiao');
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
  const r = await post('/api/action', { room: ui.room, player: ui.playerId, action });
  if (!r.ok) { ui.error = r.error; render(); return; }
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
    app.innerHTML = ui.state.selecting ? generalHtml() : roomHtml();
    requestAnimationFrame(layoutHand);
    return;
  }
  app.innerHTML = gameHtml() + skillModalHtml();
  requestAnimationFrame(layoutHand);
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
          <div class="skill-sub">${p.hp}/${p.maxHp} 血 · 手牌 ${p.handCount}</div>
        </div>
      </div>
      <div class="skill-desc-list">
        ${(g.skills || []).map(id => `<div class="skill-desc-item"><b>${skillName(id)}</b><p>${escapeHtml(g.desc || '')}</p></div>`).join('')}
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
    el.classList.toggle('selected', id === ui.selectedCard);
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
    <div class="sub" style="text-align:center;margin-top:10px;opacity:.45">v55</div>
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
    <div class="sub" style="text-align:center;margin-bottom:8px;opacity:.45">地址：${location.origin} · v55</div>
    <div class="general-grid">
      ${list.map(g => {
        const taken = isPvp && oppGenId === g.id;
        return `<div class="general-card ${chosenId === g.id ? 'selected' : ''} ${taken ? 'taken' : ''}" data-general-id="${g.id}"${taken ? ' data-taken="1"' : ''}>
          <img class="general-portrait" src="/assets/generals/${g.portrait}" alt="${g.name}" draggable="false">
          <div class="general-info">
            <div class="g-name">${g.name}</div>
            <div class="g-faction">${g.faction} · ${g.hp} 血</div>
            <div class="general-skills">${g.desc}</div>
            ${taken ? '<div class="g-taken">对手已选</div>' : ''}
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
    <div class="sub" style="text-align:center;margin-top:10px;opacity:.45">v55</div>
  </div></div>`;
}

function gameHtml() {
  return tableGameHtml();
}

function skillName(id) {
  return ({ wusheng: '武圣', paoxiao: '咆哮', longdan: '龙胆', yingzi: '英姿' })[id] || id;
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
  const eqHtml = (eq.weapon || eq.armor || eq.horse1 || eq.horse2)
    ? `<div class="gc-equips">
        ${eq.weapon ? `<div class="gc-equip weapon"><b>${eq.weapon.name}</b><span>${eq.weapon.range}</span></div>` : ''}
        ${eq.armor ? `<div class="gc-equip armor"><b>${eq.armor.name}</b></div>` : ''}
        ${eq.horse1 ? `<div class="gc-equip horse"><b>+1 ${eq.horse1.name}</b></div>` : ''}
        ${eq.horse2 ? `<div class="gc-equip horse"><b>-1 ${eq.horse2.name}</b></div>` : ''}
      </div>`
    : '';
  return `<div class="gc-wrap ${extra} ${p.isCurrent ? 'current' : ''} ${ui.selectedTarget === p.id ? 'target' : ''} ${canTarget && p.alive && p.id !== meId ? 'targetable' : ''}" data-player-id="${p.id}">
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
          ${(me.general.skills || []).map(x => `<button class="skill-btn" data-skill-view="1">${skillName(x)}</button>`).join('')}
        </div>
        ${generalCardHtml(me, s, 'gc-self')}
      </section>
    </div>
    <footer class="hint">${you.general.desc}</footer>
    ${judgmentHtml(s)}
  </div>`;
}

function judgmentHtml(s) {
  const j = s.lastJudgment;
  if (!j || ui.judgmentSeen === j.seq) return '';
  const card = j.card ? `${SUIT_CN[j.card.suit]}${j.card.number}` : '';
  return `<div class="modal-mask"><div class="modal judge-modal">
    <h2>判定</h2>
    <div class="judge-card">${j.card ? `<span class="jc-suit ${j.card.color === 'red' ? 'red' : ''}">${card}</span><b>${j.card.name}</b>` : '无牌'}</div>
    <p class="judge-text">${escapeHtml(j.text)}</p>
    <button class="btn primary" data-action="close-judgment">确定</button>
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
  return `<div class="card ${color} ${selected ? 'selected' : ''} ${discardSelected ? 'discard-selected' : ''} ${usable ? 'usable' : 'muted'}" data-card-id="${c.id}" style="--art:url('/assets/cards/${c.art}')">
    <div class="c-top">
      <span class="c-suit">${SUIT_CN[c.suit]}</span>
      <span class="c-num">${c.number}</span>
      <span class="c-type">${c.type === 'equip' ? `装备${c.range ? ' ' + c.range : ''}` : (CARD_TYPE_CN[c.type] || '')}</span>
    </div>
    <div class="c-name">${c.name}</div>
    <div class="c-art"></div>
  </div>`;
}

function canUseAsSha(card) {
  const g = ui.state?.you?.general;
  if (!g) return false;
  if (['sha', 'huosha', 'leisha'].includes(card.key)) return true;
  if (g.skills.includes('wusheng') && card.color === 'red') return true;
  if (g.skills.includes('longdan') && card.key === 'shan') return true;
  return false;
}

function canUseAsShan(card) {
  const g = ui.state?.you?.general;
  if (!g) return false;
  if (card.key === 'shan') return true;
  if (g.skills.includes('longdan') && card.key === 'sha') return true;
  return false;
}

function playActions(card) {
  const you = ui.state?.you;
  if (!you) return [];
  const acts = [];
  const canSha = canUseAsSha(card);
  const zhuge = you.equips && you.equips.weapon && you.equips.weapon.key === 'zhuge';
  const shaAllowed = you.general.skills.includes('paoxiao') || zhuge || you.shaUsed < 1;
  if (canSha && shaAllowed) acts.push({ label: '出【杀】', as: 'sha', needsTarget: true });
  if (card.type === 'equip') acts.push({ label: `装备【${card.name}】`, as: card.key, needsTarget: false });
  if (card.key === 'jiu' && (you.jiuUsed || 0) < 1) acts.push({ label: '使用【酒】', as: 'jiu', needsTarget: false });
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
    if (type === 'shan' || type === 'wanjian') return canUseAsShan(card);
    if (type === 'duel' || type === 'nanman') return canUseAsSha(card);
    if (type === 'tao') return card.key === 'tao' || card.key === 'jiu';
    if (type === 'wuxie') return card.key === 'wuxie';
    return false;
  }
  if (s.phase === 'play' && s.currentPlayer === myId(s)) return playActions(card).length > 0;
  return false;
}

function controlsHtml(s, you, current, pending, myPending, isMyTurn) {
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
    if (pending.type === 'pick') {
      const pick = s.pick;
      if (!pick) return `<div class="control-box waiting"><div class="prompt">${escapeHtml(pending.prompt || '')}</div></div>`;
      return `<div class="control-box pick-box">
        <div class="prompt">${escapeHtml(pending.prompt || '')}</div>
        <div class="pick-cards">
          ${pick.cards.map(c => c.hidden
            ? `<div class="pick-card back" data-pick-id="${c.id}"><span>?</span><small>手牌</small></div>`
            : `<div class="pick-card ${c.zone}" data-pick-id="${c.id}"><span class="pick-suit ${c.color === 'red' ? 'red' : ''}">${SUIT_CN[c.suit]}${c.number}</span><b>${c.name}</b><small>${c.zone === 'judge' ? '判定区' : c.zone === 'equip' ? '装备区' : '手牌'}</small></div>`
          ).join('')}
        </div>
        <div class="sub">点击一张牌${pick.mode === 'guohe' ? '弃置' : '获得'}</div>
      </div>`;
    }
    return `<div class="prompt-line">
      <span class="prompt">${escapeHtml(pending.prompt || '')}</span>
      <button class="btn ghost" data-action="cancel">取消</button>
    </div>`;
  }
  if (pending && !myPending) {
    const p = s.players.find(x => x.id === pending.playerId);
    return `<div class="control-box waiting"><div class="prompt">等待 ${p ? p.name : '其他玩家'} 响应…</div></div>`;
  }
  if (s.phase === 'play' && isMyTurn) {
    const selected = you.hand.find(c => c.id === ui.selectedCard);
    let tip = '出牌阶段，请选择1张牌';
    if (selected) {
      const act = playActions(selected)[0];
      if (!act) tip = `已选【${selected.name}】，这张牌现在不能使用`;
      else if (ui.pendingAction && ui.pendingAction.needsTarget) tip = `已选【${selected.name}】，请点击目标`;
      else if (act.needsTarget) tip = `已选【${selected.name}】，点目标出牌，或再点一次使用`;
      else tip = `已选【${selected.name}】，再点一次使用，或点其他牌换选`;
    }
    return `<div class="play-bar">
      <div class="play-tip">${tip}</div>
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
  const act = acts.find(a => a.as === card.key && a.needsTarget) || acts.find(a => a.needsTarget);
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

document.addEventListener('click', (e) => {
  if (ui.skillView) { ui.skillView = null; render(); return; }
  if (ui.suppressClick) { ui.suppressClick = false; return; }
  if (e.target.closest('[data-skill-view]') && ui.state && ui.state.started) {
    const me = ui.state.players.find(p => p.id === myId(ui.state));
    if (me) { ui.skillView = me; render(); return; }
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
    if (s.pending && s.pending.playerId === myId(s) && s.pending.type === 'discard') {
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
          : s.pending.type === 'wuxie' ? responseCard.key === 'wuxie'
          : s.pending.type === 'tao' ? responseCard.key === 'tao' : false;
        if (valid) { sendAction({ type: 'respond', cardId: id }); return; }
      }
      ui.selectedCard = id;
      renderLocal();
      return;
    }
    const card = s.you.hand.find(c => c.id === id);
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

    // 选牌后直接点目标立绘出牌
    if (!ui.pendingAction && ui.selectedCard && p && p.alive && id !== myId(ui.state)) {
      const card = ui.state.you.hand.find(c => c.id === ui.selectedCard);
      const acts = card ? playActions(card) : [];
      const act = acts.find(a => a.as === card.key && a.needsTarget) || acts.find(a => a.needsTarget);
      if (act) { sendAction({ type: 'play', cardId: card.id, as: act.as, targetId: id }); return; }
    }

    // 已经进入选目标模式
    if (ui.pendingAction && ui.pendingAction.needsTarget && p && p.alive && id !== myId(ui.state)) {
      ui.selectedTarget = id;
      renderLocal();
      sendAction({ type: 'play', cardId: ui.selectedCard, as: ui.pendingAction.as, targetId: id });
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
