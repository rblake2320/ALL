/**
 * The browser's connection to the town server: one WebSocket, the hello, a keep-alive, and reconnecting with a growing
 * wait. All game logic lives in src/shared/townNet/client.ts; this file only moves messages.
 */
import { TownClientCore } from '../shared/townNet/client';
import { parseServerMessage, TOWN_PROTOCOL_VERSION, type ByeReason, type TownLook } from '../shared/townNet/protocol';
import type { WalkArea } from '../shared/townNet/street';

export type TownStatus =
  | { kind: 'connecting' }
  | { kind: 'inTown' }
  | { kind: 'retrying'; inSeconds: number }
  | { kind: 'stopped'; reason: ByeReason | 'badServer' };

export interface TownConnection {
  core: TownClientCore;
  status(): TownStatus;
  /** Take one step in this direction (world axes, length 0..1) and tell the server. */
  step(mx: number, mz: number): void;
  close(): void;
}

/** ws:// or wss:// followed by a host, optional port and path; anything else is refused. */
export function isTownServerUrl(v: unknown): v is string {
  return typeof v === 'string' && /^wss?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~/-]*)?$/.test(v);
}

/** Reasons after which trying again cannot help. */
const FINAL: readonly ByeReason[] = ['version', 'badMessage', 'tooFast'];

export function connectToTown(url: string, area: WalkArea, me: { name: number; look: TownLook }, onChange: () => void): TownConnection {
  const core = new TownClientCore(area);
  let ws: WebSocket | null = null;
  let status: TownStatus = { kind: 'connecting' };
  let closedByUs = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pingCount = 0;

  const set = (s: TownStatus): void => {
    status = s;
    onChange();
  };

  const open = (): void => {
    set({ kind: 'connecting' });
    let sock: WebSocket;
    try {
      sock = new WebSocket(url);
    } catch {
      return set({ kind: 'stopped', reason: 'badServer' });
    }
    ws = sock;
    let bye: ByeReason | null = null;
    sock.onopen = () => {
      sock.send(JSON.stringify({ t: 'hello', v: TOWN_PROTOCOL_VERSION, name: me.name, look: me.look }));
      pingTimer = setInterval(() => {
        if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ t: 'ping', c: (pingCount = (pingCount + 1) >>> 0) }));
      }, 5000);
    };
    sock.onmessage = (ev) => {
      const msg = parseServerMessage(ev.data);
      if (!msg) return; // a malformed message is ignored, never acted on
      const now = performance.now();
      if (msg.t === 'welcome') {
        if (msg.v !== TOWN_PROTOCOL_VERSION || !core.welcome(msg, now)) return sock.close();
        attempt = 0;
        set({ kind: 'inTown' });
      } else if (msg.t === 'snap') core.onSnap(msg, now);
      else if (msg.t === 'join') {
        core.join(msg.p, now);
        onChange();
      } else if (msg.t === 'leave') {
        core.leave(msg.id);
        onChange();
      } else if (msg.t === 'bye') bye = msg.reason;
    };
    sock.onclose = () => {
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
      core.reset();
      if (ws === sock) ws = null;
      if (closedByUs) return;
      if (bye && FINAL.includes(bye)) return set({ kind: 'stopped', reason: bye });
      // wait 1, 2, 4, 8, 16, then 30 seconds; a full town is asked again no sooner than every 15 seconds
      attempt += 1;
      const wait = Math.max(bye === 'full' ? 15 : 1, Math.min(30, 2 ** (attempt - 1)));
      set({ kind: 'retrying', inSeconds: wait });
      retryTimer = setTimeout(open, wait * 1000);
    };
  };
  open();

  return {
    core,
    status: () => status,
    step(mx, mz) {
      const msg = core.localInput(mx, mz, performance.now());
      if (msg && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    close() {
      closedByUs = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (pingTimer) clearInterval(pingTimer);
      ws?.close();
    },
  };
}
