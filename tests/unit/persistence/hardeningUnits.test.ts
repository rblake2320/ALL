/**
 * Unit-level adversarial checks for the hardening primitives:
 *  - Electron backend probing tolerates a transient failure (an antivirus scan of the saves folder at
 *    startup must not silently move the whole session's saves into the browser profile's IndexedDB);
 *  - SlotQueue's coalesce policy and SaveManager's coalesceSaveRequests (strongest lock policy wins,
 *    imports never merged, playMinutes not lost);
 *  - canonicalJson dropKeys, parseJsonRaw, stripReservedKeys (deep, iterative, pollution-free);
 *  - ProfileStore never writes a record it could not read back (depth beyond the decoder's cap).
 */
import { describe, expect, it } from 'vitest';
import type { NativeBridge } from '../../../src/persistence/contracts';
import { createElectronBackend } from '../../../src/persistence/backends/electron';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { SlotQueue } from '../../../src/persistence/locks';
import { coalesceSaveRequests } from '../../../src/persistence/saveManager';
import { MAX_JSON_DEPTH, RESERVED_KEYS, parseJsonRaw, sanitizeParse, stripReservedKeys } from '../../../src/persistence/sanitize';
import { createProfileStore } from '../../../src/persistence';
import { silentLogger } from './fixtures';

function bridgeWith(list: (prefix: string) => Promise<string[]>): NativeBridge {
  const fail = async () => {
    throw new Error('[io] not used');
  };
  return {
    platform: 'win32',
    version: '1.0.0',
    storage: { read: fail, write: fail, remove: fail, list, quota: async () => null },
    setFullscreen: async () => undefined,
    isFullscreen: async () => false,
    quit: () => undefined,
    openSavesFolder: async () => undefined,
  };
}

describe('Electron backend probe', () => {
  it('a transient failure at startup is retried (the desktop store is still chosen)', async () => {
    let calls = 0;
    const b = createElectronBackend(
      bridgeWith(async () => {
        if (++calls <= 2) throw new Error('[busy] The file is busy (EBUSY)');
        return [];
      }),
    );
    expect(await b.available()).toBe(true);
    expect(calls).toBe(3);
  });

  it('a permanent failure gives up within ~1 s; outside Electron it answers at once', async () => {
    const t0 = Date.now();
    const b = createElectronBackend(
      bridgeWith(async () => {
        throw new Error('[io] saves folder unavailable');
      }),
    );
    expect(await b.available()).toBe(false);
    expect(Date.now() - t0).toBeLessThan(2000);
    const t1 = Date.now();
    expect(await createElectronBackend(null).available()).toBe(false);
    expect(Date.now() - t1).toBeLessThan(50);
  });
});

describe('coalescing policy', () => {
  it('SlotQueue: a coalesce function returning null queues the newer save separately, in order', async () => {
    const ran: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const q = new SlotQueue<string, string>(
      async (a) => {
        if (a === 'first') await gate;
        ran.push(a);
        return a;
      },
      () => 'error',
      (pending, next) => (next.startsWith('import') || pending.startsWith('import') ? null : next),
    );
    const p1 = q.save('first');
    await new Promise((r) => setTimeout(r, 1)); // 'first' is running
    const p2 = q.save('second');
    const p3 = q.save('import-file');
    const p4 = q.save('third'); // may not merge into the import either
    release();
    expect(await Promise.all([p1, p2, p3, p4])).toEqual(['first', 'second', 'import-file', 'third']);
    expect(ran).toEqual(['first', 'second', 'import-file', 'third']);
  });

  it('coalesceSaveRequests keeps the strongest lock policy and the known play time; imports never merge', () => {
    const base = { id: 's', name: 'n', payloadText: '{}', meta: { householdName: 'h', memberNames: [], day: 1, timeLabel: '', funds: 0, lotValue: 0, thumbnail: null } };
    const manual = { ...base, autosave: false, waitForLock: true, playMinutes: 42, createdAt: null, createOnly: false };
    const auto = { ...base, payloadText: '{"a":1}', autosave: true, waitForLock: false, playMinutes: null, createdAt: null, createOnly: false };
    const merged = coalesceSaveRequests(manual, auto);
    expect(merged).not.toBeNull();
    expect(merged!.payloadText).toBe('{"a":1}'); // latest world
    expect(merged!.waitForLock).toBe(true); // a manual save never degrades to fail-fast
    expect(merged!.playMinutes).toBe(42);
    expect(coalesceSaveRequests(auto, { ...auto, playMinutes: 7 })!.waitForLock).toBe(false);
    expect(coalesceSaveRequests(manual, { ...auto, createOnly: true })).toBeNull();
    expect(coalesceSaveRequests({ ...manual, createdAt: '2026-01-01T00:00:00.000Z' }, auto)).toBeNull();
  });
});

