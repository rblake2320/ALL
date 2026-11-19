/**
 * D-069 shared regional calendar (src/shared/calendar.ts): civil-date math, regional day/week/season/events, region
 * assignment, signed time, the monotonic clock guard and the deterministic world reducer. Adversarial: DST gaps and
 * overlaps, a midnight that does not exist, a skipped calendar day, the date line, leap days, launch-day edges,
 * NaN / garbage everywhere. The launch instant used here is a TEST value; the shipped config stays null.
 */
import { generateKeyPairSync, sign as edSign, verify as edVerify, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CALENDAR_EVENTS,
  CALENDAR_REGIONS,
  CLOCK_SKEW_TOLERANCE_MS,
  LAUNCH_EPOCH_UTC,
  activeEventsAt,
  advanceClock,
  base64UrlToBytes,
  calendarAt,
  civilDayNumber,
  clockChanged,
  daysInMonth,
  isLeapYear,
  isoWeekdayOf,
  localDateTimeIn,
  parseSignedTime,
  reduceWorldCalendar,
  regionForZone,
  seasonOf,
  signedTimeMessage,
  verifySignedTime,
  zoneOffsetMinutes,
  type CalendarClockState,
  type CalendarCommand,
  type CalendarConfig,
  type CalendarEventDef,
  type CalendarRegionDef,
  type WorldCalendarState,
} from '../../../src/shared/calendar';

const U = (iso: string) => Date.parse(iso);
/** TEST launch: Monday 2027-03-01 17:00 UTC (not a real launch date; LAUNCH_EPOCH_UTC stays null). */
const L = U('2027-03-01T17:00:00Z');
const extra: CalendarRegionDef[] = [
  { id: 'utc', zone: 'UTC', hemisphere: 'north', aliases: [] },
  { id: 'kiri', zone: 'Pacific/Kiritimati', hemisphere: 'north', aliases: [] },
  { id: 'pago', zone: 'Pacific/Pago_Pago', hemisphere: 'south', aliases: [] },
  { id: 'apia', zone: 'Pacific/Apia', hemisphere: 'south', aliases: [] },
];
const CFG: CalendarConfig = { launchEpochUtc: L, regions: [...CALENDAR_REGIONS, ...extra] };
const day = (region: string, iso: string) => calendarAt(CFG, region, U(iso))!.day;
const week = (region: string, iso: string) => calendarAt(CFG, region, U(iso))!.week;
const dn = (y: number, m: number, d: number) => civilDayNumber(y, m, d)!;

describe('civil-date math', () => {
  it('day numbers, leap years and weekdays', () => {
    expect(civilDayNumber(1970, 1, 1)).toBe(0);
    expect(civilDayNumber(2000, 1, 1)).toBe(10957);
    expect(isoWeekdayOf(0)).toBe(4); // Thursday
    expect(isoWeekdayOf(dn(2027, 3, 1))).toBe(1); // Monday
    expect(isoWeekdayOf(-1)).toBe(3);
    expect(dn(2028, 3, 1) - dn(2028, 2, 28)).toBe(2);
    expect(dn(2027, 3, 1) - dn(2027, 2, 28)).toBe(1);
    expect([2000, 2024, 2028].map(isLeapYear)).toEqual([true, true, true]);
    expect([1900, 2100, 2027].map(isLeapYear)).toEqual([false, false, false]);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2027, 2)).toBe(28);
  });

  it('refuses impossible and garbage dates', () => {
    for (const [y, m, d] of [[2027, 2, 29], [2100, 2, 29], [2027, 13, 1], [2027, 0, 1], [2027, 4, 31], [2027, 1, 0], [0, 1, 1], [10000, 1, 1], [2027.5, 1, 1], [NaN, 1, 1], [2027, 1, Infinity]])
      expect(civilDayNumber(y, m, d)).toBeNull();
    expect(civilDayNumber(2000, 2, 29)).not.toBeNull();
    expect(daysInMonth(2027, 13)).toBe(0);
  });
});

