/**
 * CLIP-AUDIT command line (Node, no browser except `shot`):
 *
 *   npx vite-node tools/clip-audit/run.ts matrix  [--bodies all|classic,walker,..] [--heights 0,0.5,1] [--times 3]
 *                                                 [--filter <regex on scenario key>] [--shard i/n] [--rot 0]
 *                                                 [--spacing 0.03] [--one-way]
 *       -> dev/out/clip-audit/results/<run>-<i>of<n>.jsonl (one Evaluation per line; resumable: done keys skipped)
 *   npx vite-node tools/clip-audit/run.ts static   -> dev/out/clip-audit/static.json (footprint / wall / surface / pets)
 *                                                 [--partner <body>]  (pair scenarios only, partner B = that body)
 *   npx vite-node tools/clip-audit/run.ts reach    -> dev/out/clip-audit/reach.json (per body x clip extents around the root)
 *                                                    + doorway.json (walking half-width vs the door opening)
 *   npx vite-node tools/clip-audit/run.ts summary  -> dev/out/clip-audit/summary.json + summary.md
 *   npx vite-node tools/clip-audit/run.ts shot --key <scenario key> --look <body@hH> [--t <s>] [--rot 0]
 *       -> dev/out/clip-audit/shots/<name>.png (the measured geometry, deepest point marked)
 *
 * Deterministic: same assets + code -> byte-identical results (no randomness, fixed sample times, sorted output).
 *
 * Exit code: `matrix` and `summary` exit 1 when any penetration check (pen:*) FAILs (> 15 mm) outside the allow-list
 * (tools/clip-audit/allowlist.ts, the CI gate's list) — `matrix` judges the jobs of this run (resumed lines included),
 * `summary` every result file. --report-only always exits 0 (exploratory / nightly report runs). Float / gap FAILs
 * are reported, never fatal. CLIP_AUDIT_NO_ALLOW=1 judges against an empty allow-list. 2 = crash / bad arguments.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Rot } from '../../src/shared/dimensions';
import { CAST_BODY_IDS, type BodyId } from '../../src/shared/cast';
import { evaluate, lookName, ORIGIN, pairPoses, rootPoseFor, setupFor, type Evaluation } from './audit';
import { buildMatrix, type Scenario } from './scenarios';
import { poseRig, rigFor, sampleRig, factoryWarnings, type Look, type Pose } from './rigs';
import { slotPose } from './objects';
import { makeSolid, penetration } from './detect';
import { OUT, renderShots, writeShot } from './shots';
import { runStatic } from './static';
import { penVerdict, worst } from './thresholds';
import { DIM } from '../../src/shared/dimensions';
import { bodyReach } from './reach';
import { ALLOW, unallowedFails } from './allowlist';
import { ANIM_STATES } from '../../src/shared/appearance';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? 'true' : v;
}

export function parseLook(s: string): Look {
  const [body, h] = s.split('@h');
  return { body: body as BodyId, height: h === undefined ? 0.5 : Number(h) };
}

export function looksFor(bodies: string, heights: number[]): Look[] {
  const ids: BodyId[] = bodies === 'all' ? ['classic', ...CAST_BODY_IDS] : (bodies.split(',') as BodyId[]);
  const out: Look[] = [];
  for (const b of ids) for (const h of heights) out.push({ body: b, height: h });
  return out;
}

async function matrix(): Promise<void> {
  const bodies = arg('bodies', 'all')!;
  const heights = (arg('heights', '0.5') ?? '0.5').split(',').map(Number);
  const times = Number(arg('times', '3'));
  const rot = Number(arg('rot', '0')) as Rot;
  const filter = arg('filter');
  const [si, sn] = (arg('shard', '1/1') ?? '1/1').split('/').map(Number);
  const runName = arg('run', 'matrix')!;
  const spacing = Number(arg('spacing', '0.03'));
  const oneWay = arg('one-way') === 'true';
  const partner = arg('partner');
  const lookB: Look | undefined = partner ? { body: partner as BodyId, height: 0.5 } : undefined;
  const rx = filter ? new RegExp(filter) : null;
  const scenarios = buildMatrix().filter((s) => (!rx || rx.test(s.key)) && (!lookB || s.kind === 'pair'));
  const looks = looksFor(bodies, heights);
  const jobs: { sc: Scenario; look: Look }[] = [];
  for (const look of looks) for (const sc of scenarios) jobs.push({ sc, look });
  const mine = jobs.filter((_, i) => i % sn === si - 1);
  const dir = resolve(OUT, 'results');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${runName}-${si}of${sn}.jsonl`);
  const done = new Set<string>();
  if (existsSync(file)) for (const line of readFileSync(file, 'utf8').split('\n')) if (line.trim()) {
    const e = JSON.parse(line) as Evaluation & { rot: number };
    done.add(`${e.key}|${e.look}`);
  }
  console.log(`[clip-audit] ${mine.length} jobs (${done.size} done) -> ${file}`);
  let n = 0;
  const t0 = Date.now();
  for (const { sc, look } of mine) {
    const id = `${sc.key}|${lookName(look)}${lookB ? `+${lookName(lookB)}` : ''}`;
    if (done.has(id)) continue;
    let e: Evaluation;
    try {
      e = await evaluate(sc, look, { times, rot, spacing, oneWay }, lookB);
    } catch (err) {
      e = { key: sc.key, look: lookName(look), clip: '', verdict: 'FAIL', checks: [{ name: 'error', value: 0, verdict: 'FAIL', detail: String((err as Error)?.stack ?? err).slice(0, 400), t: 0 }], times: [] };
    }
    appendFileSync(file, JSON.stringify({ ...e, rot, via: sc.via }) + '\n');
    n++;
    if (n % 20 === 0) console.log(`[clip-audit] ${n}/${mine.length - done.size} ${((Date.now() - t0) / n / 1000).toFixed(2)} s/job`);
  }
  if (factoryWarnings().length) console.log('[clip-audit] factory warnings:', factoryWarnings());
  console.log(`[clip-audit] done ${n} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const mineIds = new Set(mine.map(({ sc, look }) => `${sc.key}|${lookName(look)}${lookB ? `+${lookName(lookB)}` : ''}`));
  const evals: Evaluation[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) if (line.trim()) {
    const e = JSON.parse(line) as Evaluation;
    if (mineIds.has(`${e.key}|${e.look}`)) evals.push(e);
  }
  exitFor(evals);
}

/** Set the process exit code from the evaluations' penetration FAILs (see the header). */
function exitFor(evals: readonly Evaluation[]): number {
  // CLIP_AUDIT_NO_ALLOW=1: judge against an empty allow-list (every penetration FAIL counts)
  const bad = unallowedFails(evals, process.env.CLIP_AUDIT_NO_ALLOW ? [] : ALLOW);
  for (const b of bad.slice(0, 40)) console.log(`FAIL ${b.check} ${b.mm} mm  ${b.key}  ${b.look}`);
  if (bad.length > 40) console.log(`... ${bad.length - 40} more`);
  console.log(`[clip-audit] ${bad.length} penetration FAIL(s) outside the allow-list in ${evals.length} evaluations${bad.length && reportOnly() ? ' (--report-only: exit 0)' : ''}`);
  const code = bad.length && !reportOnly() ? 1 : 0;
  process.exitCode = code;
  return code;
}

