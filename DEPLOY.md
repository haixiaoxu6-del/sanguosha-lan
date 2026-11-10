# 公网联机部署

## 方式 A：Render（电脑可以关，免费）

适合：不想一直开电脑，朋友随时能进。
缺点：免费实例 15 分钟没人访问会休眠；首次打开慢；休眠/重启后房间清空。

### 步骤

1. 把 `D:\三国杀` 传到 GitHub（不要传 `cloudflared.exe`，已在 `.gitignore`）。
2. 打开 https://render.com ，注册/登录。
3. New → Web Service → 连接这个 GitHub 仓库。
4. Render 会自动读取 `render.yaml`；如果没有，手动填：
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Plan: Free
5. 部署完成后得到 `https://xxxx.onrender.com`，朋友用流量打开即可。

已准备好：
- `package.json`（`npm start` = `node server.js`）
- `render.yaml`

---

## 方式 B：Tailscale（免费、稳定、私密，电脑要开）

适合：固定几个朋友，长期玩；不想把游戏暴露到公网。

### 步骤

1. 你和朋友都安装 Tailscale：https://tailscale.com/download
2. 你登录并创建一个 tailnet，邀请朋友加入（免费个人版够 3 人）。
3. 你电脑上运行游戏服务器：
   ```
   cd /d D:\三国杀
   set PORT=3124
   node server.js
   ```
4. 在 Tailscale 里看你电脑的 IP（一般是 `100.x.x.x`）。
5. 朋友用手机流量打开：
   ```
   http://100.x.x.x:3124/?v=17
   ```
6. 建房/输房间号即可。

优点：不依赖公网隧道、不会被校园网封、手机流量稳定。
缺点：每个人都要装 Tailscale；你的电脑要开着。

---

## 方式 C：Cloudflare 临时隧道（免费，但校园网现在不稳定）

`cloudflared.exe` 已下载，`start-tunnel.bat` 已改成 HTTP/2：

```
cloudflared.exe tunnel --protocol http2 --url http://127.0.0.1:3124
```

如果 `api.trycloudflare.com` 超时，说明校园网封了 Cloudflare 的 API；可以：
- 换手机热点给电脑联网再试；
- 等网络恢复；
- 或改用方式 A/B。

免费临时地址每次重启都会变，电脑必须开着。

---

## 当前说明

- 客户端 v17 已改成每 0.6 秒轮询 `/api/state`，不再依赖 SSE，所以不会再出现“一直连接中”。
- 之前的 `tax-statement-...trycloudflare.com` 已失效，不要再用。
- 同 WiFi 仍可用：`http://172.17.129.15:3124/?v=17`（IP 可能变，用 `ipconfig` 查）。