describe('localDateTimeIn / zoneOffsetMinutes', () => {
  it('reads the local date in a zone and refuses garbage', () => {
    expect(localDateTimeIn('Asia/Tokyo', L)).toMatchObject({ y: 2027, m: 3, d: 2, hour: 2, minute: 0, isoWeekday: 2 });
    expect(zoneOffsetMinutes('Asia/Tokyo', L)).toBe(540);
    expect(zoneOffsetMinutes('Asia/Kathmandu', L)).toBe(345);
    for (const t of [NaN, Infinity, -Infinity, -1, 1e20, '5' as unknown as number]) expect(localDateTimeIn('UTC', t)).toBeNull();
    for (const z of ['Mars/Olympus', '', 'x'.repeat(65), 42 as unknown as string]) expect(localDateTimeIn(z, L)).toBeNull();
  });

  it('DST spring-forward and fall-back keep one calendar date (New York 2027)', () => {
    const before = localDateTimeIn('America/New_York', U('2027-03-14T06:59:00Z'))!;
    const after = localDateTimeIn('America/New_York', U('2027-03-14T07:00:00Z'))!;
    expect([before.d, before.hour]).toEqual([14, 1]);
    expect([after.d, after.hour]).toEqual([14, 3]); // 02:xx does not exist
    expect(day('americas-east', '2027-03-14T06:59:00Z')).toBe(day('americas-east', '2027-03-14T07:00:00Z'));
    // fall back: 01:30 happens twice, same day; the day lasts 25 h
    expect(day('americas-east', '2027-11-07T05:30:00Z')).toBe(day('americas-east', '2027-11-07T06:30:00Z'));
    expect(day('americas-east', '2027-11-08T04:59:00Z')).toBe(day('americas-east', '2027-11-07T04:00:00Z'));
    expect(day('americas-east', '2027-11-08T05:00:00Z')).toBe(day('americas-east', '2027-11-07T04:00:00Z') + 1);
  });

  it('a local midnight that does not exist (São Paulo, 2018-11-04 00:00 → 01:00)', () => {
    expect(localDateTimeIn('America/Sao_Paulo', U('2018-11-04T02:59:00Z'))).toMatchObject({ m: 11, d: 3, hour: 23, minute: 59 });
    expect(localDateTimeIn('America/Sao_Paulo', U('2018-11-04T03:00:00Z'))).toMatchObject({ m: 11, d: 4, hour: 1, minute: 0 });
  });
});

