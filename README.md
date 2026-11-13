# 三国杀 · 网页联机版

一个基于 Node.js + 原生前端的《三国杀》网页游戏，支持：

- 斗地主（3 人）
- 1v1 人机对战
- 1v1 网页联机
- 身份局（占位）

## 运行

```bash
npm install
npm start
```

默认监听 `process.env.PORT || 3000`，浏览器打开对应地址即可。

## 目录

- `server.js`：HTTP 服务、房间与接口
- `engine.js`：对局引擎（回合、技能、判定、结算）
- `ai.js`：人机 AI
- `data.js`：牌堆、武将、模式定义
- `public/`：前端（client.js、style.css、index.html、素材）

## 许可

代码以 MIT License 发布，见 [LICENSE](LICENSE)。

## 素材说明

游戏内部分字体、卡牌插画、界面素材来源于《无名杀》（Noname）及《三国杀》相关素材，
版权归原作者/权利人所有，仅用于学习与交流；如权利人要求，请移除相关内容。

《三国杀》为游卡桌游的商标与作品，本项目为非官方粉丝作品，与官方无关。
