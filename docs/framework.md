# 三国杀 Web 版 · 框架

> 配套：`decisions.md`（决策）、`PROGRESS.md`（进度）。
> 最后更新：2026-11-10

## 1. 目标与范围

- 局域网联机网页版三国杀。
- 首版两个模式：**3 人斗地主**、**1v1 人机对战**。
- 数据驱动：牌/将/技能/模式可增删。
- 服务端权威，浏览器端只做展示和操作。
- 首版不做：装备、无懈、闪电、身份局、音效/复杂动画。

## 2. 目录结构

```
D:\三国杀\
  server/            # HTTP、SSE、房间
  engine/            # 核心引擎
  modes/             # 模式
    doudizhu.js
    duel.js
    identity.js      # 占位
  data/
    cards/*.js
    generals/*.js
    skills/*.js
  ai/                # 1v1 AI
  public/
    index.html
    css/
    js/
    assets/
      generals/
      cards/
      ui/
      voices/
  tests/
  docs/
  PROGRESS.md
```

## 3. 数据 schema

### 3.1 卡牌

```js
{
  key: 'sha',            // 唯一 id
  name: '杀',
  type: 'basic',         // basic | trick | delayed
  count: 14,             // 牌堆张数
  art: 'sha.png'         // public/assets/cards/ 下
}
```

### 3.2 武将

```js
{
  id: 'guanyu',
  name: '关羽',
  faction: '蜀',
  hp: 4,
  skills: ['wusheng'],
  portrait: 'guanyu.png',
  voices: { skill: ['wusheng_re_guanyu1.mp3'], die: 'guanyu.mp3' }
}
```

### 3.3 技能

```js
{
  name: '武圣',
  type: 'viewAs',        // viewAs | mod | trigger | active
  ...
}
```

示例：

```js
wusheng: {
  name: '武圣',
  type: 'viewAs',
  convert: [{ to: 'sha', from: { color: 'red', zones: ['hand','equip','judge'] } }],
  prompt: '将一张红色牌当【杀】使用或打出'
},
paoxiao: {
  name: '咆哮',
  type: 'mod',
  locked: true,
  mods: { shaLimit: Infinity }
},
longdan: {
  name: '龙胆',
  type: 'viewAs',
  convert: [
    { to: 'sha', from: { name: 'shan', zones: ['hand'] } },
    { to: 'shan', from: { name: 'sha', zones: ['hand'] } }
  ],
  prompt: '将【杀】当【闪】、【闪】当【杀】使用或打出'
},
yingzi: {
  name: '英姿',
  type: 'mod',
  locked: true,
  mods: { drawCount: 1 }
},
jianxiong: {
  name: '奸雄',
  type: 'trigger',
  on: 'damageTakenAfter',
  do(ctx) { if (ctx.card) ctx.player.gain(ctx.card); }
}
```

### 3.4 校验

- `validateData()`：技能 id 存在、卡牌 art 存在、武将 portrait 存在、无重复 id。
- 缺文件直接报错，不带病开局。

## 4. 模式 API

```js
module.exports = {
  id: 'doudizhu',
  name: '斗地主',
  players: 3,
  enabled: true,
  roles: ['landlord', 'farmer', 'farmer'],
  setup(game) { ... },
  checkWin(game) { ... }
};
```

- `doudizhu.js`：3 人、地主 +1 血 + 先手 + 英姿、农民死亡另一个摸 2。
- `duel.js`：2 人、选将、无地主、0 血输。
- `identity.js`：`enabled:false` 占位。
- 大厅读模式注册表。

## 5. 规则

### 5.1 斗地主

- 3 人：1 地主 + 2 农民；地主公开，农民互知。
- 地主：+1 血、先手、额外【英姿】。
- 农民：一个阵亡，另一个摸 2。
- 胜：地主死 → 农民胜；两个农民死 → 地主胜。

### 5.2 1v1

- 2 人：玩家 vs AI；玩家先选将，AI 从剩下随机。
- 双方满血；玩家先手；无地主加成。
- 胜：谁先 0 血谁输。

### 5.3 回合

| 阶段 | 做什么 |
|---|---|
| 准备 | 回合开始（首版无触发） |
| 判定 | 处理兵粮寸断 |
| 摸牌 | 摸 2 + 技能加成 |
| 出牌 | 用牌；杀限 1 |
| 弃牌 | 弃到体力上限 |
| 结束 | 闭月等 |

### 5.4 牌

