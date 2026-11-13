'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Game } = require('./engine');
const { MODES, GENERALS } = require('./data');
const { aiAct } = require('./ai');

const PORT = process.env.PORT || 3123;
const PUBLIC = path.join(__dirname, 'public');
const rooms = new Map();

function uid() { return crypto.randomUUID(); }

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(s) ? makeCode() : s;
}

function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 1e6) { req.destroy(); reject(new Error('body too large')); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

class Room {
  constructor(code, mode, hostId) {
    this.code = code;
    this.mode = mode;
    this.hostId = hostId;
    this.players = [];
    this.game = null;
    this.started = false;
    this.selecting = mode === 'duel' || mode === 'duel_pvp';
    this.createdAt = Date.now();
  }

  add(name) {
    const cap = this.mode === 'duel' ? 1 : this.mode === 'duel_pvp' ? 2 : 3;
    if (this.players.length >= cap) return null;
    const p = { id: uid(), name: (name || '玩家').slice(0, 12), res: null, connected: false };
    this.players.push(p);
    return p;
  }

  get(id) { return this.players.find(p => p.id === id); }

  viewFor(id) {
    if (this.game && this.started) {
      return { room: this.code, hostId: this.hostId, mode: this.mode, ...this.game.getView(id) };
    }
    return {
      room: this.code,
      hostId: this.hostId,
      mode: this.mode,
      started: false,
      selecting: this.selecting,
      you: id,
      modes: MODES,
      generals: GENERALS,
      players: this.players.map(p => ({ id: p.id, name: p.name, connected: p.connected, generalId: p.generalId || null })),
      canStart: this.mode === 'doudizhu' ? this.players.length >= 3 : false,
      minPlayers: this.mode === 'duel' ? 1 : this.mode === 'duel_pvp' ? 2 : 3,
      maxPlayers: this.mode === 'duel' ? 1 : this.mode === 'duel_pvp' ? 2 : 3,
    };
  }

  broadcast() {
    for (const p of this.players) {
      if (!p.res) continue;
      try { sendSSE(p.res, this.viewFor(p.id)); }
      catch (e) { p.res = null; p.connected = false; }
    }
  }
}

function serveStatic(pathname, res) {
  let file = pathname === '/' ? '/index.html' : pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(full).toLowerCase();
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.mp3': 'audio/mpeg',
      '.ttf': 'font/ttf',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ico': 'image/x-icon',
    }[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    console.log('[req]', req.method, pathname);

    // 模式列表
    if (pathname === '/api/modes' && req.method === 'GET') {
      return json(res, 200, { ok: true, modes: MODES });
    }

    // 查询房间状态（SSE 的兜底）
    if (pathname === '/api/state' && req.method === 'GET') {
      const code = String(url.searchParams.get('room') || '').toUpperCase();
      const playerId = url.searchParams.get('player');
      const room = rooms.get(code);
      if (!room) return json(res, 404, { ok: false, error: '房间不存在' });
      const p = room.get(playerId);
      if (!p) return json(res, 403, { ok: false, error: '你不在这个房间' });
      p.connected = true;
      p.lastSeen = Date.now();
      return json(res, 200, { ok: true, state: room.viewFor(playerId) });
    }

    // 创建房间
    if (pathname === '/api/create' && req.method === 'POST') {
      const body = await readBody(req);
      const mode = String(body.mode || 'doudizhu');
      const meta = MODES.find(m => m.id === mode);
      if (!meta || !meta.enabled) return json(res, 400, { ok: false, error: '模式不可用' });

      const code = makeCode();
      const room = new Room(code, mode, null);
      const p = room.add((body.name || '玩家').trim());
      room.hostId = p.id;
      rooms.set(code, room);
      return json(res, 200, { ok: true, room: code, playerId: p.id, mode });
    }

    // 加入房间（斗地主）
    if (pathname === '/api/join' && req.method === 'POST') {
      const body = await readBody(req);
      const code = String(body.room || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return json(res, 404, { ok: false, error: '房间不存在' });
      if (room.mode === 'duel') return json(res, 400, { ok: false, error: '人机对战不需要加入' });
      if (room.started) return json(res, 400, { ok: false, error: '游戏已经开始' });
      const cap = room.mode === 'duel_pvp' ? 2 : 3;
      if (room.players.length >= cap) return json(res, 400, { ok: false, error: `房间已满（${cap}人）` });
      const p = room.add((body.name || '玩家').trim());
      room.broadcast();
      return json(res, 200, { ok: true, room: code, playerId: p.id, mode: room.mode });
    }

    // SSE 事件流
    if (pathname === '/api/events' && req.method === 'GET') {
      const code = String(url.searchParams.get('room') || '').toUpperCase();
      const playerId = url.searchParams.get('player');
      const room = rooms.get(code);
      if (!room) { res.writeHead(404); res.end('room not found'); return; }
      const p = room.get(playerId);
      if (!p) { res.writeHead(404); res.end('player not found'); return; }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      // 公网隧道/代理会缓冲小段 SSE，先推 8KB 注释强制刷新
      res.write(': ' + 'x'.repeat(8192) + '\n\n');
      if (p.res) { try { p.res.end(); } catch (e) { /* ignore */ } }
      p.res = res;
      p.connected = true;
      console.log('[sse] connect', code, playerId);
      room.broadcast();

      const hb = setInterval(() => {
        try { res.write(': hb\n\n'); } catch (e) { /* ignore */ }
      }, 15000);

      req.on('close', () => {
        clearInterval(hb);
        if (p.res === res) {
          p.res = null;
          p.connected = false;
          console.log('[sse] close', code, playerId);
          room.broadcast();
        }
      });
      return;
    }

    // 开始游戏
    if (pathname === '/api/start' && req.method === 'POST') {
      const body = await readBody(req);
      const code = String(body.room || '').toUpperCase();
      const room = rooms.get(code);
      if (!room) return json(res, 404, { ok: false, error: '房间不存在' });
      const p = room.get(body.player);
      if (!p) return json(res, 403, { ok: false, error: '你不在这个房间' });
      if (room.mode !== 'duel_pvp' && room.hostId !== p.id) {
        return json(res, 403, { ok: false, error: '只有房主可以开始' });
      }
      if (room.started) return json(res, 400, { ok: false, error: '游戏已经开始' });

      console.log('[start] enter', code, p.id, room.mode, room.players.length, body.generalId || '');
      if (room.mode === 'doudizhu') {
        if (room.players.length < 3) return json(res, 400, { ok: false, error: '至少需要 3 人' });
        room.game = new Game(
          room.players.map(x => ({ id: x.id, name: x.name })),
          'doudizhu'
        );
      } else if (room.mode === 'duel_pvp') {
        const generalId = String(body.generalId || '');
        const gen = GENERALS.find(g => g.id === generalId);
        if (!gen) return json(res, 400, { ok: false, error: '请选择武将' });
        const other = room.players.find(x => x.id !== p.id);
        if (other && other.generalId === generalId) {
          return json(res, 400, { ok: false, error: '对手已选该武将，换一个' });
        }
        p.generalId = generalId;
        if (room.players.length < 2) {
          room.broadcast();
          return json(res, 200, { ok: true, waiting: true, reason: '已选择，等待对手加入…' });
        }
        if (!room.players.every(x => x.generalId)) {
          room.broadcast();
          return json(res, 200, { ok: true, waiting: true, reason: '已选择，等待对手选择…' });
        }
        room.game = new Game(
          room.players.map(x => ({ id: x.id, name: x.name, generalId: x.generalId })),
          'duel_pvp'
        );
        room.selecting = false;
      } else {
        const generalId = String(body.generalId || '');
        const humanGen = GENERALS.find(g => g.id === generalId);
        if (!humanGen) return json(res, 400, { ok: false, error: '请选择武将' });
        const pool = GENERALS.filter(g => g.id !== generalId);
        const aiGen = pool[Math.floor(Math.random() * pool.length)];
        const human = room.players[0];
        room.game = new Game([
          { id: human.id, name: human.name, generalId: humanGen.id },
          { id: 'ai_' + uid(), name: 'AI', generalId: aiGen.id },
        ], 'duel');
        room.selecting = false;
      }

      console.log('[start] game created');
      room.started = true;
      room.game.start();
      console.log('[start] game started');
      room.broadcast();
      console.log('[start] broadcast done');
      return json(res, 200, { ok: true });
    }

    // 游戏操作
    if (pathname === '/api/action' && req.method === 'POST') {
      const body = await readBody(req);
      const code = String(body.room || '').toUpperCase();
      const room = rooms.get(code);
      if (!room) return json(res, 404, { ok: false, error: '房间不存在' });
      const p = room.get(body.player);
      if (!p) return json(res, 403, { ok: false, error: '你不在这个房间' });
      if (!room.game) return json(res, 400, { ok: false, error: '游戏还没开始' });

      const result = room.game.handle(p.id, body.action || {});
      if (result.ok && room.mode === 'duel') aiAct(room.game);
      room.broadcast();
      if (result.ok) result.state = room.viewFor(p.id);
      return json(res, 200, result);
    }

    // 静态文件
    if (req.method === 'GET') return serveStatic(pathname, res);

    res.writeHead(405);
    res.end('method not allowed');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { ok: false, error: '服务器错误' });
    else res.end();
  }
});