describe('calendarAt: launch-day edges, regions, rollovers', () => {
  it('the shipped launch date is a placeholder (null) and the calendar is then off', () => {
    expect(LAUNCH_EPOCH_UTC).toBeNull();
    expect(calendarAt({ launchEpochUtc: LAUNCH_EPOCH_UTC, regions: CALENDAR_REGIONS }, 'europe-west', L)).toBeNull();
  });

  it('Day 1 = the launch instant’s local date in each region', () => {
    expect(day('utc', '2027-03-01T17:00:00Z')).toBe(1);
    expect(day('utc', '2027-03-01T00:00:00Z')).toBe(1); // same local date, before the instant
    expect(day('utc', '2027-02-28T23:59:59.999Z')).toBe(0); // pre-launch
    expect(day('utc', '2027-03-02T00:00:00Z')).toBe(2);
    // Tokyo: launch is 02:00 on Mar 2 local, so Mar 1 local is pre-launch there
    expect(day('asia-east', '2027-03-01T14:59:59Z')).toBe(0);
    expect(day('asia-east', '2027-03-01T15:00:00Z')).toBe(1);
    // Los Angeles: launch 09:00 Mar 1 local
    expect(day('americas-west', '2027-03-02T07:59:00Z')).toBe(1);
    expect(day('americas-west', '2027-03-02T08:00:00Z')).toBe(2);
  });

  it('two clients in one region on one real date get the same day and the same events', () => {
    const a = calendarAt(CFG, 'europe-west', U('2027-10-31T00:00:00Z'))!; // 00:00 GMT (BST ended Oct 31 01:00 UTC)
    const b = calendarAt(CFG, 'europe-west', U('2027-10-31T23:59:59Z'))!;
    expect(a.day).toBe(b.day);
    expect(activeEventsAt(a, 'north')).toEqual(activeEventsAt(b, 'north'));
    expect(activeEventsAt(a, 'north')).toContain('halloween');
    // device zones differ (Dublin alias vs London canonical) → same region → same answer
    expect(regionForZone('Europe/Dublin', L)!.regionId).toBe(regionForZone('Europe/London', L)!.regionId);
  });

  it('different regions roll over at their own local midnight / Monday 04:00', () => {
    // 02:00 UTC Jun 1: London is Jun 1 03:00 (BST), New York is May 31 22:00
    expect(day('europe-west', '2027-06-01T02:00:00Z')).toBe(day('americas-east', '2027-06-01T02:00:00Z') + 1);
    // weekly rollover (UTC region): Monday Mar 8 04:00
    expect(week('utc', '2027-03-08T03:59:00Z')).toBe(1);
    expect(week('utc', '2027-03-08T04:00:00Z')).toBe(2);
    // Tokyo rolls over at Monday 04:00 JST = Sunday 19:00 UTC
    expect(week('asia-east', '2027-03-07T18:59:00Z')).toBe(1);
    expect(week('asia-east', '2027-03-07T19:00:00Z')).toBe(2);
    expect(week('utc', '2027-03-07T19:30:00Z')).toBe(1);
    expect(week('utc', '2027-03-01T17:00:00Z')).toBe(1);
    expect(week('utc', '2027-03-01T05:00:00Z')).toBe(1); // launch day before the instant: still week 1, never 0
  });

  it('the date line: Kiritimati (+14) and Pago Pago (−11) can be two calendar dates apart', () => {
    const t = '2027-06-01T10:30:00Z';
    expect(localDateTimeIn('Pacific/Kiritimati', U(t))).toMatchObject({ m: 6, d: 2 });
    expect(localDateTimeIn('Pacific/Pago_Pago', U(t))).toMatchObject({ m: 5, d: 31 });
    expect(day('kiri', t)).toBe(dn(2027, 6, 2) - dn(2027, 3, 2) + 1);
    expect(day('pago', t)).toBe(dn(2027, 5, 31) - dn(2027, 3, 1) + 1);
  });

  it('a skipped calendar date (Samoa, 2011-12-30) advances the day by 2, never backwards', () => {
    const cfg: CalendarConfig = { launchEpochUtc: U('2011-12-01T00:00:00Z'), regions: extra };
    const a = calendarAt(cfg, 'apia', U('2011-12-30T09:59:00Z'))!;
    const b = calendarAt(cfg, 'apia', U('2011-12-30T10:00:00Z'))!;
    expect(a.local).toMatchObject({ m: 12, d: 29, hour: 23 });
    expect(b.local).toMatchObject({ m: 12, d: 31, hour: 0 });
    expect(b.day - a.day).toBe(2);
  });

  it('the leap day counts as a day', () => {
    expect(day('utc', '2028-03-01T12:00:00Z') - day('utc', '2028-02-28T12:00:00Z')).toBe(2);
    expect(day('utc', '2027-03-01T18:00:00Z') - day('utc', '2027-02-28T18:00:00Z')).toBe(1);
  });

  it('refuses garbage', () => {
    expect(calendarAt(CFG, 'nowhere', L)).toBeNull();
    expect(calendarAt(CFG, 'utc', NaN)).toBeNull();
    expect(calendarAt({ launchEpochUtc: NaN, regions: extra }, 'utc', L)).toBeNull();
    expect(calendarAt({ launchEpochUtc: L, regions: [{ id: 'bad', zone: 'Mars/Olympus', hemisphere: 'north', aliases: [] }] }, 'bad', L)).toBeNull();
    expect(calendarAt(null as unknown as CalendarConfig, 'utc', L)).toBeNull();
  });
});

