/**
 * Shared town, step 1: the pure rules (messages, walkable street, room, town clock, the browser's prediction).
 * Adversarial by design: most cases feed the code something it must refuse.
 */
import { describe, expect, it } from 'vitest';
import { defaultAppearance } from '../../../src/shared/appearance';
import { buildWorldMap, MILDEW_LANE_GEN_VERSION, WORLD_CONTENT_VERSION } from '../../../src/shared/mildewLane';
import { PREMIUM_BODY_IDS } from '../../../src/shared/premiumBodies';
import { lookOf, MAX_CLIENT_MESSAGE_BYTES, parseClientMessage, parseLook, parseServerMessage, TOWN_NAMES, TOWN_PROTOCOL_VERSION, type InputMsg } from '../../../src/shared/townNet/protocol';
import { canStand, PLAYER_RADIUS, regionIndexAt, spawnPoint, townStreetArea, TOWN_SEED } from '../../../src/shared/townNet/street';
import { addPlayer, createRoom, INPUT_BURST, INPUT_QUEUE_MAX, isMoving, MOVING_HOLD_TICKS, queueInput, removePlayer, ROOM_CAPACITY, snapshotFor, stepRoom, stepWalk, TOWN_TICK_HZ, WALK_SPEED } from '../../../src/shared/townNet/room';
import { townClockAt, TOWN_DAY_REAL_MINUTES } from '../../../src/shared/townNet/clock';
import { INTERP_DELAY_MS, lerpAngle, PENDING_MAX, TownClientCore } from '../../../src/shared/townNet/client';

const LOOK = lookOf(defaultAppearance());
const hello = (over: Record<string, unknown> = {}) => JSON.stringify({ t: 'hello', v: TOWN_PROTOCOL_VERSION, name: 3, look: LOOK, ...over });
const area = townStreetArea();
const STEP = WALK_SPEED / TOWN_TICK_HZ;

describe('messages from a browser: only the three known shapes get through', () => {
  it('accepts a correct hello, input and ping', () => {
    expect(parseClientMessage(hello())).toEqual({ t: 'hello', v: 1, name: 3, look: LOOK });
    expect(parseClientMessage('{"t":"in","seq":1,"mx":1,"mz":-0.5}')).toEqual({ t: 'in', seq: 1, mx: 1, mz: -0.5 });
    expect(parseClientMessage('{"t":"ping","c":7}')).toEqual({ t: 'ping', c: 7 });
  });

  it('a correct hello fits the size limit with room to spare', () => {
    const biggest = lookOf({ ...defaultAppearance(), hairStyle: 'mohawk', topStyle: 'cardigan', accessory: 'eyepatch', body: 'ringmaster', height: 0.123456789, build: 0.987654321 });
    expect(JSON.stringify({ t: 'hello', v: 1, name: TOWN_NAMES.length - 1, look: biggest }).length).toBeLessThan(MAX_CLIENT_MESSAGE_BYTES - 150);
  });

  const bad: [string, unknown][] = [
    ['not a string', 42],
    ['empty', ''],
    ['not JSON', '{t:in}'],
    ['an array', '[]'],
    ['null', 'null'],
    ['unknown type', '{"t":"chat","text":"hi"}'],
    ['too long', `{"t":"ping","c":1,"pad":"${'x'.repeat(MAX_CLIENT_MESSAGE_BYTES)}"}`],
    ['input with an extra field', '{"t":"in","seq":1,"mx":0,"mz":0,"speed":9}'],
    ['input with a missing field', '{"t":"in","seq":1,"mx":0}'],
    ['input seq 0', '{"t":"in","seq":0,"mx":0,"mz":0}'],
    ['input seq negative', '{"t":"in","seq":-1,"mx":0,"mz":0}'],
    ['input seq fraction', '{"t":"in","seq":1.5,"mx":0,"mz":0}'],
    ['input seq too large', '{"t":"in","seq":4294967296,"mx":0,"mz":0}'],
    ['input direction too long on one axis', '{"t":"in","seq":1,"mx":1.01,"mz":0}'],
    ['input direction as text', '{"t":"in","seq":1,"mx":"1","mz":0}'],
    ['input direction null', '{"t":"in","seq":1,"mx":null,"mz":0}'],
    ['input direction 1e999 (infinity after parsing)', '{"t":"in","seq":1,"mx":1e999,"mz":0}'],
    ['ping with text', '{"t":"ping","c":"1"}'],
    ['hello with a typed name', hello({ name: 'Robert' })],
    ['hello with a name index past the list', hello({ name: TOWN_NAMES.length })],
    ['hello with a negative name index', hello({ name: -1 })],
    ['hello with an extra field', hello({ email: 'a@b.c' })],
    ['hello without a look', '{"t":"hello","v":1,"name":0}'],
    ['hello with a look that is a string', hello({ look: 'tall' })],
  ];
  for (const [what, text] of bad) it(`refuses: ${what}`, () => expect(parseClientMessage(text)).toBeNull());

  it('control: the refusals above are about content, not about hello or input being broken', () => {
    expect(parseClientMessage(hello({ name: TOWN_NAMES.length - 1 }))).not.toBeNull();
    expect(parseClientMessage('{"t":"in","seq":4294967295,"mx":-1,"mz":1}')).not.toBeNull();
  });
});

