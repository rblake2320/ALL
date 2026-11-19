/**
 * SHARED REGIONAL CALENDAR (D-069; design: docs/DESIGN_WORLD_LEVELS.md §1.16).
 *
 * The game has a launch instant (`LAUNCH_EPOCH_UTC`, set by the owner later: null = calendar off). Each calendar
 * REGION has one IANA time zone; its calendar day is the region's local civil date minus the launch's local date in
 * that zone, with Day 1 = launch day. Seasons, holidays, weekly sets and timed events unlock on the same real date for
 * everyone in a region. The household's own sim clock stays player-controlled (pause / speed): the regional calendar
 * only decides WHICH season / events are current, never the time of day in a world.
 *
 * Privacy (COPPA-relevant): the region comes from the device time zone (Intl) or a player override in Settings. No IP
 * geolocation, no location permission; the zone, region and clock data stay on the device and are never sent.
 *
 * Purity: every function here takes the UTC instant as an argument and never reads a clock. The game layer reads
 * clocks, verifies the signed time and dispatches a journaled `calendar` command; the sim only applies
 * `reduceWorldCalendar` to that command, so replay is deterministic. `Intl` (tz data) is used only here, in the game
 * layer, never inside src/sim.
 */

// ─────────────────────────────────────────── Config ───────────────────────────────────────────

/** Launch instant (UTC ms). PLACEHOLDER: the owner sets it later. null = the regional calendar is off (no events). */
export const LAUNCH_EPOCH_UTC: number | null = null;

/** Device vs signed time: within this the device clock is trusted as-is; beyond it the session uses the signed offset. */
export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
/** In-session clock-change detection: wall-clock delta vs monotonic delta differing by more than this = a clock change. */
export const CLOCK_JUMP_TOLERANCE_MS = 2 * 60 * 1000;
/** A signed time whose fetch round trip took longer than this is discarded (too imprecise). */
export const SIGNED_TIME_MAX_RTT_MS = 10 * 1000;
/** Weekly rollover: Monday 04:00 local region time (ISO weekday 1). */
export const WEEK_ROLLOVER = { isoWeekday: 1, minuteOfDay: 4 * 60 } as const;

/** Instants outside [1970-01-01, 9999-12-31] are refused (Intl / Date limits; garbage guard). */
const MIN_MS = 0;
const MAX_MS = 253402300799999;

export type Hemisphere = 'north' | 'south';
export type CalendarRegionId = string;

export interface CalendarRegionDef {
  id: CalendarRegionId;
  /** Canonical IANA zone: every client in the region computes dates in THIS zone, not its own. */
  zone: string;
  hemisphere: Hemisphere;
  /** Device zones mapped straight to this region (beyond the canonical one). */
  aliases: readonly string[];
}

