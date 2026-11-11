'use strict';

// 1v1 简单 AI：优先级出牌 + 响应；不偷看玩家手牌
function aiAct(game) {
  const ai = game.players.find(p => p.role === 'ai');
  if (!ai || !ai.alive) return;

  let guard = 0;
  while (!game.gameOver && guard++ < 200) {
    // ---- 响应窗口 ----
    if (game.pending) {
      if (game.pending.playerId !== ai.id) break;
      const pend = game.pending;

      if (pend.type === 'discard') {
        const ids = ai.hand.slice(0, pend.count).map(c => c.id);
        game.discardCards(ai.id, ids);
        continue;
      }

      if (pend.type === 'wugu') {
        const c = (pend.cards || [])[0];
        if (c) game.respond(ai.id, { cardId: c.id });
        else game.respond(ai.id, { pass: true });
        continue;
      }

      if (pend.type === 'huogong') {
        const shown = pend.shown;
        const c = shown ? ai.hand.find(x => x.suit === shown.suit) : null;
        game.respond(ai.id, c ? { cardId: c.id } : { pass: true });
        continue;
      }

      if (pend.type === 'pick') {
        const t = game.findPlayer(pend.targetId);
        const pool = t ? [...t.hand, ...t.judge] : [];
        if (pool.length) game.respond(ai.id, { cardId: pool[Math.floor(Math.random() * pool.length)].id });
        else game.respond(ai.id, { pass: true });
        continue;
      }

      if (pend.type === 'wuxie') {
        const harmful = ['juedou', 'guohe', 'shunshou', 'nanman', 'wanjian', 'bingliang'].includes(pend.trick && pend.trick.useAs);
        const wx = ai.hand.find(c => c.key === 'wuxie');
        if (harmful && wx && Math.random() < 0.6) game.respond(ai.id, { cardId: wx.id });
        else game.respond(ai.id, { pass: true });
        continue;
      }

      let need = null;
      if (pend.type === 'shan' || pend.type === 'wanjian') need = 'shan';
      else if (pend.type === 'duel' || pend.type === 'nanman') need = 'sha';
      else if (pend.type === 'tao') need = 'tao';

      if (pend.type === 'tao' && pend.dyingId !== ai.id) {
        // 不救玩家
        game.respond(ai.id, { pass: true });
        continue;
      }

      if (!need) { game.respond(ai.id, { pass: true }); continue; }

      const candidates = ai.hand.filter(c => game.canUseAs(ai, c, need));
      if (candidates.length) {
        game.respond(ai.id, { cardId: candidates[0].id });
      } else {
        game.respond(ai.id, { pass: true });
      }
      continue;
    }

    // ---- 只在自己的回合行动 ----
    if (!game.currentPlayer() || game.currentPlayer().id !== ai.id) break;
    if (game.phase !== 'play') break;

    const human = game.players.find(p => p.role === 'player');
    const target = human && human.alive ? human : null;

    const tryPlay = (card, as, targetId) => {
      if (!card) return false;
      const r = game.play(ai.id, { cardId: card.id, as, targetId });
      return !!r.ok;
    };

    // 1. 受伤吃桃
    if (ai.hp < ai.maxHp) {
      const tao = ai.hand.find(c => c.key === 'tao');
      if (tryPlay(tao, 'tao')) continue;
    }

    // 2. 无中生有
    const wuzhong = ai.hand.find(c => c.key === 'wuzhong');
    if (tryPlay(wuzhong, 'wuzhong')) continue;

    // 2.5 装备：空栏优先，有更好的武器也换
    const emptyEquip = ai.hand.find(c => c.type === 'equip' && ai.equips && !ai.equips[c.slot]);
    if (tryPlay(emptyEquip, emptyEquip && emptyEquip.key)) continue;

    if (target) {
      // 丈八蛇矛：两张手牌当杀
      if (ai.equips && ai.equips.weapon && ai.equips.weapon.key === 'zhangba' && ai.hand.length >= 2) {
        const [c1, c2] = ai.hand;
        const r = game.play(ai.id, { as: 'zhangba_sha', cardIds: [c1.id, c2.id], targetId: target.id });
        if (r.ok) continue;
      }
      // 3. 杀（含武圣/龙胆转化）
      const canShaLimit = ai.general.skills.includes('paoxiao') || ai.flags.shaUsed < 1;
      if (canShaLimit) {
        const sha = ai.hand.find(c => game.canUseAs(ai, c, 'sha'));
        if (tryPlay(sha, 'sha', target.id)) continue;
      }

      // 4. 决斗
      const juedou = ai.hand.find(c => c.key === 'juedou');
      if (tryPlay(juedou, 'juedou', target.id)) continue;

      // 5. 兵粮 / 过河 / 顺手
      const bingliang = ai.hand.find(c => c.key === 'bingliang');
      if (tryPlay(bingliang, 'bingliang', target.id)) continue;

      const guohe = ai.hand.find(c => c.key === 'guohe');
      if (tryPlay(guohe, 'guohe', target.id)) continue;

      const shunshou = ai.hand.find(c => c.key === 'shunshou');
      if (tryPlay(shunshou, 'shunshou', target.id)) continue;
    }

    // 6. 结束出牌
    game.endPlay(ai.id);
  }
}

module.exports = { aiAct };
