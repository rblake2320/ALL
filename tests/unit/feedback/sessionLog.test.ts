/**
 * W-117 session recorder + summary (pure): ring bound and eviction (aggregates survive it), stall detection on fake
 * timers (59 s no stall, 61 s stall, paused time never counts), time-to-first-action set once, non-productive click
 * counting, strict storage round trip (tampered strings / kinds / numbers are dropped), summary layout.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_EVENTS_MAX, STALL_MS, SessionRecorder, fromStored, newSessionId, sessionKey, toStored, type SessionHeader } from '../../../src/feedback/sessionLog';
import { clock, summarizeSession } from '../../../src/feedback/sessionSummary';

const HEADER: Partial<SessionHeader> = {
  id: 'S-ABCDEFGH',
  date: '2026-11-06',
  build: 'abc1234',
  version: '1.0.0',
  bracket: '13plus',
  platform: { segment: 'desktop', orient: 'landscape', viewport: '1280x720', dpr: 1, shell: 'web', touch: false },
  graphics: { setting: 'auto', level: 'medium', gpuKind: 'integrated', ceiling: 'high' },
};

afterEach(() => {
  vi.useRealTimers();
});

describe('ring buffer', () => {
  it('keeps at most SESSION_EVENTS_MAX raw events, evicts the oldest first and counts them; aggregates survive eviction', () => {
    let now = 0;
    const r = new SessionRecorder(HEADER, () => now);
    r.click('live', false, 'live:noSelection'); // the very first event, evicted later
    for (let i = 0; i < SESSION_EVENTS_MAX + 250; i++) {
      now += 5;
      r.push('cmd', `queue:ix_${i}`);
    }
    const log = r.toLog();
    expect(log.events).toHaveLength(SESSION_EVENTS_MAX);
    expect(log.dropped).toBe(251);
    expect(log.events[0].a).toBe('queue:ix_250'); // oldest kept = 251st pushed
    expect(log.events[log.events.length - 1].a).toBe(`queue:ix_${SESSION_EVENTS_MAX + 249}`);
    expect(log.agg.clicksNone).toMatchObject({ n: 1, by: { 'live:noSelection': 1 } }); // still in the summary
    expect(summarizeSession(log)).toContain('non-productive clicks: 1 (live:noSelection 1)');
    expect(summarizeSession(log)).toContain(`${log.dropped} older evicted`);
  });

  it('merges consecutive noise events (sim types, errors, keys) into one with a count', () => {
    const r = new SessionRecorder(HEADER, () => 0);
    for (let i = 0; i < 5; i++) r.notable('notify.info');
    r.trail('error', 'audio.sfx');
    r.trail('error', 'audio.sfx');
    const ev = r.toLog().events.filter((e) => e.k !== 'start');
    expect(ev).toEqual([
      { t: 0, k: 'sim', a: 'notify.info', c: 5 },
      { t: 0, k: 'error', a: 'audio.sfx', c: 2 },
    ]);
    expect(r.toLog().agg.notable['notify.info']).toBe(5);
  });

  it('a small capacity bound is honoured exactly', () => {
    const r = new SessionRecorder(HEADER, () => 0, 10);
    for (let i = 0; i < 37; i++) r.push('mode', i % 2 ? 'buy' : 'live');
    expect(r.toLog().events).toHaveLength(10);
    expect(r.toLog().dropped).toBe(27);
  });
});

describe('stall detection (fake timers)', () => {
  function rig() {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const r = new SessionRecorder(HEADER, () => Date.now());
    let last = Date.now();
    /** Advance real time in 1 s frames; `eligible` = in game and unpaused. */
    const run = (ms: number, eligible: boolean) => {
      for (let left = ms; left > 0; left -= 1000) {
        vi.advanceTimersByTime(Math.min(1000, left));
        const now = Date.now();
        r.idleTick(now - last, eligible);
        last = now;
      }
    };
    return { r, run };
  }

  it('59 s without input: no stall', () => {
    const { r, run } = rig();
    r.input();
    run(59_000, true);
    expect(r.stalling).toBe(false);
    expect(r.toLog().agg.stalls).toEqual([]);
  });

  it('61 s without input: one stall from the last input, ended by the next input with its idle time', () => {
    const { r, run } = rig();
    run(2_000, true);
    r.input(); // t = 2 s
    run(61_000, true);
    expect(r.stalling).toBe(true);
    const s = r.toLog().agg.stalls;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ from: 2_000, at: 62_000, to: null });
    run(4_000, true);
    r.input();
    const done = r.toLog().agg.stalls[0];
    expect(done).toMatchObject({ from: 2_000, to: 67_000, idle: 65_000 });
    expect(r.toLog().events.map((e) => e.k)).toEqual(['stall.start', 'stall.end']);
    expect(summarizeSession(r.toLog())).toContain('stalls (≥ 60 s no input, in game, unpaused): 1');
  });

  it('paused time never counts: 40 s + 120 s paused + 19 s = no stall; one more unpaused second = stall', () => {
    const { r, run } = rig();
    r.input();
    run(40_000, true);
    run(120_000, false); // paused / dialog open / menu screen
    run(19_000, true);
    expect(r.stalling).toBe(false);
    run(1_000, true);
    expect(r.stalling).toBe(true);
    expect(STALL_MS).toBe(60_000);
  });

  it('a huge frame gap (background tab) counts at most 5 s', () => {
    const r = new SessionRecorder(HEADER, () => 0);
    r.idleTick(3_600_000, true);
    expect(r.stalling).toBe(false);
  });
});

