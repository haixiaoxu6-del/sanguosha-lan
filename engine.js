'use strict';

const {
  GENERALS, ROLE_SETS, ROLE_CN, SUIT_CN,
  shuffle, buildDeck,
} = require('./data');
const { CONVERSIONS, LOCKS, DRAW_TRIGGERS, DAMAGE_TRIGGERS, JUDGE_HOOKS, matchFrom } = require('./skills');

function ok() { return { ok: true }; }
function err(msg) { return { ok: false, error: msg }; }

// 阶段技能注册表：phase = 触发阶段，locked = 锁定技（自动执行）
const PHASE_SKILLS = {
  guanxing: { phase: 'prepare', locked: false },
  biyue: { phase: 'end', locked: true },
  tuxi: { phase: 'draw', locked: false },
};

class Game {
  constructor(playerInfos, mode = 'doudizhu') {
    if (!ROLE_SETS[mode]) throw new Error('不支持的模式: ' + mode);
    if (ROLE_SETS[mode].length !== playerInfos.length) {
      throw new Error('人数与模式不匹配: ' + playerInfos.length);
    }
    this.mode = mode;
    this.n = playerInfos.length;
    // 斗地主随机座位；1v1（含真人联机）保持顺序
    const shuffled = (mode === 'duel' || mode === 'duel_pvp' || mode === 'doudizhu' || mode === 'doudizhu_ai') ? playerInfos.slice() : shuffle(playerInfos.slice());
    this.players = shuffled.map((info, i) => ({
      id: info.id,
      name: info.name,
      generalId: info.generalId || null,
      isAI: !!info.isAI,
      preRole: info.preRole || null,
      seat: i,
      role: null,
      general: null,
      hp: 0,
      maxHp: 0,
      hand: [],
      judge: [],
      equips: { weapon: null, armor: null, horse1: null, horse2: null },
      chained: false,
      yijueSealed: false,
      alive: true,
      flags: { shaUsed: 0, jiuUsed: 0, jiu: false, yijueUsed: 0, yijueTarget: null },
    }));
    this.deck = buildDeck();
    this.discard = [];
    this.current = 0;
    this.phase = 'init';
    this.pending = null;
    this.turn = 0;
    this.log = [];
    this.events = [];
    this.eventSeq = 0;
    this.revealSeq = 0;
    this.lastReveal = null;
    this.gameOver = null;
    this.started = false;
    this.assignRoles();
    this.assignGenerals();
  }

  // ---------------- 初始化 ----------------
  assignRoles() {
    if (this.mode === 'duel') {
      this.players[0].role = 'player';
      this.players[1].role = 'ai';
      return;
    }
    if (this.mode === 'duel_pvp') {
      for (const p of this.players) p.role = 'player';
      return;
    }
    // 斗地主：0 号位地主，1/2 号位农民（players 已打乱）
    if (this.mode === 'doudizhu_ai') {
      for (const p of this.players) {
        p.isAI = !!p.isAI;
        p.role = p.preRole || (p.isAI ? 'farmer' : 'landlord');
      }
      return;
    }
    this.players[0].role = 'landlord';
    for (let i = 1; i < this.n; i++) this.players[i].role = 'farmer';
  }

  assignGenerals() {
    const used = new Set();
    for (let i = 0; i < this.n; i++) {
      const p = this.players[i];
      let g = null;
      if ((this.mode === 'duel' || this.mode === 'duel_pvp' || this.mode === 'doudizhu_ai') && p.generalId && !p.isAI) {
        g = GENERALS.find(x => x.id === p.generalId) || null;
      }
      if (!g) {
        const pool = GENERALS.filter(x => !used.has(x.id));
        g = pool.length ? pool[Math.floor(Math.random() * pool.length)] : GENERALS[i % GENERALS.length];
      }
      used.add(g.id);
      p.general = { ...g, skills: g.skills.slice() };
      if (p.isAI || p.role === 'ai') p.name = g.name;
      p.maxHp = g.hp + (p.role === 'landlord' ? 1 : 0);
      p.hp = p.maxHp;
      // 地主额外获得英姿
      if (p.role === 'landlord' && !p.general.skills.includes('yingzi')) {
        p.general.skills.push('yingzi');
      }
    }
  }

  start() {
    if (this.started) return;
    this.started = true;
    for (const p of this.players) this.draw(p, 4, true);
    if (this.mode === 'doudizhu' || this.mode === 'doudizhu_ai') {
      const li = this.players.findIndex(p => p.role === 'landlord');
      this.current = li >= 0 ? li : 0;
    } else {
      this.current = 0;
    }
    this.turn = 1;
    const firstText = this.mode === 'duel'
      ? '游戏开始，你先手'
      : this.mode === 'duel_pvp'
        ? `游戏开始，${this.currentPlayer().name} 先手`
        : '游戏开始，地主先手';
    this.beginTurn();
  }

  // ---------------- 基础工具 ----------------
  pushLog(text) {
    this.log.push(text);
    if (this.log.length > 300) this.log.shift();
  }

  pushEvent(type, data) {
    const ev = { id: ++this.eventSeq, type, ...data };
    this.events.push(ev);
    if (this.events.length > 60) this.events.shift();
    return ev;
  }

  runPhaseSkills(phase) {
    const p = this.currentPlayer();
    if (!p || !p.general) return;
    for (const sid of (p.general.skills || [])) {
      const t = PHASE_SKILLS[sid];
      if (!t || t.phase !== phase) continue;
      if (sid === 'guanxing') {
        if (!this.hasSkill(p, 'guanxing')) continue;
        if (t.locked) {
          const n = this.players.filter(q => q.alive).length < 4 ? 3 : 5;
          const cards = this.deck.splice(0, Math.min(n, this.deck.length));
          this.gxAuto = { playerId: p.id, cards };
        } else {
          this.pending = { type: 'guanxing', playerId: p.id, stage: 'ask' };
          this.gxResume = 'begin';
          return;
        }
      } else if (sid === 'tuxi') {
        if (t.locked) continue;
        if (this._tuxiDone) continue;
        this.pending = { type: 'tuxi_ask', playerId: p.id };
        return;
      } else if (sid === 'biyue') {
        this.draw(p, 1);
        this.pushLog(`${p.name} 发动【闭月】摸一张牌`);
      }
    }
  }

  shaLimitOf(p) {
    return (p && p.role === 'landlord' && (this.mode === 'doudizhu' || this.mode === 'doudizhu_ai')) ? 2 : 1;
  }

  onPhaseStart(phase) {
    const p = this.currentPlayer();
    this.pushEvent('phase', { phase, playerId: p ? p.id : null });
  }

  currentPlayer() { return this.players[this.current]; }
  findPlayer(id) { return this.players.find(p => p.id === id); }
  hasSkill(p, s) {
    if (!(p && p.general && p.general.skills.includes(s))) return false;
    if (p.skillSealed && !['paoxiao', 're_paoxiao'].includes(s)) return false;
    return true;
  }

  distance(a, b) {
    let d = Math.abs(a.seat - b.seat);
    d = Math.min(d, this.n - d);
    if (b.equips && b.equips.horse1) d += 1;
    if (a.equips && a.equips.horse2) d -= 1;
    return Math.max(1, d);
  }

  cardCount(p) {
    let n = p.hand.length + p.judge.length;
    if (p.equips) for (const c of Object.values(p.equips)) if (c) n++;
    return n;
  }

  heal(p, n) {
    p.hp = Math.min(p.maxHp, p.hp + n);
    this.pushLog(`${p.name} 回复${n}点体力（${p.hp}/${p.maxHp}）`);
  }

  othersInSeatOrder(p) {
    const res = [];
    for (let i = 1; i < this.n; i++) {
      const q = this.players[(p.seat + i) % this.n];
      if (q.alive && q.id !== p.id) res.push(q);
    }
    return res;
  }

  drawCard() {
    if (this.deck.length === 0) {
      if (this.discard.length === 0) return null;
      this.deck = shuffle(this.discard);
      this.discard = [];
      this.pushLog('牌堆已重新洗牌');
    }
    return this.deck.shift();
  }

  draw(p, n, silent) {
    const cards = [];
    for (let i = 0; i < n; i++) {
      const c = this.drawCard();
      if (!c) break;
      p.hand.push(c);
      cards.push(c);
    }
    if (cards.length && !silent) { this.pauseUntil = Math.max(this.pauseUntil || 0, Date.now() + 2500); this.pauseReason = 'draw'; }
    if (cards.length && !silent) this.pushEvent('draw', { playerId: p.id, count: cards.length, cards: cards.map(c => ({ id: c.id, name: c.name, suit: c.suit, number: c.number, color: c.color, type: c.type, art: c.art })) });
    return cards;
  }

  findCardById(id) {
    for (const p of this.players) {
      let c = p.hand.find(x => x.id === id);
      if (c) return c;
      c = p.judge.find(x => x.id === id);
      if (c) return c;
      if (p.equips) {
        c = Object.values(p.equips).find(x => x && x.id === id);
        if (c) return c;
      }
    }
    return this.discard.find(x => x.id === id) || this.deck.find(x => x.id === id) || null;
  }

  removeFromPlayer(p, card) {
    let idx = p.hand.findIndex(c => c.id === card.id);
    if (idx >= 0) return p.hand.splice(idx, 1)[0];
    idx = p.judge.findIndex(c => c.id === card.id);
    if (idx >= 0) return p.judge.splice(idx, 1)[0];
    if (p.equips) {
      for (const k of Object.keys(p.equips)) {
        if (p.equips[k] && p.equips[k].id === card.id) {
          const c = p.equips[k];
          p.equips[k] = null;
          return c;
        }
      }
    }
    return null;
  }

  takeRandomCard(p) {
    const pool = [...p.hand, ...p.judge];
    if (pool.length === 0) return null;
    const card = pool[Math.floor(Math.random() * pool.length)];
    return this.removeFromPlayer(p, card);
  }

  // ---------------- 回合流程 ----------------
  nextAliveIndex(from) {
    // 斗地主类：逆时针（座位号递减）
    const dir = (this.mode === 'doudizhu' || this.mode === 'doudizhu_ai') ? -1 : 1;
    for (let i = 1; i <= this.n; i++) {
      const idx = ((from + dir * i) % this.n + this.n) % this.n;
      if (this.players[idx].alive) return idx;
    }
    return from;
  }

  startTurnDraw(p, count) {
    if (process.env.DSH_DEBUG) console.log('[startTurnDraw]', count, 'picks', this._tuxiPicks);
    const cards = [];
    for (let i = 0; i < count; i++) { const c = this.drawCard(); if (c) cards.push(c); }
    this.pendingDraw = { playerId: p.id, cards };
    this.pushEvent('draw', { playerId: p.id, count: cards.length, cards: cards.map(c => ({ id: c.id, name: c.name, suit: c.suit, number: c.number, color: c.color, type: c.type, art: c.art })) });
    this.pending = { type: 'draw_ack', playerId: p.id, prompt: '' };
    this.phase = 'play';
    this.onPhaseStart('play');
    this.runPhaseSkills('play');
  }

