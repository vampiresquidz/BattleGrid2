// Multiplayer presence client. Connects to the relay (server/index.mjs), streams
// our overworld state, and emits events for other players joining/moving/leaving.
// Degrades silently: if the relay isn't running the game just stays single-player.

export interface Hello { name: string; body: string; tint: string; x: number; z: number; facing: string; }
export interface PeerState {
  id: number; x: number; z: number; name: string; body: string; tint: string;
  facing: string; moving: boolean; running: boolean;
}

type Handler = (m: Record<string, unknown>) => void;

// where the relay lives. Override with VITE_MP_URL. In production the server
// serves the game AND the relay on one origin, so connect to this page's host
// over wss://; in local dev the relay is a separate process on :8787.
export function defaultMpUrl(): string {
  const env = (import.meta as { env?: Record<string, string> }).env?.VITE_MP_URL;
  if (env) return env;
  if (typeof location !== 'undefined' && location.protocol === 'https:') return `wss://${location.host}`;
  const host = typeof location !== 'undefined' ? location.hostname || 'localhost' : 'localhost';
  return `ws://${host}:8787`;
}

export class NetClient {
  myId = 0;
  connected = false;
  private ws?: WebSocket;
  private handlers: Record<string, Handler[]> = {};
  private lastSent = 0;

  constructor(private url: string) {}

  on(ev: string, fn: Handler) { (this.handlers[ev] ??= []).push(fn); }
  private emit(ev: string, m: Record<string, unknown>) { for (const f of this.handlers[ev] || []) f(m); }

  connect(hello: Hello) {
    let ws: WebSocket;
    try { ws = new WebSocket(this.url); } catch { return; }
    this.ws = ws;
    ws.onopen = () => { this.connected = true; this.raw({ type: 'hello', ...hello }); };
    ws.onmessage = (e) => {
      let m: Record<string, unknown>;
      try { m = JSON.parse(e.data as string); } catch { return; }
      if (m.type === 'welcome') this.myId = m.id as number;
      this.emit(m.type as string, m);
    };
    ws.onclose = () => { this.connected = false; this.emit('down', {}); };
    ws.onerror = () => { /* connection refused etc — stay solo */ };
  }

  private raw(o: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o));
  }

  // throttled state stream (~12 Hz) so we don't flood the relay
  sendState(s: { x: number; z: number; facing: string; moving: boolean; running: boolean }, now: number) {
    if (!this.connected) return;
    if (now - this.lastSent < 80) return;
    this.lastSent = now;
    this.raw({ type: 'state', ...s });
  }

  reskin(h: { name: string; body: string; tint: string }) {
    this.raw({ type: 'reskin', ...h });
  }

  // directed/raw send (challenge handshake + battle netcode use `to`)
  send(o: Record<string, unknown>) { this.raw(o); }

  // drop all listeners (used when handing the socket between scenes)
  clearHandlers() { this.handlers = {}; }

  dispose() {
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = undefined;
    this.connected = false;
    this.handlers = {};
  }
}