- 杀：距离 ≤ 攻击范围（基础 1），每回合 1 次。
- 闪：响应杀。
- 桃：自己受伤时用；濒死时救。
- 决斗：目标先出杀，轮流出，先不出者受 1。
- 过河拆桥：拆目标一张牌。
- 顺手牵羊：距离 1，拿目标一张牌。
- 无中生有：摸 2。
- 南蛮：其他角色按座位出杀，否则受 1。
- 万箭：其他角色按座位出闪，否则受 1。
- 兵粮寸断：距离 1；判定非梅花，跳过摸牌。

### 5.5 杀的结算顺序（19 事件）

| # | 时机 | 引擎事件 |
|---|---|---|
| 1 | 使用时 | onUseCard |
| 2 | 使用 | onUse |
| 3 | 指定目标时 | onTargetSpecifying |
| 4 | 成为目标时 | onBecomeTarget |
| 5 | 指定目标 | onTargetSpecified |
| 6 | 成为目标 | onBecomeTargeted |
| 7 | 指定目标后 | onTargetSpecifiedAfter |
| 8 | 成为目标后 | onBecomeTargetedAfter |
| 9 | 造成伤害时 | onDamageCausing |
| 10 | 受到伤害时 | onDamageTaking |
| 11 | 受到伤害（扣血） | onDamage |
| 12 | 进入濒死时（0血） | onDyingEnter |
| 13 | 濒死状态 | onDying |
| 14 | 脱离濒死时（回血） | onDyingLeave |
| 15 | 造成伤害后 | onDamageCaused |
| 16 | 受到伤害后 | onDamageTaken |
| 17 | 牌完成结算 | onCardResolved |
| 18 | 使用后 | onUseAfter |
| 19 | 牌进入弃牌堆 | onCardDiscarded |

- 事件表做成可扩展枚举；技能只声明 `on`。
- 同一事件多技能：优先级 + 队列；锁定技优先，再按座位。

### 5.6 兵粮寸断

- 延时锦囊，距离 1。
- 判定：非梅花 → 跳过摸牌阶段。
- 判定阶段先处理兵粮，再摸牌。

### 5.7 濒死/死亡/胜负

- HP ≤ 0 → 濒死；从濒死者开始，按座位求桃。
- 无人救 → 死亡；弃置手牌/判定区。
- 击杀奖励按模式配置；首版斗地主/1v1 可简化。
- 胜负按模式 `checkWin`。

## 6. 技能

### 6.1 分类

| 类型 | 说明 | 例子 |
|---|---|---|
| 转化 | 一张牌当另一张 | 武圣、龙胆、倾国、奇袭 |
| 锁定 | 强制生效 | 咆哮、空城、谦逊 |
| 触发 | 满足时机自动/可选 | 奸雄、反馈、刚烈、闭月、英姿 |
| 主动 | 出牌阶段主动 | 制衡、青囊、离间、仁德 |
| 限定/觉醒 | 一局一次/觉醒 | 扶汉、魂姿、若愚 |
| 光环/修正 | 改距离/上限/范围 | 马术、飞影、义从 |
| 判定/改判 | 改判定牌 | 观星、鬼才、鬼道 |
| 拼点 | 比大小 | 天义、驱虎、双雄 |
| 变身/化身 | 换武将/换技能 | 扶汉、化身 |
| 标记/积累 | 攒标记 | 忍、梅影、军略、权 |
| 死亡/濒死 | 死亡触发 | 不屈、武魂、挥泪 |

### 6.2 七段式

每个技能都能拆成：

> **时机 + 条件 + 代价 + 目标 + 效果 + 频率 + 可见性**

- 时机：对应 19 个事件点。
- 条件：`若...`（手牌数、体力、势力、性别、距离、花色）。
- 代价：`你可以弃置/失去/横置/翻面...`。
- 目标：`一名其他角色/至多两名/所有...`。
- 效果：`摸/弃/伤害/回复/令其...`。
- 频率：`每回合限一次/出牌阶段限一次/限定技/觉醒技`。
- 可见性：`锁定技`（强制）/`可以`（可选）。

### 6.3 描述句式

- 触发句：当...时/后
- 条件句：若...
- 代价句：你可以弃置.../失去...
- 目标句：选择一名/至多两名...
- 效果句：令其.../你摸.../此伤害 +1
- 持续句：直到回合结束/持续到...
- 限制句：每回合限一次/限定技
- 选择句：选择一项
- 判定句：进行判定，若结果为...
- 拼点句：拼点，若你赢...

### 6.4 无名杀映射