  tuxiFinish(source) {
    this._tuxiDone = true;
    const bonus = this.drawBonus(source);
    const remain = Math.max(0, 2 + bonus - (this._tuxiPicks || 0));
    this.startTurnDraw(source, remain);
  }

  tuxiAskPick(source, targets, idx) {
    if (idx >= targets.length) {
      this.tuxiFinish(source);
      return;
    }
    const t = targets[idx];
    this.pending = { type: 'tuxi_pick', playerId: source.id, targetId: t.id, index: 0, total: t.hand.length, prompt: `突袭：选择 ${t.name} 的一张手牌` };
  }

  beginTurn() {
    if (this.gameOver) return;
    const p = this.currentPlayer();
    if (!p || !p.alive) { this.endTurn(); return; }
    p.flags.shaUsed = 0;
    this._tuxiDone = false;
    this._tuxiPicks = 0;
    p.flags.jiuUsed = 0;
    p.flags.jiu = false;
    p.flags.liyong = false;
    p.flags.yijueUsed = 0;
    p.flags.yijueTarget = null;
    p.yijueSealed = false;
    p.skillSealed = false;
    this.phase = 'prepare';
    this.onPhaseStart('prepare');
    if (!this._gxSkip) {
      this.runPhaseSkills('prepare');
      if (this.pending && this.pending.type === 'guanxing') return;
    }
    this._gxSkip = false;
    this.phase = 'judge';
    this.onPhaseStart('judge');
    this.runPhaseSkills('judge');
    if (this.pending) return;

    let skipDraw = false;
    let skipPlay = false;
    let lastJudgment = null;
    for (const card of [...p.judge]) {
      if (!['bingliang', 'lebu', 'shandian'].includes(card.key)) continue;
      const jc = this.drawCard();
      if (jc) this.discard.push(jc);
      const idx = p.judge.findIndex(c => c.id === card.id);
      if (idx >= 0) p.judge.splice(idx, 1);
      if (card.key === 'bingliang') {
        const passed = !!(jc && jc.suit === 'club');
        const text = `【兵粮寸断】判定：${jc ? SUIT_CN[jc.suit] + jc.number : '无牌'}${passed ? '，通过' : '，跳过摸牌阶段'}`;
        this.pushLog(`${p.name} ${text}`);
        lastJudgment = {
          seq: (this.judgmentSeq = (this.judgmentSeq || 0) + 1),
          playerId: p.id,
          card: jc ? { id: jc.id, name: jc.name, suit: jc.suit, number: jc.number, color: jc.color } : null,
          passed,
          text,
        };
        if (!passed) skipDraw = true;
        this.discard.push(card);
      } else if (card.key === 'lebu') {
        const passed = !!(jc && jc.suit === 'heart');
        const text = `【乐不思蜀】判定：${jc ? SUIT_CN[jc.suit] + jc.number : '无牌'}${passed ? '，通过' : '，跳过出牌阶段'}`;
        this.pushLog(`${p.name} ${text}`);
        lastJudgment = {
          seq: (this.judgmentSeq = (this.judgmentSeq || 0) + 1),
          playerId: p.id,
          card: jc ? { id: jc.id, name: jc.name, suit: jc.suit, number: jc.number, color: jc.color } : null,
          passed,
          text,
          skipPlay: !passed,
        };
        if (!passed) skipPlay = true;
        this.discard.push(card);
      } else if (card.key === 'shandian') {
        const hit = !!(jc && jc.suit === 'spade' && jc.number >= 2 && jc.number <= 9);
        const text = `【闪电】判定：${jc ? SUIT_CN[jc.suit] + jc.number : '无牌'}${hit ? '，受到3点雷电伤害' : '，移动到下家'}`;
        this.pushLog(`${p.name} ${text}`);
        lastJudgment = {
          seq: (this.judgmentSeq = (this.judgmentSeq || 0) + 1),
          playerId: p.id,
          card: jc ? { id: jc.id, name: jc.name, suit: jc.suit, number: jc.number, color: jc.color } : null,
          passed: !hit,
          text,
        };
        if (hit) {
          this.discard.push(card);
          this.damage(p, 3, null, null, null);
          if (this.gameOver || !p.alive) { this.phase = 'over'; return; }
        } else {
          const others = this.othersInSeatOrder(p);
          if (others.length) others[0].judge.push(card);
          else this.discard.push(card);
        }
      }
    }
    if (lastJudgment) this.lastJudgment = lastJudgment;

    this.phase = 'draw';
    this.onPhaseStart('draw');
    if (skipDraw) {
      this.pushLog(`${p.name} 跳过摸牌阶段`);
    } else {
      const bonus = this.drawBonus(p);
      const drawCount = 2 + bonus;
      if (!skipPlay) {
        this.runPhaseSkills('draw');
        if (this.pending) return;
        this.startTurnDraw(p, drawCount);
        return;
      }
      this.draw(p, drawCount);
      this.pushLog(`${p.name} 摸${drawCount}张牌`);
      if (bonus > 0) this.pushLog(`${p.name} 的摸牌阶段额外摸${bonus}张牌`);
    }
    if (skipPlay) {
      this.pushLog(`${p.name} 跳过出牌阶段`);
      this.phase = 'discard';
      this.onPhaseStart('discard');
      this.checkDiscard();
      return;
    }
    this.phase = 'play';
    this.onPhaseStart('play');
  }

  endTurn() {
    if (this.gameOver) return;
    this.phase = 'end';
    this.onPhaseStart('end');
    const gxp = this.currentPlayer();
    if (this.gxAllBottom && gxp && this.hasSkill(gxp, 'guanxing') && this.gxResume !== 'end') {
      this.gxAllBottom = false;
      const gn = this.players.filter(q => q.alive).length < 4 ? 3 : 5;
      const gcards = this.deck.splice(0, Math.min(gn, this.deck.length));
      this.pending = { type: 'guanxing', playerId: gxp.id, stage: 'cards', cards: gcards };
      this.gxResume = 'end';
      return;
    }
    this.gxAllBottom = false;
    // 【厉勇】“本回合非锁定技失效”随本回合结束到期
    for (const q of this.players) q.skillSealed = false;
    // 【义绝】的封印与红桃杀加伤持续到本回合结束
    for (const q of this.players) { q.yijueSealed = false; q.flags.yijueTarget = null; }
    // 【酒】的加伤只在本回合有效，未使用的到下回合失效
    for (const q of this.players) q.flags.jiu = false;
    const p = this.currentPlayer();
    if (p && p.alive) this.runPhaseSkills('end');
    const next = this.nextAliveIndex(this.current);
    this.current = next;
    this.turn++;
    this.beginTurn();
  }

  checkDiscard() {
    const p = this.currentPlayer();
    if (!p) return;
    this.phase = 'discard';
    this.onPhaseStart('discard');
    this.runPhaseSkills('discard');
    if (this.pending) return;
    if (p.hand.length > p.hp) {
      this.pending = {
        type: 'discard',
        playerId: p.id,
        count: p.hand.length - p.hp,
        prompt: `请弃置 ${p.hand.length - p.hp} 张牌`,
      };
    } else {
      this.endTurn();
    }
  }

  // ---------------- 入口 ----------------
  handle(playerId, action) {
    if (this.gameOver) return err('游戏已经结束');
    switch (action.type) {
      case 'play': return this.play(playerId, action);
      case 'respond': return this.respond(playerId, action);
      case 'endPlay': return this.endPlay(playerId);
      case 'discard': return this.discardCards(playerId, action.cardIds);
      default: return err('未知操作');
    }
  }

  canUseAs(p, card, as) {
    if (p.yijueSealed) return false;
    if (as === card.key) return true;
    if (as === 'sha') {
      if (['sha', 'huosha', 'leisha'].includes(card.key)) return true;
      if (this.convertMatch(p, card, 'sha')) return true;
    }
    if (as === 'tiesuo_recast' && card.key === 'tiesuo') return true;
    if (as === 'shan') {
      if (this.convertMatch(p, card, 'shan')) return true;
    }
    return false;
  }

  // ---- 通用技能原语 ----
  convertMatch(p, card, as) {
    return CONVERSIONS.some(c => c.as === as
      && c.skills.some(s => this.hasSkill(p, s))
      && matchFrom(card, c.from));
  }

  shaUnlimited(p) {
    if (p.equips && p.equips.weapon && p.equips.weapon.key === 'zhuge') return true;
    return LOCKS.some(l => l.effect === 'shaUnlimited' && l.skills.some(s => this.hasSkill(p, s)));
  }

  drawBonus(p) {
    return DRAW_TRIGGERS
      .filter(t => t.effect === 'draw' && t.skills.some(s => this.hasSkill(p, s)))
      .reduce((a, t) => a + (t.value || 0), 0);
  }

  judge(p, reason) {
    const c = this.drawCard();
    if (c) this.discard.push(c);
    this.pauseUntil = Date.now() + 2000;
    this.lastJudgment = {
      seq: (this.judgmentSeq = (this.judgmentSeq || 0) + 1),
      playerId: p.id,
      card: c ? { id: c.id, name: c.name, suit: c.suit, number: c.number, color: c.color } : null,
      text: reason || '',
    };
    // 天妒类：判定牌生效后获得
    if (c) {
      for (const h of JUDGE_HOOKS) {
        if (h.effect !== 'gainJudgeCard' || !h.skills.some(s => this.hasSkill(p, s))) continue;
        const idx = this.discard.findIndex(x => x.id === c.id);
        if (idx >= 0) {
          this.discard.splice(idx, 1);
          p.hand.push(c);
          this.pushLog(`${p.name} 获得判定牌【${c.name}】`);
        }
      }
    }
    return c;
  }

  // 【涯角】：回合外使用/打出手牌后，亮出牌堆顶一张交给一名角色；类别不同则弃一张
  maybeYajiao(p, card) {
    if (!p || !p.alive || !this.hasSkill(p, 'yajiao') || !card) return false;
    const cur = this.currentPlayer();
    if (cur && cur.id === p.id) return false;
    const revealed = this.drawCard();
    if (!revealed) return false;
    const cat = c => (c.type === 'basic' ? 'basic' : (c.type === 'equip' ? 'equip' : 'trick'));
    const diff = cat(card) !== cat(revealed);
    this.pending = {
      type: 'yajiao',
      playerId: p.id,
      usedName: card.name,
      revealedName: revealed.name,
      revealed,
      diff,
      prompt: `【涯角】：亮出【${revealed.name}】，选择一名角色交给其${diff ? '（类别不同，之后弃一张牌）' : ''}`,
    };
    this.pushLog(`${p.name} 发动【涯角】，亮出【${revealed.name}】`);
    return true;
  }