// AI 看门狗：AI 自己出牌后可能留下需要 AI 自己响应的窗口，
// 只靠“玩家操作后触发一次 AI”会卡在“等待 AI 响应…”。
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.mode !== 'duel' || !room.game || room.game.gameOver) continue;
    if (room.game.pauseUntil && Date.now() < room.game.pauseUntil) continue;
    const ai = room.game.players.find(p => p.role === 'ai');
    if (!ai) continue;
    const pend = room.game.pending;
    if (pend && pend.playerId === ai.id) {
      const sig = `${pend.type}|${pend.playerId}|${pend.cardId || ''}|${pend.targetId || ''}`;
      if (room._aiSig === sig) room._aiStuck = (room._aiStuck || 0) + 1;
      else { room._aiSig = sig; room._aiStuck = 0; }

      // 安全阀：AI 连续 10 个 tick（约 4 秒）处理不了同一响应，强制放弃，避免整局卡死
      if (room._aiStuck >= 10) {
        console.error('[AI watchdog] force pass on stuck pending:', sig);
        const r = room.game.respond(ai.id, { pass: true });
        if (!r.ok) room.game.pending = null;
        room._aiStuck = 0;
        room._aiSig = '';
        room.broadcast();
        continue;
      }

      if (ai.alive) {
        try { aiAct(room.game); room.broadcast(); } catch (e) { /* ignore */ }
      }
    } else {
      room._aiSig = '';
      room._aiStuck = 0;
    }
  }
}, 400);

server.listen(PORT, () => {
  console.log(`三国杀已启动: http://localhost:${PORT}`);
});
