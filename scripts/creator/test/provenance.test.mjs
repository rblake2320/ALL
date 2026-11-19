import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { kit, sha } from '../core.mjs';

// Copy only the actual bundle inputs into an isolated fixture. Never alter the
// live repository to inject stale-code conditions.
async function isolated() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'creator-provenance-'));
  const copy = path.join(root, 'scripts/creator'); fs.mkdirSync(path.join(copy, 'generated'), { recursive: true });
  const provenance = JSON.parse(fs.readFileSync(path.join(kit, 'generated/provenance.json'), 'utf8'));
  for (const name of [...Object.keys(provenance.kitInputs), 'generated/engine.mjs', 'generated/provenance.json']) {
    fs.copyFileSync(path.join(kit, name), path.join(copy, name));
  }
  for (const name of Object.keys(provenance.inputs)) {
    const target = path.resolve(copy, name); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.resolve(kit, name), target);
  }
  fs.symlinkSync(path.join(kit, 'node_modules'), path.join(copy, 'node_modules'), 'junction');
  const { Creator } = await import(pathToFileURL(path.join(copy, 'core.mjs')).href);
  const workspace = path.join(root, 'workspace'); fs.mkdirSync(workspace);
  const creator = new Creator(workspace);
  return { copy, creator, provenance };
}

test('already-running process rejects a rebuilt bundle even if its disk provenance was updated', async () => {
  const { copy, creator, provenance } = await isolated();
  const bundle = path.join(copy, 'generated/engine.mjs'); fs.appendFileSync(bundle, '\n// rebuilt after process start\n');
  provenance.bundleSha256 = sha(fs.readFileSync(bundle));
  fs.writeFileSync(path.join(copy, 'generated/provenance.json'), JSON.stringify(provenance));
  await assert.rejects(creator.init({ id: 'stale-bundle', author: 'Test', brand: 'Grave-Cola', displayName: 'Test', flavorText: 'Test' }), /Loaded engine bundle changed/);
  assert.deepEqual(fs.readdirSync(path.join(creator.root, 'drafts')), []);
});

test('already-running process rejects changed tool code before writing a draft', async () => {
  const { copy, creator, provenance } = await isolated();
  const code = path.join(copy, 'cli.mjs'); fs.appendFileSync(code, '\n// changed tool code\n');
  provenance.kitInputs['cli.mjs'] = sha(fs.readFileSync(code));
  fs.writeFileSync(path.join(copy, 'generated/provenance.json'), JSON.stringify(provenance));
  await assert.rejects(creator.init({ id: 'stale-code', author: 'Test', brand: 'Grave-Cola', displayName: 'Test', flavorText: 'Test' }), /Creator code changed/);
  assert.deepEqual(fs.readdirSync(path.join(creator.root, 'drafts')), []);
});

test('new path-scrubbing module is provenance-bound before any author writes',async()=>{
  const {copy,creator,provenance}=await isolated();
  assert.ok(provenance.kitInputs['privacy.mjs']);
  const code=path.join(copy,'privacy.mjs');fs.appendFileSync(code,'\n// altered scrubber\n');
  provenance.kitInputs['privacy.mjs']=sha(fs.readFileSync(code));
  fs.writeFileSync(path.join(copy,'generated/provenance.json'),JSON.stringify(provenance));
  await assert.rejects(creator.init({id:'stale-scrubber',author:'Test',brand:'Grave-Cola',displayName:'Test',flavorText:'Test'}),/Creator code changed/);
  assert.deepEqual(fs.readdirSync(path.join(creator.root,'drafts')),[]);
});

test('Creator workflow uses only immutable upstream action commit references',()=>{
  const workflow=fs.readFileSync(path.resolve(kit,'../../.github/workflows/creator-kit.yml'),'utf8');
  const uses=[...workflow.matchAll(/uses:\s*([^\s#]+)/g)].map(m=>m[1]);
  assert.equal(uses.length,2);
  for(const ref of uses)assert.match(ref,/^actions\/(checkout|setup-node)@[a-f0-9]{40}$/);
});

test('source drift blocks build before an artifact is written', async () => {
  const { copy, creator, provenance } = await isolated();
  await creator.init({ id: 'source-drift', author: 'Test', brand: 'Grave-Cola', displayName: 'Test', flavorText: 'Test' });
  const input = Object.keys(provenance.inputs).find(name => name.endsWith('/schema.ts'));
  fs.appendFileSync(path.resolve(copy, input), '\n// source changed\n');
  await assert.rejects(creator.build({ id: 'source-drift' }), /Engine source changed/);
  assert.deepEqual(fs.readdirSync(path.join(creator.root, 'artifacts')), []);
});

test('test fixtures work when the platform temporary directory is an alias', () => {
  const base = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'creator-temp-alias-'));
  const physical = path.join(base, 'physical'); fs.mkdirSync(physical);
  const alias = path.join(base, 'alias'); fs.symlinkSync(physical, alias, 'junction');
  const childEnv = { ...process.env, TEMP: alias, TMP: alias, TMPDIR: alias };
  // This is a standalone TAP run, not a worker in the parent runner's protocol.
  delete childEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern',
    'same inputs build identical', path.join(kit, 'test/creator.test.mjs')], {
    cwd: kit, encoding: 'utf8', windowsHide: true, timeout: 20000,
    env: childEnv,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const selected = result.stdout.split('\n').find(line => /^ok \d+ - same inputs build identical/.test(line));
  assert.ok(selected && !selected.includes('# SKIP'), result.stdout);
});