describe('a look is made only of listed options', () => {
  it('accepts every standard cast body and the classic body', () => {
    expect(parseLook({ ...LOOK, body: 'classic' })).not.toBeNull();
    expect(parseLook({ ...LOOK, body: 'bride' })).not.toBeNull();
  });
  const bad: [string, Record<string, unknown>][] = [
    ['free text in a colour', { hairColor: 'call me on 555-0100' }],
    ['upper-case colour', { topColor: '#AABBCC' }],
    ['short colour', { eyeColor: '#abc' }],
    ['unknown hair style', { hairStyle: '<script>' }],
    ['unknown accessory', { accessory: 'crown' }],
    ['height above 1', { height: 1.5 }],
    ['height not a number', { height: '0.5' }],
    ['skin tone past the list', { skinTone: 99 }],
    ['skin tone fraction', { skinTone: 1.5 }],
    ['stitches not a boolean', { stitches: 1 }],
    ['a voice setting (not part of a town look)', { voicePitch: 0.5 }],
    ['an unknown extra field', { nickname: 'x' }],
    ['a premium body, which the server cannot check the player owns', { body: PREMIUM_BODY_IDS[0] }],
    ['a made-up body', { body: 'dragon' }],
  ];
  for (const [what, over] of bad) it(`refuses: ${what}`, () => expect(parseLook({ ...LOOK, ...over })).toBeNull());
  it('refuses a look with a field missing', () => {
    const { shoeColor: _drop, ...rest } = LOOK;
    expect(parseLook(rest)).toBeNull();
  });
  it('lookOf turns any game appearance into a look the parser accepts, and hides premium bodies', () => {
    const odd = { ...defaultAppearance(), hairColor: '#AABBCC', height: 7, build: Number.NaN, skinTone: -3, body: PREMIUM_BODY_IDS[0] };
    const look = lookOf(odd as never);
    expect(parseLook(look)).toEqual(look);
    expect(look.body).toBeUndefined();
    expect(look.hairColor).toBe('#aabbcc');
    expect('voicePitch' in look).toBe(false);
  });
});

describe('messages from the server: a browser refuses malformed ones', () => {
  const info = { id: 1, name: 0, look: LOOK, x: 50, z: 35, f: 0 };
  it('accepts welcome, join, leave, snap, pong, bye', () => {
    expect(parseServerMessage(JSON.stringify({ t: 'welcome', v: 1, id: 1, tickHz: 30, minute: 600, day: 2, players: [info] }))?.t).toBe('welcome');
    expect(parseServerMessage(JSON.stringify({ t: 'join', p: info }))?.t).toBe('join');
    expect(parseServerMessage('{"t":"leave","id":4}')).toEqual({ t: 'leave', id: 4 });
    expect(parseServerMessage('{"t":"snap","k":9,"a":3,"minute":0,"you":[1,2],"p":[[2,50.1,35,1.57,1]]}')?.t).toBe('snap');
    expect(parseServerMessage('{"t":"pong","c":1}')).toEqual({ t: 'pong', c: 1 });
    expect(parseServerMessage('{"t":"bye","reason":"full"}')).toEqual({ t: 'bye', reason: 'full' });
  });
  const bad: string[] = [
    '{"t":"snap","k":9,"a":3,"minute":0,"you":[1,null],"p":[]}',
    '{"t":"snap","k":9,"a":3,"minute":0,"you":[1,2],"p":[[2,50.1,35,1.57,2]]}',
    '{"t":"snap","k":9,"a":3,"minute":1440,"you":[1,2],"p":[]}',
    '{"t":"snap","k":9,"a":3,"minute":0,"you":[1,2],"p":[[2,"50",35,0,0]]}',
    '{"t":"bye","reason":"<b>visit example.org</b>"}',
    '{"t":"leave","id":-1}',
    JSON.stringify({ t: 'join', p: { ...info, name: 'Bob' } }),
    JSON.stringify({ t: 'join', p: { ...info, look: { ...LOOK, hairColor: 'red' } } }),
    JSON.stringify({ t: 'welcome', v: 1, id: 1, tickHz: 0, minute: 0, day: 0, players: [info] }),
    '{"t":"announce","text":"hello"}',
  ];
  for (const text of bad) it(`refuses ${text.slice(0, 70)}`, () => expect(parseServerMessage(text)).toBeNull());
});