describe('first action + non-productive clicks', () => {
  it('time to first action is set once, by the first SUCCESSFUL queue or buy (not refused ones, not other commands)', () => {
    let now = 1000;
    const r = new SessionRecorder(HEADER, () => now);
    now = 5_000;
    r.command({ type: 'cancel', ok: true });
    r.command({ type: 'queue', ok: false, id: 'home_sleep' });
    r.command({ type: 'buy', ok: false, id: 'fridge_humming', fundsBefore: 100, fundsAfter: 100 });
    expect(r.toLog().firstAction).toBeNull();
    now = 12_345;
    r.command({ type: 'queue', ok: true, id: 'home_checkMail', target: 'mailbox_crooked' });
    now = 20_000;
    r.command({ type: 'buy', ok: true, id: 'fridge_humming', fundsBefore: 2500, fundsAfter: 2050 });
    const log = r.toLog();
    expect(log.firstAction).toEqual({ ms: 11_345, type: 'queue:home_checkMail' });
    expect(log.events.filter((e) => e.k === 'first')).toHaveLength(1);
    expect(log.agg.player).toEqual({ n: 1, total: 450, by: { fridge_humming: { n: 1, total: 450 } } });
    expect(summarizeSession(log)).toContain('time to first action: 0:11 (11345 ms) — queue:home_checkMail');
  });

  it('counts only non-productive clicks, by reason, with timestamps; productive clicks only reset the idle clock', () => {
    let now = 0;
    const r = new SessionRecorder(HEADER, () => now);
    for (let i = 0; i < 3; i++) {
      now += 1000;
      r.click('live', false, 'live:noSelection');
    }
    now += 1000;
    r.click('live', true);
    now += 1000;
    r.click('buy', false, 'buy:refused');
    r.click('locked', false, 'locked:ultra');
    const a = r.toLog().agg.clicksNone;
    expect(a.n).toBe(5);
    expect(a.by).toEqual({ 'live:noSelection': 3, 'buy:refused': 1, 'locked:ultra': 1 });
    expect(a.at).toEqual([1000, 2000, 3000, 5000, 5000]);
  });
});

