'use strict';
// 自动生成：标准包界限突破武将（22 名）
// 由 tools/import-refreshed.js 从无名杀提取；技能未实现的武将请勿直接并入对局
const REFRESHED_GENERALS = [
  {
    "id": "re_caocao",
    "name": "界曹操",
    "faction": "魏",
    "gender": "male",
    "hp": 4,
    "skills": [
      "new_rejianxiong",
      "rehujia"
    ],
    "skillDescs": {
      "new_rejianxiong": {
        "name": "奸雄",
        "desc": "当你受到伤害后，你可以获得对你造成伤害的牌并摸一张牌。",
        "implemented": false
      },
      "rehujia": {
        "name": "护驾",
        "desc": "主公技。①当你需要使用或打出一张【闪】时，你可以令其他魏势力角色选择是否打出一张【闪】。若有角色响应，则你视为使用或打出了一张【闪】。②每回合限一次。当有魏势力角色于回合外使用或打出【闪】时，其可以令你摸一张牌。",
        "implemented": false
      }
    },
    "desc": "奸雄：当你受到伤害后，你可以获得对你造成伤害的牌并摸一张牌。护驾：主公技。①当你需要使用或打出一张【闪】时，你可以令其他魏势力角色选择是否打出一张【闪】。若有角色响应，则你视为使用或打出了一张【闪】。②每回合限一次。当有魏势力角色于回合外使用或打出【闪】时，其可以令你摸一张牌。",
    "portrait": "re_caocao.jpg"
  },
  {
    "id": "re_simayi",
    "name": "界司马懿",
    "faction": "魏",
    "gender": "male",
    "hp": 3,
    "skills": [
      "refankui",
      "reguicai"
    ],
    "skillDescs": {
      "refankui": {
        "name": "反馈",
        "desc": "每当你受到1点伤害后，你可以获得伤害来源的一张牌。",
        "implemented": false
      },
      "reguicai": {
        "name": "鬼才",
        "desc": "在任意角色的判定牌生效前，你可以打出一张牌代替之",
        "implemented": false
      }
    },
    "desc": "反馈：每当你受到1点伤害后，你可以获得伤害来源的一张牌。鬼才：在任意角色的判定牌生效前，你可以打出一张牌代替之",
    "portrait": "re_simayi.jpg"
  },
  {
    "id": "re_xiahoudun",
    "name": "界夏侯惇",
    "faction": "魏",
    "gender": "male",
    "hp": 4,
    "skills": [
      "reganglie",
      "new_qingjian"
    ],
    "skillDescs": {
      "reganglie": {
        "name": "刚烈",
        "desc": "当你受到1点伤害后，你可进行判定，若结果为：红色，你对伤害来源造成1点伤害，；黑色，你弃置伤害来源一张牌。",
        "implemented": false
      },
      "new_qingjian": {
        "name": "清俭",
        "desc": "当你于摸牌阶段外得到牌后，你可以展示任意张牌并交给一名其他角色。然后，当前回合角色本回合的手牌上限+X（X为你给出的牌中包含的类别数）。每回合限一次。",
        "implemented": false
      }
    },
    "desc": "刚烈：当你受到1点伤害后，你可进行判定，若结果为：红色，你对伤害来源造成1点伤害，；黑色，你弃置伤害来源一张牌。清俭：当你于摸牌阶段外得到牌后，你可以展示任意张牌并交给一名其他角色。然后，当前回合角色本回合的手牌上限+X（X为你给出的牌中包含的类别数）。每回合限一次。",
    "portrait": "re_xiahoudun.jpg"
  },
  {
    "id": "re_zhangliao",
    "name": "界张辽",
    "faction": "魏",
    "gender": "male",
    "hp": 4,
    "skills": [
      "new_retuxi"
    ],
    "skillDescs": {
      "new_retuxi": {
        "name": "突袭",
        "desc": "摸牌阶段摸牌时，你可以少摸任意张牌，然后获得等量的角色的各一张手牌。",
        "implemented": false
      }
    },
    "desc": "突袭：摸牌阶段摸牌时，你可以少摸任意张牌，然后获得等量的角色的各一张手牌。",
    "portrait": "re_zhangliao.jpg"
  },
  {
    "id": "re_xuzhu",
    "name": "界许褚",
    "faction": "魏",
    "gender": "male",
    "hp": 4,
    "skills": [
      "new_reluoyi"
    ],
    "skillDescs": {
      "new_reluoyi": {
        "name": "裸衣",
        "desc": "摸牌阶段开始时，你展示牌堆顶的三张牌。然后，你可以放弃摸牌。若如此做，你获得其中的基本牌、武器牌和【决斗】，且直到你的下回合开始，你使用的【杀】或【决斗】造成伤害时，此伤害+1。否则，你将这些牌置入弃牌堆。",
        "implemented": false
      }
    },
    "desc": "裸衣：摸牌阶段开始时，你展示牌堆顶的三张牌。然后，你可以放弃摸牌。若如此做，你获得其中的基本牌、武器牌和【决斗】，且直到你的下回合开始，你使用的【杀】或【决斗】造成伤害时，此伤害+1。否则，你将这些牌置入弃牌堆。",
    "portrait": "re_xuzhu.jpg"
  },
  {
    "id": "re_guojia",
    "name": "界郭嘉",
    "faction": "魏",
    "gender": "male",
    "hp": 3,
    "skills": [
      "tiandu",
      "new_reyiji"
    ],
    "skillDescs": {
      "tiandu": {
        "name": "天妒",
        "desc": "当你的判定牌生效后，你可以获得之。",
        "implemented": false
      },
      "new_reyiji": {
        "name": "遗计",
        "desc": "当你受到1点伤害后，你可以摸两张牌，然后可以将至多两张手牌交给其他角色。",
        "implemented": false
      }
    },
    "desc": "天妒：当你的判定牌生效后，你可以获得之。遗计：当你受到1点伤害后，你可以摸两张牌，然后可以将至多两张手牌交给其他角色。",
    "portrait": "re_guojia.jpg"
  },
  {
    "id": "re_zhenji",
    "name": "界甄姬",
    "faction": "魏",
    "gender": "female",
    "hp": 3,
    "skills": [
      "reluoshen",
      "reqingguo"
    ],
    "skillDescs": {
      "reluoshen": {
        "name": "洛神",
        "desc": "准备阶段，你可以进行判定，若结果为黑色则获得此判定牌，且可重复此流程直到出现红色的判定结果。你通过〖洛神〗得到的牌不计入当前回合的手牌上限。",
        "implemented": false
      },
      "reqingguo": {
        "name": "倾国",
        "desc": "你可以将一张黑色牌当做【闪】使用或打出。",
        "implemented": false
      }
    },
    "desc": "洛神：准备阶段，你可以进行判定，若结果为黑色则获得此判定牌，且可重复此流程直到出现红色的判定结果。你通过〖洛神〗得到的牌不计入当前回合的手牌上限。倾国：你可以将一张黑色牌当做【闪】使用或打出。",
    "portrait": "re_zhenji.jpg"
  },
  {
    "id": "re_liubei",
    "name": "界刘备",
    "faction": "蜀",
    "gender": "male",
    "hp": 4,
    "skills": [
      "rerende",
      "rejijiang"
    ],
    "skillDescs": {
      "rerende": {
        "name": "仁德",
        "desc": "出牌阶段，你可以将至少一张手牌交给其他角色，然后你于此阶段内不能再以此法交给该角色牌；若你于此阶段内给出的牌首次达到两张，你可以视为使用一张基本牌",
        "implemented": false
      },
      "rejijiang": {
        "name": "激将",
        "desc": "主公技。①当你需要使用或打出【杀】时，你可以令其他蜀势力角色依次选择是否打出一张【杀】。若有角色响应，则你视为使用或打出了此【杀】。②每回合限一次。当有蜀势力角色于回合外使用或打出【杀】时，其可以令你摸一张牌。",
        "implemented": false
      }
    },
    "desc": "仁德：出牌阶段，你可以将至少一张手牌交给其他角色，然后你于此阶段内不能再以此法交给该角色牌；若你于此阶段内给出的牌首次达到两张，你可以视为使用一张基本牌激将：主公技。①当你需要使用或打出【杀】时，你可以令其他蜀势力角色依次选择是否打出一张【杀】。若有角色响应，则你视为使用或打出了此【杀】。②每回合限一次。当有蜀势力角色于回合外使用或打出【杀】时，其可以令你摸一张牌。",
    "portrait": "re_liubei.jpg"
  },
  {
    "id": "re_machao",
    "name": "界马超",
    "faction": "蜀",
    "gender": "male",
    "hp": 4,
    "skills": [
      "mashu",
      "retieji"
    ],
    "skillDescs": {
      "mashu": {
        "name": "马术",
        "desc": "锁定技，你计算与其他角色的距离时-1。",
        "implemented": false
      },
      "retieji": {
        "name": "铁骑",
        "desc": "当你使用【杀】指定一名角色为目标后，你可以进行一次判定并令该角色的非锁定技失效直到回合结束，除非该角色弃置一张与判定结果花色相同的牌，否则不能使用【闪】抵消此【杀】。",
        "implemented": false
      }
    },
    "desc": "马术：锁定技，你计算与其他角色的距离时-1。铁骑：当你使用【杀】指定一名角色为目标后，你可以进行一次判定并令该角色的非锁定技失效直到回合结束，除非该角色弃置一张与判定结果花色相同的牌，否则不能使用【闪】抵消此【杀】。",
    "portrait": "re_machao.jpg"
  },
  {
    "id": "re_huangyueying",
    "name": "界黄月英",
    "faction": "蜀",
    "gender": "female",
    "hp": 3,
    "skills": [
      "rejizhi",
      "reqicai"
    ],
    "skillDescs": {
      "rejizhi": {
        "name": "集智",
        "desc": "当你使用锦囊牌时，你可以摸一张牌。若此牌为基本牌，则你可以弃置之，然后令本回合手牌上限+1。",
        "implemented": false
      },
      "reqicai": {
        "name": "奇才",
        "desc": "锁定技，你使用锦囊牌无距离限制，你装备区内的防具牌和宝物牌不能被其他角色弃置。",
        "implemented": false
      }
    },
    "desc": "集智：当你使用锦囊牌时，你可以摸一张牌。若此牌为基本牌，则你可以弃置之，然后令本回合手牌上限+1。奇才：锁定技，你使用锦囊牌无距离限制，你装备区内的防具牌和宝物牌不能被其他角色弃置。",
    "portrait": "re_huangyueying.jpg"
  },
  {
    "id": "re_zhugeliang",
    "name": "界诸葛亮",
    "faction": "蜀",
    "gender": "male",
    "hp": 3,
    "skills": [
      "reguanxing",
      "kongcheng"
    ],
    "skillDescs": {
      "reguanxing": {
        "name": "观星",
        "desc": "准备阶段，你可以观看牌堆顶的5张牌（存活角色小于4时改为3张），并将其以任意顺序置于牌堆项或牌堆底，若你将〖观星〗的牌都放在了牌堆底，则你可以在结束阶段再次发动〖观星〗。",
        "implemented": false
      },
      "kongcheng": {
        "name": "空城",
        "desc": "锁定技，当你没有手牌时，你不能成为【杀】或【决斗】的目标。",
        "implemented": false
      }
    },
    "desc": "观星：准备阶段，你可以观看牌堆顶的5张牌（存活角色小于4时改为3张），并将其以任意顺序置于牌堆项或牌堆底，若你将〖观星〗的牌都放在了牌堆底，则你可以在结束阶段再次发动〖观星〗。空城：锁定技，当你没有手牌时，你不能成为【杀】或【决斗】的目标。",
    "portrait": "re_zhugeliang.jpg"
  },
  {
    "id": "re_sunquan",
    "name": "界孙权",
    "faction": "吴",
    "gender": "male",
    "hp": 4,
    "skills": [
      "rezhiheng",
      "rejiuyuan"
    ],
    "skillDescs": {
      "rezhiheng": {
        "name": "制衡",
        "desc": "出牌阶段限一次，你可以弃置任意张牌并摸等量的牌，若你在发动〖制衡〗时弃置了所有手牌，则你多摸一张牌。",
        "implemented": false
      },
      "rejiuyuan": {
        "name": "救援",
        "desc": "主公技，其他吴势力角色对自己使用【桃】时，若其体力值大于你，则其可以选择令你回复1点体力，然后其摸1张牌。",
        "implemented": false
      }
    },
    "desc": "制衡：出牌阶段限一次，你可以弃置任意张牌并摸等量的牌，若你在发动〖制衡〗时弃置了所有手牌，则你多摸一张牌。救援：主公技，其他吴势力角色对自己使用【桃】时，若其体力值大于你，则其可以选择令你回复1点体力，然后其摸1张牌。",
    "portrait": "re_sunquan.jpg"
  },
  {
    "id": "re_ganning",
    "name": "界甘宁",
    "faction": "吴",
    "gender": "male",
    "hp": 4,
    "skills": [
      "qixi",
      "fenwei"
    ],
    "skillDescs": {
      "qixi": {
        "name": "奇袭",
        "desc": "你可以将一张黑色牌当做【过河拆桥】使用。",
        "implemented": false
      },
      "fenwei": {
        "name": "奋威",
        "desc": "限定技，当一名角色使用的锦囊牌指定了至少两名角色为目标时，你可以令此牌对其中任意名角色无效。",
        "implemented": false
      }
    },
    "desc": "奇袭：你可以将一张黑色牌当做【过河拆桥】使用。奋威：限定技，当一名角色使用的锦囊牌指定了至少两名角色为目标时，你可以令此牌对其中任意名角色无效。",
    "portrait": "re_ganning.jpg"
  },
  {
    "id": "re_lvmeng",
    "name": "界吕蒙",
    "faction": "吴",
    "gender": "male",
    "hp": 4,
    "skills": [
      "keji",
      "qinxue",
      "rebotu"
    ],
    "skillDescs": {
      "keji": {
        "name": "克己",
        "desc": "弃牌阶段开始时，若你于本回合的出牌阶段内没有过使用或打出过【杀】，则你可以跳过此阶段。",
        "implemented": false
      },
      "qinxue": {
        "name": "勤学",
        "desc": "觉醒技。准备阶段或结束阶段开始时，若你的手牌数减体力值大于1，则你减一点体力上限，回复1点体力或摸两张牌，获得技能【攻心】。",
        "implemented": false
      },
      "rebotu": {
        "name": "博图",
        "desc": "每轮限X次。回合结束时，若本回合内置入弃牌堆的牌中包含至少四种花色，则你可获得一个额外的回合。（X为存活角色数且至多为3）",
        "implemented": false
      }
    },
    "desc": "克己：弃牌阶段开始时，若你于本回合的出牌阶段内没有过使用或打出过【杀】，则你可以跳过此阶段。勤学：觉醒技。准备阶段或结束阶段开始时，若你的手牌数减体力值大于1，则你减一点体力上限，回复1点体力或摸两张牌，获得技能【攻心】。博图：每轮限X次。回合结束时，若本回合内置入弃牌堆的牌中包含至少四种花色，则你可获得一个额外的回合。（X为存活角色数且至多为3）",
    "portrait": "re_lvmeng.jpg"
  },
  {
    "id": "re_huanggai",
    "name": "界黄盖",
    "faction": "吴",
    "gender": "male",
    "hp": 4,
    "skills": [
      "rekurou",
      "zhaxiang"
    ],
    "skillDescs": {
      "rekurou": {
        "name": "苦肉",
        "desc": "出牌阶段限一次，你可以弃置一张牌，然后失去1点体力。",
        "implemented": false
      },
      "zhaxiang": {
        "name": "诈降",
        "desc": "锁定技 每当你失去1点体力后，你摸三张牌。然后若此时是你的出牌阶段，则直到回合结束，你使用红色【杀】无距离限制且不能被【闪】响应，你可以额外使用一张【杀】。",
        "implemented": false
      }
    },
    "desc": "苦肉：出牌阶段限一次，你可以弃置一张牌，然后失去1点体力。诈降：锁定技 每当你失去1点体力后，你摸三张牌。然后若此时是你的出牌阶段，则直到回合结束，你使用红色【杀】无距离限制且不能被【闪】响应，你可以额外使用一张【杀】。",
    "portrait": "re_huanggai.jpg"
  },
  {
    "id": "re_zhouyu",
    "name": "界周瑜",
    "faction": "吴",
    "gender": "male",
    "hp": 3,
    "skills": [
      "reyingzi",
      "refanjian"
    ],
    "skillDescs": {
      "reyingzi": {
        "name": "英姿",
        "desc": "锁定技，摸牌阶段摸牌时，你额外摸一张牌；你的手牌上限为你的体力上限。",
        "implemented": false
      },
      "refanjian": {
        "name": "反间",
        "desc": "出牌阶段限一次，你可以展示一张手牌并将此牌交给一名其他角色。然后该角色选择一项：展示其手牌并弃置所有与此牌花色相同的牌，或失去一点体力。",
        "implemented": false
      }
    },
    "desc": "英姿：锁定技，摸牌阶段摸牌时，你额外摸一张牌；你的手牌上限为你的体力上限。反间：出牌阶段限一次，你可以展示一张手牌并将此牌交给一名其他角色。然后该角色选择一项：展示其手牌并弃置所有与此牌花色相同的牌，或失去一点体力。",
    "portrait": "re_zhouyu.jpg"
  },
  {
    "id": "re_daqiao",
    "name": "界大乔",
    "faction": "吴",
    "gender": "female",
    "hp": 3,
    "skills": [
      "reguose",
      "liuli"
    ],
    "skillDescs": {
      "reguose": {
        "name": "国色",
        "desc": "出牌阶段限一次，你可以选择一项：将一张方片花色牌当做【乐不思蜀】使用；或弃置一张方片花色牌并弃置场上的一张【乐不思蜀】。选择完成后，你摸一张牌。",
        "implemented": false
      },
      "liuli": {
        "name": "流离",
        "desc": "当你成为【杀】的目标时，你可以弃置一张牌并将此【杀】转移给攻击范围内的一名其他角色（不能是此【杀】的使用者）。",
        "implemented": false
      }
    },
    "desc": "国色：出牌阶段限一次，你可以选择一项：将一张方片花色牌当做【乐不思蜀】使用；或弃置一张方片花色牌并弃置场上的一张【乐不思蜀】。选择完成后，你摸一张牌。流离：当你成为【杀】的目标时，你可以弃置一张牌并将此【杀】转移给攻击范围内的一名其他角色（不能是此【杀】的使用者）。",
    "portrait": "re_daqiao.jpg"
  },
  {
    "id": "re_luxun",
    "name": "界陆逊",
    "faction": "吴",
    "gender": "male",
    "hp": 3,
    "skills": [
      "reqianxun",
      "relianying"
    ],
    "skillDescs": {
      "reqianxun": {
        "name": "谦逊",
        "desc": "每当一张延时类锦囊牌或其他角色使用的普通锦囊牌生效时，若你是此牌的唯一目标，你可以将所有手牌置于你的武将牌上，若如此做，此回合结束时，你获得你武将牌上的所有牌。",
        "implemented": false
      },
      "relianying": {
        "name": "连营",
        "desc": "当你失去最后的手牌时，你可以令至多X名角色各摸一张牌（X为你此次失去的手牌数）。",
        "implemented": false
      }
    },
    "desc": "谦逊：每当一张延时类锦囊牌或其他角色使用的普通锦囊牌生效时，若你是此牌的唯一目标，你可以将所有手牌置于你的武将牌上，若如此做，此回合结束时，你获得你武将牌上的所有牌。连营：当你失去最后的手牌时，你可以令至多X名角色各摸一张牌（X为你此次失去的手牌数）。",
    "portrait": "re_luxun.jpg"
  },
  {
    "id": "re_sunshangxiang",
    "name": "界孙尚香",
    "faction": "吴",
    "gender": "female",
    "hp": 3,
    "skills": [
      "xiaoji",
      "rejieyin"
    ],
    "skillDescs": {
      "xiaoji": {
        "name": "枭姬",
        "desc": "当你失去一张装备区内的牌后，你可以摸两张牌。",
        "implemented": false
      },
      "rejieyin": {
        "name": "结姻",
        "desc": "出牌阶段限一次，你可以选择一名男性角色并弃置一张手牌或将装备区内的一张装备牌置于其装备区，你与其体力较高的角色摸一张牌，体力值较低的角色回复1点体力。",
        "implemented": false
      }
    },
    "desc": "枭姬：当你失去一张装备区内的牌后，你可以摸两张牌。结姻：出牌阶段限一次，你可以选择一名男性角色并弃置一张手牌或将装备区内的一张装备牌置于其装备区，你与其体力较高的角色摸一张牌，体力值较低的角色回复1点体力。",
    "portrait": "re_sunshangxiang.jpg"
  },
  {
    "id": "re_huatuo",
    "name": "界华佗",
    "faction": "群",
    "gender": "male",
    "hp": 3,
    "skills": [
      "jijiu",
      "new_reqingnang"
    ],
    "skillDescs": {
      "jijiu": {
        "name": "急救",
        "desc": "你的回合外，你可以将一张红色牌当做【桃】使用。",
        "implemented": false
      },
      "new_reqingnang": {
        "name": "青囊",
        "desc": "出牌阶段，你可以弃置一张手牌，令一名本回合内未成为过〖青囊〗的目标的角色回复一点体力。若你弃置的是黑色牌，则你本回合内不能再发动〖青囊〗。",
        "implemented": false
      }
    },
    "desc": "急救：你的回合外，你可以将一张红色牌当做【桃】使用。青囊：出牌阶段，你可以弃置一张手牌，令一名本回合内未成为过〖青囊〗的目标的角色回复一点体力。若你弃置的是黑色牌，则你本回合内不能再发动〖青囊〗。",
    "portrait": "re_huatuo.jpg"
  },
  {
    "id": "re_lvbu",
    "name": "界吕布",
    "faction": "群",
    "gender": "male",
    "hp": 5,
    "skills": [
      "wushuang",
      "new_liyu"
    ],
    "skillDescs": {
      "wushuang": {
        "name": "无双",
        "desc": "锁定技，当你使用【杀】或【决斗】指定目标后，你令此牌需要依次使用或打出两张【闪】或【杀】响应。",
        "implemented": false
      },
      "new_liyu": {
        "name": "利驭",
        "desc": "当你使用【杀】对一名其他角色造成伤害后，你可以获得其区域内的一张牌。若此牌不为装备牌，则其摸一张牌。若此牌为装备牌，则视为你对其选择的另一名角色使用一张【决斗】。",
        "implemented": false
      }
    },
    "desc": "无双：锁定技，当你使用【杀】或【决斗】指定目标后，你令此牌需要依次使用或打出两张【闪】或【杀】响应。利驭：当你使用【杀】对一名其他角色造成伤害后，你可以获得其区域内的一张牌。若此牌不为装备牌，则其摸一张牌。若此牌为装备牌，则视为你对其选择的另一名角色使用一张【决斗】。",
    "portrait": "re_lvbu.jpg"
  },
  {
    "id": "re_diaochan",
    "name": "界貂蝉",
    "faction": "群",
    "gender": "female",
    "hp": 3,
    "skills": [
      "lijian",
      "rebiyue"
    ],
    "skillDescs": {
      "lijian": {
        "name": "离间",
        "desc": "出牌阶段限一次，你可以弃置一张牌，视为一名男性角色对另一名男性角色使用一张【决斗】（不可被【无懈可击】响应）。",
        "implemented": false
      },
      "rebiyue": {
        "name": "闭月",
        "desc": "结束阶段，你可以摸一张牌，若你没有手牌，则改为摸两张牌。",
        "implemented": false
      }
    },
    "desc": "离间：出牌阶段限一次，你可以弃置一张牌，视为一名男性角色对另一名男性角色使用一张【决斗】（不可被【无懈可击】响应）。闭月：结束阶段，你可以摸一张牌，若你没有手牌，则改为摸两张牌。",
    "portrait": "re_diaochan.jpg"
  }
];

module.exports = { REFRESHED_GENERALS };
