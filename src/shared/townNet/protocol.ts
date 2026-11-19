/**
 * Shared town, step 1 (ROADMAP.md section 4): the messages a browser and the town server exchange.
 *
 * PURE: no DOM, no Node. The server and the browser both import this file, so they cannot disagree about a message.
 *
 * What a player may send is deliberately tiny: a look made only of listed options and colours, the INDEX of a preset
 * name, and a direction to walk in. There is no free text anywhere, so nothing a player types can reach another
 * player, and nothing that identifies a person is sent. Every parser here FAILS CLOSED: anything unexpected is
 * rejected whole (null), never repaired.
 */
import { ACCESSORIES, BOTTOM_STYLES, EYE_STYLES, HAIR_STYLES, SKIN_TONES, TOP_STYLES, type ZombieAppearance } from '../appearance';
import { CAST_BODY_IDS } from '../cast';

export const TOWN_PROTOCOL_VERSION = 1;
/** Largest message the server reads, in bytes (a hello with a look is about 330). */
export const MAX_CLIENT_MESSAGE_BYTES = 640;

/** Preset names. A player picks one by index; the list can grow at the end but an index never changes meaning. */
export const TOWN_NAMES = [
  'Mortimer', 'Ophelia', 'Grimsby', 'Bertha', 'Ezekiel', 'Mildred', 'Cornelius', 'Agatha', 'Barnaby', 'Winifred',
  'Thaddeus', 'Prudence', 'Ignatius', 'Hortense', 'Bartholomew', 'Edith', 'Lazarus', 'Morticia', 'Percival', 'Drusilla',
  'Ambrose', 'Tabitha', 'Rufus', 'Henrietta', 'Silas', 'Beatrix', 'Horace', 'Lavinia', 'Jasper', 'Eudora',
  'Phineas', 'Clementine',
] as const;

/** What a zombie looks like in the shared town: the game's appearance without the voice, and never a premium body. */
export type TownLook = Omit<ZombieAppearance, 'voicePitch'>;

export interface HelloMsg {
  t: 'hello';
  v: number;
  name: number;
  look: TownLook;
}
/** One step of walking: a direction with length 0..1 in world axes. `seq` rises by one per message. */
export interface InputMsg {
  t: 'in';
  seq: number;
  mx: number;
  mz: number;
}
export interface PingMsg {
  t: 'ping';
  c: number;
}
export type ClientMsg = HelloMsg | InputMsg | PingMsg;