describe('storage form', () => {
  it('round-trips exactly, and a tampered record loses only the bad parts (never a free-text string)', () => {
    let now = 0;
    const r = new SessionRecorder(HEADER, () => now);
    r.trail('screen', 'game');
    r.stepOn('act1_claim', 'act1', 0, 'mail', 1000);
    now = 9000;
    r.stepDone('act1_claim', 'mail', 1400);
    r.questDone('act1_claim', 20, 1400);
    r.hourSample(1440, 2500, 'hunger', 61.7);
    r.fps(58.6);
    const log = r.toLog();
    const stored = JSON.parse(JSON.stringify(toStored(log)));
    expect(fromStored(stored)).toEqual(log);
    stored.e.push([10, 'cmd', 'Mortimer Rotwell says hi!', null, null, null, null]); // bad alphabet
    stored.e.push([11, 'evil', 'x', null, null, null, null]); // unknown kind
    stored.e.push(['12', 'cmd', 'ok', null, null, null, null]); // bad time
    stored.header.build = 'mortimer@example.com';
    stored.funnel.push({ step: 'bad step!', quest: 'q', arc: 'a', on: 1 });
    stored.agg.notable['Hi Mortimer'] = 3;
    const back = fromStored(stored)!;
    expect(back.events).toEqual(log.events);
    expect(back.header.build).toBe('dev');
    expect(back.funnel).toEqual(log.funnel);
    expect(JSON.stringify(back)).not.toMatch(/Mortimer|example\.com/);
    expect(fromStored({ ...stored, format: 'other' })).toBeNull();
    expect(fromStored(null)).toBeNull();
    expect(fromStored({ ...stored, header: { ...stored.header, id: 'not-an-id' } })).toBeNull();
  });

  it('keys are reduced to the closed alphabet; session ids are random-format, not derived from anything', () => {
    expect(sessionKey('Hello <b>Mortimer</b>')).toBe('Hello__b_Mortimer__b_');
    expect(sessionKey({ a: 1 })).toBe('none');
    const words = [0x12345678, 0x9abcdef0];
    const id = newSessionId(() => words.shift() ?? 0);
    expect(id).toMatch(/^S-[0-9A-HJKMNP-TV-Z]{8}$/);
  });
});

describe('summary', () => {
  it('header, Act 1 funnel in order with reached-at / time in step, purchases, events, fps, raw lines', () => {
    let now = 0;
    const r = new SessionRecorder(HEADER, () => now);
    r.setWorld({ kind: 'new', lot: 'derelict', difficulty: 'normal', arc: 'act1' });
    r.questOn('act1_claim', 'act1');
    r.stepOn('act1_claim', 'act1', 0, 'mail', 0);
    now = 30_000;
    r.command({ type: 'queue', ok: true, id: 'home_checkMail', target: 'mailbox_crooked', g: 100 });
    now = 75_000;
    r.stepDone('act1_claim', 'mail', 300);
    r.questDone('act1_claim', 20, 300);
    r.questOn('act1_rest', 'act1');
    r.stepOn('act1_rest', 'act1', 0, 'sleep', 300);
    r.simSpend('groceries', 30, 400);
    r.autoInteraction('home_eatJerky', 400);
    r.notable('fx.fire', 500);
    r.fps(40);
    r.fps(60);
    now = 125_000;
    r.end('quit');
    const text = summarizeSession(r.toLog());
    const lines = text.split('\n');
    expect(lines[0]).toBe('AFTERLIFE LEASE — PLAYTEST SESSION LOG');
    expect(lines[1]).toBe('session S-ABCDEFGH · 2026-11-06 · build abc1234 · v1.0.0');
    expect(text).toContain('platform: desktop · landscape · 1280x720 @1x · web');
    expect(text).toContain('duration 2:05 · ended (quit)');
    expect(text).toContain('world: new · lot derelict · difficulty normal · arc act1');
    expect(text).toContain('ACT 1 FUNNEL (1/2 steps done)');
    const claim = lines.findIndex((l) => l.includes('act1_claim.mail'));
    const rest = lines.findIndex((l) => l.includes('act1_rest.sleep'));
    expect(claim).toBeGreaterThan(0);
    expect(rest).toBeGreaterThan(claim);
    expect(lines[claim]).toMatch(/1\s+act1_claim\.mail\s+0:00\s+1:15\s+1:15/);
    expect(lines[rest]).toMatch(/2\s+act1_rest\.sleep\s+1:15\s+— \(open\)/);
    expect(text).toContain('Bones awarded 20');
    expect(text).toContain('household, sim-side (autonomy, interaction costs, bills, theft): 1 · $30');
    expect(text).toContain('autonomous interactions completed: 1 (home_eatJerky 1)');
    expect(text).toContain('notable events: fx.fire 1');
    expect(text).toContain('fps: min 40 · avg 50 · max 60 (2 samples)');
    expect(text).toMatch(/\n0:30\.000\s+cmd queue:home_checkMail:mailbox_crooked @D1\/09:25/);
    expect(clock(3_725_000)).toBe('1:02:05');
  });
});