function reportOnly(): boolean {
  return process.argv.includes('--report-only');
}

async function shot(): Promise<void> {
  const key = arg('key')!;
  const look = parseLook(arg('look', 'classic@h0.5')!);
  const rot = Number(arg('rot', '0')) as Rot;
  const sc = buildMatrix().find((s) => s.key === key);
  if (!sc) throw new Error(`no scenario ${key}`);
  const t = Number(arg('t', '0.5'));
  const name = arg('name') ?? `${key}__${lookName(look)}__t${t}`.replace(/[^A-Za-z0-9_.@+-]+/g, '_');
  const parts: { mesh: ReturnType<typeof sampleRig>['body']; color: string; opacity?: number }[] = [];
  const markers: { at: [number, number, number]; color: string; label: string }[] = [];
  if (sc.kind === 'slot') {
    const setup = await setupFor(sc, rot);
    const pose = rootPoseFor(sc, look, slotPose(setup.main.spec, setup.main.frame, sc.slotIndex, sc.approach), setup.main.frame);
    const lr = await rigFor(look);
    poseRig(lr, sc.act, pose, t);
    const s = sampleRig(lr);
    parts.push({ mesh: s.body, color: '#9fc27a' });
    if (s.item) parts.push({ mesh: s.item, color: '#e8c060' });
    for (const o of setup.all) parts.push({ mesh: o.solid.mesh, color: '#8a6a9a', opacity: 0.55 });
    const p = penetration(makeSolid(s.body), setup.solid, { spacing: 0.02 });
    if (p.deepest) markers.push({ at: p.deepest.at, color: '#ff2a2a', label: `${p.maxDepthMm} mm` });
  } else if (sc.kind === 'pair') {
    const ra = await rigFor(look, 'A');
    const rb = await rigFor(look, 'B');
    const { a: pa, b: pb } = pairPoses(sc, look, look);
    poseRig(ra, sc.a, pa, t);
    poseRig(rb, sc.b, pb, t);
    const sa = sampleRig(ra);
    const sb = sampleRig(rb);
    parts.push({ mesh: sa.body, color: '#9fc27a' }, { mesh: sb.body, color: '#7aa2c2', opacity: 0.8 });
    const p = penetration(makeSolid(sa.body), makeSolid(sb.body), { oneWay: true });
    if (p.deepest) markers.push({ at: p.deepest.at, color: '#ff2a2a', label: `${p.maxDepthMm} mm` });
  } else {
    const lr = await rigFor(look);
    poseRig(lr, sc.act, { x: ORIGIN.x, y: 0, z: ORIGIN.z, facing: 0 }, t);
    const s = sampleRig(lr);
    parts.push({ mesh: s.body, color: '#9fc27a' });
    if (s.item) parts.push({ mesh: s.item, color: '#e8c060' });
  }
  writeShot({ name, title: `${key}  ${lookName(look)}  t=${t}s`, parts, markers });
  const files = await renderShots([name]);
  console.log(files.join('\n'));
}

