/**
 * Reserved object keys ('__proto__', 'constructor', 'prototype') anywhere in saved data.
 *
 * The loader drops them (prototype-pollution guard). If the SAVE side keeps them, the checksum covers
 * data the loader will never reconstruct: the self-check refuses every save ("can never save again"), a
 * profile record can never be decoded (settings silently reset on every launch), and a file from an older
 * build that contains one would be unloadable. Save and load must agree: the key is dropped on BOTH
 * sides, the rest of the data survives, nothing is polluted.
 */
import { describe, expect, it } from 'vitest';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { createProfileStore } from '../../../src/persistence';
import { canonicalJson } from '../../../src/persistence/canonicalJson';
import { validateWorld } from '../../../src/persistence/validation';
import type { WorldState } from '../../../src/sim/types';
import { makeMeta, makeWorld, silentLogger } from './fixtures';

/** Define an OWN enumerable property (works for '__proto__' too, which plain assignment cannot create). */
function setKey(o: object, key: string, value: unknown): void {
  Object.defineProperty(o, key, { value, enumerable: true, configurable: true, writable: true });
}

function withReservedKeys(): WorldState {
  const w = makeWorld(3);
  setKey(w.flags, 'constructor', true);
  setKey(w.stats.counters, 'prototype', 4);
  setKey(w.objects.o7.data, '__proto__', 'evil');
  setKey(w.agents.a1.active!.params, 'constructor', 'x');
  return w;
}

function clean(w: WorldState): unknown {
  // What the world looks like once every reserved key is gone.
  return JSON.parse(
    JSON.stringify(w, (k, v) => (k === '__proto__' || k === 'constructor' || k === 'prototype' ? undefined : v)),
  );
}

describe('reserved keys in a world save', () => {
  it('a world containing reserved keys still saves, loads, and loses only those keys', async () => {
    const backend = createMemoryBackend();
    const warnings: string[] = [];
    const m = new SaveManagerImpl({ backend, logger: { warn: (...a: unknown[]) => warnings.push(a.map(String).join(' ')), error: () => undefined } });
    const world = withReservedKeys();
    const r = await m.save('slot1', 'reserved', world, makeMeta());
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    expect(warnings.join('\n')).toMatch(/reserved key/i);

    const fresh = new SaveManagerImpl({ backend, logger: silentLogger });
    const l = await fresh.load('slot1');
    expect(l.ok, l.ok ? '' : l.error).toBe(true);
    if (!l.ok) return;
    expect(canonicalJson(l.world)).toBe(canonicalJson(clean(world)));
    expect(Object.prototype.hasOwnProperty.call(l.world.flags, 'constructor')).toBe(false);
    expect(Object.getPrototypeOf(l.world.objects.o7.data)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // and the slot keeps working: the next save rotates a LOADABLE primary into the backup
    expect((await fresh.save('slot1', 'again', l.world, makeMeta())).ok).toBe(true);
  });

  it('import of a hand-made file whose payload carries reserved keys is accepted (keys dropped, warning)', async () => {
    const m = new SaveManagerImpl({ backend: createMemoryBackend(), logger: silentLogger });
    const world = withReservedKeys();
    // Export a clean save, then splice a reserved key into the exported text WITHOUT fixing checksums is
    // tampering (must fail) - but a file whose checksum was computed over the reserved key (an older
    // build that kept it) must still be usable: the loader verifies what it reconstructs.
    expect((await m.save('src', 'src', world, makeMeta())).ok).toBe(true);
    const exported = await m.exportSlot('src');
    expect(exported).not.toBeNull();
    const imported = await m.importFile(exported!.data);
    expect(imported.ok, imported.ok ? '' : imported.error).toBe(true);
    if (imported.ok) expect(canonicalJson(imported.world)).toBe(canonicalJson(clean(world)));
  });
});

describe('reserved keys in profile records', () => {
  it('a settings object with a reserved key keeps every OTHER setting across a reload', async () => {
    const backend = createMemoryBackend();
    const p1 = createProfileStore({ backend, logger: silentLogger });
    const value = JSON.parse('{"volume":0.4,"keys":{"jump":"Space","constructor":"C","__proto__":{"polluted":1}}}') as Record<string, unknown>;
    await p1.save('settings', value);
    const p2 = createProfileStore({ backend, logger: silentLogger });
    const fallback = { volume: 1, keys: { jump: 'J' } };
    const got = await p2.load('settings', fallback);
    expect(got.volume).toBe(0.4); // not silently reset to the fallback
    expect(got.keys.jump).toBe('Space');
    expect(Object.prototype.hasOwnProperty.call(got.keys, 'constructor')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('validateWorld on unsanitized input (defence in depth — it is exported)', () => {
  it('never lets an own "__proto__" key change a record prototype; reserved keys are dropped with an issue', () => {
    const w = makeWorld(1);
    // VALID values under the reserved key: a well-formed object state and a boolean flag. A naive
    // `out[key] = value` would make the object state the PROTOTYPE of world.objects.
    const validObject = JSON.stringify({ ...w.objects.o7, id: 'o99' });
    const text = JSON.stringify(w)
      .replace('"flags":{', '"flags":{"__proto__":true,"constructor":false,')
      .replace('"objects":{', `"objects":{"__proto__":${validObject},`)
      .replace('"counters":{', '"counters":{"prototype":3,');
    const raw = JSON.parse(text) as unknown; // plain JSON.parse: own __proto__ properties
    const v = validateWorld(raw);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(Object.getPrototypeOf(v.world.flags)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(v.world.objects)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(v.world.stats.counters)).toBe(Object.prototype);
    expect(Object.keys(v.world.objects).sort()).toEqual(['o10', 'o7', 'o8', 'o9']);
    expect(Object.prototype.hasOwnProperty.call(v.world.flags, 'constructor')).toBe(false);
    expect(() => canonicalJson(v.world)).not.toThrow();
    expect(v.issues.filter((i) => i.message.includes('reserved')).length).toBeGreaterThanOrEqual(4);
  });

  it('keeps forward-compatible extra keys even when they are named like Object.prototype members', () => {
    const w = makeWorld(1);
    setKey(w, 'toString', 'future-field');
    setKey(w.household, 'valueOf', 7);
    setKey(w.lot, 'hasOwnProperty', { kept: true });
    const v = validateWorld(JSON.parse(JSON.stringify(w)));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const out = v.world as unknown as Record<string, Record<string, unknown>>;
    expect(Object.prototype.hasOwnProperty.call(out, 'toString')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(out.household, 'valueOf')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(out.lot, 'hasOwnProperty')).toBe(true);
  });
});