export interface PlayerInfo {
  id: number;
  name: number;
  look: TownLook;
  x: number;
  z: number;
  f: number;
}
export interface WelcomeMsg {
  t: 'welcome';
  v: number;
  id: number;
  tickHz: number;
  /** Town clock: whole minutes since the start of the town day, and the day number. */
  minute: number;
  day: number;
  players: PlayerInfo[];
}
export interface JoinMsg {
  t: 'join';
  p: PlayerInfo;
}
export interface LeaveMsg {
  t: 'leave';
  id: number;
}
/** Positions of everyone in the room. `p` rows are [id, x, z, facing, moving 0|1], rounded; `you` is exact. */
export interface SnapMsg {
  t: 'snap';
  k: number;
  /** Highest input `seq` of yours the server has applied. */
  a: number;
  minute: number;
  you: [number, number];
  p: [number, number, number, number, number][];
}
export interface PongMsg {
  t: 'pong';
  c: number;
}
export type ByeReason = 'full' | 'version' | 'badMessage' | 'tooFast' | 'idle' | 'shutdown';
export interface ByeMsg {
  t: 'bye';
  reason: ByeReason;
}
export type ServerMsg = WelcomeMsg | JoinMsg | LeaveMsg | SnapMsg | PongMsg | ByeMsg;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasExactly = (o: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
};
const unit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const hex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/.test(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const uint = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;

const LOOK_KEYS = ['height', 'build', 'skinTone', 'hairStyle', 'hairColor', 'topStyle', 'topColor', 'bottomStyle', 'bottomColor', 'shoeColor', 'eyeStyle', 'eyeColor', 'accessory', 'stitches'] as const;

/** A look made only of listed options, or null. `body` is optional and may only name one of the standard cast bodies. */
export function parseLook(raw: unknown): TownLook | null {
  if (!isObj(raw)) return null;
  const withBody = Object.prototype.hasOwnProperty.call(raw, 'body');
  if (!hasExactly(raw, withBody ? [...LOOK_KEYS, 'body'] : LOOK_KEYS)) return null;
  if (!unit(raw.height) || !unit(raw.build) || !uint(raw.skinTone, SKIN_TONES.length - 1)) return null;
  if (!oneOf(HAIR_STYLES, raw.hairStyle) || !oneOf(TOP_STYLES, raw.topStyle) || !oneOf(BOTTOM_STYLES, raw.bottomStyle)) return null;
  if (!oneOf(EYE_STYLES, raw.eyeStyle) || !oneOf(ACCESSORIES, raw.accessory) || typeof raw.stitches !== 'boolean') return null;
  if (!hex(raw.hairColor) || !hex(raw.topColor) || !hex(raw.bottomColor) || !hex(raw.shoeColor) || !hex(raw.eyeColor)) return null;
  const look: TownLook = {
    height: raw.height, build: raw.build, skinTone: raw.skinTone, hairStyle: raw.hairStyle, hairColor: raw.hairColor,
    topStyle: raw.topStyle, topColor: raw.topColor, bottomStyle: raw.bottomStyle, bottomColor: raw.bottomColor,
    shoeColor: raw.shoeColor, eyeStyle: raw.eyeStyle, eyeColor: raw.eyeColor, accessory: raw.accessory, stitches: raw.stitches,
  };
  if (withBody) {
    if (raw.body !== 'classic' && !oneOf(CAST_BODY_IDS as readonly string[], raw.body)) return null;
    look.body = raw.body as TownLook['body'];
  }
  return look;
}

/** The look the town shows for a game appearance: colours lower-cased, premium bodies shown as the classic body. */
export function lookOf(app: ZombieAppearance): TownLook {
  const clamp = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);
  const col = (c: string, d: string) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : d);
  const look: TownLook = {
    height: clamp(app.height), build: clamp(app.build),
    skinTone: uint(app.skinTone, SKIN_TONES.length - 1) ? app.skinTone : 0,
    hairStyle: oneOf(HAIR_STYLES, app.hairStyle) ? app.hairStyle : 'messy', hairColor: col(app.hairColor, '#3b2f2f'),
    topStyle: oneOf(TOP_STYLES, app.topStyle) ? app.topStyle : 'tee', topColor: col(app.topColor, '#6b4f8a'),
    bottomStyle: oneOf(BOTTOM_STYLES, app.bottomStyle) ? app.bottomStyle : 'pants', bottomColor: col(app.bottomColor, '#3a3f55'),
    shoeColor: col(app.shoeColor, '#2a2420'), eyeStyle: oneOf(EYE_STYLES, app.eyeStyle) ? app.eyeStyle : 'droopy',
    eyeColor: col(app.eyeColor, '#f2e86d'), accessory: oneOf(ACCESSORIES, app.accessory) ? app.accessory : 'none', stitches: app.stitches === true,
  };
  if (oneOf(CAST_BODY_IDS as readonly string[], app.body)) look.body = app.body;
  return look;
}

/**
 * Read one message from a browser. `text` is the raw frame; anything that is not exactly one of the three known
 * messages, with exactly the known fields in range, gives null.
 */