/** v1 region table (PROPOSED; owner can change it). Ordered west → east; order breaks ties in `regionForZone`. */
export const CALENDAR_REGIONS: readonly CalendarRegionDef[] = [
  { id: 'pacific-hawaii', zone: 'Pacific/Honolulu', hemisphere: 'north', aliases: [] },
  { id: 'americas-alaska', zone: 'America/Anchorage', hemisphere: 'north', aliases: [] },
  { id: 'americas-west', zone: 'America/Los_Angeles', hemisphere: 'north', aliases: ['America/Vancouver', 'America/Tijuana'] },
  { id: 'americas-mountain', zone: 'America/Denver', hemisphere: 'north', aliases: ['America/Phoenix', 'America/Edmonton', 'America/Boise'] },
  { id: 'americas-central', zone: 'America/Chicago', hemisphere: 'north', aliases: ['America/Mexico_City', 'America/Winnipeg'] },
  { id: 'americas-east', zone: 'America/New_York', hemisphere: 'north', aliases: ['America/Toronto', 'America/Detroit', 'America/Bogota', 'America/Lima'] },
  { id: 'americas-south', zone: 'America/Sao_Paulo', hemisphere: 'south', aliases: ['America/Argentina/Buenos_Aires', 'America/Santiago', 'America/Montevideo'] },
  { id: 'europe-west', zone: 'Europe/London', hemisphere: 'north', aliases: ['Europe/Dublin', 'Europe/Lisbon', 'Atlantic/Reykjavik'] },
  { id: 'europe-central', zone: 'Europe/Berlin', hemisphere: 'north', aliases: ['Europe/Paris', 'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Warsaw', 'Africa/Lagos'] },
  { id: 'europe-east', zone: 'Europe/Helsinki', hemisphere: 'north', aliases: ['Europe/Athens', 'Europe/Kyiv', 'Europe/Bucharest', 'Africa/Cairo', 'Africa/Johannesburg', 'Asia/Jerusalem'] },
  { id: 'asia-south', zone: 'Asia/Kolkata', hemisphere: 'north', aliases: ['Asia/Dubai', 'Asia/Karachi', 'Asia/Dhaka'] },
  { id: 'asia-southeast', zone: 'Asia/Singapore', hemisphere: 'north', aliases: ['Asia/Bangkok', 'Asia/Jakarta', 'Asia/Manila', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Australia/Perth'] },
  { id: 'asia-east', zone: 'Asia/Tokyo', hemisphere: 'north', aliases: ['Asia/Seoul'] },
  { id: 'oceania-east', zone: 'Australia/Sydney', hemisphere: 'south', aliases: ['Australia/Melbourne', 'Australia/Brisbane', 'Australia/Adelaide'] },
  { id: 'oceania-nz', zone: 'Pacific/Auckland', hemisphere: 'south', aliases: ['Pacific/Fiji'] },
];

export interface CalendarConfig {
  launchEpochUtc: number | null;
  regions: readonly CalendarRegionDef[];
}

// ─────────────────────────────────────────── Civil-date math (pure integers) ───────────────────────────────────────────

export interface LocalDate {
  y: number;
  m: number; // 1..12
  d: number; // 1..31
}

export interface LocalDateTime extends LocalDate {
  hour: number; // 0..23
  minute: number; // 0..59
  /** ISO weekday: 1 = Monday .. 7 = Sunday. */
  isoWeekday: number;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export function isLeapYear(y: number): boolean {
  return isInt(y) && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0);
}

export function daysInMonth(y: number, m: number): number {
  if (!isInt(y) || !isInt(m) || m < 1 || m > 12) return 0;
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Days since 1970-01-01 for a valid proleptic-Gregorian date (H. Hinnant's days_from_civil), else null. */
export function civilDayNumber(y: number, m: number, d: number): number | null {
  if (!isInt(y) || !isInt(m) || !isInt(d) || y < 1 || y > 9999 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** ISO weekday (1 = Monday) of a day number. 1970-01-01 was a Thursday. */
export function isoWeekdayOf(dayNumber: number): number {
  return ((((dayNumber + 3) % 7) + 7) % 7) + 1;
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  if (FORMATTERS.has(zone)) return FORMATTERS.get(zone)!;
  let f: Intl.DateTimeFormat | null = null;
  try {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  } catch {
    f = null; // RangeError: unknown zone
  }
  if (FORMATTERS.size < 512) FORMATTERS.set(zone, f);
  return f;
}

/** Local civil date + time of a UTC instant in an IANA zone, or null (bad zone, non-finite / out-of-range instant). */
export function localDateTimeIn(zone: string, utcMs: number): LocalDateTime | null {
  if (typeof zone !== 'string' || zone.length === 0 || zone.length > 64) return null;
  if (typeof utcMs !== 'number' || !Number.isFinite(utcMs) || utcMs < MIN_MS || utcMs > MAX_MS) return null;
  const f = formatterFor(zone);
  if (!f) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = f.formatToParts(utcMs);
  } catch {
    return null;
  }
  const get = (t: string) => {
    const p = parts.find((x) => x.type === t);
    return p ? Number(p.value) : NaN;
  };
  const y = get('year');
  const m = get('month');
  const d = get('day');
  let hour = get('hour');
  const minute = get('minute');
  if (hour === 24) hour = 0;
  const dn = civilDayNumber(y, m, d);
  if (dn === null || !isInt(hour) || !isInt(minute)) return null;
  return { y, m, d, hour, minute, isoWeekday: isoWeekdayOf(dn) };
}

/** Zone offset from UTC in whole minutes at an instant (e.g. +540 for Tokyo), or null. */
export function zoneOffsetMinutes(zone: string, utcMs: number): number | null {
  const l = localDateTimeIn(zone, utcMs);
  if (!l) return null;
  const localMin = civilDayNumber(l.y, l.m, l.d)! * 1440 + l.hour * 60 + l.minute;
  return localMin - Math.floor(utcMs / 60000);
}

// ─────────────────────────────────────────── Region assignment ───────────────────────────────────────────

export interface RegionAssignment {
  regionId: CalendarRegionId;
  how: 'override' | 'exact' | 'alias' | 'offset';
}

/**
 * Region for a device zone: a valid player override wins; else an exact canonical / alias match; else the region whose
 * STANDARD offset (the smaller of mid-January and mid-July offsets in the instant's year) is nearest, preferring the
 * same hemisphere (a zone that is ahead in January has southern DST), ties by table order. null when the zone is not a
 * valid IANA zone and there is no valid override. Nothing here leaves the device.
 */
export function regionForZone(deviceZone: string, utcMs: number, regions: readonly CalendarRegionDef[] = CALENDAR_REGIONS, override: string | null = null): RegionAssignment | null {
  if (!Array.isArray(regions) || regions.length === 0) return null;
  if (typeof override === 'string' && regions.some((r) => r.id === override)) return { regionId: override, how: 'override' };
  if (typeof deviceZone !== 'string' || deviceZone.length === 0) return null;
  const exact = regions.find((r) => r.zone === deviceZone);
  if (exact) return { regionId: exact.id, how: 'exact' };
  const alias = regions.find((r) => Array.isArray(r.aliases) && r.aliases.includes(deviceZone));
  if (alias) return { regionId: alias.id, how: 'alias' };
  const now = localDateTimeIn('UTC', utcMs);
  if (!now) return null;
  const std = (zone: string): { std: number; south: boolean } | null => {
    const jan = zoneOffsetMinutes(zone, Date.UTC(now.y, 0, 15, 12));
    const jul = zoneOffsetMinutes(zone, Date.UTC(now.y, 6, 15, 12));
    if (jan === null || jul === null) return null;
    return { std: Math.min(jan, jul), south: jan > jul };
  };
  const dev = std(deviceZone);
  if (!dev) return null;
  let best: { id: string; score: number } | null = null;
  for (const r of regions) {
    const s = std(r.zone);
    if (!s) continue;
    const hemiMismatch = (r.hemisphere === 'south') !== dev.south ? 1 : 0;
    const score = Math.abs(s.std - dev.std) * 2 + hemiMismatch; // hemisphere only breaks equal-offset ties
    if (!best || score < best.score) best = { id: r.id, score };
  }
  return best ? { regionId: best.id, how: 'offset' } : null;
}

// ─────────────────────────────────────────── Calendar day / week / season / events ───────────────────────────────────────────

export interface CalendarInstant {
  regionId: CalendarRegionId;
  /** 1 = launch day in this region; ≤ 0 before launch (pre-launch: no events). */
  day: number;
  /** 1 = launch week (launch day up to the first Monday 04:00 local), +1 at every rollover. ≤ 0 before launch. */
  week: number;
  local: LocalDateTime;
  season: Season;
}

export type Season = 'autumn' | 'winter' | 'spring' | 'summer';

/** Meteorological seasons by local month and hemisphere. */
export function seasonOf(month: number, hemisphere: Hemisphere): Season | null {
  if (!isInt(month) || month < 1 || month > 12) return null;
  const north: Season[] = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
  const s = north[month - 1];
  if (hemisphere === 'north') return s;
  if (hemisphere === 'south') return ({ winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' } as const)[s];
  return null;
}

/** Calendar day, week and season of an instant in a region, or null (calendar off, unknown region, garbage input). */
export function calendarAt(config: CalendarConfig, regionId: CalendarRegionId, utcMs: number): CalendarInstant | null {
  if (!config || config.launchEpochUtc === null || typeof config.launchEpochUtc !== 'number') return null;
  const region = Array.isArray(config.regions) ? config.regions.find((r) => r.id === regionId) : undefined;
  if (!region) return null;
  const launch = localDateTimeIn(region.zone, config.launchEpochUtc);
  const local = localDateTimeIn(region.zone, utcMs);
  if (!launch || !local) return null;
  const launchDn = civilDayNumber(launch.y, launch.m, launch.d)!;
  const dn = civilDayNumber(local.y, local.m, local.d)!;
  const day = dn - launchDn + 1;
  // week: count Monday-04:00 rollovers in (launch local midnight, now]. A "rollover day" starts at 04:00 local.
  const rollDay = (n: number, minuteOfDay: number) => (minuteOfDay < WEEK_ROLLOVER.minuteOfDay ? n - 1 : n);
  const nowRd = rollDay(dn, local.hour * 60 + local.minute);
  const launchRd = rollDay(launchDn, launch.hour * 60 + launch.minute);
  // rollovers = Mondays (as rollover days) m with launchRd < m <= nowRd
  const mondaysUpTo = (n: number) => Math.floor((n - mondayBase) / 7);
  const week = day < 1 ? day : Math.max(1, 1 + (mondaysUpTo(nowRd) - mondaysUpTo(launchRd)));
  const season = seasonOf(local.m, region.hemisphere)!;
  return { regionId, day, week, local, season };
}

/** Day number of a Monday (1970-01-05): Mondays are mondayBase + 7k. */
const mondayBase = 4;

export interface CalendarEventDef {
  id: string;
  /** Opens on a fixed local month/day every year (per hemisphere when set), or on calendar days since launch. */
  when: { kind: 'monthDay'; month: number; day: number; hemisphere?: Hemisphere } | { kind: 'calendarDays'; from: number; to: number };
  /** monthDay events: how many local days the window stays open (≥ 1). */
  durationDays?: number;
}

/** v1 event table (PROPOSED anchors for the W-034 holidays; owner can change them). */
export const CALENDAR_EVENTS: readonly CalendarEventDef[] = [
  { id: 'launch_week', when: { kind: 'calendarDays', from: 1, to: 7 } },
  { id: 'halloween', when: { kind: 'monthDay', month: 10, day: 31 }, durationDays: 7 },
  { id: 'long_night', when: { kind: 'monthDay', month: 12, day: 21, hemisphere: 'north' }, durationDays: 7 },
  { id: 'long_night', when: { kind: 'monthDay', month: 6, day: 21, hemisphere: 'south' }, durationDays: 7 },
  { id: 'rising_day', when: { kind: 'monthDay', month: 3, day: 20, hemisphere: 'north' }, durationDays: 7 },
  { id: 'rising_day', when: { kind: 'monthDay', month: 9, day: 22, hemisphere: 'south' }, durationDays: 7 },
  { id: 'cooldown_carnival', when: { kind: 'monthDay', month: 7, day: 15, hemisphere: 'north' }, durationDays: 7 },
  { id: 'cooldown_carnival', when: { kind: 'monthDay', month: 1, day: 15, hemisphere: 'south' }, durationDays: 7 },
];

/**
 * Event ids open at a calendar instant (sorted, unique). A month/day window that started last year (e.g. Dec 28 + 7)
 * still counts. Feb 29 events open only in leap years. Pre-launch (day ≤ 0): none.
 */
export function activeEventsAt(inst: CalendarInstant | null, hemisphere: Hemisphere, events: readonly CalendarEventDef[] = CALENDAR_EVENTS): string[] {
  if (!inst || !isInt(inst.day) || inst.day < 1 || !Array.isArray(events)) return [];
  const dn = civilDayNumber(inst.local.y, inst.local.m, inst.local.d);
  if (dn === null) return [];
  const out = new Set<string>();
  for (const e of events) {
    if (!e || typeof e.id !== 'string' || !e.when) continue;
    if (e.when.kind === 'calendarDays') {
      if (isInt(e.when.from) && isInt(e.when.to) && inst.day >= e.when.from && inst.day <= e.when.to) out.add(e.id);
      continue;
    }
    if (e.when.kind !== 'monthDay' || (e.when.hemisphere && e.when.hemisphere !== hemisphere)) continue;
    const dur = isInt(e.durationDays) && e.durationDays >= 1 ? Math.min(e.durationDays, 366) : 1;
    for (const y of [inst.local.y, inst.local.y - 1]) {
      const start = civilDayNumber(y, e.when.month, e.when.day);
      if (start !== null && dn >= start && dn < start + dur) out.add(e.id);
    }
  }
  return [...out].sort();
}

// ─────────────────────────────────────────── Signed time ───────────────────────────────────────────

/** Response of the stateless time endpoint (Cloudflare Worker): UTC ms + Ed25519 signature. Carries no player data. */
export interface SignedTime {
  v: 1;
  t: number;
  kid: string;
  /** base64url of the 64-byte Ed25519 signature over `signedTimeMessage(t, kid)`. */
  sig: string;
}

/** Bytes the endpoint signs (UTF-8). Domain-separated so a signature cannot be reused for anything else. */
export function signedTimeMessage(t: number, kid: string): Uint8Array {
  return new TextEncoder().encode(`afterlife-lease:time:v1:${kid}:${t}`);
}

/** Strict parse of an endpoint response (unknown JSON) → SignedTime, or null. */
export function parseSignedTime(raw: unknown): SignedTime | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(',');
  if (keys !== 'kid,sig,t,v') return null;
  if (o.v !== 1 || !isInt(o.t) || (o.t as number) < MIN_MS || (o.t as number) > MAX_MS) return null;
  if (typeof o.kid !== 'string' || !/^[a-z0-9-]{1,16}$/.test(o.kid)) return null;
  if (typeof o.sig !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(o.sig)) return null;
  return { v: 1, t: o.t as number, kid: o.kid, sig: o.sig };
}

export function base64UrlToBytes(s: string): Uint8Array | null {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of s) {
    buf = (buf << 6) | alphabet.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** Ed25519 verify primitive (WebCrypto in the client, node:crypto in tests): (publicKeyId, message, signature) → valid? */
export type Ed25519Verify = (kid: string, message: Uint8Array, signature: Uint8Array) => boolean | Promise<boolean>;

/** True only for a well-formed response whose signature verifies under its key id. Never throws. */
export async function verifySignedTime(raw: unknown, verify: Ed25519Verify): Promise<SignedTime | null> {
  const st = parseSignedTime(raw);
  if (!st || typeof verify !== 'function') return null;
  const sig = base64UrlToBytes(st.sig);
  if (!sig || sig.length !== 64) return null;
  try {
    return (await verify(st.kid, signedTimeMessage(st.t, st.kid), sig)) === true ? st : null;
  } catch {
    return null;
  }
}

/** In-session clock-change detection: the wall clock moved differently from the monotonic clock by > tolerance. */
export function clockChanged(wallDeltaMs: number, monoDeltaMs: number, toleranceMs: number = CLOCK_JUMP_TOLERANCE_MS): boolean {
  if (![wallDeltaMs, monoDeltaMs, toleranceMs].every((v) => typeof v === 'number' && Number.isFinite(v))) return true;
  return Math.abs(wallDeltaMs - monoDeltaMs) > toleranceMs;
}

// ─────────────────────────────────────────── Device clock guard (game layer, profile) ───────────────────────────────────────────

/** Saved on the device (ProfileStore), never sent anywhere. */
export interface CalendarClockState {
  regionId: CalendarRegionId;
  /** Highest calendar day / week reached (never decreases). */
  day: number;
  week: number;
  /** Latest device wall-clock reading seen (rollback detection across sessions). */
  lastDeviceUtc: number;
  /** Latest verified signed time, if any. */
  lastSigned: SignedTime | null;
}

export interface ClockObservation {
  utcMs: number;
  source: 'signed' | 'device';
  /** Device readings flagged by `clockChanged` during this session are not trusted until a signed time arrives. */
  jumped?: boolean;
  signed?: SignedTime | null;
}

export interface ClockAdvance {
  state: CalendarClockState;
  /** True when day or week moved forward. */
  advanced: boolean;
  /** Why progress was held: the device clock went backwards, an in-session jump, pre-launch, or bad input. */
  held: null | 'rollback' | 'jump' | 'preLaunch' | 'invalid';
}

/**
 * Monotonic guard: the calendar never goes backwards. A device clock earlier than the last one seen (beyond the skew
 * tolerance) holds progress (it resumes once real time passes the reached day); a flagged in-session jump is ignored;
 * a verified signed time is always accepted (it may still not lower the day). Pure.
 */
export function advanceClock(prev: CalendarClockState, obs: ClockObservation, config: CalendarConfig): ClockAdvance {
  const held = (why: ClockAdvance['held'], state = prev): ClockAdvance => ({ state, advanced: false, held: why });
  if (!prev || !obs || typeof obs.utcMs !== 'number' || !Number.isFinite(obs.utcMs)) return held('invalid');
  if (obs.source === 'device' && obs.jumped) return held('jump');
  const inst = calendarAt(config, prev.regionId, obs.utcMs);
  if (!inst) return held('invalid');
  let state: CalendarClockState = { ...prev };
  if (obs.source === 'device') {
    if (obs.utcMs < prev.lastDeviceUtc - CLOCK_SKEW_TOLERANCE_MS) return held('rollback', { ...prev });
    state.lastDeviceUtc = Math.max(prev.lastDeviceUtc, obs.utcMs);
  } else if (obs.source === 'signed') {
    if (!obs.signed || obs.signed.t !== obs.utcMs) return held('invalid');
    if (!prev.lastSigned || obs.signed.t > prev.lastSigned.t) state.lastSigned = obs.signed;
  } else return held('invalid');
  if (inst.day < 1) return { state, advanced: false, held: 'preLaunch' };
  const day = Math.max(prev.day, inst.day);
  const week = Math.max(prev.week, inst.week);
  const advanced = day > prev.day || week > prev.week;
  state = { ...state, day, week };
  return { state, advanced, held: null };
}

// ─────────────────────────────────────────── World calendar (sim-side reducer; journaled command) ───────────────────────────────────────────

/** Payload of the journaled `calendar` command the game dispatches when the regional day/week advances (or on load). */
export interface CalendarCommand {
  regionId: CalendarRegionId;
  day: number;
  week: number;
  season: Season;
  /** Open event ids (sorted, unique), computed by the game layer with `activeEventsAt`. */
  events: string[];
  /** Last verified signed time backing this day, or null (device clock only). */
  signed: SignedTime | null;
}

/** Saved in the world (`WorldState.regionCalendar`, optional: absent = never received; old saves need no migration). */
export interface WorldCalendarState {
  v: 1;
  regionId: CalendarRegionId;
  day: number;
  week: number;
  season: Season;
  events: string[];
  /** Signed time stored with the save, so a load can re-verify it (tampered ⇒ treated as unverified, never rewound). */
  signed: SignedTime | null;
  /** Sim tick the command was applied at. */
  appliedTick: number;
}

const SEASONS: readonly Season[] = ['autumn', 'winter', 'spring', 'summer'];

/**
 * Apply a calendar command (deterministic: same state + same command ⇒ same result). Refused (state unchanged,
 * ok false): malformed, day or week going backwards, or a region switch to an earlier day. Re-applying the same
 * command is a no-op. Plain JSON in and out.
 */
export function reduceWorldCalendar(prev: WorldCalendarState | null | undefined, cmd: unknown, tick: number): { next: WorldCalendarState | null; ok: boolean; reason?: string } {
  const keep = (reason: string) => ({ next: prev ?? null, ok: false, reason });
  if (!isInt(tick) || tick < 0) return keep('invalid');
  if (!cmd || typeof cmd !== 'object') return keep('invalid');
  const c = cmd as Partial<CalendarCommand>;
  if (typeof c.regionId !== 'string' || c.regionId.length === 0 || c.regionId.length > 48) return keep('invalid');
  if (!isInt(c.day) || c.day < 1 || !isInt(c.week) || c.week < 1 || c.week > c.day) return keep('invalid');
  if (typeof c.season !== 'string' || !SEASONS.includes(c.season as Season)) return keep('invalid');
  if (!Array.isArray(c.events) || c.events.length > 32 || c.events.some((e) => typeof e !== 'string' || e.length === 0 || e.length > 48)) return keep('invalid');
  const events = [...new Set(c.events as string[])].sort();
  const signed = c.signed === null || c.signed === undefined ? null : parseSignedTime(c.signed);
  if (c.signed && !signed) return keep('invalid');
  if (prev) {
    if (c.day < prev.day || c.week < prev.week) return keep('regress');
    if (c.day === prev.day && c.week === prev.week && c.regionId === prev.regionId && c.season === prev.season && events.join('|') === prev.events.join('|')) {
      const better = signed && (!prev.signed || signed.t > prev.signed.t);
      return better ? { next: { ...prev, signed }, ok: true } : { next: prev, ok: true, reason: 'same' };
    }
  }
  return { next: { v: 1, regionId: c.regionId, day: c.day, week: c.week, season: c.season as Season, events, signed, appliedTick: tick }, ok: true };
}
