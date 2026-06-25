// Abyssal Grid server: serves the built game (dist/) AND hosts the multiplayer
// presence + PvP relay on the same port, so a single DigitalOcean App Platform
// service runs the whole thing (WebSockets share the site's origin).
//
//   local dev:  npm run server   (relay on :8787; the app runs via `npm run dev`)
//   production: node server/index.mjs   (serves dist/ + relay on $PORT)
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 8787;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.webp': 'image/webp',
};

// --- HTTP: serve the static build (no-op in dev when dist/ isn't built) ---
const http = createServer(async (req, res) => {
  if (req.url === '/healthz') { res.writeHead(200); res.end('ok'); return; }
  if (!existsSync(DIST)) { res.writeHead(200); res.end('Abyssal Grid relay online'); return; }
  try {
    let p = normalize(decodeURIComponent((req.url || '/').split('?')[0]));
    if (p === '/' || p.endsWith('/')) p = '/index.html';
    let file = join(DIST, p);
    if (!file.startsWith(DIST) || !existsSync(file)) file = join(DIST, 'index.html'); // SPA fallback
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

// --- WebSocket presence/PvP relay on the same server ---
const wss = new WebSocketServer({ server: http });

let nextId = 1;
const clients = new Map(); // ws -> { id, state }

const pick = (o, keys) => { const r = {}; for (const k of keys) if (k in o) r[k] = o[k]; return r; };
const send = (ws, obj) => { try { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); } catch { /* gone */ } };
function broadcast(except, obj) {
  const s = JSON.stringify(obj);
  for (const ws of clients.keys()) {
    if (ws !== except && ws.readyState === ws.OPEN) { try { ws.send(s); } catch { /* gone */ } }
  }
}

// heartbeat: App Platform / proxies can drop a socket without a clean close,
// which would leave a frozen "ghost" player. Ping every 30s and reap silent ones.
const beat = setInterval(() => {
  for (const ws of clients.keys()) {
    if (ws.isAlive === false) { ws.terminate(); continue; } // fires 'close' → leave
    ws.isAlive = false;
    try { ws.ping(); } catch { /* gone */ }
  }
}, 30000);
wss.on('close', () => clearInterval(beat));

wss.on('connection', (ws) => {
  const id = nextId++;
  const c = { id, state: { x: 0, z: 6, name: 'agent', body: 'humanoid', tint: '', facing: 'down', moving: false, running: false } };
  clients.set(ws, c);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (buf) => {
    let m;
    try { m = JSON.parse(buf.toString()); } catch { return; }
    // directed message (challenge handshake + battle netcode): route to one peer
    if (typeof m.to === 'number') {
      for (const [tws, tc] of clients) {
        if (tc.id === m.to) { send(tws, { ...m, from: id }); break; }
      }
      return;
    }
    if (m.type === 'hello') {
      Object.assign(c.state, pick(m, ['name', 'body', 'tint', 'x', 'z', 'facing']));
      const peers = [];
      for (const o of clients.values()) if (o.id !== id) peers.push({ id: o.id, ...o.state });
      send(ws, { type: 'welcome', id, peers });
      broadcast(ws, { type: 'join', id, ...c.state });
    } else if (m.type === 'state') {
      Object.assign(c.state, pick(m, ['x', 'z', 'facing', 'moving', 'running']));
      broadcast(ws, { type: 'state', id, x: c.state.x, z: c.state.z, facing: c.state.facing, moving: c.state.moving, running: c.state.running });
    } else if (m.type === 'reskin') {
      Object.assign(c.state, pick(m, ['name', 'body', 'tint']));
      broadcast(ws, { type: 'reskin', id, name: c.state.name, body: c.state.body, tint: c.state.tint });
    }
  });

  ws.on('close', () => { clients.delete(ws); broadcast(null, { type: 'leave', id }); });
  ws.on('error', () => { /* ignore; close will clean up */ });
});

http.listen(PORT, () => {
  console.log(`[abyssal] serving ${existsSync(DIST) ? 'dist/ + ' : ''}presence/PvP relay on :${PORT}`);
});