describe('the walkable street', () => {
  it('is exactly the six street regions of the map the game draws, joined edge to edge', () => {
    const map = buildWorldMap({ genVersion: MILDEW_LANE_GEN_VERSION, contentVersion: WORLD_CONTENT_VERSION, seed: TOWN_SEED }, { regionId: 'wormwood:mildew_n2', templateId: 'starter' });
    expect(area.regions.map((r) => r.id)).toEqual(map.regions.filter((r) => r.kind === 'street').map((r) => r.id).sort());
    expect(area.rects).toHaveLength(6);
    for (let i = 1; i < area.rects.length; i++) {
      expect(area.rects[i].x0).toBe(area.rects[i - 1].x1);
      expect(area.rects[i].z0).toBe(area.rects[0].z0);
      expect(area.rects[i].z1).toBe(area.rects[0].z1);
    }
  });
  it('a zombie can stand in the middle and across a join between two regions, never outside, never on not-a-number', () => {
    const a = area.rects[0];
    const b = area.rects[1];
    const midZ = (a.z0 + a.z1) / 2;
    expect(canStand(area, (a.x0 + a.x1) / 2, midZ)).toBe(true);
    expect(canStand(area, b.x0, midZ)).toBe(true); // exactly on the join
    expect(canStand(area, a.x0 + PLAYER_RADIUS / 2, midZ)).toBe(false); // body would stick out of the west end
    expect(canStand(area, b.x0, a.z0 - 1)).toBe(false); // a front yard
    expect(canStand(area, b.x0, a.z1 + 5)).toBe(false);
    expect(canStand(area, Number.NaN, midZ)).toBe(false);
    expect(canStand(area, Number.POSITIVE_INFINITY, midZ)).toBe(false);
  });
  it('every spawn point for the first 500 players is a place a zombie can stand', () => {
    for (let n = 0; n < 500; n++) {
      const p = spawnPoint(area, n);
      expect(canStand(area, p.x, p.z), `player ${n} at ${p.x},${p.z}`).toBe(true);
      expect(regionIndexAt(area, p.x, p.z)).toBeGreaterThanOrEqual(0);
    }
  });
  it('a full room of players all start at different places', () => {
    const seen = new Set<string>();
    for (let n = 0; n < ROOM_CAPACITY; n++) {
      const p = spawnPoint(area, n);
      seen.add(`${p.x.toFixed(2)},${p.z.toFixed(2)}`);
    }
    expect(seen.size).toBe(ROOM_CAPACITY);
  });
});

