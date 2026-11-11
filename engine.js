'use strict';

const {
  GENERALS, ROLE_SETS, ROLE_CN, SUIT_CN,
  shuffle, buildDeck,
} = require('./data');

function ok() { return { ok: true }; }
function err(msg) { return { ok: false, error: msg }; }

class Game {
  constructor(playerInfos, mode = 'doudizhu') {
    if (!ROLE_SETS[mode]) throw new Error('不支持的模式: ' + mode);
    if (ROLE_SETS[mode].length !== playerInfos.length) {
      throw new Error('人数与模式不匹配: ' + playerInfos.length);
    }
    this.mode = mode;
    this.n = playerInfos.length;
    // 斗地主随机座位；1v1（含真人联机）保持顺序
    const shuffled = (mode === 'duel' || mode === 'duel_pvp') ? playerInfos.slice() : shuffle(playerInfos.slice());
    this.players = shuffled.map((info, i) => ({
      id: info.id,
      name: info.name,
      generalId: info.generalId || null,
      seat: i,
      role: null,
      general: null,
      hp: 0,
      maxHp: 0,
      hand: [],
      judge: [],
      equips: { weapon: null, armor: null, horse1: null, horse2: null },
      chained: false,
      alive: true,
      flags: { shaUsed: 0, jiuUsed: 0, jiu: false },
    }));
    this.deck = buildDeck();
    this.discard = [];
    this.current = 0;
    this.phase = 'init';
    this.pending = null;
    this.turn = 0;
    this.log = [];
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
    this.players[0].role = 'landlord';
    for (let i = 1; i < this.n; i++) this.players[i].role = 'farmer';
  }

  assignGenerals() {
    const used = new Set();
    for (let i = 0; i < this.n; i++) {
      const p = this.players[i];
      let g = null;
      if ((this.mode === 'duel' || this.mode === 'duel_pvp') && p.generalId) {
        g = GENERALS.find(x => x.id === p.generalId) || null;
      }
      if (!g) {
        const pool = GENERALS.filter(x => !used.has(x.id));
        g = pool.length ? pool[Math.floor(Math.random() * pool.length)] : GENERALS[i % GENERALS.length];
      }
      used.add(g.id);
      p.general = { ...g, skills: g.skills.slice() };
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
    for (const p of this.players) this.draw(p, 4);
    this.current = 0;
    this.turn = 1;
    const firstText = this.mode === 'duel'
      ? '游戏开始，你先手'
      : this.mode === 'duel_pvp'
        ? `游戏开始，${this.currentPlayer().name} 先手`
        : '游戏开始，地主先手';
    this.pushLog(firstText);
    this.beginTurn();
  }

  // ---------------- 基础工具 ----------------
  pushLog(text) {
    this.log.push(text);
    if (this.log.length > 300) this.log.shift();
  }

  currentPlayer() { return this.players[this.current]; }
  findPlayer(id) { return this.players.find(p => p.id === id); }
  hasSkill(p, s) { return !!(p && p.general && p.general.skills.includes(s)); }

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
    return this.deck.pop();
  }

  draw(p, n) {
    const cards = [];
    for (let i = 0; i < n; i++) {
      const c = this.drawCard();
      if (!c) break;
      p.hand.push(c);
      cards.push(c);
    }
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
    for (let i = 1; i <= this.n; i++) {
      const idx = (from + i) % this.n;
      if (this.players[idx].alive) return idx;
    }
    return from;
  }

  beginTurn() {
    if (this.gameOver) return;
    const p = this.currentPlayer();
    if (!p || !p.alive) { this.endTurn(); return; }
    p.flags.shaUsed = 0;
    p.flags.jiuUsed = 0;
    p.flags.jiu = false;
    this.phase = 'judge';

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
    if (skipDraw) {
      this.pushLog(`${p.name} 跳过摸牌阶段`);
    } else {
      let drawCount = 2;
      if (this.hasSkill(p, 'yingzi')) drawCount = 3;
      this.draw(p, drawCount);
      this.pushLog(`${p.name} 摸${drawCount}张牌`);
      if (this.hasSkill(p, 'yingzi')) this.pushLog(`${p.name} 发动【英姿】多摸一张牌`);
    }
    if (skipPlay) {
      this.pushLog(`${p.name} 跳过出牌阶段`);
      this.phase = 'discard';
      this.checkDiscard();
      return;
    }
    this.phase = 'play';
  }

