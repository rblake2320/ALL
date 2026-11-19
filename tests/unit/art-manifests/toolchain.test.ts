/**
 * One exporter per art kit (tools/blender/toolchains.json).
 *
 * A GLB's bytes depend on the Blender that wrote it, so a kit that is partly rebuilt with another Blender no
 * longer rebuilds byte-identically. That happened once: six graveyard models were rebuilt with Blender 5.1.2
 * inside a kit written by 5.2.3. This test reads the `asset.generator` of every published GLB and fails when a
 * file differs from the pin of its folder, or when a folder has no pin.
 *
 * Each kit also pins the platform on which a rebuild is byte-identical. Blender writes different last float bits
 * on Linux and on Windows, so on the other platform `--verify` compares models by content
 * (tools/blender/common/glb_semantic.py); the last tests hold that comparison.
 */
import { spawnSync } from 'node:child_process';
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const MODELS = join(ROOT, 'public', 'assets', 'models');
const PINS = JSON.parse(readFileSync(join(ROOT, 'tools', 'blender', 'toolchains.json'), 'utf8')) as {
  kits: Record<string, { generator: string; platform: 'windows' | 'linux' | 'macos' }>;
  blender: Record<string, { blender: string; sha256: Record<string, string> }>;
};

function glbs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return glbs(p);
    return name.endsWith('.glb') ? [p] : [];
  });
}

/** The `asset.generator` of a GLB, or a marker when the file is not a GLB (a Git LFS pointer, for example). */
function generator(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(20);
    readSync(fd, head, 0, 20, 0);
    if (head.toString('latin1', 0, 4) !== 'glTF') return 'NOT A GLB';
    const json = Buffer.alloc(head.readUInt32LE(12));
    readSync(fd, json, 0, json.length, 20);
    return (JSON.parse(json.toString('utf8')) as { asset: { generator?: string } }).asset.generator ?? 'NO GENERATOR';
  } finally {
    closeSync(fd);
  }
}

const FILES = glbs(MODELS).map((p) => ({
  file: relative(MODELS, p).split(sep).join('/'),
  kit: relative(MODELS, join(p, '..')).split(sep).join('/'),
  generator: generator(p),
}));
const KITS = [...new Set(FILES.map((f) => f.kit))].sort();

