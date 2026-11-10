'use strict';

// ---------- 花色 ----------
const SUITS = ['spade', 'heart', 'club', 'diamond'];
const SUIT_CN = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };
const COLOR = { spade: 'black', club: 'black', heart: 'red', diamond: 'red' };

// ---------- 牌堆（56 张核心牌） ----------
const CARD_DEFS = [
  { key: 'sha',       name: '杀',       type: 'basic',   count: 14, art: 'sha.png' },
  { key: 'shan',      name: '闪',       type: 'basic',   count: 10, art: 'shan.png' },
  { key: 'tao',       name: '桃',       type: 'basic',   count: 6,  art: 'tao.png' },
  { key: 'juedou',    name: '决斗',     type: 'trick',   count: 4,  art: 'juedou.png' },
  { key: 'guohe',     name: '过河拆桥', type: 'trick',   count: 4,  art: 'guohe.png' },
  { key: 'shunshou',  name: '顺手牵羊', type: 'trick',   count: 4,  art: 'shunshou.png' },
  { key: 'wuzhong',   name: '无中生有', type: 'trick',   count: 4,  art: 'wuzhong.png' },
  { key: 'nanman',    name: '南蛮入侵', type: 'trick',   count: 3,  art: 'nanman.png' },
  { key: 'wanjian',   name: '万箭齐发', type: 'trick',   count: 3,  art: 'wanjian.png' },
  { key: 'bingliang', name: '兵粮寸断', type: 'delayed', count: 4,  art: 'bingliang.png' },
  { key: 'wuxie',     name: '无懈可击', type: 'trick',   count: 4,  art: 'wuxie.png' },
];

// ---------- 武将（首版 3 个） ----------
const GENERALS = [
  {
    id: 'guanyu', name: '关羽', faction: '蜀', hp: 4,
    skills: ['wusheng'],
    desc: '武圣：你可以将一张红色牌当【杀】使用或打出。',
    portrait: 'guanyu.png',
  },
  {
    id: 'zhangfei', name: '张飞', faction: '蜀', hp: 4,
    skills: ['paoxiao'],
    desc: '咆哮：锁定技，你使用【杀】无次数限制。',
    portrait: 'zhangfei.png',
  },
  {
    id: 'zhaoyun', name: '赵云', faction: '蜀', hp: 4,
    skills: ['longdan'],
    desc: '龙胆：你可以将【杀】当【闪】、【闪】当【杀】使用或打出。',
    portrait: 'zhaoyun.png',
  },
];

// ---------- 模式 ----------
const ROLE_SETS = {
  doudizhu: ['landlord', 'farmer', 'farmer'],
  duel: ['player', 'ai'],
};

const ROLE_CN = {
  landlord: '地主',
  farmer: '农民',
  player: '玩家',
  ai: 'AI',
};

const MODES = [
  { id: 'doudizhu', name: '斗地主', players: 3, enabled: true, desc: '1 地主 vs 2 农民' },
  { id: 'duel', name: '人机对战', players: 2, enabled: true, desc: '1v1 打 AI' },
  { id: 'identity', name: '身份局', players: 0, enabled: false, desc: '敬请期待' },
];

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildDeck() {
  const deck = [];
  let id = 0;
  for (const def of CARD_DEFS) {
    for (let i = 0; i < def.count; i++) {
      const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
      const number = 1 + Math.floor(Math.random() * 13);
      deck.push({
        id: 'c' + id++,
        key: def.key,
        name: def.name,
        type: def.type,
        suit,
        number,
        color: COLOR[suit],
        art: def.art,
      });
    }
  }
  return shuffle(deck);
}

module.exports = {
  SUITS, SUIT_CN, COLOR,
  CARD_DEFS, GENERALS, ROLE_SETS, ROLE_CN, MODES,
  shuffle, buildDeck,
};
