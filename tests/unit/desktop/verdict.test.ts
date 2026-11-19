/**
 * Negative regressions for the desktop verification driver's verdict logic (tests/desktop/lib/verdict.mjs).
 * Each case is a false pass found in review of 9c31fd1: errors ignored by the verdict, a failed process query read
 * as "no processes", and a second instance that exits with an error counted as single-instance success.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs helper without type declarations
import { classifyErrors, isKnownMissing, queryLines, secondInstanceOk, verdict } from '../../desktop/lib/verdict.mjs';

const ok = [{ name: 'a', ok: true }];
const cast404 = { kind: 'response', url: 'app://game/assets/models/characters/cast/bride.glb', status: 404 };
const line404 = { kind: 'console', message: 'Failed to load resource: the server responded with a status of 404 (Not Found)' };

describe('desktop driver verdict', () => {
  it('one unexpected renderer error fails the run even when every check passed', () => {
    expect(verdict({ checks: ok, events: [{ kind: 'pageerror', message: 'boom' }] })).toMatchObject({ functional: true, clean: false, pass: false });
    expect(verdict({ checks: ok, events: [{ kind: 'console', message: 'TypeError: x is undefined' }] }).pass).toBe(false);
    expect(verdict({ checks: ok, events: [{ kind: 'requestfailed', url: 'app://game/assets/index.js', failure: 'net::ERR_FAILED' }] }).pass).toBe(false);
  });

  it('a 404 outside the cast allow-list fails; an allow-listed one is reported as known', () => {
    expect(verdict({ checks: ok, events: [{ kind: 'response', url: 'app://game/assets/models/objects/fridge.glb', status: 404 }] }).pass).toBe(false);
    const v = verdict({ checks: ok, events: [cast404, line404] });
    expect(v.pass).toBe(true);
    expect(v.known).toHaveLength(2);
    expect(v.unexpected).toEqual([]);
  });

  it('an aborted request is known only for an allow-listed URL', () => {
    const aborted = (url: string) => ({ kind: 'requestfailed', url, failure: 'net::ERR_ABORTED' });
    expect(verdict({ checks: ok, events: [cast404, aborted(cast404.url)] }).pass).toBe(true);
    expect(verdict({ checks: ok, events: [aborted('app://game/assets/models/objects/fridge.glb')] }).pass).toBe(false);
    expect(verdict({ checks: ok, events: [aborted('app://game/index.html')] }).pass).toBe(false);
  });

  it('a transport failure on a cast URL is NOT waived: it needs ERR_ABORTED and a recorded 404 for the same URL', () => {
    const url = 'app://game/assets/manifest.cast.json';
    expect(verdict({ checks: ok, events: [{ kind: 'requestfailed', url, failure: 'net::ERR_CONNECTION_RESET' }] }).pass).toBe(false);
    expect(verdict({ checks: ok, events: [{ kind: 'requestfailed', url, failure: 'net::ERR_ABORTED' }] }).pass).toBe(false); // no 404 seen
    expect(verdict({ checks: ok, events: [{ kind: 'response', url, status: 404 }, { kind: 'requestfailed', url, failure: 'net::ERR_CONNECTION_RESET' }] }).pass).toBe(false);
    expect(verdict({ checks: ok, events: [cast404, { kind: 'requestfailed', url, failure: 'net::ERR_ABORTED' }] }).pass).toBe(false); // 404 was for another URL
    expect(verdict({ checks: ok, events: [{ kind: 'requestfailed', url, failure: 'net::ERR_ABORTED' }, { kind: 'response', url, status: 404 }] }).pass).toBe(true); // order does not matter
  });

  it('a 404 console line without a matching allow-listed response is unexpected', () => {
    expect(classifyErrors([line404]).unexpected).toHaveLength(1);
    expect(classifyErrors([cast404, line404, line404]).unexpected).toHaveLength(1);
  });

  it('the allow-list is anchored (no traversal, no other folders, no other statuses)', () => {
    expect(isKnownMissing('app://game/assets/models/characters/cast/../zombie.glb')).toBe(false);
    expect(isKnownMissing('https://evil.example/app://game/assets/manifest.cast.json')).toBe(false);
    expect(isKnownMissing('app://game/assets/models/characters/zombie.glb')).toBe(false);
    expect(verdict({ checks: ok, events: [{ ...cast404, status: 500 }] }).pass).toBe(false);
  });

  it('a failed or empty check list never passes', () => {
    expect(verdict({ checks: [], events: [] }).pass).toBe(false);
    expect(verdict({ checks: [{ name: 'a', ok: false }], events: [] }).pass).toBe(false);
    expect(verdict({ checks: [{ name: 'a', ok: 'yes' }], events: [] }).pass).toBe(false);
  });

  it('a failed process query throws instead of reading as "no processes"', () => {
    expect(() => queryLines({ status: 1, stdout: '', stderr: '' }, 'pids')).toThrow(/exit 1/);
    expect(() => queryLines({ status: 0, stdout: '', stderr: 'Get-Process : access denied' }, 'pids')).toThrow(/access denied/);
    expect(() => queryLines({ status: null, stdout: '', stderr: '', error: new Error('spawn powershell.exe ENOENT') }, 'pids')).toThrow(/ENOENT/);
    expect(queryLines({ status: 0, stdout: '', stderr: '' }, 'pids')).toEqual([]);
    expect(queryLines({ status: 0, stdout: '12\r\n34\r\n', stderr: '' }, 'pids')).toEqual(['12', '34']);
  });

  it('a second instance must exit with code 0', () => {
    expect(secondInstanceOk(0)).toBe(true);
    expect(secondInstanceOk(1)).toBe(false);
    expect(secondInstanceOk(null)).toBe(false);
    expect(secondInstanceOk('still running after 15 s')).toBe(false);
  });
});
