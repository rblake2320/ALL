/**
 * Blender pipeline <-> TypeScript source-of-truth parity:
 *   - tools/blender/common/dims.py mirrors every DIM value of src/shared/dimensions.ts
 *   - tools/blender/common/catalog.py parses src/shared/catalog.ts identically (run with a system python3)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIM } from '../../../src/shared/dimensions';
import { ENV_MODELS, PHYSICAL_SPECS } from '../../../src/shared/catalog';

const ROOT = join(__dirname, '..', '..', '..');

function parseDimsPy(src: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of src.split('\n')) {
    const m = /^([A-Z][A-Z_]*)\s*=\s*(-?[0-9.]+)\s*$/.exec(line.trim());
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

describe('dims.py mirrors dimensions.ts', () => {
  const py = parseDimsPy(readFileSync(join(ROOT, 'tools', 'blender', 'common', 'dims.py'), 'utf8'));

  it('has every DIM key with an identical value', () => {
    for (const [k, v] of Object.entries(DIM)) {
      expect(py[k], `dims.py is missing ${k}`).toBeDefined();
      expect(py[k], k).toBe(v);
    }
  });

  it('defines no stale extra DIM-style constants', () => {
    const extra = Object.keys(py).filter((k) => !(k in DIM) && !['FRONT_Y', 'BACK_Y'].includes(k));
    expect(extra).toEqual([]);
  });

  it('the DIM dict lists the same keys as the module constants', () => {
    const src = readFileSync(join(ROOT, 'tools', 'blender', 'common', 'dims.py'), 'utf8');
    const dictKeys = [...src.matchAll(/^\s+'([A-Z_]+)':\s*([A-Z_]+),\s*$/gm)].map((m) => [m[1], m[2]]);
    expect(dictKeys.length).toBe(Object.keys(DIM).length);
    for (const [k, ref] of dictKeys) expect(k).toBe(ref);
  });
});

function havePython(): boolean {
  const r = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

describe.runIf(havePython())('catalog.py parses catalog.ts like TypeScript does', () => {
  const r = spawnSync('python3', [join(ROOT, 'tools', 'blender', 'common', 'catalog.py'), '--json'], { encoding: 'utf8' });
  const parsed = r.status === 0 ? (JSON.parse(r.stdout) as Record<string, {
    id: string; placement: string; category: string; w: number; d: number; height: number; dynamic_parts: string[];
    variants: string[]; needs_power: boolean; env: boolean; light_height: number | null;
    size: [number, number, number] | null;
  }>) : {};

  it('runs successfully', () => {
    expect(r.status, r.stderr).toBe(0);
  });

  it('finds every spec and env model', () => {
    const ids = [...PHYSICAL_SPECS.map((s) => s.id), ...ENV_MODELS.map((e) => e.id)];
    expect(Object.keys(parsed).sort()).toEqual(ids.sort());
  });

  it.each(PHYSICAL_SPECS.map((s) => [s.id, s] as const))('%s fields match', (id, s) => {
    const p = parsed[id];
    expect(p.placement).toBe(s.placement);
    expect(p.category).toBe(s.category);
    expect(p.w).toBe(s.footprint.w);
    expect(p.d).toBe(s.footprint.d);
    expect(p.height).toBeCloseTo(s.height, 9);
    expect(p.dynamic_parts).toEqual(s.dynamicParts ?? []);
    expect(p.variants).toEqual(s.variants ?? []);
    expect(p.needs_power).toBe(!!s.needsPower);
    expect(p.light_height).toBe(s.light ? s.light.height : null);
  });
});

describe.runIf(havePython())('catalog.py reads ENV_MODELS sizes (no duplicated size tables)', () => {
  const r = spawnSync('python3', [join(ROOT, 'tools', 'blender', 'common', 'catalog.py'), '--json'], { encoding: 'utf8' });
  const parsed = r.status === 0 ? (JSON.parse(r.stdout) as Record<string, { env: boolean; size: number[] | null; height: number }>) : {};

  it.each(ENV_MODELS.map((e) => [e.id, e] as const))('%s size matches the catalog', (id, e) => {
    const p = parsed[id];
    expect(p.env).toBe(true);
    expect(p.size).toEqual([e.size.w, e.size.d, e.size.h]);
    expect(p.height).toBe(e.size.h);
  });

  it('the validator and the runtime have no hand-copied ENV_DIMS tables left', () => {
    const validate = readFileSync(join(ROOT, 'tools', 'blender', 'objects', 'validate.py'), 'utf8');
    expect(validate).not.toMatch(/'env_house_a'\s*:\s*\(/);
    const specs = readFileSync(join(ROOT, 'src', 'render', 'models', 'specs.ts'), 'utf8');
    expect(specs).not.toMatch(/env_house_a:\s*\[/);
  });
});

/**
 * Byte-for-byte reproducibility of the Blender pipeline (spawns headless Blender: opt-in because it costs ~10-30 s of
 * CPU). Run with:  BLENDER_PYTHON=/home/user/.venvs/blender/bin/python npx vitest run tests/unit/models/pipeline.test.ts
 * The ids cover the former offenders (noisy Cycles AO bake + exporter vertex splits made them differ run to run).
 */