  // ---------------- 出牌 ----------------
  play(playerId, action) {
    if (this.phase !== 'play') return err('现在不是出牌阶段');
    const p = this.currentPlayer();
    if (!p || p.id !== playerId) return err('还没轮到你');
    if (this.pending) return err('请先等待当前响应结束');

    // 丈八蛇矛：两张手牌当杀（无实体单牌，必须在查找 cardId 之前处理）
    if (action.as === 'zhangba_sha') {
      const ids = Array.isArray(action.cardIds) ? action.cardIds : [];
      if (ids.length !== 2) return err('请选择两张手牌');
      const c1 = p.hand.find(c => c.id === ids[0]);
      const c2 = p.hand.find(c => c.id === ids[1]);
      if (!c1 || !c2 || c1.id === c2.id) return err('请选择两张不同的手牌');
      if (!p.equips || !p.equips.weapon || p.equips.weapon.key !== 'zhangba') return err('没有装备【丈八蛇矛】');
      const target = action.targetId ? this.findPlayer(action.targetId) : null;
      if (!target || !target.alive || target.id === p.id) return err('请选择一名其他角色');
      if (this.distance(p, target) > 3) return err('目标不在攻击范围内');
      if (!this.shaUnlimited(p) && p.flags.shaUsed >= this.shaLimitOf(p)) return err('本回合的【杀】次数已用完');
      p.hand.splice(p.hand.findIndex(c => c.id === c1.id), 1);
      p.hand.splice(p.hand.findIndex(c => c.id === c2.id), 1);
      this.discard.push(c1, c2);
      p.flags.shaUsed++;
      this.pushLog(`${p.name} 发动【丈八蛇矛】，将两张手牌当【杀】对 ${target.name} 使用`);
      this.pushEvent('sha', { playerId: p.id, targetId: target.id, color: 'black' });
      this.pending = {
        type: 'shan',
        playerId: target.id,
        sourceId: p.id,
        cardId: c1.id,
        boost: false,
        queue: [],
        prompt: `${target.name} 请出【闪】`,
      };
      return ok();
    }

    // 义绝：出牌阶段限一次，弃置一张牌，令一名其他角色展示一张手牌
    if (action.as === 'yijue') {
      if (!this.hasSkill(p, 'yijue')) return err('没有【义绝】');
      if (p.flags.yijueUsed >= 1) return err('本回合已经发动过【义绝】');
      const target = action.targetId ? this.findPlayer(action.targetId) : null;
      if (!target || !target.alive || target.id === p.id) return err('请选择一名其他角色');
      if (target.hand.length === 0) return err('目标没有手牌');
      const ids = Array.isArray(action.cardIds) ? action.cardIds : [];
      let cost = p.hand.find(c => c.id === ids[0]);
      let fromEquip = false;
      if (!cost) {
        for (const slot of ['weapon', 'armor', 'horse1', 'horse2']) {
          const e = p.equips[slot];
          if (e && e.id === ids[0]) { cost = e; fromEquip = true; p.equips[slot] = null; break; }
        }
      }
      if (!cost) return err('请选择一张要弃置的牌');
      if (!fromEquip) p.hand.splice(p.hand.indexOf(cost), 1);
      this.discard.push(cost);
      p.flags.yijueUsed = 1;
      this.pushLog(`${p.name} 发动【义绝】，弃【${cost.name}】，令 ${target.name} 展示一张手牌`);
      this.pending = {
        type: 'yijue',
        playerId: target.id,
        sourceId: p.id,
        prompt: `${target.name} 请选择一张手牌展示（义绝）`,
      };
      return ok();
    }

    const card = p.hand.find(c => c.id === action.cardId);
    if (!card) return err('你没有这张牌');
    this.pushEvent('card', { playerId: p.id, card: { id: card.id, name: card.name, suit: card.suit, number: card.number, color: card.color, type: card.type, art: card.art } });

    const useAs = action.as || card.key;

    // 装备牌：只有“装备”时进入装备区；被武圣等转化时按转化后的牌使用
    if (card.type === 'equip' && useAs === card.key) {
      const slot = card.slot || (card.key === 'bagua' || card.key === 'renwang' || card.key === 'tengjia' || card.key === 'baiyin' ? 'armor' : 'weapon');
      const old = p.equips[slot];
      p.hand.splice(p.hand.findIndex(c => c.id === card.id), 1);
      p.equips[slot] = card;
      if (old) {
        this.discard.push(old);
        if (old.key === 'baiyin') this.heal(p, 1);
      }
      this.pushLog(`${p.name} 装备了【${card.name}】`);
      return ok();
    }


    // 丈八蛇矛：两张手牌当杀
    if (useAs === 'zhangba_sha') {
      const ids = Array.isArray(action.cardIds) ? action.cardIds : [];
      if (ids.length !== 2) return err('请选择两张手牌');
      const c1 = p.hand.find(c => c.id === ids[0]);
      const c2 = p.hand.find(c => c.id === ids[1]);
      if (!c1 || !c2 || c1.id === c2.id) return err('请选择两张不同的手牌');
      if (!p.equips || !p.equips.weapon || p.equips.weapon.key !== 'zhangba') return err('没有装备【丈八蛇矛】');
      const target = action.targetId ? this.findPlayer(action.targetId) : null;
      if (!target || !target.alive || target.id === p.id) return err('请选择一名其他角色');
      if (this.hasSkill(target, 'kongcheng') && target.hand.length === 0) return err('【空城】：不能成为【杀】的目标');
      if (this.distance(p, target) > 3) return err('目标不在攻击范围内');
      if (!this.hasSkill(p, 'paoxiao') && p.flags.shaUsed >= this.shaLimitOf(p)) return err('本回合的【杀】次数已用完');
      p.hand.splice(p.hand.findIndex(c => c.id === c1.id), 1);
      p.hand.splice(p.hand.findIndex(c => c.id === c2.id), 1);
      this.discard.push(c1, c2);
      p.flags.shaUsed++;
      this.pushLog(`${p.name} 发动【丈八蛇矛】，将两张手牌当【杀】对 ${target.name} 使用`);
      this.pending = {
        type: 'shan',
        playerId: target.id,
        sourceId: p.id,
        cardId: c1.id,
        prompt: `${target.name} 请出【闪】`,
      };
      return ok();
    }

    if (!this.canUseAs(p, card, useAs)) return err('这张牌不能这样使用');

    // 铁索连环重铸：弃置此牌，摸一张牌
    if (useAs === 'tiesuo_recast') {
      p.hand.splice(p.hand.findIndex(c => c.id === card.id), 1);
      this.discard.push(card);
      this.draw(p, 1);
      this.pushLog(`${p.name} 重铸【铁索连环】，摸一张牌`);
      return ok();
    }

    // 酒：出牌阶段限一次，下一张杀伤害+1
    if (useAs === 'jiu') {
      if (p.flags.jiuUsed >= 1) return err('本回合已经使用过【酒】');
      p.hand.splice(p.hand.findIndex(c => c.id === card.id), 1);
      this.discard.push(card);
      p.flags.jiu = true;
      p.flags.jiuUsed = 1;
      this.pushLog(`${p.name} 使用【酒】，本回合下一张【杀】伤害+1`);
      return ok();
    }

    const targetIds = Array.isArray(action.targetIds) ? action.targetIds : (action.targetId ? [action.targetId] : []);
    const targets = targetIds.map(id => this.findPlayer(id)).filter(Boolean);
    const target = targets[0] || null;

    // 目标/使用条件校验
    if (useAs === 'sha') {
      if (!target || !target.alive || target.id === p.id) return err('请选择一名其他角色');
      if (this.hasSkill(target, 'kongcheng') && target.hand.length === 0) return err('【空城】：不能成为【杀】的目标');
      const range = (p.equips && p.equips.weapon && p.equips.weapon.range) || 1;
      if (!this.shaUnlimited(p) && p.flags.shaUsed >= this.shaLimitOf(p)) return err('本回合的【杀】次数已用完');
      const noRange = (this.hasSkill(p, 're_paoxiao') && p.flags.shaUsed >= 1)
        || (this.hasSkill(p, 're_wusheng') && card.suit === 'diamond');
      if (!noRange && this.distance(p, target) > range) return err('目标不在攻击范围内');
    } else if (useAs === 'juedou') {
      if (!target || !target.alive || target.id === p.id) return err('请选择一名其他角色');
      if (this.hasSkill(target, 'kongcheng') && target.hand.length === 0) return err('【空城】：不能成为【决斗】的目标');
    } else if (useAs === 'guohe') {
      if (!target || !target.alive || target.id === p.id) return err('请选择一名其他角色');
      if (this.cardCount(target) === 0) return err('目标没有牌');
    } else if (useAs === 'shunshou') {
      if (!target || !target.alive || target.id === p.id) return err('请选择一名其他角色');
      if (this.distance(p, target) !== 1) return err('顺手牵羊只能对距离1的角色使用');
      if (this.cardCount(target) === 0) return err('目标没有牌');
    } else if (useAs === 'bingliang') {
      if (!target || !target.alive || target.id === p.id) return err('请选择一名其他角色');
      if (this.distance(p, target) !== 1) return err('兵粮寸断只能对距离1的角色使用');
      if (target.judge.some(c => c.key === 'bingliang')) return err('目标已有【兵粮寸断】');
    } else if (useAs === 'tao') {
      if (p.hp >= p.maxHp) return err('体力已满，不能使用【桃】');
    } else if (useAs === 'jiedao') {
      if (!target || target.id === p.id) return err('请选择一名其他角色');
      if (!target.equips || !target.equips.weapon) return err('目标没有装备武器');
      const victim = action.victimId ? this.findPlayer(action.victimId) : null;
      if (!victim || !victim.alive || victim.id === target.id) return err('请选择被出杀的角色');
      if (this.distance(target, victim) > (target.equips.weapon.range || 1)) return err('该角色不在其攻击范围内');
    } else if (useAs === 'lebu') {
      if (!target || target.id === p.id) return err('请选择一名其他角色');
      if (target.judge.some(c => c.key === 'lebu')) return err('目标已有【乐不思蜀】');
    } else if (useAs === 'huogong') {
      if (!target || target.id === p.id) return err('请选择一名其他角色');
      if (target.hand.length === 0) return err('目标没有手牌');
    } else if (useAs === 'tiesuo') {
      if (!targets.length) return err('请选择一名或两名角色');
      if (targets.length > 2) return err('最多选择两名角色');
    } else if (useAs === 'shandian') {
      // 闪电对自己使用，不指定目标
    } else if (useAs === 'taoyuan' || useAs === 'wugu') {
      // 不指定目标
    } else if (!['wuzhong', 'nanman', 'wanjian'].includes(useAs)) {
      return err('未知的牌');
    }

    // 消耗手牌
    p.hand.splice(p.hand.findIndex(c => c.id === card.id), 1);

    // 杀 / 桃：直接结算
    if (useAs === 'sha') {
      const weapon = p.equips && p.equips.weapon;
      const armor = target.equips && target.equips.armor;
      const ignoreArmor = weapon && weapon.key === 'qinggang';
      const fire = card.key === 'huosha' || (weapon && weapon.key === 'zhuque' && card.key === 'sha' && action.fire === true);
      const liyongActive = this.hasSkill(p, 'liyong') && p.flags.liyong;
      if (armor && !ignoreArmor) {
        if (armor.key === 'renwang' && !fire && card.color === 'black') {
          this.discard.push(card);
          this.pushLog(`${target.name} 的【仁王盾】使黑色【杀】无效`);
          return ok();
        }
        if (armor.key === 'tengjia' && card.key === 'sha' && !fire) {
          this.discard.push(card);
          this.pushLog(`${target.name} 的【藤甲】使普通【杀】无效`);
          return ok();
        }
        if (armor.key === 'bagua' && !liyongActive) {
          const judge = this.drawCard();
          if (judge) {
            this.discard.push(judge);
            this.lastJudgment = { seq: Date.now(), card: judge, text: `【八卦阵】判定：${judge.name}` };
            this.pauseUntil = Date.now() + 1500; this.pauseReason = 'judge';
            if (judge.color === 'red') {
              this.discard.push(card);
              this.pushLog(`${target.name} 的【八卦阵】判定为红色，视为出【闪】`);
              if (this.hasSkill(p, 'liyong') && this.phase === 'play' && this.currentPlayer() && this.currentPlayer().id === p.id) {
                p.flags.liyong = true;
                this.pushLog(`${p.name} 的【杀】被【八卦阵】闪避，触发【厉勇】`);
              }
              return ok();
            }
          }
        }
      }
      this.discard.push(card);
      p.flags.shaUsed++;
      const jiuBoost = p.flags.jiu ? 1 : 0;
      if (p.flags.jiu) {
        p.flags.jiu = false;
        this.pushLog(`${p.name} 的【酒】使本张【杀】伤害+1`);
      }
      const yijueBoost = (p.flags.yijueTarget === target.id && card.suit === 'heart') ? 1 : 0;
      this.pushLog(`${p.name} 对 ${target.name} 使用【杀】${fire ? '（火杀）' : ''}`);
      this.pushEvent('sha', { playerId: p.id, targetId: target.id, color: card.color, element: fire ? 'fire' : (card.key === 'leisha' ? 'thunder' : null) });
      // 厉勇：上一张【杀】被【闪】抵消后，本阶段下一张【杀】目标非锁定技失效、不可响应、伤害+1
      if (this.hasSkill(p, 'liyong') && p.flags.liyong) {
        p.flags.liyong = false;
        target.skillSealed = true;
        this.pushLog(`${p.name} 发动【厉勇】：${target.name} 本回合非锁定技失效，此【杀】不可响应且伤害+1`);
        this.damage(target, 2, p, card, null);
        if (target.alive) {
          p.hp -= 1;
          this.pushLog(`${p.name} 因【厉勇】失去1点体力（${p.hp}/${p.maxHp}）`);
          if (p.hp <= 0) this.enterDying(p, null, null, null);
        }
        return ok();
      }
      // 雌雄双股剑：异性目标先选择弃一张手牌或让使用者摸一张牌
      const fangtian = !!(weapon && weapon.key === 'fangtian' && p.hand.length === 0 && targets.length > 1);
      const shaTargets = fangtian ? targets.slice(0, 3) : [target];
      const first = shaTargets[0];
      const rest = shaTargets.slice(1).map(x => x.id);
      const boost = jiuBoost + yijueBoost;
      if (weapon && weapon.key === 'cixiong' && p.general && first.general
        && p.general.gender !== first.general.gender && first.hand.length > 0) {
        this.pending = {
          type: 'cixiong', playerId: first.id, sourceId: p.id, targetId: first.id,
          cardId: card.id, fire, boost, queue: rest,
          prompt: `【雌雄双股剑】：弃一张手牌，或让 ${p.name} 摸一张牌`,
        };
        return ok();
      }
      this.pending = {
        type: 'shan',
        playerId: first.id,
        sourceId: p.id,
        cardId: card.id,
        fire,
        boost,
        queue: rest,
        prompt: `${first.name} 请出【闪】`,
      };
      return ok();
    }
    if (useAs === 'tao') {
      this.discard.push(card);
      p.hp = Math.min(p.maxHp, p.hp + 1);
      this.pushLog(`${p.name} 使用【桃】，回复1点体力`);
      return ok();
    }

    // 锦囊：先进入【无懈可击】窗口
    if (useAs === 'bingliang' || useAs === 'lebu' || useAs === 'shandian') {
      // 延时锦囊使用时不需要无懈；无懈在判定阶段生效前才询问
      this.resolveTrick({ sourceId: p.id, cardId: card.id, cardRef: card, trick: { useAs, targetId: useAs === 'shandian' ? p.id : target.id }, canceled: false });
      return ok();
    }
    if (useAs === 'nanman' || useAs === 'wanjian') {
      const tq = this.othersInSeatOrder(p).filter(q => {
        if (q.equips && q.equips.armor && q.equips.armor.key === 'tengjia') {
          this.pushLog(`${q.name} 的【藤甲】使【${useAs === 'nanman' ? '南蛮入侵' : '万箭齐发'}】无效`);
          return false;
        }
        return true;
      });
      this.discard.push(card);
      this.startAoe(p, card, useAs, tq);
      return ok();
    }
    this.discard.push(card);
    this.startWuxie(p, card, { useAs, targetId: target ? target.id : null, victimId: action.victimId || null, targetIds: targets.map(x => x.id) });
    return ok();
  }