export function parseClientMessage(text: unknown): ClientMsg | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_CLIENT_MESSAGE_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(raw)) return null;
  if (raw.t === 'in') {
    if (!hasExactly(raw, ['t', 'seq', 'mx', 'mz'])) return null;
    const { seq, mx, mz } = raw;
    if (!uint(seq, 0xffffffff) || seq === 0) return null;
    if (typeof mx !== 'number' || typeof mz !== 'number' || !Number.isFinite(mx) || !Number.isFinite(mz)) return null;
    if (mx < -1 || mx > 1 || mz < -1 || mz > 1) return null;
    return { t: 'in', seq, mx, mz };
  }
  if (raw.t === 'ping') {
    if (!hasExactly(raw, ['t', 'c']) || !uint(raw.c, 0xffffffff)) return null;
    return { t: 'ping', c: raw.c };
  }
  if (raw.t === 'hello') {
    if (!hasExactly(raw, ['t', 'v', 'name', 'look'])) return null;
    if (!uint(raw.v, 0xffff) || !uint(raw.name, TOWN_NAMES.length - 1)) return null;
    const look = parseLook(raw.look);
    if (!look) return null;
    return { t: 'hello', v: raw.v, name: raw.name, look };
  }
  return null;
}

/**
 * Read one message from the server (browser side). The server is trusted for positions, but a browser still refuses
 * anything malformed, so a broken or impersonated server cannot feed bad values into the page.
 */
export function parseServerMessage(text: unknown): ServerMsg | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > 262144) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(raw)) return null;
  const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const info = (p: unknown): PlayerInfo | null => {
    if (!isObj(p) || !uint(p.id, 0x7fffffff) || !uint(p.name, TOWN_NAMES.length - 1) || !fin(p.x) || !fin(p.z) || !fin(p.f)) return null;
    const look = parseLook(p.look);
    return look ? { id: p.id, name: p.name, look, x: p.x, z: p.z, f: p.f } : null;
  };
  switch (raw.t) {
    case 'welcome': {
      if (!uint(raw.v, 0xffff) || !uint(raw.id, 0x7fffffff) || !uint(raw.tickHz, 240) || raw.tickHz === 0 || !uint(raw.minute, 1439) || !uint(raw.day, 0x7fffffff) || !Array.isArray(raw.players)) return null;
      const players: PlayerInfo[] = [];
      for (const p of raw.players) {
        const i = info(p);
        if (!i) return null;
        players.push(i);
      }
      return { t: 'welcome', v: raw.v, id: raw.id, tickHz: raw.tickHz, minute: raw.minute, day: raw.day, players };
    }
    case 'join': {
      const p = info(raw.p);
      return p ? { t: 'join', p } : null;
    }
    case 'leave':
      return uint(raw.id, 0x7fffffff) ? { t: 'leave', id: raw.id } : null;
    case 'snap': {
      if (!uint(raw.k, Number.MAX_SAFE_INTEGER) || !uint(raw.a, 0xffffffff) || !uint(raw.minute, 1439)) return null;
      if (!Array.isArray(raw.you) || raw.you.length !== 2 || !fin(raw.you[0]) || !fin(raw.you[1]) || !Array.isArray(raw.p)) return null;
      const rows: SnapMsg['p'] = [];
      for (const r of raw.p) {
        if (!Array.isArray(r) || r.length !== 5 || !uint(r[0], 0x7fffffff) || !fin(r[1]) || !fin(r[2]) || !fin(r[3]) || (r[4] !== 0 && r[4] !== 1)) return null;
        rows.push([r[0], r[1], r[2], r[3], r[4]]);
      }
      return { t: 'snap', k: raw.k, a: raw.a, minute: raw.minute, you: [raw.you[0], raw.you[1]], p: rows };
    }
    case 'pong':
      return uint(raw.c, 0xffffffff) ? { t: 'pong', c: raw.c } : null;
    case 'bye':
      return oneOf(['full', 'version', 'badMessage', 'tooFast', 'idle', 'shutdown'] as const, raw.reason) ? { t: 'bye', reason: raw.reason } : null;
    default:
      return null;
  }
}
