/**
 * The shared-town server, step 1 (ROADMAP.md section 4): browsers connect over a WebSocket, the server moves
 * everybody and tells each browser where the others are.
 *
 * What it does NOT do, on purpose: no accounts, no chat, no free text, no database, no files. It keeps nothing after a
 * player leaves and writes no address to its log. Counting connections per address (to stop one machine filling the
 * town) happens in memory only.
 *
 * Every limit is enforced here, never trusted to the page: message size, message rate, players per room, connections
 * per address, which web sites may connect, and how fast anyone can walk (src/shared/townNet/room.ts).
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_CLIENT_MESSAGE_BYTES, parseClientMessage, TOWN_PROTOCOL_VERSION, type ByeReason, type ServerMsg } from '../src/shared/townNet/protocol';
import { addPlayer, createRoom, playerInfo, queueInput, removePlayer, roomIsFull, snapshotFor, stepRoom, SNAP_EVERY_TICKS, TOWN_TICK_HZ, type Room } from '../src/shared/townNet/room';
import { townStreetArea } from '../src/shared/townNet/street';
import { townClockAt } from '../src/shared/townNet/clock';

export interface TownServerOptions {
  port?: number;
  host?: string;
  /** Web origins allowed to connect (exact match, e.g. "https://example.org"). Empty = any origin (local testing only). */
  allowedOrigins?: readonly string[];
  /** Rooms the server will open. Players beyond `maxRooms * ROOM_CAPACITY` are told the town is full. */
  maxRooms?: number;
  /** Connections accepted from one address at a time. */
  maxPerAddress?: number;
  /**
   * true = the server sits behind ONE reverse proxy of the host (most hosting services), which appends the real
   * address to the X-Forwarded-For header: count connections by that last entry instead of the proxy's own address.
   * Leave false when browsers connect directly, or anyone could claim any address.
   */
  trustProxy?: boolean;
  /** Messages a connection may send per second before it is dropped. */
  maxMessagesPerSecond?: number;
  /** A connection that has sent nothing for this long is dropped. */
  idleMs?: number;
  /** A connection must say hello within this long. */
  helloMs?: number;
  /** false = the caller drives `tick()` itself (tests). */
  autoTick?: boolean;
  /** Real time in milliseconds (tests pass their own clock). */
  now?: () => number;
  log?: (line: string) => void;
}

export interface TownServerStats {
  rooms: number;
  players: number;
  connections: number;
  ticks: number;
  /** Ticks or messages that threw and were contained. */
  faults: number;
  rejected: Record<string, number>;
}

export interface TownServer {
  readonly port: number;
  stats(): TownServerStats;
  /** Advance every room one tick and send snapshots when due. */
  tick(): void;
  close(): Promise<void>;
}

interface Conn {
  ws: WebSocket;
  address: string;
  room: Room | null;
  playerId: number;
  /** Message allowance (token bucket). */
  tokens: number;
  tokensAt: number;
  lastMessageAt: number;
  openedAt: number;
  closed: boolean;
}

/**
 * The address a connection is counted under. Behind a trusted proxy that is the LAST X-Forwarded-For entry (the one
 * the proxy itself added; earlier entries are whatever the browser claimed). Never logged, never sent to anyone.
 */
export function clientAddress(req: Pick<IncomingMessage, 'headers' | 'socket'>, trustProxy: boolean): string {
  const direct = req.socket.remoteAddress ?? 'unknown';
  if (!trustProxy) return direct;
  const header = req.headers['x-forwarded-for'];
  const value = Array.isArray(header) ? header[header.length - 1] : header;
  const last = typeof value === 'string' ? value.split(',').pop()?.trim() : undefined;
  return last && /^[0-9a-fA-F:.]{2,45}$/.test(last) ? last : direct;
}

/** A snapshot is skipped for a browser this far behind; twice this and the connection is dropped. */
const BACKLOG_SKIP_BYTES = 64 * 1024;

