// Abyssal Grid — multiplayer presence relay.
// A dumb, stateless-ish broadcast hub: every client streams its overworld state
// (position, facing, chosen agent) and the server fans it out to everyone else.
// No game logic lives here — it's just shared presence so the data-world feels
// inhabited. Run with: npm run server   (PORT env to override 8787)
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8787;
const wss = new WebSocketServer({ port: PORT });

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

wss.on('connection', (ws) => {
  const id = nextId++;
  const c = { id, state: { x: 0, z: 6, name: 'agent', body: 'humanoid', tint: '', facing: 'down', moving: false, running: false } };
  clients.set(ws, c);

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

console.log(`[mp] Abyssal Grid presence relay on ws://localhost:${PORT}`);