describe('walking: one pace for everyone, never off the street', () => {
  const start = () => ({ x: 100, z: 35, facing: 0 });
  it('one step covers exactly the walking speed for one tick, whatever the length of the direction', () => {
    const a = start();
    expect(stepWalk(a, 1, 0, area)).toBe(true);
    expect(a.x - 100).toBeCloseTo(STEP, 12);
    const b = start();
    stepWalk(b, 1, 1, area); // a diagonal is not faster
    expect(Math.hypot(b.x - 100, b.z - 35)).toBeCloseTo(STEP, 12);
  });
  it('a half-pushed stick walks at half pace; a barely-touched one does not move', () => {
    const a = start();
    stepWalk(a, 0.5, 0, area);
    expect(a.x - 100).toBeCloseTo(STEP / 2, 12);
    const b = start();
    expect(stepWalk(b, 0.01, 0.01, area)).toBe(false);
    expect(b).toEqual(start());
  });
  it('not-a-number and infinite directions do nothing', () => {
    for (const [mx, mz] of [[Number.NaN, 0], [0, Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY, Number.NaN]]) {
      const w = start();
      expect(stepWalk(w, mx, mz, area)).toBe(false);
      expect(w).toEqual(start());
    }
  });
  it('walking into the edge slides along it and never leaves', () => {
    const w = { x: 100, z: area.rects[0].z0 + PLAYER_RADIUS + 0.01, facing: 0 };
    for (let i = 0; i < 200; i++) stepWalk(w, 1, -1, area); // push north-east into the north edge
    expect(canStand(area, w.x, w.z)).toBe(true);
    expect(w.x).toBeGreaterThan(105); // kept moving east
    expect(w.z).toBeGreaterThanOrEqual(area.rects[0].z0 + PLAYER_RADIUS);
  });
  it('10,000 random steps from random starts never end outside the street', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
    for (let n = 0; n < 50; n++) {
      const at = spawnPoint(area, n);
      const w = { x: at.x, z: at.z, facing: 0 };
      for (let i = 0; i < 200; i++) {
        stepWalk(w, rnd() * 2 - 1, rnd() * 2 - 1, area);
        expect(canStand(area, w.x, w.z)).toBe(true);
      }
    }
  });
});

describe('the room: the server decides, and nobody can cheat the pace', () => {
  const input = (seq: number, mx = 1, mz = 0): InputMsg => ({ t: 'in', seq, mx, mz });
  it('admits players up to capacity, each with their own id, and refuses the next', () => {
    const room = createRoom(area);
    const ids = new Set<number>();
    for (let i = 0; i < ROOM_CAPACITY; i++) ids.add(addPlayer(room, i % TOWN_NAMES.length, LOOK)!.id);
    expect(ids.size).toBe(ROOM_CAPACITY);
    expect(addPlayer(room, 0, LOOK)).toBeNull();
    expect(removePlayer(room, [...ids][0])).toBe(true);
    const again = addPlayer(room, 0, LOOK)!;
    expect(ids.has(again.id)).toBe(false); // an id is never handed out twice in a room
  });
  it('one input moves a player one step, in the tick after it arrived', () => {
    const room = createRoom(area);
    const p = addPlayer(room, 0, LOOK)!;
    const x0 = p.x;
    queueInput(room, p.id, input(1));
    expect(p.x).toBe(x0);
    stepRoom(room);
    expect(p.x - x0).toBeCloseTo(STEP, 12);
    expect(p.lastSeq).toBe(1);
  });
  it('SPEED CHEAT: 1,000 inputs sent at once move a player no further than the saved-up allowance', () => {
    const room = createRoom(area);
    const p = addPlayer(room, 0, LOOK)!;
    const x0 = p.x;
    for (let s = 1; s <= 1000; s++) queueInput(room, p.id, input(s));
    expect(p.queue.length).toBe(INPUT_QUEUE_MAX);
    stepRoom(room);
    expect((p.x - x0) / STEP).toBeLessThanOrEqual(INPUT_BURST + 1e-9);
  });
  it('SPEED CHEAT: over 10 seconds of flooding, distance stays at the walking speed (plus the allowance)', () => {
    const room = createRoom(area);
    const p = addPlayer(room, 0, LOOK)!;
    p.x = area.rects[0].x0 + 1;
    const x0 = p.x;
    let seq = 0;
    for (let tick = 0; tick < TOWN_TICK_HZ * 10; tick++) {
      for (let k = 0; k < 20; k++) queueInput(room, p.id, input(++seq));
      stepRoom(room);
    }
    expect(p.x - x0).toBeLessThanOrEqual(WALK_SPEED * 10 + INPUT_BURST * STEP + 1e-9);
    expect(p.x - x0).toBeGreaterThan(WALK_SPEED * 10 - 1); // control: an honest walker does cover the distance
  });
  it('repeated and out-of-order inputs are dropped', () => {
    const room = createRoom(area);
    const p = addPlayer(room, 0, LOOK)!;
    expect(queueInput(room, p.id, input(5))).toBe(true);
    expect(queueInput(room, p.id, input(5))).toBe(false);
    expect(queueInput(room, p.id, input(4))).toBe(false);
    stepRoom(room);
    expect(queueInput(room, p.id, input(5))).toBe(false); // already applied
    expect(queueInput(room, p.id, input(6))).toBe(true);
    expect(queueInput(room, 999, input(1))).toBe(false); // nobody with that id
  });
  it('a player who stops sending stops moving, and "walking" switches off shortly after', () => {
    const room = createRoom(area);
    const p = addPlayer(room, 0, LOOK)!;
    queueInput(room, p.id, input(1));
    stepRoom(room);
    expect(isMoving(room, p)).toBe(true);
    const x = p.x;
    for (let i = 0; i < MOVING_HOLD_TICKS + 1; i++) stepRoom(room);
    expect(p.x).toBe(x);
    expect(isMoving(room, p)).toBe(false);
  });
  it('the same inputs give the same room, bit for bit (two runs)', () => {
    const run = () => {
      const room = createRoom(area);
      const a = addPlayer(room, 0, LOOK)!;
      const b = addPlayer(room, 1, LOOK)!;
      for (let t = 1; t <= 300; t++) {
        queueInput(room, a.id, input(t, Math.sin(t / 7), Math.cos(t / 11)));
        if (t % 3) queueInput(room, b.id, input(t, -Math.cos(t / 5), Math.sin(t / 13)));
        stepRoom(room);
      }
      return JSON.stringify([...room.players.values()].map((p) => [p.id, p.x, p.z, p.facing, p.lastSeq]));
    };
    expect(run()).toBe(run());
  });
  it('a snapshot gives a player their own exact position and everyone else rounded, never themselves twice', () => {
    const room = createRoom(area);
    const a = addPlayer(room, 0, LOOK)!;
    const b = addPlayer(room, 1, LOOK)!;
    queueInput(room, a.id, input(1, 0.337, 0.211));
    stepRoom(room);
    const snap = snapshotFor(room, a.id, 600)!;
    expect(snap.you).toEqual([a.x, a.z]);
    expect(snap.a).toBe(1);
    expect(snap.p.map((r) => r[0])).toEqual([b.id]);
    expect(snapshotFor(room, 999, 0)).toBeNull();
    expect(parseServerMessage(JSON.stringify(snap))).toEqual(snap);
  });
});

