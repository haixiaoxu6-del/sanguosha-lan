'use strict';

// ---------- 花色 ----------
const SUITS = ['spade', 'heart', 'club', 'diamond'];
const SUIT_CN = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };
const COLOR = { spade: 'black', club: 'black', heart: 'red', diamond: 'red' };

// ---------- 牌堆（56 张核心牌） ----------
const CARD_DEFS = [
  { key: 'sha',       name: '杀',       type: 'basic',   count: 30, art: 'sha.png' },
  { key: 'huosha',    name: '火杀',     type: 'basic',   element: 'fire', count: 5, art: 'huogong.png', desc: '火属性【杀】。' },
  { key: 'leisha',    name: '雷杀',     type: 'basic',   element: 'thunder', count: 9, art: 'shandian.png', desc: '雷属性【杀】。' },
  { key: 'shan',      name: '闪',       type: 'basic',   count: 24, art: 'shan.png' },
  { key: 'tao',       name: '桃',       type: 'basic',   count: 12, art: 'tao.png' },
  { key: 'jiu',       name: '酒',       type: 'basic',   count: 5,  art: 'jiu.png', desc: '出牌阶段，对自己使用，令本回合下一张【杀】伤害+1（每回合限一次）；濒死时对自己使用，回复1点体力。' },
  { key: 'juedou',    name: '决斗',     type: 'trick',   count: 4,  art: 'juedou.png' },
  { key: 'guohe',     name: '过河拆桥', type: 'trick',   count: 4,  art: 'guohe.png' },
  { key: 'shunshou',  name: '顺手牵羊', type: 'trick',   count: 4,  art: 'shunshou.png' },
  { key: 'wuzhong',   name: '无中生有', type: 'trick',   count: 4,  art: 'wuzhong.png' },
  { key: 'nanman',    name: '南蛮入侵', type: 'trick',   count: 3,  art: 'nanman.png' },
  { key: 'wanjian',   name: '万箭齐发', type: 'trick',   count: 3,  art: 'wanjian.png' },
  { key: 'bingliang', name: '兵粮寸断', type: 'delayed', count: 4,  art: 'bingliang.png' },
  { key: 'wuxie',     name: '无懈可击', type: 'trick',   count: 4,  art: 'wuxie.png' },

  // ---------- 装备（标准包 19 + 军争 6） ----------
  { key: 'zhuge',    name: '诸葛连弩', type: 'equip', slot: 'weapon', range: 1, count: 2, art: 'zhuge.png', desc: '出牌阶段，你可以使用任意数量的【杀】。' },
  { key: 'qinggang', name: '青釭剑',   type: 'equip', slot: 'weapon', range: 2, count: 1, art: 'qinggang.png', desc: '锁定技，你使用【杀】时无视目标防具。' },
  { key: 'cixiong',  name: '雌雄双股剑', type: 'equip', slot: 'weapon', range: 2, count: 1, art: 'cixiong.png', desc: '你使用【杀】指定异性目标时，可令其弃一张牌或你摸一张牌。' },
  { key: 'qinglong', name: '青龙偃月刀', type: 'equip', slot: 'weapon', range: 3, count: 1, art: 'qinglong.png', desc: '你使用的【杀】被【闪】抵消时，可以继续使用一张【杀】。' },
  { key: 'zhangba',  name: '丈八蛇矛', type: 'equip', slot: 'weapon', range: 3, count: 1, art: 'zhangba.png', desc: '你可以将两张手牌当【杀】使用或打出。' },
  { key: 'guanshi',  name: '贯石斧',   type: 'equip', slot: 'weapon', range: 3, count: 1, art: 'guanshi.png', desc: '你使用的【杀】被【闪】抵消时，可弃两张牌令此【杀】依然造成伤害。' },
  { key: 'fangtian', name: '方天画戟', type: 'equip', slot: 'weapon', range: 4, count: 1, art: 'fangtian.png', desc: '你使用最后一张手牌【杀】时，可以额外指定一个目标。' },
  { key: 'qilin',    name: '麒麟弓',   type: 'equip', slot: 'weapon', range: 5, count: 1, art: 'qilin.png', desc: '你使用【杀】造成伤害时，可弃置目标装备区的一匹马。' },
  { key: 'hanbing',  name: '寒冰剑',   type: 'equip', slot: 'weapon', range: 2, count: 1, art: 'hanbing.png', desc: '你使用【杀】造成伤害时，可防止伤害并弃置目标两张牌。' },
  { key: 'guding',   name: '古锭刀',   type: 'equip', slot: 'weapon', range: 2, count: 1, art: 'guding.png', desc: '锁定技，你使用【杀】造成伤害时，若目标没有手牌，伤害+1。' },
  { key: 'zhuque',   name: '朱雀羽扇', type: 'equip', slot: 'weapon', range: 4, count: 1, art: 'zhuque.png', desc: '你可以将普通【杀】当火【杀】使用。' },
  { key: 'bagua',    name: '八卦阵',   type: 'equip', slot: 'armor', count: 2, art: 'bagua.png', desc: '当你需要使用【闪】时，可以判定，若为红色则视为使用【闪】。' },
  { key: 'renwang',  name: '仁王盾',   type: 'equip', slot: 'armor', count: 1, art: 'renwang.png', desc: '锁定技，黑色的【杀】对你无效。' },
  { key: 'tengjia',  name: '藤甲',     type: 'equip', slot: 'armor', count: 2, art: 'tengjia.png', desc: '锁定技，普通【杀】、【南蛮】、【万箭】对你无效；受到火属性伤害+1。' },
  { key: 'baiyin',   name: '白银狮子', type: 'equip', slot: 'armor', count: 1, art: 'baiyin.png', desc: '锁定技，你受到伤害时，若伤害大于1则减为1；失去装备时回复1点体力。' },
  { key: 'dilu',     name: '的卢',     type: 'equip', slot: 'horse1', count: 1, art: 'dilu.png', desc: '+1马：其他角色计算与你的距离+1。' },
  { key: 'jueying',  name: '绝影',     type: 'equip', slot: 'horse1', count: 1, art: 'jueying.png', desc: '+1马：其他角色计算与你的距离+1。' },
  { key: 'zhuahuang', name: '爪黄飞电', type: 'equip', slot: 'horse1', count: 1, art: 'zhuahuang.png', desc: '+1马：其他角色计算与你的距离+1。' },
  { key: 'hualiu',   name: '骅骝',     type: 'equip', slot: 'horse1', count: 1, art: 'hualiu.png', desc: '+1马：其他角色计算与你的距离+1。' },
  { key: 'chitu',    name: '赤兔',     type: 'equip', slot: 'horse2', count: 1, art: 'chitu.png', desc: '-1马：你计算与其他角色的距离-1。' },
  { key: 'dawan',    name: '大宛',     type: 'equip', slot: 'horse2', count: 1, art: 'dawan.png', desc: '-1马：你计算与其他角色的距离-1。' },
  { key: 'zixing',   name: '紫骍',     type: 'equip', slot: 'horse2', count: 1, art: 'chitu.png', desc: '-1马：你计算与其他角色的距离-1。' },
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
  duel_pvp: ['player', 'player'],
};

const ROLE_CN = {
  landlord: '地主',
  farmer: '农民',
  player: '玩家',
  ai: 'AI',
};

const MODES = [
  { id: 'doudizhu', name: '斗地主', players: 3, enabled: true, desc: '1 地主 vs 2 农民' },
  { id: 'duel_pvp', name: '1v1 联机', players: 2, enabled: true, desc: '两个真人单挑' },
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
        slot: def.slot,
        range: def.range,
        desc: def.desc,
        element: def.element,
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
