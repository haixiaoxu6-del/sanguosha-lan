# 三国杀 · 局域网版

3 人斗地主 + 1v1 人机对战的网页版三国杀，同一 WiFi 下用浏览器联机。

## 运行

需要 Node.js（建议 18+）。

```bash
cd /d D:\三国杀
node server.js
```

看到 `三国杀已启动: http://localhost:3123` 即可。

- 本机打开：`http://127.0.0.1:3123/`
- 同一 WiFi 的手机/电脑打开：`http://<房主电脑 IP>:3123/`
- 房主 IP 用 `ipconfig` 查看，一般是 `192.168.x.x` 或 `172.17.x.x`。

## 模式

### 斗地主

- 3 人：1 地主 + 2 农民。
- 地主：+1 血、先手、额外【英姿】（摸牌 +1）。
- 农民：一个农民阵亡，另一个摸 2 张。
- 地主死 → 农民胜；两个农民死 → 地主胜。

### 人机对战

- 2 人：玩家 vs AI。
- 玩家先选将，AI 从剩下随机选。
- 双方满血，玩家先手，谁先 0 血谁输。

## 操作

- 点手牌 → 点目标 → 出牌。
- 按住手牌拖到目标，松开即出牌。
- 无目标牌（桃/无中生有/南蛮/万箭）：点牌后点“使用”。
- 任何选择都有“取消”；响应窗口有“放弃”。
- 锁定技自动触发。

## 目录

```
D:\三国杀\
  server.js          # HTTP + SSE + 房间
  engine.js          # 核心引擎
  ai.js              # 1v1 AI
  data.js            # 牌/将/模式数据
  public/            # 前端
    index.html
    style.css
    client.js
    assets/
      generals/
      cards/
      ui/
  docs/
  PROGRESS.md
```

## 加牌 / 加将

- 牌：改 `data.js` 的 `CARD_DEFS`，加 `key/name/type/count/art`。
- 将：改 `data.js` 的 `GENERALS`，加 `id/name/faction/hp/skills/desc/portrait`。
- 技能逻辑目前写在 `engine.js` 的 `canUseAs` / `play` 里；后续会拆成 `data/skills`。

## 素材

立绘、牌图来自本机无名杀，仅自用局域网，不公开传播。已转成真正的 PNG，放在 `public/assets/`。

## 连不上

1. 确认手机和电脑在**同一个 WiFi**。
2. 确认地址是房主电脑的局域网 IP，端口 `3123`。
3. 校园网可能开 AP 隔离；如果打不开，用手机热点组局域网。
4. Windows 防火墙放行 Node（专用/公用网络都勾上）。
