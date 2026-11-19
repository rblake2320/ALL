/**
 * Shared town, step 1: the real server with real WebSocket connections on this machine.
 * Proves two players see each other, and that every limit is enforced by the server itself.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { Socket } from 'node:net';
import { defaultAppearance } from '../../../src/shared/appearance';
import { lookOf, MAX_CLIENT_MESSAGE_BYTES, parseServerMessage, type ServerMsg, type SnapMsg, type WelcomeMsg } from '../../../src/shared/townNet/protocol';
import { ROOM_CAPACITY, TOWN_TICK_HZ, WALK_SPEED } from '../../../src/shared/townNet/room';
import { clientAddress, startTownServer, type TownServer, type TownServerOptions } from '../../../server/townServer';

const LOOK = lookOf(defaultAppearance());
const HELLO = JSON.stringify({ t: 'hello', v: 1, name: 0, look: LOOK });

let server: TownServer | null = null;
const sockets: WebSocket[] = [];
let clock = Date.UTC(2026, 10, 19);

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await server?.close();
  server = null;
});

async function boot(opts: TownServerOptions = {}): Promise<TownServer> {
  clock = Date.UTC(2026, 10, 19);
  server = await startTownServer({ autoTick: false, now: () => clock, ...opts });
  return server;
}

interface Client {
  ws: WebSocket;
  got: ServerMsg[];
  raw: string[];
  closed: Promise<number>;
  next<T extends ServerMsg['t']>(type: T): Promise<Extract<ServerMsg, { t: T }>>;
}

function connect(s: TownServer, headers: Record<string, string> = {}): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}`, { headers });
    sockets.push(ws);
    const got: ServerMsg[] = [];
    const raw: string[] = [];
    const waiters: { type: string; done: (m: ServerMsg) => void }[] = [];
    ws.on('message', (d) => {
      const text = d.toString();
      raw.push(text);
      const m = parseServerMessage(text);
      if (!m) return;
      const i = waiters.findIndex((w) => w.type === m.t);
      if (i >= 0) waiters.splice(i, 1)[0].done(m);
      else got.push(m);
    });
    const closed = new Promise<number>((res) => ws.on('close', (code) => res(code)));
    const client: Client = {
      ws, got, raw, closed,
      next(type) {
        const i = got.findIndex((m) => m.t === type);
        if (i >= 0) return Promise.resolve(got.splice(i, 1)[0] as never);
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error(`no "${type}" message within 3 s`)), 3000);
          waiters.push({ type, done: (m) => (clearTimeout(timer), res(m as never)) });
        });
      },
    };
    ws.on('open', () => resolve(client));
    ws.on('error', reject);
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

async function join(s: TownServer): Promise<{ c: Client; welcome: WelcomeMsg }> {
  const c = await connect(s);
  c.ws.send(HELLO);
  return { c, welcome: await c.next('welcome') };
}

/** Tick the server until the client has received its next snapshot. */
async function snapAfterTicks(s: TownServer, c: Client, ticks: number): Promise<SnapMsg> {
  // drop snapshots already waiting, so the one returned is fresh
  for (let i = c.got.length - 1; i >= 0; i--) if (c.got[i].t === 'snap') c.got.splice(i, 1);
  await new Promise((r) => setTimeout(r, 30)); // let sent inputs arrive
  for (let i = 0; i < ticks; i++) {
    clock += 1000 / TOWN_TICK_HZ;
    s.tick();
  }
  let snap = await c.next('snap');
  await new Promise((r) => setTimeout(r, 30));
  for (let i = c.got.length - 1; i >= 0; i--) {
    const m = c.got[i];
    if (m.t === 'snap' && m.k > snap.k) snap = m;
  }
  return snap;
}