  startAoe(source, card, useAs, targets) {
    this.aoe = { sourceId: source.id, card, cardId: card.id, useAs, remaining: targets.map(t => t.id) };
    this.aoeNext();
  }

  aoeNext() {
    const a = this.aoe;
    if (!a) return;
    let tid = null;
    while (a.remaining.length) {
      const id = a.remaining.shift();
      const q = this.findPlayer(id);
      if (q && q.alive) { tid = id; break; }
    }
    if (!tid) {
      this.aoe = null;
      if (a.card && !this.discard.some(c => c.id === a.card.id)) this.discard.push(a.card);
      return;
    }
    this.startWuxie(this.findPlayer(a.sourceId), a.card, { useAs: a.useAs, targetId: tid, aoe: true });
  }

  startWuxie(source, card, trick) {
    const eligible = this.players
      .filter(x => x.alive && x.id !== source.id && x.hand.some(c => c.key === 'wuxie'))
      .map(x => x.id);
    if (!eligible.length) {
      this.resolveTrick({ sourceId: source.id, cardId: card.id, cardRef: card, trick, canceled: false });
      return;
    }
    this.pending = {
      type: 'wuxie',
      playerId: null,
      allowed: eligible,
      sourceId: source.id,
      cardId: card.id,
      cardRef: card,
      trick,
      wuxieCount: 0,
      canceled: false,
      prompt: `是否对【${card.name}】使用【无懈可击】？`,
    };
  }

  askWuxieAgain(lastPlayer) {
    const src = this.pending ? this.pending.sourceId : null;
    const eligible = this.players
      .filter(x => x.alive && x.id !== src && x.hand.some(c => c.key === 'wuxie'))
      .map(x => x.id);
    const pending = this.pending;
    if (!eligible.length) {
      this.resolveTrick({ sourceId: pending.sourceId, cardId: pending.cardId, cardRef: pending.cardRef, trick: pending.trick, canceled: pending.wuxieCount % 2 === 1 });
      return;
    }
    this.pending = {
      type: 'wuxie',
      playerId: null,
      allowed: eligible,
      sourceId: lastPlayer.id,
      cardId: pending.cardId,
      cardRef: pending.cardRef,
      trick: pending.trick,
      wuxieCount: pending.wuxieCount,
      canceled: false,
      prompt: `是否对${lastPlayer.name}的【无懈可击】使用【无懈可击】？`,
    };
  }