| 无名杀 | 我们的 DSL |
|---|---|
| `viewAs:{name}` + `filterCard` | `kind:'viewAs'`，`viewAs.as/from` |
| `mod.cardUsable` | `kind:'mod'`，`mods` |
| `trigger:{player:'...'}` | `kind:'trigger'`，`timing` |
| `filter(event,player)` | `filter(ctx)` |
| `content()` | `effect(ctx)` |
| `cost` | `cost` |
| `limited` / `forced` | `frequency` / `forced` |

## 7. UI

### 7.1 大厅

- 竖排模式卡：斗地主、人机对战亮；身份局灰。
- 背景：`image/background/noname_bg.jpg` 或木纹。
- 建房/加入、玩家列表、房间号。

### 7.2 选将（1v1）

- 3 张武将卡（立绘、名称、势力、HP、技能描述）。
- 玩家点选 1 张；AI 从剩下随机 1 张。
- 显示双方选择 → 开始对战。

### 7.3 对局

- 上方：玩家面板（立绘、HP、手牌数、判定区）。
- 中间：出牌区/战报。
- 下方：自己的武将、手牌（插画）、技能按钮、取消/确定。
- 右侧：战报。

### 7.4 交互状态机

```
出牌阶段
  └─ 点/拖手牌 → 已选牌
        ├─ 无目标 → [使用] [取消]
        └─ 有目标 → 选目标
              ├─ 点/放目标 → 出牌
              └─ 取消 → 已选牌
        └─ 取消 → 出牌阶段
```

### 7.5 取消

| 位置 | 取消回到 |
|---|---|
| 选目标 | 已选牌 |
| 已选牌 | 出牌阶段 |
| 主动技 | 出牌阶段（不付代价） |
| 响应 | 响应提示 |
| 弃牌 | 弃牌提示 |

- 取消 ≠ 放弃。
- 锁定技无取消。
- Esc/右键取消；Enter 确定。

### 7.6 响应/弃牌

- 响应：出闪/出杀/出桃 + 放弃 + 取消。
- 弃牌：选 N 张 + 确定/取消。
- 多目标：点选多个 + 确定/取消。

### 7.7 视觉/素材

- 手杀 UI + 木纹；静态 + CSS 过渡。
- 素材路径：`E:\...\无名杀\resources\app`。
- 复制到 `public/assets/`；转换伪扩展名。
- 第一版无音效/复杂动画。

## 8. 联机

### 8.1 房间

- 建房：生成 4 位房间号，房主。
- 加入：房间号；最多 3 人（斗地主）/2 人（1v1）。
- 状态：lobby → select → playing → over。
- 断线：用 playerId 重连；游戏中暂不托管。

### 8.2 SSE + POST

- `POST /api/create`、`/api/join`、`/api/start`、`/api/action`。
- `GET /api/events?room=&player=` SSE。
- 服务端权威；每次操作广播个性化视图。

### 8.3 视图裁剪

- 自己：完整手牌。
- 别人：手牌数量、装备、判定区数量。
- 身份：地主公开；农民互知；1v1 无身份。

### 8.4 重连

- 客户端 localStorage 存 room/playerId。
- 刷新后重新连 SSE；服务端恢复。

### 8.5 校验

- 服务端校验所有操作：回合、阶段、手牌、目标、距离、次数。
- 非法操作返回 error，不改状态。

## 9. AI

- 服务端 AI，不偷看玩家手牌。
- 出牌优先级：桃（受伤）→ 无中 → 杀 → 决斗 → 兵粮/过河/顺手 → 结束。
- 响应：闪/杀/桃，否则放弃。
- 后续可加难度。

## 10. 测试

- 单元：每张牌、每个技能、伤害/濒死/胜负。
- 交互：武圣+龙胆、咆哮+杀限、兵粮判定、决斗、南蛮/万箭、濒死求桃。
- 随机：300 局 3 人/1v1 不崩。
- 联机：3 客户端、重连、非法操作。
- UI：拖牌、取消、响应、手机。

## 11. 里程碑

| 里程碑 | 内容 |
|---|---|
| M1 | 引擎 + 测试 |
| M2 | 房间 + 联机 |
| M3 | 大厅 + 对局 UI + 素材 |
| M4 | 拖牌/取消/响应 |
| M5 | 1v1 AI |
| M6 | 测试/文档/收尾 |

## 12. 开放问题

- AI 难度。
- 音效/动画。
- 身份局/国战。
- 房间号格式/重连细节。