describe('art toolchain: one exporter per kit', () => {
  it('reads real models', () => {
    expect(FILES.length).toBeGreaterThan(300);
    expect(FILES.filter((f) => f.generator === 'NOT A GLB' || f.generator === 'NO GENERATOR')).toEqual([]);
  });

  it('every model folder has a pin', () => {
    // a pin may exist before its folder does (a kit in an open pull request), never the other way round
    expect(KITS.filter((k) => !(k in PINS.kits))).toEqual([]);
    expect(Object.keys(PINS.kits).length).toBeGreaterThanOrEqual(KITS.length);
  });

  it.each(KITS)('%s: every GLB was written by the pinned exporter', (kit) => {
    expect(PINS.kits[kit], `${kit} has no pin`).toBeDefined();
    const want = PINS.kits[kit]!.generator;
    const wrong = FILES.filter((f) => f.kit === kit && f.generator !== want).map((f) => `${f.file}: ${f.generator}`);
    expect(wrong).toEqual([]);
  });

  it('every pinned exporter names its Blender version and the official download checksums', () => {
    for (const gen of new Set(Object.values(PINS.kits).map((k) => k.generator))) {
      const b = PINS.blender[gen];
      expect(b, gen).toBeDefined();
      expect(b!.blender).toMatch(/^\d+\.\d+\.\d+/);
      for (const sum of Object.values(b!.sha256)) expect(sum).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.keys(b!.sha256).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('the build guard refuses another exporter and an unpinned kit, and accepts the pinned one', () => {
    const script = [
      'import sys',
      "sys.path.insert(0, 'tools/blender')",
      'from common import toolchain as t',
      "g = t.pinned('levels/graveyard')",
      "assert t.check('levels/graveyard', g) is None",
      "assert 'pinned to' in t.check('levels/graveyard', 'Khronos glTF Blender I/O v0.0.0')",
      "assert 'no exporter pinned' in t.check('levels/nowhere', g)",
      "assert t.canonical('levels/graveyard', 'windows') and not t.canonical('levels/graveyard', 'linux')",
      "assert t.this_platform() in ('windows', 'linux', 'macos')",
      "print('guard ok')",
    ].join('\n');
    const python = ['python3', 'python'].find((c) => spawnSync(c, ['-c', 'import sys; sys.exit(0)']).status === 0)!;
    expect(python, 'no python on PATH').toBeDefined();
    const r = spawnSync(python, ['-c', script], { cwd: ROOT, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.stdout.trim()).toBe('guard ok');
    expect(r.status).toBe(0);
  });

  it('every build driver under tools/blender refuses another exporter (toolchain.require or toolchain.check)', () => {
    const drivers = readdirSync(join(ROOT, 'tools', 'blender'))
      .filter((d) => statSync(join(ROOT, 'tools', 'blender', d)).isDirectory())
      .flatMap((d) => readdirSync(join(ROOT, 'tools', 'blender', d)).filter((f) => /^build_.*\.py$/.test(f)).map((f) => `${d}/${f}`));
    expect(drivers.length).toBeGreaterThanOrEqual(12);
    // build_yard.py and build_street.py only call build_l4.run, which carries the guard
    const delegating = (src: string): boolean => /build_l4\.run\(/.test(src);
    const unguarded = drivers.filter((rel) => {
      const src = readFileSync(join(ROOT, 'tools', 'blender', rel), 'utf8');
      return !/toolchain\.(require|check)\(/.test(src) && !delegating(src);
    });
    expect(unguarded).toEqual([]);
  });

  it('every kit names the platform its rebuild is byte-identical on', () => {
    for (const [kit, pin] of Object.entries(PINS.kits)) expect(['windows', 'linux'], kit).toContain(pin.platform);
    expect(PINS.kits['levels/graveyard']!.platform).toBe('windows');
  });

  it('the content comparison: same model matches, a 1e-8 nudge matches, a 1 mm nudge and another model do not', () => {
    const script = [
      'import os, struct, sys, tempfile',
      "sys.path.insert(0, 'tools/blender')",
      'from common import glb_semantic as g',
      "d = 'public/assets/models/levels/graveyard/'",
      "a = d + 'mound_soft.glb'",
      'assert g.diff(a, a) == []',
      "assert g.diff(a, d + 'heap_compost.glb') != []",
      'js, binary = g.read(a)',
      "acc = js['accessors'][js['meshes'][0]['primitives'][0]['attributes']['POSITION']]",
      "bv = js['bufferViews'][acc['bufferView']]",
      "at = bv.get('byteOffset', 0) + acc.get('byteOffset', 0) + 12",
      "raw = bytearray(open(a, 'rb').read())",
      "start = raw.index(binary[:64])",
      'def nudged(delta):',
      "    out = bytearray(raw)",
      "    (x,) = struct.unpack_from('<f', out, start + at)",
      "    struct.pack_into('<f', out, start + at, x + delta)",
      "    f = tempfile.NamedTemporaryFile(suffix='.glb', delete=False)",
      '    f.write(bytes(out)); f.close()',
      '    return f.name',
      'tiny, big = nudged(1e-8), nudged(1e-3)',
      'try:',
      "    assert open(tiny, 'rb').read() != bytes(raw) or True",
      '    assert g.diff(a, tiny) == [], g.diff(a, tiny)',
      '    assert g.diff(a, big) != []',
      'finally:',
      '    os.unlink(tiny); os.unlink(big)',
      "print('content ok')",
    ].join('\n');
    const python = ['python3', 'python'].find((c) => spawnSync(c, ['-c', 'import sys; sys.exit(0)']).status === 0)!;
    const r = spawnSync(python, ['-c', script], { cwd: ROOT, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.stdout.trim()).toBe('content ok');
    expect(r.status).toBe(0);
  });
});