interface Row extends Evaluation {
  rot: number;
  via: string[];
}

function summary(): void {
  const dir = resolve(OUT, 'results');
  const rows: Row[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl')).sort()) {
    for (const line of readFileSync(resolve(dir, f), 'utf8').split('\n')) if (line.trim()) rows.push(JSON.parse(line) as Row);
  }
  // only scenarios the current matrix still contains (older result files may hold since-retired keys)
  const live = new Set(buildMatrix().map((x) => x.key));
  for (let i = rows.length - 1; i >= 0; i--) {
    rows[i].checks = rows[i].checks.filter((c) => c.name !== 'float:body');
    rows[i].verdict = worst(...rows[i].checks.map((c) => c.verdict));
    if (!live.has(rows[i].key)) rows.splice(i, 1);
  }
  rows.sort((a, b) => (a.key + a.look < b.key + b.look ? -1 : 1));
  // per check name x scenario: worst look
  const byCheck = new Map<string, { key: string; look: string; value: number; verdict: string; detail: string; t: number }[]>();
  const counts: Record<string, number> = { PASS: 0, WARN: 0, FAIL: 0 };
  for (const r of rows) {
    counts[r.verdict]++;
    for (const c of r.checks) {
      if (c.verdict === 'PASS') continue;
      const l = byCheck.get(c.name) ?? [];
      l.push({ key: r.key, look: r.look, value: c.value, verdict: c.verdict, detail: c.detail, t: c.t });
      byCheck.set(c.name, l);
    }
  }
  const out = {
    evaluations: rows.length,
    verdicts: counts,
    checks: Object.fromEntries([...byCheck].sort().map(([k, v]) => [k, {
      fail: v.filter((x) => x.verdict === 'FAIL').length,
      warn: v.filter((x) => x.verdict === 'WARN').length,
      worst: [...v].sort((a, b) => b.value - a.value).slice(0, 25),
    }])),
  };
  writeFileSync(resolve(OUT, 'summary.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ evaluations: out.evaluations, verdicts: out.verdicts, checks: Object.fromEntries(Object.entries(out.checks).map(([k, v]) => [k, { fail: v.fail, warn: v.warn }])) }, null, 1));
  exitFor(rows);
}

/** Per body x clip reach table -> dev/out/clip-audit/reach.json (social spacing / walls / doorways). */
async function reach(): Promise<void> {
  const bodies = arg('bodies', 'all')!;
  const out: Record<string, Record<string, unknown>> = {};
  for (const look of looksFor(bodies, [0.5])) {
    const row: Record<string, unknown> = {};
    for (const anim of ANIM_STATES) {
      const r = await bodyReach(look, anim);
      row[anim] = { front: r.front, frontCore: r.frontCore, back: r.back, half: r.half, halfCore: r.halfCore, top: r.top };
    }
    out[look.body] = row;
    console.log(`[clip-audit] reach ${look.body}`);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'reach.json'), JSON.stringify(out, null, 1));
  // doorways: a zombie walks through the middle of a DOOR_WIDTH opening (door leaf swung open, jambs at ±DOOR_WIDTH/2)
  const clear = DIM.DOOR_WIDTH / 2;
  const doors = Object.entries(out).map(([body, row]) => {
    const w = row.walk as { half: number; halfCore: number };
    const depth = Math.round((w.half - clear) * 1000);
    return { body, walkHalfMm: Math.round(w.half * 1000), walkHalfCoreMm: Math.round(w.halfCore * 1000), clearHalfMm: Math.round(clear * 1000), depthMm: Math.max(0, depth), coreDepthMm: Math.max(0, Math.round((w.halfCore - clear) * 1000)), verdict: penVerdict(Math.max(0, depth)) };
  });
  writeFileSync(resolve(OUT, 'doorway.json'), JSON.stringify(doors, null, 1));
  for (const d of doors) if (d.verdict !== 'PASS') console.log(`${d.verdict} doorway ${d.body}: walk half-width ${d.walkHalfMm} mm (core ${d.walkHalfCoreMm}) vs ${d.clearHalfMm} mm`);
}

async function main(): Promise<void> {
  const COMMANDS = ['matrix', 'shot', 'summary', 'static', 'reach'];
  const cmd = process.argv.find((a) => COMMANDS.includes(a)) ?? 'matrix';
  if (cmd === 'matrix') await matrix();
  else if (cmd === 'shot') await shot();
  else if (cmd === 'summary') summary();
  else if (cmd === 'static') await runStatic();
  else if (cmd === 'reach') await reach();
  else throw new Error(`unknown command ${cmd}`);
  process.exit(process.exitCode ?? 0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(2);
});
