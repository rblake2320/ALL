import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PICKUP_RISE_TIMES, pickupRise } from './pickupRise';

const output = process.argv[2];
if (!output || existsSync(output)) throw new Error('usage: recordPickupRise.ts <fresh-output.json>');
const source = process.env.CLIP_SOURCE_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const rows = (await pickupRise()).map((r) => ({ ...r, maxMm: r.mm > 15 ? Math.ceil(r.mm * 1.1 + 3) : 15 }));
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
writeFileSync(output, JSON.stringify({ source, sampling: '60 Hz, inclusive 0.65–0.85 s', times: PICKUP_RISE_TIMES,
  toolSha256: hash('tools/clip-audit/pickupRise.ts'), manifestSha256: hash('public/assets/manifest.premium.json'), rows }, null, 2) + '\n');
console.log(`MEASURED ${rows.length} body/item cases, ${rows.reduce((n, r) => n + r.samples, 0)} poses; ${rows.filter((r) => r.mm > 15).length} known rise penetrations, source ${source}`);