  resolveTrick(pend) {
    this.pending = null;
    const source = this.findPlayer(pend.sourceId);
    const card = pend.cardRef || this.findCardById(pend.cardId);
    const trick = pend.trick || {};
    const target = trick.targetId ? this.findPlayer(trick.targetId) : null;

    if (pend.canceled) {
      if (trick && trick.aoe) {
        const t = this.findPlayer(trick.targetId);
        this.pushLog(`【无懈可击】抵消了对 ${t ? t.name : '目标'} 的【${card ? card.name : '锦囊'}】`);
        this.aoeNext();
        return;
      }
      this.pushLog(`【${card ? card.name : '锦囊'}】被【无懈可击】抵消`);
      if (card && !this.discard.some(c => c.id === card.id)) this.discard.push(card);
      return;
    }
    if (!source || !source.alive) return;

    if (trick.useAs === 'bingliang' || trick.useAs === 'lebu') {
      if (target && target.alive && card) {
        target.judge.push(card);
        this.pushLog(`${source.name} 对 ${target.name} 使用【${trick.useAs === 'lebu' ? '乐不思蜀' : '兵粮寸断'}】`);
      }
      return;
    }
    if (trick.useAs === 'shandian') {
      const self = source;
      if (self && self.alive && card) {
        self.judge.push(card);
        this.pushLog(`${source.name} 使用【闪电】`);
      }
      return;
    }
    if (trick.useAs === 'juedou') {
      if (!target || !target.alive) return;
      this.pushLog(`${source.name} 对 ${target.name} 使用【决斗】`);
      this.pending = {
        type: 'duel',
        playerId: target.id,
        sourceId: source.id,
        a: source.id,
        b: target.id,
        turn: target.id,
        cardId: card ? card.id : null,
        prompt: `${target.name} 请出【杀】`,
      };
      return;
    }
    if (trick.useAs === 'guohe' || trick.useAs === 'shunshou') {
      if (!target || !target.alive) return;
      if (this.cardCount(target) === 0) return;
      this.pending = {
        type: 'pick',
        playerId: source.id,
        sourceId: source.id,
        targetId: target.id,
        mode: trick.useAs,
        trickCardId: card ? card.id : null,
        prompt: `请选择 ${target.name} 的一张牌`,
      };
      return;
    }
    if (trick.useAs === 'wuzhong') {
      this.draw(source, 2);
      this.pushLog(`${source.name} 使用【无中生有】，摸两张牌`);
      return;
    }
    if (trick.useAs === 'taoyuan') {
      this.pushLog(`${source.name} 使用【桃园结义】`);
      for (const q of this.players) if (q.alive && q.hp < q.maxHp) this.heal(q, 1);
      return;
    }
    if (trick.useAs === 'wugu') {
      const alive = this.players.filter(q => q.alive);
      const cards = [];
      for (let i = 0; i < alive.length; i++) {
        const c = this.drawCard();
        if (c) cards.push(c);
      }
      this.pushLog(`${source.name} 使用【五谷丰登】，亮出${cards.length}张牌`);
      this.pending = {
        type: 'wugu',
        playerId: source.id,
        aliveIds: alive.map(q => q.id),
        cards,
        index: 0,
        prompt: '五谷丰登：请选择一张牌',
      };
      return;
    }
    if (trick.useAs === 'huogong') {
      if (!target || !target.alive || target.hand.length === 0) return;
      const shown = target.hand[Math.floor(Math.random() * target.hand.length)];
      this.pushLog(`${target.name} 展示【${shown.name}】`);
      this.pending = {
        type: 'huogong',
        playerId: source.id,
        targetId: target.id,
        shown,
        prompt: `火攻：${target.name} 展示了【${shown.name}】，可弃同花色手牌造成1点火焰伤害`,
      };
      return;
    }
    if (trick.useAs === 'tiesuo') {
      const ids = trick.targetIds && trick.targetIds.length ? trick.targetIds : (target ? [target.id] : []);
      for (const id of ids) {
        const q = this.findPlayer(id);
        if (!q || !q.alive) continue;
        q.chained = !q.chained;
        this.pushLog(`${source.name} 使用【铁索连环】，${q.name}${q.chained ? '横置' : '重置'}`);
      }
      return;
    }
    if (trick.useAs === 'jiedao') {
      if (!target || !target.alive) return;
      const w = target.equips && target.equips.weapon;
      if (!w) return;
      const victim = trick.victimId ? this.findPlayer(trick.victimId) : null;
      const sha = target.hand.find(c => this.canUseAs(target, c, 'sha'));
      if (!sha || !victim || !victim.alive) {
        target.equips.weapon = null;
        source.hand.push(w);
        this.pushLog(`${target.name} 没有对 ${victim ? victim.name : '目标'} 出【杀】，将【${w.name}】交给 ${source.name}`);
        return;
      }
      this.pushLog(`${source.name} 对 ${target.name} 使用【借刀杀人】，令其杀 ${victim.name}`);
      this.pending = {
        type: 'jiedao',
        playerId: target.id,
        sourceId: source.id,
        victimId: victim.id,
        weaponName: w.name,
        prompt: `【借刀杀人】：对 ${victim.name} 使用【杀】，或交出【${w.name}】`,
      };
      return;
    }
    if (trick.useAs === 'nanman' || trick.useAs === 'wanjian') {
      const cardName = trick.useAs === 'nanman' ? '南蛮入侵' : '万箭齐发';
      if (trick.aoe) {
        const t = this.findPlayer(trick.targetId);
        if (t && t.alive) {
          this.pending = {
            type: trick.useAs,
            playerId: t.id,
            sourceId: source.id,
            cardId: card ? card.id : null,
            aoe: true,
            prompt: `${t.name} 请出【${trick.useAs === 'nanman' ? '杀' : '闪'}】`,
          };
        } else {
          this.aoeNext();
        }
        return;
      }
      const queue = this.othersInSeatOrder(source).filter(q => {
        if (q.equips && q.equips.armor && q.equips.armor.key === 'tengjia') {
          this.pushLog(`${q.name} 的【藤甲】使【${cardName}】无效`);
          return false;
        }
        return true;
      });
      this.pushLog(`${source.name} 使用【${cardName}】`);
      if (queue.length > 0) {
        this.pending = {
          type: trick.useAs,
          playerId: queue[0].id,
          sourceId: source.id,
          cardId: card ? card.id : null,
          queue: queue.map(x => x.id),
          index: 0,
          prompt: `${queue[0].name} 请出【${trick.useAs === 'nanman' ? '杀' : '闪'}】`,
        };
      }
      return;
    }
  }

  pickCard(playerId, cardId) {
    if (!this.pending || this.pending.type !== 'pick') return err('现在不需要选牌');
    if (this.pending.playerId !== playerId) return err('还没轮到你选牌');
    const p = this.findPlayer(playerId);
    const target = this.findPlayer(this.pending.targetId);
    if (!p || !target) return err('角色不存在');
    const card = target.hand.find(c => c.id === cardId)
      || target.judge.find(c => c.id === cardId)
      || Object.values(target.equips || {}).find(c => c && c.id === cardId);
    if (!card) return err('目标没有这张牌');
    this.lastReveal = { seq: ++this.revealSeq, playerId: target.id, card: { id: card.id, name: card.name, suit: card.suit, number: card.number, color: card.color, type: card.type, art: card.art } };
    this.removeFromPlayer(target, card);
    if (this.pending.mode === 'guohe') {
      this.discard.push(card);
      this.pushLog(`${p.name} 对 ${target.name} 使用【过河拆桥】，弃置了【${card.name}】`);
    } else {
      p.hand.push(card);
      this.pushLog(`${p.name} 对 ${target.name} 使用【顺手牵羊】，获得了【${card.name}】`);
    }
    this.pending = null;
    return ok();
  }

  endPlay(playerId) {
    if (this.phase !== 'play') return err('现在不是出牌阶段');
    const p = this.currentPlayer();
    if (!p || p.id !== playerId) return err('还没轮到你');
    if (this.pending) return err('请先等待当前响应结束');
    this.phase = 'discard';
    this.checkDiscard();
    return ok();
  }

  discardCards(playerId, cardIds) {
    if (!this.pending || this.pending.type !== 'discard') return err('现在不需要弃牌');
    if (this.pending.playerId !== playerId) return err('还没轮到你弃牌');
    if (!Array.isArray(cardIds) || cardIds.length !== this.pending.count) {
      return err(`请选择 ${this.pending.count} 张牌`);
    }
    const p = this.findPlayer(playerId);
    for (const id of cardIds) {
      if (!p.hand.some(c => c.id === id)) return err('你选择了不存在的牌');
    }
    for (const id of cardIds) {
      const idx = p.hand.findIndex(c => c.id === id);
      const [c] = p.hand.splice(idx, 1);
      this.discard.push(c);
    }
    this.pushLog(`${p.name} 弃置了 ${cardIds.length} 张牌`);
    this.pending = null;
    this.endTurn();
    return ok();
  }

  // ---------------- 响应 ----------------
  respond(playerId, action) {
    const p = this.findPlayer(playerId);
    const before = this.pending;
    const cur = this.currentPlayer();
    const outside = !!(cur && cur.id !== playerId);
    const noUse = !!(before && ['pick', 'wugu', 'yijue', 'huogong', 'yajiao', 'yajiao_discard'].includes(before.type));
    const played = (p && action && action.cardId) ? (p.hand.find(c => c.id === action.cardId) || null) : null;
    const res = this._respond(playerId, action);
    if (res && res.ok && played && outside && !noUse && !this.pending) {
      this.maybeYajiao(p, played);
    }
    return res;
  }

