import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ErrorRing, buildDiagnostics, describeError, type DiagnosticsInput } from '../../../src/game/diagnostics';
import { GAME_TITLE, GAME_VERSION } from '../../../src/game/version';
import { DEFAULT_SETTINGS } from '../../../src/game/contracts';
import { fatalMessage, isBenignError } from '../../../src/game/fatal';

describe('version', () => {
  it('GAME_VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8')) as { version: string; productName?: string };
    expect(GAME_VERSION).toBe(pkg.version);
    expect(GAME_TITLE).toBe(pkg.productName);
  });
});

describe('ErrorRing', () => {
  it('keeps the newest N and counts all', () => {
    const r = new ErrorRing(3, () => 0);
    for (let i = 0; i < 10; i++) r.push(`w${i}`, new Error(`e${i}`));
    expect(r.list().map((e) => e.message)).toEqual(['e7', 'e8', 'e9']);
    expect(r.count).toBe(10);
  });
  it('truncates huge messages and keeps a short stack', () => {
    const r = new ErrorRing(3, () => 0);
    const e = r.push('x'.repeat(500), new Error('m'.repeat(5000)));
    expect(e.where.length).toBe(80);
    expect(e.message.length).toBe(500);
    expect(e.stack!.split('\n').length).toBeLessThanOrEqual(8);
  });
});

describe('describeError', () => {
  it.each([
    [new Error('boom'), 'boom'],
    [new TypeError(''), 'TypeError'],
    ['plain', 'plain'],
    [{ message: 'obj' }, 'obj'],
    [{ code: 7 }, '{"code":7}'],
    [42, '42'],
    [null, 'null'],
    [undefined, 'undefined'],
  ])('%s', (input, out) => expect(describeError(input)).toBe(out));
  it('handles circular objects', () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    expect(() => describeError(o)).not.toThrow();
  });
});

describe('buildDiagnostics', () => {
  const input = (over: Partial<DiagnosticsInput> = {}): DiagnosticsInput => ({
    userAgent: () => 'UA/1.0',
    platform: () => 'win32 1.0.0',
    screen: () => 'game',
    mode: () => 'live',
    speed: () => '1',
    fps: () => 59.6,
    renderer: () => ({ quality: 'high' }),
    sim: () => ({ tick: 1234, time: 'day 2 Tue 9:00 AM', agents: 5 }),
    faults: () => [{ tick: 10, where: 'system:decay', message: 'NaN need' }],
    errors: () => [{ at: 0, where: 'ui', message: 'oops', stack: 'Error: oops\n  at a\n  at b' }],
    settings: () => DEFAULT_SETTINGS,
    storage: () => ({ backend: 'indexeddb' }),
    loop: () => ({ ticks: 99 }),
    wallNow: () => Date.UTC(2026, 10, 5),
    ...over,
  });

  it('includes version, UA, renderer fps, sim tick/day, agents, faults, errors and settings', () => {
    const s = buildDiagnostics(input());
    for (const needle of [GAME_VERSION, 'UA/1.0', 'win32', 'FPS: 60', 'tick: 1234', 'day 2', 'agents: 5', 'system:decay', 'oops', '"quality":"auto"', 'indexeddb', 'ticks: 99']) {
      expect(s).toContain(needle);
    }
  });

  it('never throws even when every probe throws', () => {
    const boom = () => {
      throw new Error('x');
    };
    const s = buildDiagnostics({
      userAgent: boom,
      platform: boom,
      screen: boom,
      mode: boom,
      speed: boom,
      fps: boom,
      renderer: boom,
      sim: boom,
      faults: boom,
      errors: boom,
      settings: boom,
      storage: boom,
      loop: boom,
      wallNow: boom,
    } as unknown as DiagnosticsInput);
    expect(s).toContain(GAME_VERSION);
    expect(s).toContain('(none)');
  });

  it('caps faults/errors to the newest 20', () => {
    const faults = Array.from({ length: 50 }, (_, i) => ({ tick: i, where: `w${i}`, message: 'm' }));
    const s = buildDiagnostics(input({ faults: () => faults }));
    expect(s).toContain('w49');
    expect(s).not.toContain('w29:');
  });
});

describe('fatal error filtering', () => {
  it('benign browser noise is ignored', () => {
    expect(isBenignError('ResizeObserver loop limit exceeded')).toBe(true);
    expect(isBenignError('ResizeObserver loop completed with undelivered notifications.')).toBe(true);
    expect(isBenignError('Script error.')).toBe(true);
    expect(isBenignError('TypeError: x is undefined', 'chrome-extension://abc/content.js')).toBe(true);
    expect(isBenignError('TypeError: x is undefined', 'http://localhost/assets/index.js')).toBe(false);
  });
  it('fatal message is player-facing and bounded', () => {
    const m = fatalMessage(new Error('z'.repeat(1000)));
    expect(m.startsWith('Something went wrong')).toBe(true);
    expect(m.length).toBeLessThan(400);
  });
});