export async function startTownServer(opts: TownServerOptions = {}): Promise<TownServer> {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const allowed = new Set(opts.allowedOrigins ?? []);
  const maxRooms = opts.maxRooms ?? 4;
  const maxPerAddress = opts.maxPerAddress ?? 4;
  const rate = opts.maxMessagesPerSecond ?? 90;
  const idleMs = opts.idleMs ?? 30_000;
  const helloMs = opts.helloMs ?? 5_000;
  const area = townStreetArea();
  const rooms: Room[] = [];
  const conns = new Set<Conn>();
  const perAddress = new Map<string, number>();
  const stats: TownServerStats = { rooms: 0, players: 0, connections: 0, ticks: 0, faults: 0, rejected: {} };
  const reject = (why: string): void => {
    stats.rejected[why] = (stats.rejected[why] ?? 0) + 1;
  };

  const http: Server = createServer((req, res) => {
    // one read-only page for the host's health check; it reports counts and nothing about anybody
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, v: TOWN_PROTOCOL_VERSION, players: countPlayers(), rooms: rooms.length }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES, perMessageDeflate: false });

  const countPlayers = (): number => rooms.reduce((n, r) => n + r.players.size, 0);
  const send = (c: Conn, msg: ServerMsg): void => {
    if (c.closed || c.ws.readyState !== c.ws.OPEN) return;
    c.ws.send(JSON.stringify(msg));
  };
  const drop = (c: Conn, reason: ByeReason | null, code = 1008): void => {
    if (c.closed) return;
    if (reason) {
      reject(reason);
      send(c, { t: 'bye', reason });
    }
    c.closed = true;
    try {
      c.ws.close(code);
    } catch {
      /* already gone */
    }
    leave(c);
  };
  const leave = (c: Conn): void => {
    if (!conns.delete(c)) return;
    const left = (perAddress.get(c.address) ?? 1) - 1;
    if (left > 0) perAddress.set(c.address, left);
    else perAddress.delete(c.address);
    if (c.room && c.playerId) {
      removePlayer(c.room, c.playerId);
      for (const o of conns) if (o.room === c.room && o.playerId) send(o, { t: 'leave', id: c.playerId });
      if (c.room.players.size === 0) {
        const i = rooms.indexOf(c.room);
        if (i >= 0) rooms.splice(i, 1);
      }
    }
    c.room = null;
    c.playerId = 0;
  };

  const onMessage = (c: Conn, data: unknown, isBinary: boolean): void => {
    const t = now();
    c.tokens = Math.min(rate, c.tokens + ((t - c.tokensAt) / 1000) * rate);
    c.tokensAt = t;
    if (c.tokens < 1) return drop(c, 'tooFast');
    c.tokens -= 1;
    c.lastMessageAt = t;
    const msg = isBinary ? null : parseClientMessage(Buffer.isBuffer(data) ? data.toString('utf8') : null);
    if (!msg) return drop(c, 'badMessage');
    if (msg.t === 'ping') return send(c, { t: 'pong', c: msg.c });
    if (msg.t === 'hello') {
      if (c.playerId) return drop(c, 'badMessage');
      if (msg.v !== TOWN_PROTOCOL_VERSION) return drop(c, 'version');
      let room = rooms.find((r) => !roomIsFull(r));
      if (!room) {
        if (rooms.length >= maxRooms) return drop(c, 'full', 1013);
        room = createRoom(area);
        rooms.push(room);
      }
      const p = addPlayer(room, msg.name, msg.look);
      if (!p) return drop(c, 'full', 1013);
      c.room = room;
      c.playerId = p.id;
      const clock = townClockAt(t);
      send(c, { t: 'welcome', v: TOWN_PROTOCOL_VERSION, id: p.id, tickHz: TOWN_TICK_HZ, minute: clock.minute, day: clock.day, players: [...room.players.values()].map(playerInfo) });
      for (const o of conns) if (o !== c && o.room === room && o.playerId) send(o, { t: 'join', p: playerInfo(p) });
      return;
    }
    // an input before hello is a protocol error
    if (!c.room || !c.playerId) return drop(c, 'badMessage');
    queueInput(c.room, c.playerId, msg);
  };

  http.on('upgrade', (req: IncomingMessage, socket, head) => {
    const refuse = (status: string, why: string): void => {
      reject(why);
      socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    };
    const origin = req.headers.origin;
    if (allowed.size > 0 && (typeof origin !== 'string' || !allowed.has(origin))) return refuse('403 Forbidden', 'origin');
    const address = clientAddress(req, opts.trustProxy === true);
    if ((perAddress.get(address) ?? 0) >= maxPerAddress) return refuse('429 Too Many Requests', 'perAddress');
    wss.handleUpgrade(req, socket, head, (ws) => {
      const t = now();
      const c: Conn = { ws, address, room: null, playerId: 0, tokens: rate, tokensAt: t, lastMessageAt: t, openedAt: t, closed: false };
      conns.add(c);
      perAddress.set(address, (perAddress.get(address) ?? 0) + 1);
      ws.on('message', (data, isBinary) => {
        try {
          onMessage(c, data, isBinary);
        } catch {
          // fault barrier: one connection's bad moment never takes the town down
          stats.faults += 1;
          drop(c, 'badMessage');
        }
      });
      ws.on('close', () => {
        c.closed = true;
        leave(c);
      });
      ws.on('error', () => {
        // an oversized frame arrives here: ws closes the socket with 1009
        c.closed = true;
        leave(c);
      });
    });
  });

  const tick = (): void => {
    stats.ticks += 1;
    const t = now();
    const minute = townClockAt(t).minute;
    for (const room of rooms) {
      try {
        stepRoom(room);
      } catch {
        stats.faults += 1;
      }
    }
    for (const c of [...conns]) {
      if (c.closed) continue;
      if (!c.playerId && t - c.openedAt > helloMs) {
        drop(c, 'idle');
        continue;
      }
      if (t - c.lastMessageAt > idleMs) {
        drop(c, 'idle');
        continue;
      }
      if (!c.room || !c.playerId || c.room.tick % SNAP_EVERY_TICKS !== 0) continue;
      const backlog = c.ws.bufferedAmount;
      if (backlog > BACKLOG_SKIP_BYTES * 2) {
        drop(c, 'tooFast');
        continue;
      }
      if (backlog > BACKLOG_SKIP_BYTES) continue;
      const snap = snapshotFor(c.room, c.playerId, minute);
      if (snap) send(c, snap);
    }
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  if (opts.autoTick !== false) {
    // a fixed-step loop on the monotonic clock: late timers catch up (at most 5 ticks at once), early ones wait
    const stepMs = 1000 / TOWN_TICK_HZ;
    let next = performance.now() + stepMs;
    timer = setInterval(() => {
      let n = 0;
      while (performance.now() >= next && n < 5) {
        tick();
        next += stepMs;
        n += 1;
      }
      if (n === 5) next = performance.now() + stepMs;
    }, Math.floor(stepMs / 2));
  }

  await new Promise<void>((resolve, rejectListen) => {
    http.once('error', rejectListen);
    http.listen(opts.port ?? 0, opts.host ?? '127.0.0.1', () => resolve());
  });
  const port = (http.address() as AddressInfo).port;
  log(`town server listening on port ${port} (origins: ${allowed.size ? [...allowed].join(', ') : 'any'})`);

  return {
    port,
    stats: () => ({ ...stats, rooms: rooms.length, players: countPlayers(), connections: conns.size, rejected: { ...stats.rejected } }),
    tick,
    async close(): Promise<void> {
      if (timer) clearInterval(timer);
      for (const c of [...conns]) drop(c, 'shutdown', 1001);
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