  endTurn() {
    if (this.gameOver) return;
    const p = this.currentPlayer();
    if (p && p.alive && this.hasSkill(p, 'biyue')) {
      this.draw(p, 1);
      this.pushLog(`${p.name} 发动【闭月】摸一张牌`);
    }
    const next = this.nextAliveIndex(this.current);
    this.current = next;
    this.turn++;
    this.beginTurn();
  }

  checkDiscard() {
    const p = this.currentPlayer();
    if (!p) return;
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
    if (as === card.key) return true;
    if (as === 'sha') {
      if (['sha', 'huosha', 'leisha'].includes(card.key)) return true;
      if ((this.hasSkill(p, 'wusheng') || this.hasSkill(p, 're_wusheng')) && card.color === 'red') return true;
      if ((this.hasSkill(p, 'longdan') || this.hasSkill(p, 're_longdan')) && card.key === 'shan') return true;
    }
    if (as === 'tiesuo_recast' && card.key === 'tiesuo') return true;
    if (as === 'shan') {
      if ((this.hasSkill(p, 'longdan') || this.hasSkill(p, 're_longdan')) && card.key === 'sha') return true;
    }
    return false;
  }

  // ---------------- 出牌 ----------------
  play(playerId, action) {
    if (this.phase !== 'play') return err('现在不是出牌阶段');
    const p = this.currentPlayer();
    if (!p || p.id !== playerId) return err('还没轮到你');
    if (this.pending) return err('请先等待当前响应结束');

    const card = p.hand.find(c => c.id === action.cardId);
    if (!card) return err('你没有这张牌');

    // 装备牌：直接进入装备区
    if (card.type === 'equip') {
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

    const useAs = action.as || (card && card.key);

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
      if (this.distance(p, target) > 3) return err('目标不在攻击范围内');
      if (!this.hasSkill(p, 'paoxiao') && p.flags.shaUsed >= 1) return err('本回合已经使用过【杀】');
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
      const range = (p.equips && p.equips.weapon && p.equips.weapon.range) || 1;
      if (this.distance(p, target) > range) return err('目标不在攻击范围内');
      if (!this.hasSkill(p, 'paoxiao') && !this.hasSkill(p, 're_paoxiao') && !(p.equips && p.equips.weapon && p.equips.weapon.key === 'zhuge') && p.flags.shaUsed >= 1) return err('本回合已经使用过【杀】');
    } else if (useAs === 'juedou') {
      if (!target || !target.alive || target.id === p.id) return err('请选择一名其他角色');
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
      const fire = weapon && weapon.key === 'zhuque';
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
        if (armor.key === 'bagua') {
          const judge = this.drawCard();
          if (judge) {
            this.discard.push(judge);
            this.lastJudgment = { seq: Date.now(), card: judge, text: `【八卦阵】判定：${judge.name}` };
            if (judge.color === 'red') {
              this.discard.push(card);
              this.pushLog(`${target.name} 的【八卦阵】判定为红色，视为出【闪】`);
              return ok();
            }
          }
        }
      }
      this.discard.push(card);
      p.flags.shaUsed++;
      if (this.hasSkill(p, 're_paoxiao') && p.flags.shaUsed === 2) {
        this.draw(p, 1);
        this.pushLog(`${p.name} 发动【咆哮】，摸一张牌`);
      }
      if (this.hasSkill(p, 're_longdan') && card.key === 'shan') {
        this.draw(p, 1);
        this.pushLog(`${p.name} 发动【龙胆】，摸一张牌`);
      }
      const wushengBoost = this.hasSkill(p, 're_wusheng') && card.color === 'red' && card.key !== 'sha';
      this.pushLog(`${p.name} 对 ${target.name} 使用【杀】${fire ? '（火杀）' : ''}`);
      // 雌雄双股剑：异性目标，摸一张
      if (weapon && weapon.key === 'cixiong' && p.general && target.general && p.general.gender !== target.general.gender) {
        this.draw(p, 1);
        this.pushLog(`${p.name} 发动【雌雄双股剑】，摸一张牌`);
      }
      const fangtian = !!(weapon && weapon.key === 'fangtian' && p.hand.length === 0 && targets.length > 1);
      const shaTargets = fangtian ? targets : [target];
      const first = shaTargets[0];
      const rest = shaTargets.slice(1).map(x => x.id);
      this.pending = {
        type: 'shan',
        playerId: first.id,
        sourceId: p.id,
        cardId: card.id,
        fire,
        boost: wushengBoost,
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
      this.startWuxie(p, card, { useAs, targetId: useAs === 'shandian' ? p.id : target.id });
      return ok();
    }
    this.discard.push(card);
    this.startWuxie(p, card, { useAs, targetId: target ? target.id : null, targetIds: targets.map(x => x.id) });
    return ok();
  }