describe('seasons and events', () => {
  it('meteorological seasons flip by hemisphere', () => {
    expect(seasonOf(10, 'north')).toBe('autumn');
    expect(seasonOf(10, 'south')).toBe('spring');
    expect(seasonOf(1, 'north')).toBe('winter');
    expect(seasonOf(1, 'south')).toBe('summer');
    expect(seasonOf(13, 'north')).toBeNull();
    expect(seasonOf(5, 'east' as never)).toBeNull();
    expect(calendarAt(CFG, 'oceania-east', U('2027-07-01T00:00:00Z'))!.season).toBe('winter');
  });

  it('windows: open on the date, for durationDays, across the new year; Feb 29 only in leap years; none pre-launch', () => {
    const at = (iso: string) => calendarAt(CFG, 'utc', U(iso));
    expect(activeEventsAt(at('2027-10-30T12:00:00Z'), 'north')).not.toContain('halloween');
    expect(activeEventsAt(at('2027-10-31T00:00:00Z'), 'north')).toContain('halloween');
    expect(activeEventsAt(at('2027-11-06T23:59:00Z'), 'north')).toContain('halloween');
    expect(activeEventsAt(at('2027-11-07T00:00:00Z'), 'north')).not.toContain('halloween');
    expect(activeEventsAt(at('2027-03-07T12:00:00Z'), 'north')).toContain('launch_week');
    expect(activeEventsAt(at('2027-03-08T12:00:00Z'), 'north')).not.toContain('launch_week');
    expect(activeEventsAt(at('2027-12-21T12:00:00Z'), 'north')).toContain('long_night');
    expect(activeEventsAt(at('2027-12-21T12:00:00Z'), 'south')).not.toContain('long_night');
    const custom: CalendarEventDef[] = [
      { id: 'yearEnd', when: { kind: 'monthDay', month: 12, day: 28 }, durationDays: 7 },
      { id: 'leap', when: { kind: 'monthDay', month: 2, day: 29 } },
      { id: 'bad', when: { kind: 'monthDay', month: 13, day: 1 } },
    ];
    expect(activeEventsAt(at('2028-01-03T12:00:00Z'), 'north', custom)).toEqual(['yearEnd']);
    expect(activeEventsAt(at('2028-01-04T12:00:00Z'), 'north', custom)).toEqual([]);
    expect(activeEventsAt(at('2028-02-29T12:00:00Z'), 'north', custom)).toEqual(['leap']);
    expect(activeEventsAt(at('2029-03-01T12:00:00Z'), 'north', custom)).toEqual([]);
    expect(activeEventsAt(at('2027-02-20T12:00:00Z'), 'north')).toEqual([]); // pre-launch
    expect(activeEventsAt(null, 'north')).toEqual([]);
    const ids = activeEventsAt(at('2027-10-31T12:00:00Z'), 'north', [...CALENDAR_EVENTS, ...CALENDAR_EVENTS]);
    expect(ids).toEqual([...new Set(ids)].sort());
  });
});

describe('regionForZone (no location data: device zone or override only)', () => {
  it('override, exact, alias, nearest standard offset, hemisphere tie-break', () => {
    expect(regionForZone('Asia/Tokyo', L)).toEqual({ regionId: 'asia-east', how: 'exact' });
    expect(regionForZone('Europe/Paris', L)).toEqual({ regionId: 'europe-central', how: 'alias' });
    expect(regionForZone('Asia/Tokyo', L, CALENDAR_REGIONS, 'europe-west')).toEqual({ regionId: 'europe-west', how: 'override' });
    expect(regionForZone('Asia/Tokyo', L, CALENDAR_REGIONS, 'atlantis')).toEqual({ regionId: 'asia-east', how: 'exact' });
    expect(regionForZone('America/Halifax', L)).toEqual({ regionId: 'americas-east', how: 'offset' }); // −4: NY (north) beats São Paulo (south)
    expect(regionForZone('Australia/Hobart', L)).toEqual({ regionId: 'oceania-east', how: 'offset' });
    expect(regionForZone('Asia/Kathmandu', L)).toEqual({ regionId: 'asia-south', how: 'offset' });
    for (const z of ['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/St_Johns', 'Asia/Kabul']) expect(regionForZone(z, L)).not.toBeNull();
  });

  it('garbage → null (no guessing from anything else)', () => {
    expect(regionForZone('Mars/Olympus', L)).toBeNull();
    expect(regionForZone('', L)).toBeNull();
    expect(regionForZone('America/Halifax', NaN)).toBeNull();
    expect(regionForZone('Asia/Tokyo', L, [])).toBeNull();
    expect(regionForZone(undefined as unknown as string, L)).toBeNull();
  });
});

