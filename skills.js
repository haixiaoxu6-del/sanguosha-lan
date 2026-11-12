'use strict';
// 通用技能原语层
// 新增武将时，重复模式的技能只需在这里加配置，不必改引擎。
//
// 1) 转化牌 CONVERSIONS：as=转化成的牌名，from=原牌条件(color/key/type)，skills=触发技能
// 2) 锁定技 LOCKS：effect 'shaUnlimited'（【杀】无次数限制）
// 3) 摸牌触发 DRAW_TRIGGERS：摸牌阶段额外摸 value 张
// 4) 伤害触发 DAMAGE_TRIGGERS：受到伤害后 gainDamageCard（获得造成伤害的牌）/ stealSourceCard（获得来源一张牌）
// 5) 判定 HOOKS：判定牌生效后 gainJudgeCard（获得判定牌）

const CONVERSIONS = [
  { skills: ['wusheng', 're_wusheng', 'new_rewusheng'], as: 'sha', from: { color: 'red' } },
  { skills: ['longdan', 're_longdan', 'ollongdan'], as: 'sha', from: { key: 'shan' } },
  { skills: ['longdan', 're_longdan', 'ollongdan'], as: 'shan', from: { key: 'sha' } },
];

const LOCKS = [
  { skills: ['paoxiao', 're_paoxiao', 'olpaoxiao'], effect: 'shaUnlimited' },
];

const DRAW_TRIGGERS = [
  { skills: ['yingzi', 'reyingzi', 'olyingzi'], effect: 'draw', value: 1 },
];

const DAMAGE_TRIGGERS = [
  { skills: ['jianxiong', 'new_rejianxiong'], effect: 'gainDamageCard' },
  { skills: ['fankui', 'refankui'], effect: 'stealSourceCard' },
];

const JUDGE_HOOKS = [
  { skills: ['tiandu'], effect: 'gainJudgeCard' },
];

function matchFrom(card, from) {
  if (!card || !from) return false;
  if (from.color && card.color !== from.color) return false;
  if (from.key && card.key !== from.key) return false;
  if (from.type && card.type !== from.type) return false;
  return true;
}

module.exports = { CONVERSIONS, LOCKS, DRAW_TRIGGERS, DAMAGE_TRIGGERS, JUDGE_HOOKS, matchFrom };
