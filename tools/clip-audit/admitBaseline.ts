/** Convert frozen gate measurements into exact, capped rows for review. Never runs as part of the gate itself. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { LEGACY_ALLOW, allowFor, CAUSES } from './allowlist';
import { validateBaselineFiles } from './baselineAdmission';

const [output, ...files] = process.argv.slice(2);
if (!output || files.length !== 4) throw new Error('usage: admitBaseline.ts <fresh-output.json> <four partition reports>');
if (existsSync(output)) throw new Error(`refusing to overwrite ${output}`);
const reports = validateBaselineFiles(files);
const first = reports[0];
type Row = [string, string, string, string, number, number];
const rows: Row[] = [];
for (const r of reports) for (const f of r.failures) {
  if (!Number.isFinite(f.measuredMm) || f.measuredMm <= 15 || !f.check.startsWith('pen:')) throw new Error('invalid measurement');
  // These premium contact cases were clean at the pin; never manufacture an exception for the regression this task protects.
  if (/^(sexton|lowside|waitress|patient|fisherman)@/.test(f.look) &&
      ['floor:standEat+plate', 'floor:read+book'].includes(f.key) && f.check === 'pen:item-body') {
    throw new Error(`premium contact regression requires a source fix: ${f.key} ${f.look} ${f.measuredMm} mm`);
  }
  const prior = allowFor(f.check, f.key, f.look, LEGACY_ALLOW);
  if (prior && f.measuredMm <= prior.maxMm) continue;
  const cause = f.check === 'pen:partner' ? 'social' : f.check === 'pen:floor' ? 'floor' :
    f.check.startsWith('pen:self') ? 'self' : f.check.startsWith('pen:item') ? 'carry' :
    f.check.startsWith('pen:wall') ? 'wall' : /:(sit[^:+|]*)(\+|\||$)/.test(f.key) ? 'seat' :
    /:(sleep|beEmbalmed|bath|collapse)(\+|\||$)/.test(f.key) ? 'lying' : 'work';
  if (!CAUSES[cause]) throw new Error(`unknown cause ${cause}`);
  rows.push([cause, f.check, f.key, f.look, f.measuredMm, Math.ceil(f.measuredMm * 1.1 + 3)]);
}
rows.sort((a, b) => JSON.stringify(a.slice(1, 4)).localeCompare(JSON.stringify(b.slice(1, 4)), 'en'));
if (new Set(rows.map((r) => JSON.stringify(r.slice(1, 4)))).size !== rows.length) throw new Error('duplicate rows');
const metadata = { version: 1, source: first.source, assetPin: first.source,
  options: first.options, evaluated: reports.reduce((n, r) => n + r.evaluated, 0),
  margin: 'ceil(measuredMm * 1.1 + 3); exact scenario/check/look only',
  harness: first.harness, assets: Object.assign({}, ...reports.map((r) => r.assets)),
  reports: files.map((file, i) => ({ part: reports[i].part, sha256: createHash('sha256').update(readFileSync(file)).digest('hex'), rawSha256: reports[i].rawSha256, evaluated: reports[i].evaluated })),
  columns: ['cause', 'check', 'scenario', 'look', 'measuredMm', 'maxMm'] };
const header = JSON.stringify(metadata, null, 2);
writeFileSync(output, header.slice(0, -2) + ',\n  "rows": [\n' + rows.map((r) => '    ' + JSON.stringify(r)).join(',\n') + '\n  ]\n}\n');
console.log(`RECORDED ${rows.length} exact capped exceptions from ${metadata.evaluated} evaluations; review before committing`);