  _respond(playerId, action) {
    if (!this.pending) return err('现在没有需要响应的牌');
    const pend = this.pending;
    if (pend.playerId !== playerId && !(pend.allowed || []).includes(playerId)) return err('还没轮到你响应');
    const p = this.findPlayer(playerId);
    if (!p || !p.alive) return err('角色已阵亡');
    if (p.yijueSealed && action.cardId) return err('被【义绝】封印，不能使用或打出手牌');

    if (pend.type === 'pick') {
      if (action.pass || !action.cardId) {
        const t = this.findPlayer(pend.targetId);
        const has = t ? (t.hand.length + t.judge.length + Object.values(t.equips || {}).filter(Boolean).length) : 0;
        if (has > 0) return err('请选择一张牌');
        this.pending = null;
        return ok();
      }
      return this.pickCard(playerId, action.cardId);
    }

    if (pend.type === 'wugu') {
      const c = (pend.cards || []).find(x => x.id === action.cardId);
      if (!c) return err('请选择五谷的牌');
      pend.cards = pend.cards.filter(x => x.id !== c.id);
      p.hand.push(c);
      this.pushLog(`${p.name} 从【五谷丰登】获得【${c.name}】`);
      pend.index++;
      if (pend.index < pend.aliveIds.length) {
        const nid = pend.aliveIds[pend.index];
        const nq = this.findPlayer(nid);
        pend.playerId = nid;
        pend.prompt = `${nq ? nq.name : '?'} 请选择一张五谷牌`;
        this.pending = pend;
      } else {
        for (const rest of pend.cards) this.discard.push(rest);
        this.pending = null;
      }
      return ok();
    }

    if (pend.type === 'huogong') {
      if (action.pass) { this.pending = null; return ok(); }
      const c = p.hand.find(x => x.id === action.cardId);
      const shown = pend.shown;
      if (!c || c.suit !== shown.suit) return err('请弃置同花色手牌');
      p.hand.splice(p.hand.indexOf(c), 1);
      this.discard.push(c);
      const target = this.findPlayer(pend.targetId);
      this.pushLog(`${p.name} 弃置【${c.name}】，对 ${target.name} 造成1点火焰伤害`);
      this.pending = null;
      this.damage(target, 1, p, { ...shown, element: 'fire' }, null);
      return ok();
    }

    if (pend.type === 'yijue') {
      const src = this.findPlayer(pend.sourceId);
      const shown = p.hand.find(c => c.id === action.cardId);
      if (!shown) {
        if (p.hand.length === 0) { this.pending = null; return ok(); }
        return err('请选择一张手牌展示');
      }
      this.pending = null;
      this.lastReveal = { seq: ++this.revealSeq, playerId: p.id, card: { id: shown.id, name: shown.name, suit: shown.suit, number: shown.number, color: shown.color, type: shown.type, art: shown.art } };
      if (shown.color === 'black') {
        p.yijueSealed = true;
        p.skillSealed = true;
        if (src) src.flags.yijueTarget = p.id;
        this.pushLog(`${p.name} 展示黑色【${shown.name}】：本回合不能使用/打出手牌、非锁定技失效，${src ? src.name : ''} 对其红桃【杀】伤害+1`);
      } else {
        p.hand.splice(p.hand.indexOf(shown), 1);
        if (src) src.hand.push(shown);
        this.pushLog(`${p.name} 展示红色【${shown.name}】，${src ? src.name : ''} 获得之`);
        if (src && src.alive && p.hp < p.maxHp) {
          this.pending = {
            type: 'yijue_heal', playerId: src.id, targetId: p.id,
            prompt: `【义绝】：是否令 ${p.name} 回复1点体力？`,
          };
        }
      }
      return ok();
    }

    if (pend.type === 'yijue_heal') {
      if (action.pass) { this.pending = null; return ok(); }
      const t = this.findPlayer(pend.targetId);
      if (t && t.alive && t.hp < t.maxHp) {
        this.heal(t, 1);
        this.pushLog(`${p.name} 令 ${t.name} 回复1点体力`);
      }
      this.pending = null;
      return ok();
    }

    if (pend.type === 'hanbing') {
      const target = this.findPlayer(pend.targetId);
      if (action.pass) {
        this.pending = null;
        this.pushLog(`${p.name} 放弃发动【寒冰剑】`);
        if (target) this.damage(target, pend.amount, p, this.findCardById(pend.cardId), pend.parent, { skipHanbing: true });
        return ok();
      }
      const ids = Array.isArray(action.cardIds) ? action.cardIds : [];
      if (!ids.length || ids.length > pend.count) return err(`请选择 1~${pend.count} 张牌`);
      if (!target || !target.alive) { this.pending = null; return ok(); }
      const removed = [];
      for (const id of ids) {
        const pool = [...target.hand, ...Object.values(target.equips || {}).filter(Boolean)];
        const c = pool.find(x => x.id === id);
        if (!c) return err('目标没有这张牌');
        this.removeFromPlayer(target, c);
        this.discard.push(c);
        removed.push(c.name);
      }
      this.pushLog(`${p.name} 发动【寒冰剑】，防止伤害并弃置 ${target.name} 的【${removed.join('】【')}】`);
      this.pending = null;
      return ok();
    }

    if (pend.type === 'yajiao') {
      const target = action.targetId ? this.findPlayer(action.targetId) : null;
      if (!target || !target.alive) return err('请选择一名角色');
      target.hand.push(pend.revealed);
      this.pushLog(`${p.name} 将【${pend.revealed.name}】交给 ${target.name}`);
      this.pending = null;
      if (pend.diff) {
        if (p.hand.length === 0) return ok();
        this.pending = { type: 'yajiao_discard', playerId: p.id, count: 1, prompt: '【涯角】：两张牌类别不同，请弃置一张牌' };
      }
      return ok();
    }

    if (pend.type === 'yajiao_discard') {
      const ids = Array.isArray(action.cardIds) ? action.cardIds : [];
      const c = p.hand.find(x => x.id === ids[0]);
      if (!c) {
        if (p.hand.length === 0) { this.pending = null; return ok(); }
        return err('请选择一张牌弃置');
      }
      p.hand.splice(p.hand.indexOf(c), 1);
      this.discard.push(c);
      this.pushLog(`${p.name} 因【涯角】弃置【${c.name}】`);
      this.pending = null;
      return ok();
    }

    if (pend.type === 'cixiong') {
      const src = this.findPlayer(pend.sourceId);
      if (action.pass) {
        if (src) { this.draw(src, 1); this.pushLog(`${p.name} 选择让 ${src.name} 摸一张牌`); }
      } else {
        const card = p.hand.find(c => c.id === action.cardId);
        if (!card) return err('请选择一张手牌弃置');
        p.hand.splice(p.hand.indexOf(card), 1);
        this.discard.push(card);
        this.pushLog(`${p.name} 弃置【${card.name}】`);
      }
      const t = this.findPlayer(pend.targetId);
      this.pending = {
        type: 'shan', playerId: t.id, sourceId: pend.sourceId, cardId: pend.cardId,
        fire: pend.fire, boost: pend.boost || 0, queue: pend.queue || [],
        prompt: `${t.name} 请出【闪】`,
      };
      return ok();
    }

    if (pend.type === 'guanshi') {
      if (action.pass) { this.pending = null; return ok(); }
      const ids = Array.isArray(action.cardIds) ? action.cardIds : [];
      if (ids.length !== 2) return err('请选择两张牌');
      const removed = [];
      for (const id of ids) {
        const c = this.findCardById(id);
        if (!c) return err('没有这张牌');
        const owned = p.hand.includes(c) || p.judge.includes(c) || Object.values(p.equips || {}).includes(c);
        if (!owned) return err('只能弃置自己的牌');
        this.removeFromPlayer(p, c);
        this.discard.push(c);
        removed.push(c.name);
      }
      this.pushLog(`${p.name} 发动【贯石斧】，弃置【${removed.join('】【')}】令【杀】依然造成伤害`);
      this.pending = null;
      const t = this.findPlayer(pend.targetId);
      const gsRef = this.findCardById(pend.cardId);
      const gsCard = gsRef ? (pend.fire ? { ...gsRef, fire: true } : gsRef) : null;
      this.damage(t, 1 + (pend.boost || 0), p, gsCard, null);
      return ok();
    }

    if (pend.type === 'qinglong') {
      if (action.pass) { this.pending = null; return ok(); }
      const sha = p.hand.find(c => this.canUseAs(p, c, 'sha'));
      if (!sha) { this.pending = null; return ok(); }
      p.hand.splice(p.hand.indexOf(sha), 1);
      this.discard.push(sha);
      this.pushLog(`${p.name} 发动【青龙偃月刀】，继续使用【${sha.name}】`);
      this.pushEvent('sha', { playerId: p.id, targetId: pend.targetId, color: sha.color });
      const t = this.findPlayer(pend.targetId);
      this.pending = {
        type: 'shan', playerId: t.id, sourceId: p.id, cardId: sha.id,
        fire: sha.key === 'huosha', boost: 0, queue: [],
        prompt: `${t.name} 请出【闪】`,
      };
      return ok();
    }

    if (pend.type === 'qilin') {
      if (action.pass) { this.pending = null; return ok(); }
      const t = this.findPlayer(pend.targetId);
      if (t && t.equips) {
        const slot = t.equips.horse1 ? 'horse1' : (t.equips.horse2 ? 'horse2' : null);
        if (slot) {
          const h = t.equips[slot];
          t.equips[slot] = null;
          this.discard.push(h);
          this.pushLog(`${p.name} 发动【麒麟弓】，弃置 ${t.name} 的【${h.name}】`);
        }
      }
      this.pending = null;
      return ok();
    }

    if (pend.type === 'jiedao') {
      if (action.pass) {
        const w = p.equips && p.equips.weapon;
        const src = this.findPlayer(pend.sourceId);
        if (w) {
          p.equips.weapon = null;
          if (src) src.hand.push(w);
          this.pushLog(`${p.name} 将【${w.name}】交给 ${src ? src.name : ''}`);
        }
        this.pending = null;
        return ok();
      }
      const card = p.hand.find(c => c.id === action.cardId);
      if (!card || !this.canUseAs(p, card, 'sha')) return err('请选择【杀】');
      const victim = this.findPlayer(pend.victimId);
      if (!victim || !victim.alive) { this.pending = null; return ok(); }
      p.hand.splice(p.hand.indexOf(card), 1);
      this.discard.push(card);
      this.pushLog(`${p.name} 对 ${victim.name} 使用【${card.name}】（借刀杀人）`);
      this.pushEvent('sha', { playerId: p.id, targetId: victim.id, color: card.color, response: true });
      this.pending = {
        type: 'shan', playerId: victim.id, sourceId: p.id,
        cardId: card.id, boost: false, queue: [],
        prompt: `${victim.name} 请出【闪】`,
      };
      return ok();
    }

    if (pend.type === 'guanxing') {
      if (pend.stage === 'ask') {
        this.pending = null;
        if (!action.accept) {
          this._gxSkip = true;
          this.beginTurn();
          return ok();
        }
        const n = this.players.filter(q => q.alive).length < 4 ? 3 : 5;
        const cards = this.deck.splice(0, Math.min(n, this.deck.length));
        this.pending = { type: 'guanxing', playerId: pend.playerId, stage: 'cards', cards };
        return ok();
      }
      const top = (action.top || []).map(id => pend.cards.find(c => c.id === id)).filter(Boolean);
      const bottom = (action.bottom || []).map(id => pend.cards.find(c => c.id === id)).filter(Boolean);
      this.deck.unshift(...top);
      this.deck.push(...bottom);
      this.gxAllBottom = bottom.length === pend.cards.length && pend.cards.length > 0;
      this.pending = null;
      if (this.gxResume === 'end') {
        this.gxResume = 'begin';
        this.gxAllBottom = false;
        this.endTurn();
      } else {
        this._gxSkip = true;
        this.beginTurn();
      }
      return ok();
    }

    if (pend.type === 'tuxi_ask') {
      this.pending = null;
      if (!action.accept) {
        this._tuxiDone = true;
        this.startTurnDraw(p, 2 + this.drawBonus(p));
        return ok();
      }
      this.pending = { type: 'tuxi_targets', playerId: p.id, count: 2, prompt: '突袭：选择 1~2 名其他角色' };
      return ok();
    }

    if (pend.type === 'tuxi_targets') {
      if (action.pass) {
        this.pending = null;
        this._tuxiDone = true;
        this.startTurnDraw(p, 2 + this.drawBonus(p));
        return ok();
      }
      const ids = Array.isArray(action.targetIds) ? action.targetIds : [];
      const targets = ids.map(id => this.findPlayer(id)).filter(x => x && x.alive && x.id !== p.id && x.hand.length > 0);
      if (!targets.length) {
        this.pending = null;
        this._tuxiDone = true;
        this.startTurnDraw(p, 2 + this.drawBonus(p));
        return ok();
      }
      this.tuxiTargets = targets.slice(0, 2);
      this.tuxiAskPick(p, this.tuxiTargets, 0);
      return ok();
    }

    if (pend.type === 'tuxi_more') {
      if (action.pass) { this.tuxiFinish(p); return ok(); }
      const ids = Array.isArray(action.targetIds) ? action.targetIds : [];
      const t = ids.length ? this.findPlayer(ids[0]) : null;
      if (t && t.alive && t.hand.length > 0 && t.id !== p.id) {
        this.tuxiTargets = [t];
        this.tuxiAskPick(p, [t], 0);
      } else {
        this.tuxiFinish(p);
      }
      return ok();
    }

    if (pend.type === 'tuxi_pick') {
      const t = this.findPlayer(pend.targetId);
      if (!t || !t.alive || !t.hand.length) {
        const next = (this.tuxiTargets || []).indexOf(t) + 1;
        this.tuxiAskPick(p, this.tuxiTargets || [], Math.max(0, next));
        return ok();
      }
      const i = Math.max(0, Math.min(t.hand.length - 1, Number(action.index) || 0));
      const card = t.hand.splice(i, 1)[0];
      p.hand.push(card);
      this.pushLog(`${p.name} 发动【突袭】，获得 ${t.name} 的一张手牌`);
      this.pushEvent('card', { playerId: p.id, card: { id: card.id, name: card.name, suit: card.suit, number: card.number, color: card.color, type: card.type, art: card.art } });
      this._tuxiPicks = (this._tuxiPicks || 0) + 1;
      const used = (this.tuxiTargets || []).map(x => x.id);
      const others = this.players.filter(x => x.alive && x.id !== p.id && x.hand.length > 0 && !used.includes(x.id));
      if (this._tuxiPicks < 2 && others.length) {
        this.pending = { type: 'tuxi_more', playerId: p.id, used, prompt: '突袭：可再选一名角色' };
        return ok();
      }
      this.tuxiFinish(p);
      return ok();
    }

    if (pend.type === 'farmer_reward') {
      const healIt = action.choice === 'heal' && p.hp < p.maxHp;
      if (healIt) {
        p.hp = Math.min(p.maxHp, p.hp + 1);
        this.pushLog(`${p.name} 选择回复1点体力`);
      } else {
        this.draw(p, 2);
        this.pushLog(`${p.name} 选择摸两张牌`);
      }
      this.pending = null;
      const cur0 = this.currentPlayer();
      if (cur0 && !cur0.alive) this.endTurn();
      return ok();
    }

    if (pend.type === 'draw_ack') {
      const pd = this.pendingDraw;
      if (pd && pd.playerId === p.id) {
        p.hand.push(...pd.cards);
        this.pushLog(`${p.name} 摸${pd.cards.length}张牌`);
        this.pendingDraw = null;
      }
      this.pending = null;
      return ok();
    }

    if (pend.type === 'wuxie') {
      const allowed = pend.allowed || [];
      if (action.pass) {
        pend.allowed = allowed.filter(id => id !== p.id);
        if (!pend.allowed.length) {
          this.resolveTrick({ sourceId: pend.sourceId, cardId: pend.cardId, cardRef: pend.cardRef, trick: pend.trick, canceled: (pend.wuxieCount || 0) % 2 === 1 });
        }
        return ok();
      }
      if (!allowed.includes(p.id)) return err('还没轮到你响应');
      const card = p.hand.find(c => c.id === action.cardId);
      if (!card || card.key !== 'wuxie') return err('请选择【无懈可击】');
      p.hand.splice(p.hand.indexOf(card), 1);
      this.discard.push(card);
      this.pushLog(`${p.name} 使用【无懈可击】`);
      this.pushEvent('card', { playerId: p.id, card: { id: card.id, name: card.name, suit: card.suit, number: card.number, color: card.color, type: card.type, art: card.art } });
      pend.wuxieCount = (pend.wuxieCount || 0) + 1;
      this.askWuxieAgain(p);
      return ok();
    }

    if (pend.type === 'shan') {
      const nextSha = () => {
        if (pend.queue && pend.queue.length) {
          const nid = pend.queue.shift();
          const nq = this.findPlayer(nid);
          if (nq && nq.alive) {
            this.pending = {
              type: 'shan', playerId: nid, sourceId: pend.sourceId,
              cardId: pend.cardId, queue: pend.queue,
              prompt: `${nq.name} 请出【闪】`,
            };
            return true;
          }
        }
        return false;
      };
      if (action.pass) {
        this.pending = null;
        this.pushLog(`${p.name} 没有出【闪】`);
        const hitRef = this.findCardById(pend.cardId);
        const hitCard = hitRef ? (pend.fire ? { ...hitRef, fire: true } : hitRef) : null;
        this.damage(p, 1 + (pend.boost || 0), this.findPlayer(pend.sourceId), hitCard, null);
        if (!this.pending) nextSha();
        return ok();
      }
      const card = p.hand.find(c => c.id === action.cardId);
      if (!card || !this.canUseAs(p, card, 'shan')) return err('请选择【闪】');
      p.hand.splice(p.hand.indexOf(card), 1);
      this.discard.push(card);
      this.pushLog(`${p.name} 打出【闪】`);
      this.pushEvent('shan', { playerId: p.id });
      const liyongSrc = this.findPlayer(pend.sourceId);
      if (liyongSrc && this.hasSkill(liyongSrc, 'liyong') && this.phase === 'play'
        && this.currentPlayer() && this.currentPlayer().id === liyongSrc.id) {
        liyongSrc.flags.liyong = true;
        this.pushLog(`${liyongSrc.name} 的【杀】被【闪】抵消，触发【厉勇】`);
      }
      this.pending = null;
      const hadNext = nextSha();
      if (hadNext) return ok();
      const src = this.findPlayer(pend.sourceId);
      // 青龙偃月刀：被闪抵消后可以选择继续使用一张杀
      if (src && src.equips && src.equips.weapon && src.equips.weapon.key === 'qinglong') {
        const sha = src.hand.find(c => this.canUseAs(src, c, 'sha'));
        if (sha) {
          this.pending = {
            type: 'qinglong', playerId: src.id, targetId: p.id,
            prompt: '【青龙偃月刀】：是否继续使用一张【杀】？',
          };
          return ok();
        }
      }
      // 贯石斧：被闪抵消后可以选择弃两张牌强行造成伤害
      if (src && src.equips && src.equips.weapon && src.equips.weapon.key === 'guanshi' && this.cardCount(src) >= 2) {
        this.pending = {
          type: 'guanshi', playerId: src.id, targetId: p.id,
          cardId: pend.cardId, boost: pend.boost, count: 2,
          prompt: '【贯石斧】：是否弃两张牌令此【杀】依然造成伤害？',
        };
        return ok();
      }
      return ok();
    }

    if (pend.type === 'duel') {
      if (action.pass) {
        this.pending = null;
        const oppId = p.id === pend.a ? pend.b : pend.a;
        this.pushLog(`${p.name} 没有出【杀】`);
        this.damage(p, 1, this.findPlayer(oppId), this.findCardById(pend.cardId), null);
        return ok();
      }
      const card = p.hand.find(c => c.id === action.cardId);
      if (!card || !this.canUseAs(p, card, 'sha')) return err('请选择【杀】');
      p.hand.splice(p.hand.indexOf(card), 1);
      this.discard.push(card);
      this.pushLog(`${p.name} 打出【杀】`);
      this.pushEvent('sha', { playerId: p.id, color: card.color, response: true });
      const oppId = p.id === pend.a ? pend.b : pend.a;
      const opp = this.findPlayer(oppId);
      if (!opp || !opp.alive) { this.pending = null; return ok(); }
      this.pending = { ...pend, playerId: oppId, turn: oppId, prompt: `${opp.name} 请出【杀】` };
      return ok();
    }

    if (pend.type === 'tao') {
      const dying = this.findPlayer(pend.dyingId);
      if (action.pass) {
        pend.index++;
        if (pend.index >= pend.queue.length) {
          this.pending = null;
          this.pushLog(`无人救${dying.name}`);
          const wasCurrent = this.currentPlayer() && this.currentPlayer().id === dying.id;
          this.die(dying, this.findPlayer(pend.sourceId));
          if (!this.gameOver && !wasCurrent) this.pending = pend.parent || null;
        } else {
          pend.playerId = pend.queue[pend.index];
          const q = this.findPlayer(pend.playerId);
          pend.prompt = `${q ? q.name : '?'} 是否使用【桃】救${dying.name}？（还需${1 - dying.hp}张）`;
        }
        return ok();
      }
      const card = p.hand.find(c => c.id === action.cardId);
      if (!card || (card.key !== 'tao' && card.key !== 'jiu')) return err('请选择【桃】或【酒】');
      if (card.key === 'jiu' && dying.id !== p.id) return err('【酒】只能在自己濒死时使用');
      p.hand.splice(p.hand.indexOf(card), 1);
      this.discard.push(card);
      dying.hp = Math.min(dying.maxHp, dying.hp + 1);
      this.pushLog(`${p.name} 对 ${dying.name} 使用【${card.key === 'jiu' ? '酒' : '桃'}】`);
      if (dying.hp > 0) {
        this.pending = pend.parent || null;
      } else {
        pend.prompt = `${p.name} 是否继续使用【桃】？（还需${1 - dying.hp}张）`;
      }
      return ok();
    }

    if (pend.type === 'nanman' || pend.type === 'wanjian') {
      const need = pend.type === 'nanman' ? 'sha' : 'shan';
      const needCard = pend.type === 'nanman' ? '杀' : '闪';
      if (action.pass) {
        const parent = this.advanceQueue(pend);
        this.pending = null;
        this.pushLog(`${p.name} 没有出【${needCard}】`);
        this.damage(p, 1, this.findPlayer(pend.sourceId), this.findCardById(pend.cardId), parent);
        if (pend.aoe && !this.pending) this.aoeNext();
        return ok();
      }
      const card = p.hand.find(c => c.id === action.cardId);
      if (!card || !this.canUseAs(p, card, need)) return err(`请选择【${needCard}】`);
      p.hand.splice(p.hand.indexOf(card), 1);
      this.discard.push(card);
      this.pushLog(`${p.name} 打出【${needCard}】`);
      this.pushEvent(needCard === '杀' ? 'sha' : 'shan', { playerId: p.id, response: true });
      this.pending = this.advanceQueue(pend);
      if (pend.aoe && !this.pending) this.aoeNext();
      return ok();
    }

    return err('未知的响应类型');
  }