describe('reserved-key primitives', () => {
  it('canonicalJson dropKeys leaves reserved keys out everywhere and reports each path', () => {
    const v = JSON.parse('{"a":{"__proto__":1,"b":[{"constructor":2,"c":3}]},"prototype":4,"z":5}') as unknown;
    const paths: string[] = [];
    expect(canonicalJson(v, { dropKeys: RESERVED_KEYS, onDroppedKey: (p) => paths.push(p) })).toBe('{"a":{"b":[{"c":3}]},"z":5}');
    expect(paths.sort()).toEqual(['$.a.__proto__', '$.a.b[0].constructor', '$.prototype']);
  });

  it('parseJsonRaw keeps every key as a plain own property (no setter runs) and enforces the caps', () => {
    const v = parseJsonRaw('{"__proto__":{"polluted":true},"x":1}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(v, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(() => parseJsonRaw('['.repeat(MAX_JSON_DEPTH + 1) + ']'.repeat(MAX_JSON_DEPTH + 1))).toThrow(/nesting/);
    expect(() => parseJsonRaw('{"a":1}', { maxChars: 3 })).toThrow(/limit/);
    expect(() => parseJsonRaw('{"a":')).toThrow();
  });

  it('stripReservedKeys removes them at any depth without recursion and matches sanitizeParse', () => {
    let deep = '{"__proto__":1,"v":0}';
    for (let i = 0; i < 5000; i++) deep = `{"constructor":${i},"n":[${deep}]}`;
    const raw = JSON.parse(deep) as unknown; // 10k levels: a recursive walk would overflow the stack
    expect(stripReservedKeys(raw)).toBe(5001);
    let node = raw as Record<string, unknown>;
    let levels = 0;
    for (;;) {
      expect(Object.keys(node).some((k) => RESERVED_KEYS.has(k))).toBe(false);
      const next = (node.n as unknown[] | undefined)?.[0];
      if (!next) break;
      node = next as Record<string, unknown>;
      levels++;
    }
    expect(levels).toBe(5000);
    const text = '{"a":[{"__proto__":{"x":1},"k":{"prototype":2,"ok":true}}],"constructor":"c"}';
    const stripped = parseJsonRaw(text);
    stripReservedKeys(stripped);
    expect(stripped).toEqual(sanitizeParse(text));
  });
});

describe('ProfileStore self-check', () => {
  it('a value nested beyond the decoder cap is refused BEFORE writing; the stored record survives', async () => {
    const backend = createMemoryBackend();
    const p = createProfileStore({ backend, logger: silentLogger });
    await p.save('settings', { ok: 1 });
    let deep: unknown = 1;
    for (let i = 0; i < MAX_JSON_DEPTH + 5; i++) deep = { d: deep };
    await expect(p.save('settings', deep)).rejects.toThrow(/invalid|deeper/i);
    expect(await createProfileStore({ backend, logger: silentLogger }).load('settings', { ok: 0 })).toEqual({ ok: 1 });
  });
});