const BLENDER_PY = process.env.BLENDER_PYTHON ?? '';
describe.runIf(BLENDER_PY !== '' && existsSync(BLENDER_PY))('pipeline reproducibility (headless Blender)', () => {
  it('a fresh rebuild matches the committed GLBs and manifest sha256 exactly', () => {
    const ids = ['sofa_velvet', 'trash_lidded', 'tv_crt', 'item_bonepile', 'coffin_chillrest', 'env_tree_b', 'item_meal',
      'fridge_cryo', 'lantern_post'];
    const r = spawnSync(BLENDER_PY, [join(ROOT, 'tools', 'blender', 'objects', 'build_all.py'), '--verify', '--only', ids.join(',')],
      { encoding: 'utf8', timeout: 600000 });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout).toContain(`verify: ${ids.length}/${ids.length} reproducible`);
  }, 620000);
});

/**
 * Atomic publishing (opt-in, spawns headless Blender): build_all.py stages every GLB in a private directory and only
 * swaps files into the output when the WHOLE requested build succeeded, so a running dev server / renderer never sees
 * half-written GLBs or a manifest pointing at missing files. Exercised against a scratch --out tree, never public/.
 */
describe.runIf(BLENDER_PY !== '' && existsSync(BLENDER_PY))('pipeline atomic publish (headless Blender)', () => {
  it('publishes nothing when a builder crashes, nothing changes on a no-op rebuild, and leaves no staging dirs', () => {
    const harness = `
import sys, json, hashlib, tempfile, shutil
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(join(ROOT, 'tools', 'blender'))})
sys.path.insert(0, ${JSON.stringify(join(ROOT, 'tools', 'blender', 'objects'))})
import build_all
from objects import registry
out = Path(tempfile.mkdtemp(prefix='al-publish-test-'))
def snap():
    files = sorted((out / 'models' / 'objects').glob('*')) + [out / 'manifest.objects.json']
    return {f.name: (hashlib.sha256(f.read_bytes()).hexdigest(), f.stat().st_mtime_ns) for f in files if f.exists()}
res = {}
res['first'] = build_all.main(['--only', 'chair_creaky,item_dish', '--out', str(out)])
a = snap()
res['noop'] = build_all.main(['--only', 'chair_creaky,item_dish', '--out', str(out)])
res['noop_untouched'] = snap() == a
orig = registry.BUILDERS['item_dish']
def boom(m, spec): raise RuntimeError('simulated builder crash')
registry.BUILDERS['item_dish'] = boom
prev_chair = registry.BUILDERS['chair_creaky']
def chair2(m, spec):
    prev_chair(m, spec)
    from common import shapes as S
    m.add(S.box(0.1, 0.1, 0.1, 0.01, 1, base=(0, 0, 0)), 'Paint')
registry.BUILDERS['chair_creaky'] = chair2
res['crash'] = build_all.main(['--only', 'chair_creaky,item_dish', '--out', str(out)])
res['crash_untouched'] = snap() == a
res['leftovers'] = [p.name for p in out.rglob('.stage-*')] + [p.name for p in out.rglob('*.tmp*')]
res['manifest_ids'] = sorted(json.loads((out / 'manifest.objects.json').read_text())['objects'])
shutil.rmtree(out, ignore_errors=True)
print('RESULT ' + json.dumps(res))
`;
    const r = spawnSync(BLENDER_PY, ['-c', harness], { encoding: 'utf8', timeout: 300000 });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const line = r.stdout.split('\n').find((l) => l.startsWith('RESULT '));
    expect(line, r.stdout).toBeDefined();
    const res = JSON.parse(line!.slice(7)) as Record<string, unknown>;
    expect(res.first).toBe(0);
    expect(res.noop).toBe(0);
    expect(res.noop_untouched, 'identical rebuild must not touch any file (no watcher churn)').toBe(true);
    expect(res.crash, 'a crashing builder fails the run').toBe(1);
    expect(res.crash_untouched, 'nothing (not even the successfully rebuilt chair) is published on failure').toBe(true);
    expect(res.leftovers).toEqual([]);
    expect(res.manifest_ids).toEqual(['chair_creaky', 'item_dish']);
  }, 320000);
});