  advanceQueue(pend) {
    if (!pend.queue) return null;
    pend.index++;
    while (pend.index < pend.queue.length) {
      const q = this.findPlayer(pend.queue[pend.index]);
      if (q && q.alive) {
        pend.playerId = q.id;
        const needCard = pend.type === 'nanman' ? '杀' : '闪';
        pend.prompt = `${q.name} 请出【${needCard}】`;
        return pend;
      }
      pend.index++;
    }
    return null;
  }

  // ---------------- 伤害 / 死亡 ----------------
  damage(target, amount, source, card, parent = null, opts = null) {
    if (!target.alive) { this.pending = parent; return; }
    if (target.equips && target.equips.armor && target.equips.armor.key === 'baiyin' && amount > 1) amount = 1;
    if (source && source.equips && source.equips.weapon && source.equips.weapon.key === 'guding' && target.hand.length === 0) amount += 1;
    // 藤甲：南蛮/万箭无效
    if (target.equips && target.equips.armor && target.equips.armor.key === 'tengjia' && card && (card.key === 'nanman' || card.key === 'wanjian')) {
      this.pushLog(`${target.name} 的【藤甲】使【${card.name}】无效`);
      this.pending = parent;
      return;
    }
    // 寒冰剑（可选）：使用【杀】造成伤害时，可以防止此伤害，改为弃置目标两张手牌/装备（不含判定区）
    if (source && source.equips && source.equips.weapon && source.equips.weapon.key === 'hanbing'
      && card && (card.key === 'sha' || card.key === 'huosha' || card.key === 'leisha')
      && !(opts && opts.skipHanbing)) {
      const poolAll = [...target.hand, ...Object.values(target.equips || {}).filter(Boolean)];
      if (poolAll.length > 0) {
        this.pending = {
          type: 'hanbing',
          playerId: source.id,
          targetId: target.id,
          count: Math.min(2, poolAll.length),
          amount,
          cardId: card.id,
          parent,
          prompt: `【寒冰剑】：是否防止 ${target.name} 受到的 ${amount} 点伤害，改为弃置其 ${Math.min(2, poolAll.length)} 张手牌/装备？`,
        };
        this.pushLog(`${source.name} 的【寒冰剑】可以选择防止伤害并弃置 ${target.name} 的牌`);
        return;
      }
    }
    if (target.equips && target.equips.armor && target.equips.armor.key === 'tengjia' && card && (card.fire || card.element === 'fire')) amount += 1;
    target.hp -= amount;
    this.pushLog(`${target.name} 受到${amount}点伤害（${target.hp}/${target.maxHp}）`);
    this.pushEvent('damage', { playerId: target.id, sourceId: source ? source.id : null, amount, element: card && (card.element || (card.fire ? 'fire' : null)) || null });
    // 麒麟弓：造成伤害后可以选择弃置目标一匹马
    if (source && source.equips && source.equips.weapon && source.equips.weapon.key === 'qilin'
      && target.alive && target.equips && (target.equips.horse1 || target.equips.horse2) && !this.pending) {
      this.pending = {
        type: 'qilin', playerId: source.id, targetId: target.id,
        prompt: '【麒麟弓】：是否弃置目标的一匹马？',
      };
    }
    // 连环：属性伤害传导给其他横置角色，受到属性伤害后解除横置
    if (target.chained && card && (card.element === 'fire' || card.element === 'thunder' || card.fire)) {
      target.chained = false;
      for (const q of this.players) {
        if (q.id === target.id || !q.alive || !q.chained) continue;
        this.pushLog(`${q.name} 处于连环状态，受到传导的${amount}点伤害`);
        q.chained = false;
        q.hp -= amount;
        if (q.hp <= 0) this.enterDying(q, source, card, null);
      }
      this.checkWin();
    }

    // 通用伤害触发原语（奸雄 / 反馈 等）
    for (const t of DAMAGE_TRIGGERS) {
      if (!t.skills.some(s => this.hasSkill(target, s))) continue;
      if (t.effect === 'gainDamageCard' && card) {
        const idx = this.discard.findIndex(c => c.id === card.id);
        if (idx >= 0) {
          const [c] = this.discard.splice(idx, 1);
          target.hand.push(c);
          this.pushLog(`${target.name} 发动技能，获得【${c.name}】`);
        }
      } else if (t.effect === 'stealSourceCard' && source && source.alive) {
        const taken = this.takeRandomCard(source);
        if (taken) {
          target.hand.push(taken);
          this.pushLog(`${target.name} 发动技能，获得${source.name}的一张牌`);
        }
      }
    }

    if (target.hp <= 0) {
      this.enterDying(target, source, card, parent);
    } else if (!this.pending) {
      this.pending = parent;
    }
    this.checkWin();
  }

