import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { Creator, contract, validateSvg, fingerprint, parseJson, kit, sha } from '../core.mjs';
import { brandSkinFor, canonicalJson } from '../generated/engine.mjs';
const source = { id: 'night-chiller', author: 'Creator acceptance', brand: 'Grave-Cola', displayName: 'Night Chiller', flavorText: 'Original house-brand art.' };
function workspace() { return fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'afterlife-creator-test-')); }
async function draft() { const root = workspace(), c = new Creator(root); await c.init(source); return { root, c }; }
function edit(root, fn) { const file = path.join(root, 'drafts/night-chiller/pack.json'); const value = JSON.parse(fs.readFileSync(file, 'utf8')); fn(value); fs.writeFileSync(file, JSON.stringify(value)); }

test('fresh CLI author -> build -> gate uses real registry, restores builtins and rejects unsigned production', async () => {
  const root = workspace();
  const run = (cmd, data) => JSON.parse(execFileSync(process.execPath, [path.join(kit, 'cli.mjs'), cmd, '--workspace', root, '--json', JSON.stringify(data)], { encoding: 'utf8', windowsHide: true }));
  assert.equal(run('init', source).status, 'created');
  const b = run('build', { id: source.id });
  const receipt = run('gate', { artifact: b.artifact });
  assert.equal(receipt.packSha256, b.packSha256);
  assert.equal(receipt.registry.resolved[0].objects[0].resolvedSkin, 'night_chiller');
  assert.equal(receipt.registry.before[0][0], 'grave_cola_fridge');
  assert.equal(receipt.production.admitted, false);
  assert.equal(receipt.production.stage, 'signature');
  assert.equal(receipt.publicationReady, false);
  assert.equal(receipt.gates.repositoryCI.startsWith('Blocked'), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, receipt.receipt), 'utf8')).packSha256, b.packSha256);
});
test('same inputs build identical artifact bytes across new workspaces; existing output is preserved', async () => {
  const a = await draft(), b = await draft();
  const first = await a.c.build({ id: source.id }), second = await b.c.build({ id: source.id });
  assert.equal(first.packSha256, second.packSha256);
  const before = fs.readFileSync(path.join(a.root, 'artifacts', first.artifact, 'pack.json'));
  await assert.rejects(a.c.build({ id: source.id }), /Destination exists/);
  assert.deepEqual(fs.readFileSync(path.join(a.root, 'artifacts', first.artifact, 'pack.json')), before);
});
test('real resolver returns to built-in skin after every verification', async () => {
  const { c } = await draft(); const b = await c.build({ id: source.id });
  const before = brandSkinFor('fridge_humming').id;
  assert.equal((await c.verify({ artifact: b.artifact })).registry.resolved[0].objects[0].resolvedSkin, 'night_chiller');
  assert.equal(brandSkinFor('fridge_humming').id, before);
});
for (const [label, mutate] of [
  ['displayName', m => { m.contents.brandSkins[0].displayName = 'Changed after build'; }],
  ['manifest id', m => { m.id = 'swapped-pack'; }],
  ['version', m => { m.version = '9.9.9'; }],
  ['author', m => { m.author = 'Replacement author'; }],
  ['art with recomputed hashes', (m, dir) => {
    const file = path.join(dir, 'art/logo.svg'); fs.appendFileSync(file, '\n');
    const bytes = fs.readFileSync(file); m.assets[0].bytes = bytes.length;
    m.assets[0].sha256 = sha(bytes);
  }],
]) test(`artifact identity rejects ${label} edit even when game validation permits it`, async () => {
  const { root, c } = await draft(); const b = await c.build({ id: source.id });
  const dir = path.join(root, 'artifacts', b.artifact), file = path.join(dir, 'pack.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8')); mutate(manifest, dir);
  fs.writeFileSync(file, canonicalJson(manifest) + '\n');
  await assert.rejects(c.gate({ artifact: b.artifact }), /Artifact identity/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'receipts')), []);
});
test('artifact names bind the full digest and reject shortened, renamed or noncanonical manifests', async () => {
  const { root, c } = await draft(); const b = await c.build({ id: source.id });
  assert.ok(b.artifact.endsWith(b.packSha256));
  const dir = path.join(root, 'artifacts', b.artifact);
  for (const name of [b.artifact.slice(0, -48), `renamed-${b.packSha256}`]) {
    const target = path.join(root, 'artifacts', name); fs.renameSync(dir, target);
    await assert.rejects(c.verify({ artifact: name }), /Artifact identity/);
    fs.renameSync(target, dir);
  }
  const file = path.join(dir, 'pack.json'), m = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
  await assert.rejects(c.verify({ artifact: b.artifact }), /canonical pack.json/);
});
test('all-disabled skins and uncovered advertised targets cannot produce success receipts', async () => {
  const { root, c } = await draft(); edit(root, m => { m.contents.brandSkins[0].enabled = false; });
  await assert.rejects(c.build({ id: source.id }), /enabled skin/);
  edit(root, m => { m.contents.brandSkins.push({ ...m.contents.brandSkins[0], id: 'active_skin', enabled: true, appliesTo: ['bed_normal'] }); });
  await assert.rejects(c.build({ id: source.id }), /advertised target/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'receipts')), []);
});
test('partial overlap preserves each skin effective target and resolves later skins first', async () => {
  const { root, c } = await draft();
  edit(root, m => { m.contents.brandSkins[0].appliesTo.push('bed_normal');m.contents.brandSkins.push({ ...m.contents.brandSkins[0], id: 'winning_skin',appliesTo:['fridge_humming'] }); });
  const b = await c.build({ id: source.id }), receipt = await c.gate({ artifact: b.artifact });
  assert.equal(receipt.gates.realRegistry, 'Worked');
  assert.equal(receipt.registry.targetAssertions.length, 3);
  assert.ok(receipt.registry.targetAssertions.every(a => a.expected === (a.object==='fridge_humming'?'winning_skin':'night_chiller') && a.actual === a.expected));
  assert.equal(brandSkinFor('fridge_humming').id, 'grave_cola_fridge');
});