describe('two players in the shared town', () => {
  it('each is told about the other, and sees the other walk', async () => {
    const s = await boot();
    const a = await join(s);
    expect(a.welcome.players.map((p) => p.id)).toEqual([a.welcome.id]);
    const b = await join(s);
    expect(b.welcome.players.map((p) => p.id).sort()).toEqual([a.welcome.id, b.welcome.id].sort());
    expect((await a.c.next('join')).p.id).toBe(b.welcome.id);
    expect(b.welcome.id).not.toBe(a.welcome.id);

    const bStart = b.welcome.players.find((p) => p.id === b.welcome.id)!;
    // walk at pace: a few steps, let the server tick, a few more (a burst of 30 would be cut to the queue limit)
    let seen = await snapAfterTicks(s, a.c, 2);
    for (let batch = 0; batch < 5; batch++) {
      for (let i = 1; i <= 6; i++) b.c.ws.send(JSON.stringify({ t: 'in', seq: batch * 6 + i, mx: 1, mz: 0 }));
      seen = await snapAfterTicks(s, a.c, 8);
    }
    const row = seen.p.find((r) => r[0] === b.welcome.id)!;
    expect(row[1] - bStart.x).toBeCloseTo((30 * WALK_SPEED) / TOWN_TICK_HZ, 1); // A sees B 30 steps east (2.4 tiles), rounded
    expect(row[1] - bStart.x).toBeLessThanOrEqual((30 * WALK_SPEED) / TOWN_TICK_HZ + 0.01);
    expect(row[2]).toBeCloseTo(bStart.z, 2);
    // A did not move
    const aStart = a.welcome.players[0];
    expect(seen.you).toEqual([aStart.x, aStart.z]);
  });

  it('when one leaves, the other is told and the count drops', async () => {
    const s = await boot();
    const a = await join(s);
    const b = await join(s);
    await a.c.next('join');
    b.c.ws.close();
    expect((await a.c.next('leave')).id).toBe(b.welcome.id);
    expect(s.stats().players).toBe(1);
  });

  it('the last player leaving empties the town: nothing is kept', async () => {
    const s = await boot();
    const a = await join(s);
    a.c.ws.close();
    await a.c.closed;
    await new Promise((r) => setTimeout(r, 30));
    expect(s.stats()).toMatchObject({ players: 0, rooms: 0, connections: 0 });
  });

  it('everything the server sends about a player is an id, a preset-name index, a look made of listed options and numbers', async () => {
    const s = await boot();
    const a = await join(s);
    await join(s);
    await a.c.next('join');
    await snapAfterTicks(s, a.c, 4);
    expect(a.c.raw.length).toBeGreaterThanOrEqual(3);
    for (const text of a.c.raw) {
      expect(parseServerMessage(text), text.slice(0, 80)).not.toBeNull();
      expect(text).not.toMatch(/127\.0\.0\.1|::1|address|origin|agent/i);
    }
  });
});