  enterDying(target, source, card, parent) {
    const queue = [target.id, ...this.othersInSeatOrder(target).map(x => x.id)];
    this.pending = {
      type: 'tao',
      playerId: target.id,
      dyingId: target.id,
      sourceId: source ? source.id : null,
      queue,
      index: 0,
      parent: parent || null,
      damageCardId: card ? card.id : null,
      prompt: `${target.name} 濒死，还需${1 - target.hp}张【桃】，是否使用？`,
    };
    this.pushLog(`${target.name} 濒死！`);
  }

  die(player, killer) {
    if (!player.alive) return;
    player.alive = false;
    player.hp = 0;
    for (const c of player.hand) this.discard.push(c);
    for (const c of player.judge) this.discard.push(c);
    player.hand = [];
    player.judge = [];
    this.pushLog(`${player.name} 阵亡（${ROLE_CN[player.role]}）`);

    // 斗地主：一个农民阵亡，另一个农民选择摸两张牌或回复1点体力
    let farmerReward = null;
    if ((this.mode === 'doudizhu' || this.mode === 'doudizhu_ai') && player.role === 'farmer') {
      const other = this.players.find(x => x.alive && x.role === 'farmer' && x.id !== player.id);
      if (other) {
        farmerReward = other;
        if (other.isAI) {
          if (other.hp < other.maxHp) { other.hp = Math.min(other.maxHp, other.hp + 1); this.pushLog(`${other.name} 农民阵亡补偿：回复1点体力`); }
          else { this.draw(other, 2); this.pushLog(`${other.name} 农民阵亡补偿：摸两张牌`); }
        } else {
          this.pending = { type: 'farmer_reward', playerId: other.id, prompt: '农民阵亡补偿：摸两张牌 或 回复1点体力' };
          this.pushLog(`${other.name} 获得农民阵亡补偿，请选择`);
        }
      }
    }

    this.checkWin();
    if (this.gameOver) return;
    if (this.pending) return;

    const cur = this.currentPlayer();
    if (cur && !cur.alive) {
      this.pending = null;
      this.endTurn();
    }
  }

  checkWin() {
    if (this.gameOver) return;
    if (this.mode === 'duel_pvp') {
      const dead = this.players.find(p => !p.alive);
      if (dead) {
        const winner = this.players.find(p => p.alive);
        this.gameOver = winner
          ? { winner: winner.id, text: `${winner.name} 获胜` }
          : { winner: 'draw', text: '平局' };
      }
    } else if (this.mode === 'duel') {
      const player = this.players.find(p => p.role === 'player');
      const ai = this.players.find(p => p.role === 'ai');
      if (!player.alive) this.gameOver = { winner: 'ai', text: 'AI 获胜' };
      else if (!ai.alive) this.gameOver = { winner: 'player', text: '你获胜' };
    } else {
      const landlord = this.players.find(p => p.role === 'landlord');
      const farmers = this.players.filter(p => p.role === 'farmer' && p.alive);
      if (!landlord.alive) this.gameOver = { winner: 'farmer', text: '农民获胜' };
      else if (farmers.length === 0) this.gameOver = { winner: 'landlord', text: '地主获胜' };
    }

    if (this.gameOver) {
      this.phase = 'over';
      this.pending = null;
      this.pushLog(`游戏结束：${this.gameOver.text}`);
    }
  }

  // ---------------- 视图 ----------------
  getView(playerId) {
    const you = this.findPlayer(playerId);
    const revealAll = !!this.gameOver;
    return {
      started: this.started,
      phase: this.phase,
      turn: this.turn,
      currentPlayer: this.currentPlayer() ? this.currentPlayer().id : null,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        seat: p.seat,
        role: p.role,
        general: p.general,
        hp: p.hp,
        maxHp: p.maxHp,
        handCount: p.hand.length,
        judgeCount: p.judge.length,
        equips: p.equips,
        chained: !!p.chained,
        jiu: !!p.flags.jiu,
        yijueSealed: !!p.yijueSealed,
        judges: p.judge.map(c => c.name),
        alive: p.alive,
        isCurrent: this.currentPlayer() && this.currentPlayer().id === p.id,
      })),
      you: you ? {
        id: you.id,
        role: you.role,
        general: you.general,
        hp: you.hp,
        maxHp: you.maxHp,
        hand: you.hand,
        judge: you.judge,
        equips: you.equips,
        shaUsed: you.flags.shaUsed,
        jiuUsed: you.flags.jiuUsed,
        jiu: you.flags.jiu,
        yijueUsed: you.flags.yijueUsed,
        yijueSealed: !!you.yijueSealed,
      } : null,
      pending: this.pending ? ((this.pending.playerId === playerId || (this.pending.allowed || []).includes(playerId))
        ? {
            type: this.pending.type,
            playerId: this.pending.playerId,
            prompt: this.pending.prompt,
            count: this.pending.count,
            dyingId: this.pending.dyingId,
            stage: this.pending.stage,
            targetId: this.pending.targetId,
            total: this.pending.total,
            cards: this.pending.cards ? this.pending.cards.map(c => ({ id: c.id, name: c.name, suit: c.suit, number: c.number, color: c.color, type: c.type })) : undefined,
          }
        : { type: this.pending.type, playerId: this.pending.playerId }) : null,
      lastJudgment: this.lastJudgment || null,
      deckCount: this.deck.length,
      hanbing: this.pending && this.pending.type === 'hanbing' && this.pending.playerId === playerId
        ? (() => {
            const t = this.findPlayer(this.pending.targetId);
            if (!t) return { count: 0, targetName: '', cards: [], zones: null };
            const cv = c => ({ id: c.id, name: c.name, suit: c.suit, number: c.number, color: c.color, type: c.type });
            return {
              count: this.pending.count,
              targetName: t.name,
              cards: [...t.hand, ...Object.values(t.equips || {}).filter(Boolean)]
                .map(c => ({ id: c.id, name: c.name, type: c.type, suit: c.suit, number: c.number, color: c.color })),
              zones: {
                hand: t.hand.map(c => ({ id: c.id })),
                equips: {
                  weapon: t.equips.weapon ? cv(t.equips.weapon) : null,
                  armor: t.equips.armor ? cv(t.equips.armor) : null,
                  horse1: t.equips.horse1 ? cv(t.equips.horse1) : null,
                  horse2: t.equips.horse2 ? cv(t.equips.horse2) : null,
                },
                judge: [],
              },
            };
          })()
        : null,
      wugu: this.pending && this.pending.type === 'wugu' && this.pending.playerId === playerId
        ? { cards: this.pending.cards.map(c => ({ id: c.id, name: c.name, suit: c.suit, number: c.number, color: c.color })) }
        : null,
      huogong: this.pending && this.pending.type === 'huogong' && this.pending.playerId === playerId
        ? {
            shown: { id: this.pending.shown.id, name: this.pending.shown.name, suit: this.pending.shown.suit, number: this.pending.shown.number, color: this.pending.shown.color },
            same: (you ? you.hand : []).filter(c => c.suit === this.pending.shown.suit).map(c => ({ id: c.id, name: c.name, suit: c.suit, number: c.number, color: c.color })),
          }
        : null,
      pick: this.pending && this.pending.type === 'pick' && this.pending.playerId === playerId
        ? (() => {
            const t = this.findPlayer(this.pending.targetId);
            if (!t) return { targetId: null, targetName: '', mode: this.pending.mode, cards: [], zones: null };
            const cv = c => ({ id: c.id, name: c.name, suit: c.suit, number: c.number, color: c.color, type: c.type });
            return {
              targetId: t.id,
              targetName: t.name,
              mode: this.pending.mode,
              cards: [
                ...t.judge.map(c => ({ id: c.id, zone: 'judge', hidden: false, name: c.name, suit: c.suit, number: c.number, color: c.color })),
                ...Object.values(t.equips || {}).filter(Boolean).map(c => ({ id: c.id, zone: 'equip', hidden: false, name: c.name, suit: c.suit, number: c.number, color: c.color })),
                ...t.hand.map(c => ({ id: c.id, zone: 'hand', hidden: true })),
              ],
              zones: {
                hand: t.hand.map(c => ({ id: c.id })),
                equips: {
                  weapon: t.equips.weapon ? cv(t.equips.weapon) : null,
                  armor: t.equips.armor ? cv(t.equips.armor) : null,
                  horse1: t.equips.horse1 ? cv(t.equips.horse1) : null,
                  horse2: t.equips.horse2 ? cv(t.equips.horse2) : null,
                },
                judge: t.judge.map(cv),
              },
            };
          })()
        : null,
      log: this.log.slice(-30),
      events: this.events.slice(-20),
      lastReveal: this.lastReveal,
      gameOver: this.gameOver,
    };
  }
}

module.exports = { Game };