for (const disabled of [false,true]) test(`reject a ${disabled?'disabled covered':'fully overridden'} skin before artifact publication`, async()=>{
  const {root,c}=await draft();
  edit(root,m=>{m.contents.brandSkins[0].enabled=!disabled;m.contents.brandSkins.push({...m.contents.brandSkins[0],id:'winning_skin',enabled:true});});
  await assert.rejects(c.build({id:source.id}),/effective target/);
  assert.deepEqual(fs.readdirSync(path.join(root,'artifacts')),[]);
  assert.deepEqual(fs.readdirSync(path.join(root,'receipts')),[]);
});
test('hard-linked draft and artifact files are rejected without modifying the other link', async () => {
  const { root, c } = await draft();
  const art = path.join(root, 'drafts/night-chiller/art/logo.svg'), outside = path.join(workspace(), 'shared.svg');
  fs.linkSync(art, outside);
  await assert.rejects(c.build({ id: source.id }), /Hard links/);
  fs.unlinkSync(outside);
  const b = await c.build({ id: source.id }), builtArt = path.join(root, 'artifacts', b.artifact, 'art/logo.svg');
  const before = fs.readFileSync(builtArt); fs.linkSync(builtArt, outside);
  await assert.rejects(c.gate({ artifact: b.artifact }), /Hard links/);
  assert.deepEqual(fs.readFileSync(outside), before);
  assert.deepEqual(fs.readdirSync(path.join(root, 'receipts')), []);
});
for (const [label, mutate, pattern] of [
  ['unsupported objects', m => { m.contents.objects = [{ id: 'cheat' }]; }, /cannot load/],
  ['creatures', m => { m.contents.creatures = []; }, /not a content kind/],
  ['licensed trademark', m => { m.contents.brandSkins[0].licensed = true; }, /licensed mark/],
  ['unapproved brand', m => { m.contents.brandSkins[0].brand = 'Actual Brand'; }, /approved house brand/],
  ['unknown gameplay field', m => { m.contents.brandSkins[0].price = 0; }, /not a brand-skin field/],
  ['missing target', m => { m.contents.brandSkins[0].appliesTo = ['fridge_nonexistent']; }, /existing catalog/],
  ['empty target', m => { m.contents.brandSkins[0].appliesTo = []; }, /existing catalog/],
  ['id mismatch', m => { m.id = 'other-id'; }, /id differ/],
  ['newer engine', m => { m.requires.engine = '>=99.0.0'; }, /needs game version/],
  ['builtin clash', m => { m.contents.brandSkins[0].id = 'grave_cola_fridge'; }, /already in use/],
]) test(`reject ${label}`, async () => {
  const { root, c } = await draft(); edit(root, mutate);
  if (label === 'builtin clash') {
    const b = await c.build({ id: source.id }); await assert.rejects(c.verify({ artifact: b.artifact }), pattern);
  } else await assert.rejects(c.build({ id: source.id }), pattern);
});
test('tampered asset fails actual game hash gate; no success receipt', async () => {
  const { root, c } = await draft(); const b = await c.build({ id: source.id });
  fs.appendFileSync(path.join(root, 'artifacts', b.artifact, 'art/logo.svg'), ' ');
  await assert.rejects(c.gate({ artifact: b.artifact }), /wrong size/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'receipts')), []);
});
test('signature and binary art are rejected', async () => {
  const { root, c } = await draft();
  fs.writeFileSync(path.join(root, 'drafts/night-chiller/art/model.glb'), 'glTF');
  await assert.rejects(c.build({ id: source.id }), /static SVG/);
  fs.renameSync(path.join(root, 'drafts/night-chiller/art/model.glb'), path.join(root, 'parked-model.glb'));
  fs.writeFileSync(path.join(root, 'drafts/night-chiller/pack.sig'), '{}');
  await assert.rejects(c.build({ id: source.id }), /No signing/);
});
test('unlisted artifact file fails exact-set validation', async () => {
  const { root, c } = await draft(); const b = await c.build({ id: source.id });
  fs.writeFileSync(path.join(root, 'artifacts', b.artifact, 'extra.svg'), '<svg/>');
  await assert.rejects(c.verify({ artifact: b.artifact }), /not listed/);
});
test('traversal, absolute paths, unknown CLI fields, reserved keys and invalid UTF-8 fail', async () => {
  const { c } = await draft();
  for (const id of ['../escape', 'C:/private', 'aa/../../x']) await assert.rejects(c.build({ id }));
  await assert.rejects(c.init({ ...source, command: 'arbitrary shell' }));
  assert.throws(() => parseJson(Buffer.from('{"__proto__":{"polluted":true}}')), /Reserved/);
  assert.throws(() => parseJson(Buffer.from([0xff])), /encoded data/);
  const result = spawnSync(process.execPath, [path.join(kit, 'cli.mjs'), 'delete', '--workspace', c.root, '--json', '{}'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
});
test('links/junctions cannot redirect workspace, drafts, outputs or assets', async () => {
  const { root, c } = await draft(); const other = workspace();
  const linked = path.join(root, 'drafts/redirect'); fs.symlinkSync(other, linked, 'junction');
  await assert.rejects(c.build({ id: 'redirect' }), /Links and junctions/);
  const alias = path.join(workspace(), 'alias'); fs.symlinkSync(root, alias, 'junction');
  assert.throws(() => new Creator(alias), /links\/junctions/);
  fs.symlinkSync(other, path.join(root, 'drafts/night-chiller/art/redirect'), 'junction');
  await assert.rejects(c.build({ id: source.id }), /Links and junctions/);
});
for (const content of [
  '<script>alert(1)</script>', '<image href="https://evil.invalid/a"/>', '<foreignObject/>',
  '<rect onload="alert(1)"/>', '<rect style="fill:url(https://evil.invalid)"/>',
  '<rect fill="url(#x)"/>', '<g xmlns:x="http://evil.invalid"><x:script/></g>',
  '<?xml-stylesheet href="https://evil.invalid/x"?>', '<use href="#x"/>',
]) test(`SVG rejects active/reference content ${content.slice(0, 30)}`, () => {
  assert.throws(() => validateSvg(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${content}</svg>`)));
});
test('SVG rejects entities, malformed XML, high complexity and oversized files', () => {
  for (const text of ['<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///secret">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>', '<svg>',
    '<svg xmlns="http://www.w3.org/2000/svg">' + '<g>'.repeat(33) + '</g>'.repeat(33) + '</svg>', 'x'.repeat(256 * 1024 + 1)]) assert.throws(() => validateSvg(Buffer.from(text)));
});
test('pack filesystem count and size are bounded; lock prevents replacement', async () => {
  const { root, c } = await draft();
  fs.writeFileSync(path.join(root, 'drafts/.night-chiller.lock'), 'another writer');
  await assert.rejects(c.init(source), /EEXIST/);
  assert.equal(fs.readFileSync(path.join(root, 'drafts/.night-chiller.lock'), 'utf8'), 'another writer');
  fs.writeFileSync(path.join(root, 'drafts/night-chiller/art/huge.svg'), Buffer.alloc(8 * 1024 * 1024 + 1));
  await assert.rejects(c.build({ id: source.id }), /resource limits/);
});
test('contract is bounded to current support and fingerprints bind names and bytes', () => {
  assert.deepEqual(contract().supported, ['brandSkins']);
  assert.equal(contract().futureTask, 'W-084');
  assert.ok(contract().targetObjects.includes('fridge_humming'));
  assert.notEqual(fingerprint(new Map([['a', Buffer.from('x')]])), fingerprint(new Map([['b', Buffer.from('x')]])));
});
