/** Fail-closed admission of frozen reports. Cardinality alone is not coverage or provenance. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { GATE_LOOKS, GATE_OPTIONS, GATE_PARTS, gateScenarios } from './gate';
import { lookName, type Evaluation } from './audit';
import { PREMIUM_BODY_IDS, premiumGlbPath } from '../../src/shared/premiumBodies';

const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const canonical = (s: string) => s.replace(/^\/?assets\//, '');
const ordered = (values: unknown[]) => values.map((v) => JSON.stringify(v)).sort();
export function sameDistinctSet(actual: unknown[], expected: unknown[], label: string): void {
  if (!Array.isArray(actual) || new Set(ordered(actual)).size !== actual.length || JSON.stringify(ordered(actual)) !== JSON.stringify(ordered(expected))) {
    throw new Error(`duplicate or mismatched ${label}`);
  }
}
export function validateRawCoverage(report: any, raw: Evaluation[], keys: string[], looks: string[]): void {
  sameDistinctSet(report.scenarios, keys, 'scenario coverage');
  sameDistinctSet(report.looks.map(lookName), looks, 'look coverage');
  const expected = keys.flatMap((key) => looks.map((look) => `${key}|${look}`));
  sameDistinctSet(raw.map((e) => `${e.key}|${e.look}`), expected, 'raw evaluation coverage');
  if (report.evaluated !== expected.length) throw new Error('incomplete measurement count');
  const reconstructed = [];
  for (const e of raw) {
    if (!Array.isArray(e.times) || e.times.length !== GATE_OPTIONS.times || e.times.some((t) => !Number.isFinite(t) || t < 0) ||
        !Array.isArray(e.checks) || !e.checks.length || new Set(e.checks.map((c) => c.name)).size !== e.checks.length) throw new Error('invalid raw samples');
    for (const c of e.checks) {
      if (c.name.startsWith('error') || !Number.isFinite(c.value) || !Number.isFinite(c.t) || !e.times.includes(c.t)) throw new Error('invalid raw check');
      if (c.name.startsWith('pen:') && c.value > 15) reconstructed.push({ key: e.key, look: e.look, check: c.name, measuredMm: c.value, detail: c.detail, t: c.t });
    }
  }
  sameDistinctSet(report.failures, reconstructed, 'failures versus raw evaluations');
}

export function validateBaselineFiles(files: string[]): any[] {
  if (files.length !== 4) throw new Error('requires four complete partitions');
  const reports = files.map((file) => JSON.parse(readFileSync(file, 'utf8')));
  sameDistinctSet(reports.map((r) => r.part), GATE_PARTS, 'partition coverage');
  const source = reports[0].source;
  if (!/^[a-f0-9]{40}$/.test(source)) throw new Error('missing immutable source identity');
  const blobs = new Map<string, Buffer>();
  const blob = (path: string): Buffer => {
    if (!blobs.has(path)) blobs.set(path, execFileSync('git', ['show', `${source}:${path}`], { maxBuffer: 64 * 1024 * 1024 }));
    return blobs.get(path)!;
  };
  // Current enumeration may be used only when its content and scenario source match the declared frozen capture.
  execFileSync('git', ['diff', '--exit-code', source, '--', 'src/render', 'src/sim', 'src/shared'], { stdio: 'pipe' });
  if (sha(readFileSync('tools/clip-audit/scenarios.ts', 'utf8').replace(/\r\n/g, '\n')) !== sha(blob('tools/clip-audit/scenarios.ts'))) throw new Error('enumerator differs from capture source');
  const requiredHarness = ['scenarios.ts', 'rigs.ts', 'audit.ts', 'gate.ts', 'detect.ts', 'geometry.ts', 'recordBaseline.ts'];
  const requiredAssets = ['models/characters/zombie.glb', 'models/characters/cast/mascot.glb', 'manifest.cast.json', 'manifest.premium.json',
    ...PREMIUM_BODY_IDS.flatMap((id) => [premiumGlbPath(id, 'high'), premiumGlbPath(id, 'low')])];
  for (let i = 0; i < reports.length; i++) {
    const r = reports[i];
    if (r.source !== source || JSON.stringify(r.options) !== JSON.stringify(GATE_OPTIONS)) throw new Error('mixed source or sampling options');
    if (!r.harness || !r.assets) throw new Error('missing digest maps');
    sameDistinctSet(Object.keys(r.harness), requiredHarness, 'harness digest coverage');
    for (const name of requiredHarness) if (r.harness[name] !== sha(blob(`tools/clip-audit/${name}`))) throw new Error(`harness digest mismatch: ${name}`);
    const assets = new Map<string, string>();
    for (const [path, digest] of Object.entries(r.assets)) {
      const name = canonical(path);
      if (!/^(models\/[\w/.-]+\.glb|manifest\.[\w.-]+\.json)$/.test(name) || name.includes('..')) throw new Error('invalid asset path');
      if (assets.has(name) && assets.get(name) !== digest) throw new Error('conflicting asset digest');
      assets.set(name, String(digest));
      if (digest !== sha(blob(`public/assets/${name}`))) throw new Error(`asset digest mismatch: ${name}`);
    }
    for (const name of requiredAssets) if (!assets.has(name)) throw new Error(`missing asset digest: ${name}`);
    const text = readFileSync(`${files[i]}.jsonl`, 'utf8');
    const raw = text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Evaluation);
    validateRawCoverage(r, raw, gateScenarios(r.part).map((s) => s.key), GATE_LOOKS.map(lookName));
    r.rawSha256 = sha(text);
  }
  return reports;
}