describe('the town clock is the same for everyone and needs no storage', () => {
  const t0 = Date.UTC(2026, 10, 19, 12, 0, 0);
  it('is a pure function of real time', () => expect(townClockAt(t0)).toEqual(townClockAt(t0)));
  it('one town day lasts the configured real time and has 1,440 minutes', () => {
    const a = townClockAt(t0);
    const b = townClockAt(t0 + TOWN_DAY_REAL_MINUTES * 60_000);
    expect(b.day).toBe(a.day + 1);
    expect(b.minute).toBe(a.minute);
    for (let i = 0; i < 5000; i++) {
      const c = townClockAt(t0 + i * 7919);
      expect(Number.isInteger(c.minute) && c.minute >= 0 && c.minute <= 1439).toBe(true);
    }
  });
  it('never runs backwards', () => {
    let last = -1;
    for (let i = 0; i < 3000; i++) {
      const c = townClockAt(t0 + i * 5000);
      const abs = c.day * 1440 + c.minute;
      expect(abs).toBeGreaterThanOrEqual(last);
      last = abs;
    }
  });
  it('broken or ancient times read as day 0, midnight', () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) expect(townClockAt(v)).toEqual({ day: 0, minute: 0 });
  });
});

describe("the browser's prediction agrees with the server", () => {
  const welcome = (id: number, players: { id: number; x: number; z: number }[]) => ({ t: 'welcome' as const, v: 1, id, tickHz: 30, minute: 0, day: 0, players: players.map((p) => ({ ...p, name: 0, look: LOOK, f: 0 })) });

  it('with a delayed connection the page never has to be corrected, and ends exactly where the server has it', () => {
    const room = createRoom(area);
    const p = addPlayer(room, 0, LOOK)!;
    const core = new TownClientCore(area);
    core.welcome(welcome(p.id, [p]), 0);
    const inFlight: { due: number; msg: InputMsg }[] = [];
    const snaps: { due: number; snap: NonNullable<ReturnType<typeof snapshotFor>> }[] = [];
    const DELAY = 4; // ticks each way
    for (let tick = 1; tick <= 400; tick++) {
      const msg = core.localInput(Math.sin(tick / 9), Math.cos(tick / 17), tick * 33)!;
      inFlight.push({ due: tick + DELAY, msg });
      while (inFlight.length && inFlight[0].due <= tick) queueInput(room, p.id, inFlight.shift()!.msg);
      stepRoom(room);
      if (tick % 2 === 0) snaps.push({ due: tick + DELAY, snap: snapshotFor(room, p.id, 0)! });
      while (snaps.length && snaps[0].due <= tick) core.onSnap(snaps.shift()!.snap, tick * 33);
    }
    expect(core.corrections).toBe(0);
    // let everything arrive
    for (const f of inFlight) queueInput(room, p.id, f.msg);
    for (let i = 0; i < 10; i++) stepRoom(room);
    core.onSnap(snapshotFor(room, p.id, 0)!, 99999);
    const me = core.self(99999)!;
    expect([me.x, me.z]).toEqual([p.x, p.z]);
  });

  it('when the server disagrees (it dropped inputs), the server wins', () => {
    const room = createRoom(area);
    const p = addPlayer(room, 0, LOOK)!;
    const core = new TownClientCore(area);
    core.welcome(welcome(p.id, [p]), 0);
    const sent: InputMsg[] = [];
    for (let s = 0; s < 60; s++) sent.push(core.localInput(1, 0, s * 33)!);
    // the server only ever saw the last five
    for (const m of sent.slice(-5)) queueInput(room, p.id, m);
    for (let i = 0; i < 5; i++) stepRoom(room);
    core.onSnap(snapshotFor(room, p.id, 0)!, 3000);
    const me = core.self(3000)!;
    expect(me.x).toBe(p.x);
    expect(core.corrections).toBe(1);
  });

  it('keeps at most four seconds of unconfirmed steps', () => {
    const core = new TownClientCore(area);
    core.welcome(welcome(1, [{ id: 1, x: 100, z: 35 }]), 0);
    for (let s = 0; s < PENDING_MAX * 3; s++) core.localInput(0, 0, s);
    expect((core as unknown as { pending: unknown[] }).pending.length).toBe(PENDING_MAX);
  });

  it('does nothing before the welcome, and refuses a welcome that does not include the player', () => {
    const core = new TownClientCore(area);
    expect(core.localInput(1, 0, 0)).toBeNull();
    expect(core.self(0)).toBeNull();
    expect(core.welcome(welcome(7, [{ id: 1, x: 100, z: 35 }]), 0)).toBe(false);
    expect(core.joined).toBe(false);
  });

  it('other zombies slide between reports instead of jumping', () => {
    const core = new TownClientCore(area);
    core.welcome(welcome(1, [{ id: 1, x: 100, z: 35 }, { id: 2, x: 50, z: 35 }]), 0);
    core.onSnap({ t: 'snap', k: 2, a: 0, minute: 0, you: [100, 35], p: [[2, 50, 35, 0, 1]] }, 1000);
    core.onSnap({ t: 'snap', k: 4, a: 0, minute: 0, you: [100, 35], p: [[2, 51, 35, 0, 1]] }, 1100);
    const mid = core.others(1050 + INTERP_DELAY_MS)[0];
    expect(mid.x).toBeCloseTo(50.5, 9);
    expect(mid.moving).toBe(true);
    expect(core.others(1100 + INTERP_DELAY_MS)[0].x).toBe(51);
    // reports stop: the zombie stays where it was last seen and stops walking
    const later = core.others(5000)[0];
    expect(later.x).toBe(51);
    expect(later.moving).toBe(false);
  });

  it('a zombie that leaves is gone; a report about a stranger is ignored until they are introduced', () => {
    const core = new TownClientCore(area);
    core.welcome(welcome(1, [{ id: 1, x: 100, z: 35 }, { id: 2, x: 50, z: 35 }]), 0);
    core.onSnap({ t: 'snap', k: 2, a: 0, minute: 0, you: [100, 35], p: [[9, 60, 35, 0, 0]] }, 100);
    expect(core.others(500).map((o) => o.id)).toEqual([2]);
    core.leave(2);
    expect(core.others(500)).toEqual([]);
    expect(core.playerCount).toBe(1);
  });

  it('turning takes the short way round', () => {
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 1);
    expect(lerpAngle(0, 1, 0.5)).toBeCloseTo(0.5, 12);
  });
});