describe('limits the server enforces itself', () => {
  for (const joined of [false, true]) {
    it(`buffered hello after a drop cannot leave ghost players (joined=${joined})`, async () => {
      const s = await boot();
      const c = joined ? (await join(s)).c : await connect(s);
      // Batch both frames into one write so ws delivers the second message after drop().
      const socket = (c.ws as unknown as { _socket: Socket })._socket;
      socket.cork();
      c.ws.send(joined ? HELLO : '{"t":"chat","text":"invalid"}');
      c.ws.send(HELLO);
      socket.uncork();
      expect(await c.closed).toBe(1008);
      expect(s.stats()).toMatchObject({ connections: 0, players: 0, rooms: 0 });
      const next = await join(s);
      expect(next.welcome.players).toHaveLength(1);
    });
  }

  it('a web site that is not on the list cannot connect; one on the list can', async () => {
    const s = await boot({ allowedOrigins: ['https://play.example'] });
    await expect(connect(s, { origin: 'https://evil.example' })).rejects.toThrow('HTTP 403');
    await expect(connect(s)).rejects.toThrow('HTTP 403'); // no Origin header at all
    const ok = await connect(s, { origin: 'https://play.example' });
    ok.ws.send(HELLO);
    expect((await ok.next('welcome')).t).toBe('welcome');
    expect(s.stats().rejected.origin).toBe(2);
  });

  it('one address cannot hold more than its share of connections, and gets a slot back when one closes', async () => {
    const s = await boot({ maxPerAddress: 2 });
    const one = await connect(s);
    await connect(s);
    await expect(connect(s)).rejects.toThrow('HTTP 429');
    one.ws.close();
    await one.closed;
    await new Promise((r) => setTimeout(r, 30));
    await expect(connect(s)).resolves.toBeTruthy();
  });

  it('behind a host proxy, players are counted by the address the proxy reports, not the proxy\'s own', async () => {
    const s = await boot({ maxPerAddress: 1, trustProxy: true });
    await connect(s, { 'x-forwarded-for': '203.0.113.7' });
    await expect(connect(s, { 'x-forwarded-for': '203.0.113.7' })).rejects.toThrow('HTTP 429');
    await expect(connect(s, { 'x-forwarded-for': '203.0.113.8' })).resolves.toBeTruthy();
    // a browser cannot dodge the limit by claiming another address: only the proxy's own (last) entry counts
    await expect(connect(s, { 'x-forwarded-for': '198.51.100.1, 203.0.113.7' })).rejects.toThrow('HTTP 429');
  });

  it('without a trusted proxy the X-Forwarded-For header is ignored (control)', async () => {
    const s = await boot({ maxPerAddress: 1 });
    await connect(s, { 'x-forwarded-for': '203.0.113.7' });
    await expect(connect(s, { 'x-forwarded-for': '203.0.113.8' })).rejects.toThrow('HTTP 429');
  });

  it('a malformed forwarded address falls back to the direct one', () => {
    const req = (xff: string | string[] | undefined) => ({ headers: { 'x-forwarded-for': xff }, socket: { remoteAddress: '198.51.100.9' } }) as never;
    expect(clientAddress(req('203.0.113.7'), true)).toBe('203.0.113.7');
    expect(clientAddress(req('a, 2001:db8::1'), true)).toBe('2001:db8::1');
    expect(clientAddress(req(['1.1.1.1', '2.2.2.2']), true)).toBe('2.2.2.2');
    for (const bad of ['<script>', '', 'not an address', 'x'.repeat(80), undefined]) expect(clientAddress(req(bad), true)).toBe('198.51.100.9');
    expect(clientAddress(req('203.0.113.7'), false)).toBe('198.51.100.9');
  });

  it('a full room opens a second one; when every room is full the next player is told so', async () => {
    const s = await boot({ maxRooms: 2, maxPerAddress: 1000 });
    for (let i = 0; i < ROOM_CAPACITY * 2; i++) await join(s);
    expect(s.stats()).toMatchObject({ rooms: 2, players: ROOM_CAPACITY * 2 });
    const extra = await connect(s);
    extra.ws.send(HELLO);
    expect((await extra.next('bye')).reason).toBe('full');
    expect(await extra.closed).toBe(1013);
    expect(s.stats().players).toBe(ROOM_CAPACITY * 2);
  });

  const badFirst: [string, string][] = [
    ['free text', 'hello there'],
    ['an input before hello', '{"t":"in","seq":1,"mx":1,"mz":0}'],
    ['a chat message', '{"t":"chat","text":"hi"}'],
    ['a hello with a typed name', JSON.stringify({ t: 'hello', v: 1, name: 'Robert', look: LOOK })],
    ['a hello with an e-mail field', JSON.stringify({ t: 'hello', v: 1, name: 0, look: LOOK, email: 'a@b.c' })],
  ];
  for (const [what, text] of badFirst) {
    it(`drops a connection that sends ${what}, and admits nobody`, async () => {
      const s = await boot();
      const c = await connect(s);
      c.ws.send(text);
      expect((await c.next('bye')).reason).toBe('badMessage');
      expect(await c.closed).toBe(1008);
      expect(s.stats().players).toBe(0);
    });
  }

  it('drops a binary frame', async () => {
    const s = await boot();
    const c = await connect(s);
    c.ws.send(Buffer.from(HELLO));
    expect((await c.next('bye')).reason).toBe('badMessage');
  });

  it('drops a second hello on the same connection (no changing identity mid-session)', async () => {
    const s = await boot();
    const { c } = await join(s);
    c.ws.send(HELLO);
    expect((await c.next('bye')).reason).toBe('badMessage');
    await c.closed;
    expect(s.stats().players).toBe(0);
  });

  it('refuses a newer page with the reason "version"', async () => {
    const s = await boot();
    const c = await connect(s);
    c.ws.send(JSON.stringify({ t: 'hello', v: 2, name: 0, look: LOOK }));
    expect((await c.next('bye')).reason).toBe('version');
  });

  it('a frame over the size limit closes the connection without being read', async () => {
    const s = await boot();
    const { c } = await join(s);
    c.ws.send(`{"t":"ping","c":1,"pad":"${'x'.repeat(MAX_CLIENT_MESSAGE_BYTES * 2)}"}`);
    expect(await c.closed).toBe(1009);
    await new Promise((r) => setTimeout(r, 30));
    expect(s.stats().players).toBe(0);
  });

  it('a connection that floods messages is dropped; one at the normal rate is not', async () => {
    const s = await boot({ maxMessagesPerSecond: 50 });
    const flood = await join(s);
    const calm = await join(s);
    for (let i = 1; i <= 200; i++) flood.c.ws.send(JSON.stringify({ t: 'ping', c: i })); // no time passes on the server clock
    expect((await flood.c.next('bye')).reason).toBe('tooFast');
    for (let i = 1; i <= 30; i++) {
      calm.c.ws.send(JSON.stringify({ t: 'in', seq: i, mx: 0, mz: 1 }));
      clock += 34;
    }
    calm.c.ws.send('{"t":"ping","c":1}');
    expect((await calm.c.next('pong')).c).toBe(1);
  });

  it('a connection that never says hello is dropped; a quiet player is dropped after the idle limit; a pinging one stays', async () => {
    const s = await boot({ helloMs: 1000, idleMs: 5000 });
    const silent = await connect(s);
    const quiet = await join(s);
    const alive = await join(s);
    clock += 1500;
    s.tick();
    expect((await silent.next('bye')).reason).toBe('idle');
    clock += 3000;
    alive.c.ws.send('{"t":"ping","c":1}');
    await alive.c.next('pong');
    clock += 3000;
    s.tick();
    expect((await quiet.c.next('bye')).reason).toBe('idle');
    await quiet.c.closed;
    expect(s.stats().players).toBe(1);
  });

  it('SPEED CHEAT over the wire: 600 inputs in one burst move a player a few steps, not 48 tiles', async () => {
    const s = await boot({ maxMessagesPerSecond: 100000 });
    const watcher = await join(s);
    const cheat = await join(s);
    const start = cheat.welcome.players.find((p) => p.id === cheat.welcome.id)!;
    for (let seq = 1; seq <= 600; seq++) cheat.c.ws.send(JSON.stringify({ t: 'in', seq, mx: 1, mz: 0 }));
    const seen = await snapAfterTicks(s, watcher.c, 4);
    const row = seen.p.find((r) => r[0] === cheat.welcome.id)!;
    expect(row[1] - start.x).toBeLessThan(1.5);
  });

  it('the health page reports counts only', async () => {
    const s = await boot();
    await join(s);
    const res = await fetch(`http://127.0.0.1:${s.port}/healthz`);
    expect(await res.json()).toEqual({ ok: true, v: 1, players: 1, rooms: 1 });
    expect((await fetch(`http://127.0.0.1:${s.port}/anything-else`)).status).toBe(404);
  });

  it('closing the server tells everyone and frees the port', async () => {
    const s = await boot();
    const { c } = await join(s);
    await s.close();
    server = null;
    expect((await c.next('bye')).reason).toBe('shutdown');
    await expect(fetch(`http://127.0.0.1:${s.port}/healthz`)).rejects.toThrow();
  });
});