describe('signed time (Ed25519)', () => {
  const kp = generateKeyPairSync('ed25519');
  const other = generateKeyPairSync('ed25519');
  const keys: Record<string, KeyObject> = { k1: kp.publicKey };
  const verify = (kid: string, msg: Uint8Array, sig: Uint8Array) => !!keys[kid] && edVerify(null, msg, keys[kid], sig);
  const b64u = (b: Buffer) => b.toString('base64url');
  const mk = (t: number, kid = 'k1', priv = kp.privateKey) => ({ v: 1, t, kid, sig: b64u(edSign(null, signedTimeMessage(t, kid), priv)) });

  it('accepts a genuine response', async () => {
    const r = mk(L);
    expect(r.sig).toHaveLength(86);
    expect(await verifySignedTime(r, verify)).toEqual(r);
    expect(base64UrlToBytes(r.sig)!.length).toBe(64);
  });

  it('rejects a tampered time, key id, signature, a foreign key and malformed bodies', async () => {
    const r = mk(L);
    expect(await verifySignedTime({ ...r, t: r.t + 1 }, verify)).toBeNull();
    expect(await verifySignedTime({ ...r, t: r.t + 86400000 }, verify)).toBeNull();
    expect(await verifySignedTime({ ...r, kid: 'k2' }, verify)).toBeNull();
    const flipped = Buffer.from(base64UrlToBytes(r.sig)!);
    flipped[10] ^= 1;
    expect(await verifySignedTime({ ...r, sig: b64u(flipped) }, verify)).toBeNull();
    expect(await verifySignedTime(mk(L, 'k1', other.privateKey), verify)).toBeNull();
    for (const bad of [null, undefined, 'x', [], {}, { ...r, extra: 1 }, { ...r, v: 2 }, { ...r, t: 1.5 }, { ...r, t: -1 }, { ...r, t: NaN }, { ...r, sig: r.sig.slice(1) }, { ...r, sig: r.sig.replace(/.$/, '=') }, { ...r, kid: 'K 1' }])
      expect(await verifySignedTime(bad, verify)).toBeNull();
    expect(await verifySignedTime(r, () => { throw new Error('boom'); })).toBeNull();
    expect(await verifySignedTime(r, null as never)).toBeNull();
    expect(parseSignedTime(r)).toEqual(r);
  });

  it('clock-change detection', () => {
    expect(clockChanged(60000, 60000)).toBe(false);
    expect(clockChanged(60000 + 119000, 60000)).toBe(false);
    expect(clockChanged(60000 + 121000, 60000)).toBe(true);
    expect(clockChanged(-3600000, 60000)).toBe(true);
    expect(clockChanged(NaN, 1)).toBe(true);
  });
});

describe('advanceClock (monotonic guard)', () => {
  const base: CalendarClockState = { regionId: 'utc', day: 1, week: 1, lastDeviceUtc: L, lastSigned: null };
  const H = 3600000;

  it('offline play advances with the device clock; a rollback holds; nothing ever goes backwards', () => {
    const a = advanceClock(base, { utcMs: L + 72 * H, source: 'device' }, CFG);
    expect(a.state.day).toBe(4);
    expect(a.advanced).toBe(true);
    const b = advanceClock(a.state, { utcMs: L + 24 * H, source: 'device' }, CFG);
    expect(b.held).toBe('rollback');
    expect(b.state.day).toBe(4);
    const c = advanceClock(b.state, { utcMs: a.state.lastDeviceUtc - CLOCK_SKEW_TOLERANCE_MS + 1000, source: 'device' }, CFG);
    expect(c.held).toBeNull(); // within skew tolerance: not a rollback
    expect(c.state.day).toBe(4);
    expect(advanceClock(c.state, { utcMs: L + 500 * H, source: 'device', jumped: true }, CFG).held).toBe('jump');
    expect(advanceClock(base, { utcMs: L - 48 * H, source: 'device' }, CFG).held).toBe('rollback');
  });

  it('a verified signed time is accepted but never rewinds a reached day', async () => {
    const ahead = advanceClock(base, { utcMs: L + 240 * H, source: 'device' }, CFG).state; // device clock 10 days ahead
    const st = { v: 1 as const, t: L + 24 * H, kid: 'k1', sig: 'A'.repeat(86) };
    const r = advanceClock(ahead, { utcMs: st.t, source: 'signed', signed: st }, CFG);
    expect(r.state.day).toBe(ahead.day);
    expect(r.state.lastSigned).toEqual(st);
    expect(advanceClock(base, { utcMs: st.t + 1, source: 'signed', signed: st }, CFG).held).toBe('invalid');
  });

  it('property: random device clocks (rollbacks, jumps, garbage) never lower day or week', () => {
    let s = base;
    let seed = 7;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 2000; i++) {
      const r = rnd();
      const t = r < 0.05 ? NaN : L + (rnd() * 400 - 50) * H;
      const next = advanceClock(s, { utcMs: t, source: 'device', jumped: rnd() < 0.05 }, CFG).state;
      expect(next.day).toBeGreaterThanOrEqual(s.day);
      expect(next.week).toBeGreaterThanOrEqual(s.week);
      s = next;
    }
  });

  it('pre-launch and garbage hold', () => {
    const pre: CalendarClockState = { ...base, day: 0, week: 0, lastDeviceUtc: L - 72 * H };
    expect(advanceClock(pre, { utcMs: L - 48 * H, source: 'device' }, CFG).held).toBe('preLaunch');
    expect(advanceClock(base, { utcMs: Infinity, source: 'device' }, CFG).held).toBe('invalid');
    expect(advanceClock(base, { utcMs: L, source: 'radio' as never }, CFG).held).toBe('invalid');
    expect(advanceClock(base, null as never, CFG).held).toBe('invalid');
  });
});