  startWuxie(source, card, trick) {
    // 只询问手里确实有【无懈可击】的其他玩家；没人有就直接结算
    const queue = this.othersInSeatOrder(source)
      .filter(x => x.alive && x.hand.some(c => c.key === 'wuxie'))
      .map(x => x.id);
    if (queue.length === 0) {
      this.resolveTrick({ sourceId: source.id, cardId: card.id, cardRef: card, trick, canceled: false });
      return;
    }
    this.pending = {
      type: 'wuxie',
      playerId: queue[0],
      sourceId: source.id,
      cardId: card.id,
      cardRef: card,
      queue,
      index: 0,
      canceled: false,
      trick,
      prompt: `是否对【${card.name}】使用【无懈可击】？`,
    };
  }

  resolveTrick(pend) {
    this.pending = null;
    const source = this.findPlayer(pend.sourceId);
    const card = pend.cardRef || this.findCardById(pend.cardId);
    const trick = pend.trick || {};
    const target = trick.targetId ? this.findPlayer(trick.targetId) : null;

    if (pend.canceled) {
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
      const sha = target.hand.find(c => this.canUseAs(target, c, 'sha'));
      if (sha) {
        this.removeFromPlayer(target, sha);
        this.discard.push(sha);
        this.pushLog(`${target.name} 使用【杀】响应【借刀杀人】`);
        this.damage(source, 1, target, sha, null);
      } else {
        target.equips.weapon = null;
        source.hand.push(w);
        this.pushLog(`${target.name} 将【${w.name}】交给 ${source.name}`);
      }
      return;
    }
    if (trick.useAs === 'nanman' || trick.useAs === 'wanjian') {
      const queue = this.othersInSeatOrder(source);
      this.pushLog(`${source.name} 使用【${trick.useAs === 'nanman' ? '南蛮入侵' : '万箭齐发'}】`);
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
    if (!this.pending) return err('现在没有需要响应的牌');
    const pend = this.pending;
    if (pend.playerId !== playerId) return err('还没轮到你响应');
    const p = this.findPlayer(playerId);
    if (!p || !p.alive) return err('角色已阵亡');

    if (pend.type === 'pick') return this.pickCard(playerId, action.cardId);

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

    if (pend.type === 'wuxie') {
      if (action.pass) {
        pend.index++;
        while (pend.index < pend.queue.length) {
          const q = this.findPlayer(pend.queue[pend.index]);
          if (q && q.alive) break;
          pend.index++;
        }
        if (pend.index >= pend.queue.length) {
          this.resolveTrick(pend);
        } else {
          pend.playerId = pend.queue[pend.index];
          const q = this.findPlayer(pend.playerId);
          const cname = pend.cardRef ? pend.cardRef.name : '锦囊';
          pend.prompt = `${q.name} 是否对【${cname}】使用【无懈可击】？`;
        }
        return ok();
      }
      const card = p.hand.find(c => c.id === action.cardId);
      if (!card || card.key !== 'wuxie') return err('请选择【无懈可击】');
      p.hand.splice(p.hand.indexOf(card), 1);
      this.discard.push(card);
      this.pushLog(`${p.name} 使用【无懈可击】`);
      pend.canceled = true;
      this.resolveTrick(pend);
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
        this.damage(p, pend.boost ? 2 : 1, this.findPlayer(pend.sourceId), this.findCardById(pend.cardId), null);
        if (!this.pending) nextSha();
        return ok();
      }
      const card = p.hand.find(c => c.id === action.cardId);
      if (!card || !this.canUseAs(p, card, 'shan')) return err('请选择【闪】');
      p.hand.splice(p.hand.indexOf(card), 1);
      this.discard.push(card);
      this.pushLog(`${p.name} 打出【闪】`);
      if (this.hasSkill(p, 're_longdan') && card.key === 'sha') {
        this.draw(p, 1);
        this.pushLog(`${p.name} 发动【龙胆】，摸一张牌`);
      }
      this.pending = null;
      nextSha();
      // 青龙偃月刀：被闪抵消后可以继续使用一张杀
      const src = this.findPlayer(pend.sourceId);
      if (src && src.equips && src.equips.weapon && src.equips.weapon.key === 'qinglong') {
        const sha = src.hand.find(c => this.canUseAs(src, c, 'sha'));
        if (sha) {
          this.removeFromPlayer(src, sha);
          this.discard.push(sha);
          this.pushLog(`${src.name} 发动【青龙偃月刀】，继续使用【杀】`);
          this.pending = {
            type: 'shan',
            playerId: p.id,
            sourceId: src.id,
            cardId: sha.id,
            prompt: `${p.name} 请出【闪】`,
          };
          return ok();
        }
      }
      // 贯石斧：被闪抵消后弃两张牌，强行造成伤害
      if (src && src.equips && src.equips.weapon && src.equips.weapon.key === 'guanshi' && this.cardCount(src) >= 2) {
        const pool = [...src.hand, ...src.judge];
        for (let i = 0; i < 2 && pool.length; i++) {
          const c = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
          this.removeFromPlayer(src, c);
          this.discard.push(c);
        }
        this.pushLog(`${src.name} 发动【贯石斧】，弃两张牌令【杀】依然造成伤害`);
        this.damage(p, 1, src, this.findCardById(pend.cardId), null);
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
          pend.prompt = `${q ? q.name : '?'} 是否使用【桃】救${dying.name}？`;
        }
        return ok();
      }
      const card = p.hand.find(c => c.id === action.cardId);
      if (!card || (card.key !== 'tao' && card.key !== 'jiu')) return err('请选择【桃】或【酒】');
      p.hand.splice(p.hand.indexOf(card), 1);
      this.discard.push(card);
      dying.hp = Math.min(dying.maxHp, dying.hp + 1);
      this.pushLog(`${p.name} 对 ${dying.name} 使用【${card.key === 'jiu' ? '酒' : '桃'}】`);
      if (dying.hp > 0) {
        this.pending = pend.parent || null;
      } else {
        pend.prompt = `${p.name} 是否继续使用【桃】？`;
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
        return ok();
      }
      const card = p.hand.find(c => c.id === action.cardId);
      if (!card || !this.canUseAs(p, card, need)) return err(`请选择【${needCard}】`);
      p.hand.splice(p.hand.indexOf(card), 1);
      this.discard.push(card);
      this.pushLog(`${p.name} 打出【${needCard}】`);
      this.pending = this.advanceQueue(pend);
      return ok();
    }

