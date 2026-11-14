'use strict';

// 1v1 简单 AI：优先级出牌 + 响应；不偷看玩家手牌
function aiAct(game) {
  let ai = null;
  if (game.pending && game.pending.type === 'wuxie' && game.pending.allowed) {
    const q = game.pending.allowed.map(id => game.findPlayer(id)).find(x => x && x.isAI && x.alive);
    if (q) ai = q;
  }
  if (!ai && game.pending && game.pending.playerId) {
    const q = game.findPlayer(game.pending.playerId);
    if (q && q.isAI) ai = q;
  }
  if (!ai) {
    const c = game.currentPlayer();
    if (c && c.isAI) ai = c;
  }
  if (!ai || !ai.alive) return;

  let guard = 0;
  while (!game.gameOver && guard++ < 200) {
    // ---- 响应窗口 ----
    if (game.pending) {
      if (game.pending.playerId !== ai.id) break;
      const pend = game.pending;

      // 被【义绝】封印：不能用/打出手牌，需要出牌的响应全部放弃
      if (ai.yijueSealed && ['shan', 'duel', 'nanman', 'wanjian', 'tao', 'wuxie', 'huogong', 'jiedao'].includes(pend.type)) {
        game.respond(ai.id, { pass: true });
        continue;
      }

      if (pend.type === 'guanxing') {
        if (pend.stage === 'ask') { game.respond(ai.id, { accept: true }); return; }
        const ids = (pend.cards || []).map(c => c.id);
        game.respond(ai.id, { top: ids, bottom: [] });
        return;
      }

      if (pend.type === 'wuxie') {
        const t = pend.trick && pend.trick.targetId ? game.findPlayer(pend.trick.targetId) : null;
        const ally = t && (t.id === ai.id || t.role === ai.role);
        const wx = ai.hand.find(c => c.key === 'wuxie');
        if (wx && ally) game.respond(ai.id, { cardId: wx.id });
        else game.respond(ai.id, { pass: true });
        return;
      }

      if (pend.type === 'tuxi_ask') { game.respond(ai.id, { accept: true }); return; }
      if (pend.type === 'tuxi_targets') {
        const foes = game.players.filter(x => x.alive && x.id !== ai.id && x.role !== ai.role && x.hand.length > 0).slice(0, 2);
        game.respond(ai.id, { targetIds: foes.map(x => x.id) });
        return;
      }
      if (pend.type === 'tuxi_pick') { game.respond(ai.id, { index: 0 }); return; }

      if (pend.type === 'farmer_reward') {
        game.respond(ai.id, { choice: ai.hp < ai.maxHp ? 'heal' : 'draw' });
        return;
      }

      if (pend.type === 'draw_ack') { game.respond(ai.id, {}); return; }

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

      if (pend.type === 'cixiong') {
        if (ai.hand.length >= 3) game.respond(ai.id, { cardId: ai.hand[0].id });
        else game.respond(ai.id, { pass: true });
        continue;
      }

      if (pend.type === 'guanshi') {
        const pool = [...ai.hand, ...Object.values(ai.equips || {}).filter(Boolean), ...ai.judge];
        if (pool.length >= 2) game.respond(ai.id, { cardIds: pool.slice(0, 2).map(c => c.id) });
        else game.respond(ai.id, { pass: true });
        continue;
      }

      if (pend.type === 'qinglong' || pend.type === 'qilin') {
        game.respond(ai.id, {});
        continue;
      }

      if (pend.type === 'yijue_heal') {
        game.respond(ai.id, { pass: true });
        continue;
      }

      if (pend.type === 'jiedao') {
        const sha = ai.hand.find(c => game.canUseAs(ai, c, 'sha'));
        game.respond(ai.id, sha ? { cardId: sha.id } : { pass: true });
        continue;
      }

      if (pend.type === 'yijue') {
        const c = ai.hand[0];
        game.respond(ai.id, c ? { cardId: c.id } : { pass: true });
        continue;
      }

      if (pend.type === 'hanbing') {
        const t = game.findPlayer(pend.targetId);
        const pool = t ? [...t.hand, ...Object.values(t.equips || {}).filter(Boolean)] : [];
        const ids = pool.slice(0, pend.count || 2).map(c => c.id);
        game.respond(ai.id, ids.length ? { cardIds: ids } : { pass: true });
        continue;
      }

      if (pend.type === 'yajiao') {
        game.respond(ai.id, { targetId: ai.id });
        continue;
      }

      if (pend.type === 'yajiao_discard') {
        const c = ai.hand[0];
        game.respond(ai.id, { cardIds: c ? [c.id] : [] });
        continue;
      }

      if (pend.type === 'pick') {
        const t = game.findPlayer(pend.targetId);
        const pool = t ? [...t.hand, ...t.judge, ...Object.values(t.equips || {}).filter(Boolean)] : [];
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

    // 敌人：不同阵营的存活角色；农民优先打地主，否则打血量最低的
    let enemies = game.players.filter(p => p.alive && p.id !== ai.id && p.role !== ai.role);
    if (ai.role === 'farmer') {
      enemies.sort((x, y) => (x.role === 'landlord' ? -1 : 0) - (y.role === 'landlord' ? -1 : 0) || x.hp - y.hp);
    } else {
      enemies.sort((x, y) => x.hp - y.hp);
    }
    const target = enemies[0] || null;

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

    // 1.5 酒：本回合未用且手里有杀，先喝酒
    if (!ai.flags.jiuUsed && ai.hand.some(c => c.key === 'jiu') && ai.hand.some(c => game.canUseAs(ai, c, 'sha'))) {
      const jiu = ai.hand.find(c => c.key === 'jiu');
      if (tryPlay(jiu, 'jiu')) continue;
    }

    if (target) {
      // 义绝：本回合未发动、目标有手牌、自己有牌可弃
      if (ai.general.skills.includes('yijue') && ai.flags.yijueUsed < 1 && target.hand.length > 0 && ai.hand.length > 1) {
        const cost = ai.hand[ai.hand.length - 1];
        const r = game.play(ai.id, { as: 'yijue', cardIds: [cost.id], targetId: target.id });
        if (r.ok) continue;
      }
      // 丈八蛇矛：两张手牌当杀
      if (ai.equips && ai.equips.weapon && ai.equips.weapon.key === 'zhangba' && ai.hand.length >= 2) {
        const [c1, c2] = ai.hand;
        const r = game.play(ai.id, { as: 'zhangba_sha', cardIds: [c1.id, c2.id], targetId: target.id });
        if (r.ok) continue;
      }
      // 3. 杀（含武圣/龙胆转化）
      const canShaLimit = ai.general.skills.includes('paoxiao') || ai.general.skills.includes('re_paoxiao')
        || (ai.equips && ai.equips.weapon && ai.equips.weapon.key === 'zhuge') || ai.flags.shaUsed < (game.shaLimitOf ? game.shaLimitOf(ai) : (ai.role === 'landlord' ? 2 : 1));
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
