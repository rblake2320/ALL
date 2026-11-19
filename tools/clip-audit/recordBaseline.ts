/** Explicit measurement only: never updates an allow-list or reports the product as passing. Run on a frozen pin. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { evaluate, type Evaluation } from './audit';
import { GATE_LOOKS, GATE_OPTIONS, GATE_PARTS, gateScenarios, type GatePart } from './gate';
import { factoryLoadedPaths, factoryWarnings } from './rigs';
import { assetPath } from './assets';
import { THRESHOLDS } from './thresholds';

const part = process.argv[2] as GatePart;
const output = process.argv[3];
if (!GATE_PARTS.includes(part) || !output) throw new Error('usage: recordBaseline.ts slotsA|slotsB|social|floor <fresh-output.json>');
if (existsSync(output) || existsSync(`${output}.jsonl`)) throw new Error(`refusing to overwrite evidence: ${output}`);
const source = process.env.CLIP_SOURCE_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(source)) throw new Error('source must be an immutable full commit');
const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const harnessFiles = ['scenarios.ts', 'rigs.ts', 'audit.ts', 'gate.ts', 'detect.ts', 'geometry.ts', 'recordBaseline.ts'];
const harness = Object.fromEntries(harnessFiles.map((f) => [f, digest(resolve('tools/clip-audit', f))]));
mkdirSync(dirname(resolve(output)), { recursive: true });
const scenarios = gateScenarios(part);
const failures: { key: string; look: string; check: string; measuredMm: number; detail: string; t: number }[] = [];
let count = 0;
for (const look of GATE_LOOKS) for (const scenario of scenarios) {
  const e: Evaluation = await evaluate(scenario, look, GATE_OPTIONS);
  if (!e.checks.length || !e.times.length || e.checks.some((c) => c.name === 'error' || !Number.isFinite(c.value))) {
    throw new Error(`invalid measurement ${scenario.key} ${e.look}`);
  }
  appendFileSync(`${output}.jsonl`, JSON.stringify(e) + '\n');
  for (const c of e.checks) if (c.name.startsWith('pen:') && c.value > THRESHOLDS.penFailMm) {
    failures.push({ key: e.key, look: e.look, check: c.name, measuredMm: c.value, detail: c.detail, t: c.t });
  }
  count++;
  if (count % 20 === 0) console.log(`[baseline:${part}] measured ${count}/${scenarios.length * GATE_LOOKS.length}`);
  await new Promise<void>((r) => setImmediate(r));
}
if (factoryWarnings().length) throw new Error(`loader warnings: ${factoryWarnings().join('; ')}`);
const assetFiles = [...new Set(['models/characters/zombie.glb', 'manifest.cast.json', 'manifest.premium.json',
  ...factoryLoadedPaths('high'), ...factoryLoadedPaths('low')])].sort();
const assets = Object.fromEntries(assetFiles.map((f) => [f, digest(assetPath(f))]));
writeFileSync(output, JSON.stringify({ source, harness, assets, part, options: GATE_OPTIONS, evaluated: count,
  looks: GATE_LOOKS, scenarios: scenarios.map((s) => s.key), failures }, null, 2) + '\n');
console.log(`[baseline:${part}] MEASURED ${count}, observed ${failures.length} penetrations >15 mm; no product PASS verdict`);