    return err('未知的响应类型');
  }

  advanceQueue(pend) {
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
  damage(target, amount, source, card, parent = null) {
    if (!target.alive) { this.pending = parent; return; }
    if (target.equips && target.equips.armor && target.equips.armor.key === 'baiyin' && amount > 1) amount = 1;
    if (source && source.equips && source.equips.weapon && source.equips.weapon.key === 'guding' && target.hand.length === 0) amount += 1;
    if (source && source.flags && source.flags.jiu && card && card.key === 'sha') {
      amount += 1;
      source.flags.jiu = false;
      this.pushLog(`${source.name} 的【酒】使【杀】伤害+1`);
    }
    // 藤甲：南蛮/万箭无效
    if (target.equips && target.equips.armor && target.equips.armor.key === 'tengjia' && card && (card.key === 'nanman' || card.key === 'wanjian')) {
      this.pushLog(`${target.name} 的【藤甲】使【${card.name}】无效`);
      this.pending = parent;
      return;
    }
    // 寒冰剑：防止伤害，弃目标两张牌
    if (source && source.equips && source.equips.weapon && source.equips.weapon.key === 'hanbing' && card && card.key !== 'nanman' && card.key !== 'wanjian') {
      const pool = [...target.hand, ...target.judge, ...Object.values(target.equips || {}).filter(Boolean)];
      const removed = [];
      for (let i = 0; i < 2 && pool.length; i++) {
        const c = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        this.removeFromPlayer(target, c);
        this.discard.push(c);
        removed.push(c.name);
      }
      this.pushLog(`${source.name} 发动【寒冰剑】，防止伤害并弃置 ${target.name} 的${removed.length ? '【' + removed.join('】【') + '】' : '两张牌'}`);
      this.pending = parent;
      return;
    }
    if (target.equips && target.equips.armor && target.equips.armor.key === 'tengjia' && card && (card.fire || card.element === 'fire')) amount += 1;
    target.hp -= amount;
    this.pushLog(`${target.name} 受到${amount}点伤害（${target.hp}/${target.maxHp}）`);
    // 麒麟弓：造成伤害后弃置目标一匹马
    if (source && source.equips && source.equips.weapon && source.equips.weapon.key === 'qilin' && target.equips) {
      const slot = target.equips.horse1 ? 'horse1' : (target.equips.horse2 ? 'horse2' : null);
      if (slot) {
        const horse = target.equips[slot];
        target.equips[slot] = null;
        this.discard.push(horse);
        this.pushLog(`${source.name} 发动【麒麟弓】，弃置 ${target.name} 的【${horse.name}】`);
      }
    }
    // 连环：属性伤害传导给其他横置角色
    if (target.chained && card && (card.element === 'fire' || card.element === 'thunder' || card.fire)) {
      for (const q of this.players) {
        if (q.id === target.id || !q.alive || !q.chained) continue;
        this.pushLog(`${q.name} 处于连环状态，受到传导的${amount}点伤害`);
        q.hp -= amount;
        if (q.hp <= 0) this.enterDying(q, source, card, null);
      }
      this.checkWin();
    }

    // 奸雄
    if (this.hasSkill(target, 'jianxiong') && card) {
      const idx = this.discard.findIndex(c => c.id === card.id);
      if (idx >= 0) {
        const [c] = this.discard.splice(idx, 1);
        target.hand.push(c);
        this.pushLog(`${target.name} 发动【奸雄】，获得【${c.name}】`);
      }
    }
    // 反馈
    if (this.hasSkill(target, 'fankui') && source && source.alive) {
      const taken = this.takeRandomCard(source);
      if (taken) {
        target.hand.push(taken);
        this.pushLog(`${target.name} 发动【反馈】，获得${source.name}的一张牌`);
      }
    }

    if (target.hp <= 0) {
      this.enterDying(target, source, card, parent);
    } else {
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
      prompt: `${target.name} 濒死，是否使用【桃】？`,
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

    // 斗地主：一个农民阵亡，另一个农民摸 2 张
    if (this.mode === 'doudizhu' && player.role === 'farmer') {
      const other = this.players.find(x => x.alive && x.role === 'farmer' && x.id !== player.id);
      if (other) {
        this.draw(other, 2);
        this.pushLog(`${other.name} 农民阵亡补偿，摸两张牌`);
      }
    }

    this.checkWin();

    if (!this.gameOver) {
      const cur = this.currentPlayer();
      if (cur && !cur.alive) {
        this.pending = null;
        this.endTurn();
      }
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
      } : null,
      pending: this.pending ? (this.pending.playerId === playerId
        ? {
            type: this.pending.type,
            playerId: this.pending.playerId,
            prompt: this.pending.prompt,
            count: this.pending.count,
            dyingId: this.pending.dyingId,
          }
        : { type: this.pending.type, playerId: this.pending.playerId }) : null,
      lastJudgment: this.lastJudgment || null,
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
            return {
              targetId: this.pending.targetId,
              mode: this.pending.mode,
              cards: t ? [
                ...t.judge.map(c => ({ id: c.id, zone: 'judge', hidden: false, name: c.name, suit: c.suit, number: c.number, color: c.color })),
                ...Object.values(t.equips || {}).filter(Boolean).map(c => ({ id: c.id, zone: 'equip', hidden: false, name: c.name, suit: c.suit, number: c.number, color: c.color })),
                ...t.hand.map(c => ({ id: c.id, zone: 'hand', hidden: true })),
              ] : [],
            };
          })()
        : null,
      log: this.log.slice(-30),
      gameOver: this.gameOver,
    };
  }
}

module.exports = { Game };