describe('reduceWorldCalendar (journaled command; deterministic replay)', () => {
  const cmd = (over: Partial<CalendarCommand> = {}): CalendarCommand => ({ regionId: 'europe-west', day: 10, week: 2, season: 'spring', events: ['launch_week'], signed: null, ...over });

  it('applies, ignores repeats, refuses regressions and garbage', () => {
    const a = reduceWorldCalendar(null, cmd(), 100);
    expect(a.ok).toBe(true);
    expect(a.next).toEqual({ v: 1, regionId: 'europe-west', day: 10, week: 2, season: 'spring', events: ['launch_week'], signed: null, appliedTick: 100 });
    expect(reduceWorldCalendar(a.next, cmd(), 200)).toEqual({ next: a.next, ok: true, reason: 'same' });
    expect(reduceWorldCalendar(a.next, cmd({ day: 9 }), 200)).toMatchObject({ next: a.next, ok: false, reason: 'regress' });
    expect(reduceWorldCalendar(a.next, cmd({ day: 9, regionId: 'americas-east' }), 200).ok).toBe(false); // region switch may not rewind
    expect(reduceWorldCalendar(a.next, cmd({ day: 10, regionId: 'americas-east' }), 200).ok).toBe(true);
    const garbage: unknown[] = [null, 'x', {}, cmd({ day: NaN }), cmd({ day: 0 }), cmd({ week: 11 }), cmd({ season: 'monsoon' as never }), cmd({ events: 'x' as never }), cmd({ events: [''] }), cmd({ regionId: '' }), cmd({ signed: { v: 1, t: 1, kid: 'k1', sig: 'short' } as never })];
    for (const g of garbage) expect(reduceWorldCalendar(a.next, g, 300)).toMatchObject({ next: a.next, ok: false });
    expect(reduceWorldCalendar(a.next, cmd(), -1).ok).toBe(false);
    expect(reduceWorldCalendar(null, cmd({ events: ['b', 'a', 'b'] }), 0).next!.events).toEqual(['a', 'b']);
  });

  it('replaying the same command stream gives byte-identical state (JSON round trip stable)', () => {
    const stream: { c: unknown; t: number }[] = [
      { c: cmd({ day: 1, week: 1, events: ['launch_week'] }), t: 0 },
      { c: cmd({ day: 3, week: 1, events: ['launch_week'] }), t: 4000 },
      { c: cmd({ day: 2, week: 1 }), t: 5000 }, // late duplicate from a rolled-back clock: refused
      { c: cmd({ day: 8, week: 2, events: [] }), t: 9000 },
      { c: { garbage: true }, t: 9100 },
      { c: cmd({ day: 245, week: 36, season: 'autumn', events: ['halloween'] }), t: 20000 },
    ];
    const run = () => stream.reduce<WorldCalendarState | null>((s, e) => reduceWorldCalendar(s, JSON.parse(JSON.stringify(e.c)), e.t).next, null);
    const a = run();
    expect(run()).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(a).toMatchObject({ day: 245, events: ['halloween'], appliedTick: 20000 });
  });
});
