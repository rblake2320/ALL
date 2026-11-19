/* Read-only witnesses against the PR57 types/helpers. This is contract review, not world implementation. */
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const ref = process.argv.find(a => a.startsWith('--ref='))?.slice(6) || '39a2d6ab6600f4aabc0c917b995965137ad34bbf';
if (!/^[a-f0-9]{7,40}$/.test(ref)) throw new Error('Use an immutable Git commit id');
const revised = process.argv.includes('--revised');
const source = execFileSync('git', ['show', `${ref}:src/shared/world.ts`], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' });
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports });
const w = mod.exports;
const valid = (x, z) => w.isValidPlacement({ regionId: 'unfinished:next', originX: x, originZ: z, rot: 0, width: 10, depth: 10 });
const rows = {
  ref,
  contractSha256: crypto.createHash('sha256').update(source).digest('hex'),
  northOfMildew: { placementValid: valid(40, -10), cell: w.cellIdOfWorldTile(45, -5) },
  westOfPark: { placementValid: valid(-10, 30), cell: w.cellIdOfWorldTile(-5, 35) },
  positiveControl: { placementValid: valid(200, 30), cell: w.cellIdOfWorldTile(205, 35) },
  initialDesignSplitWitness: { members: 8, distinctOccupiedLotRegions: 8, hardActiveLotCap: 6, canSatisfyBoth: 8 <= 6 },
};
if (revised) {
  const members = Array.from({ length: 8 }, (_, i) => ({ regionId: `wormwood:away${i}`, kind: 'lot' }));
  const input = { homeRegionId: 'wormwood:home', memberRegions: members, candidates: Array.from({ length: 20 }, (_, i) => ({ regionId: `wormwood:extra${i}`, kind: 'lot', distance: i })) };
  const live = w.selectLiveRegions(input);
  rows.revisedSplit = live;
  if (!rows.northOfMildew.placementValid || rows.northOfMildew.cell === null || !rows.westOfPark.placementValid || rows.westOfPark.cell === null || !rows.positiveControl.placementValid) throw new Error('Signed expansion still fails');
  if (live.lotCount !== 9 || live.required.length !== 9 || !members.every(m => live.live.includes(m.regionId)) || live.live.some(id => id.startsWith('wormwood:extra'))) throw new Error('Split household rule failed');
  rows.revisedChecks = 'Worked: signed expansion and all8away-member lots+home retained';
} else if (rows.northOfMildew.placementValid || rows.northOfMildew.cell !== null || rows.westOfPark.placementValid || rows.westOfPark.cell !== null || !rows.positiveControl.placementValid) throw new Error('Before-state witness does not match its pin');
process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
