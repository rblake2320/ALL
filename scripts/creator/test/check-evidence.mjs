// Offline retained-evidence acceptance. No SDK, build, browser or workspace mutation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root=path.resolve(process.argv[2]??fileURLToPath(new URL('../../../docs/desktop-reports/sol-creator-hardening-evidence',import.meta.url)));
const read=name=>fs.readFileSync(path.join(root,name),'utf8'),json=name=>JSON.parse(read(name));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const seal=json('seal.json');assert.equal(seal.format,'sol-creator-hardening-v1');
const actual=fs.readdirSync(root,{recursive:true,withFileTypes:true}).filter(d=>d.isFile()).map(d=>path.relative(root,path.join(d.parentPath,d.name)).replaceAll('\\','/')).sort();
assert.deepEqual(actual,[...seal.files.map(f=>f.path),'seal.json'].sort());
for(const f of seal.files){
  assert.ok(!path.isAbsolute(f.path)&&!f.path.split('/').includes('..'));
  const name=path.join(root,f.path);assert.ok(fs.lstatSync(name).isFile());
  const bytes=fs.readFileSync(name);assert.equal(bytes.length,f.bytes,f.path);assert.equal(sha(bytes),f.sha256,f.path);
}
const demo=json('demo/demo-evidence.json');assert.equal(demo.calls.length,7);assert.equal(demo.provenance.head,seal.sourcePin);
assert.equal(demo.stderr,'');assert.equal(demo.tools.tools.length,5);
for(const call of demo.calls) {
  if(call.name==='gate')assert.equal(call.value.publicationReady,false);
  if(call.name==='creator_gate')assert.equal(call.value.structuredContent.publicationReady,false);
  if(call.name==='creator_build')assert.equal(call.value.isError,true);
}
const log=json('live-log/result.json');assert.equal(log.status,'Worked');assert.equal(log.tests,3);assert.equal(log.provenance.head,seal.sourcePin);
assert.equal(sha(fs.readFileSync(path.join(root,'live-log',log.log))),log.logSha256);
assert.ok(read('live-log/'+log.log).includes('[repo]'));assert.equal(log.result.code,0);assert.equal(log.result.error,null);
assert.match(read('logs/creator-pinned-tests.txt'),/tests 56/);assert.match(read('logs/creator-pinned-tests.txt'),/fail 0/);assert.match(read('logs/creator-pinned-tests.txt'),/skipped 0/);
const provenance=json('sources/generated/provenance.json');assert.equal(provenance.head,seal.sourcePin);
assert.equal(sha(fs.readFileSync(path.join(root,'sources/generated/engine.mjs'))),provenance.bundleSha256);
for(const [name,digest] of Object.entries(provenance.kitInputs))assert.equal(sha(fs.readFileSync(path.join(root,'sources',name))),digest,name);
for(const [name,digest] of Object.entries(provenance.inputs)){
  const relative=path.posix.normalize('scripts/creator/'+name.replaceAll('\\','/'));assert.ok(!relative.startsWith('../')&&!path.posix.isAbsolute(relative));
  assert.equal(sha(fs.readFileSync(path.join(root,'engine-inputs',relative))),digest,name);
}
for(const name of ['creator-before-hardening.txt','creator-before-mcp-corrected.txt','creator-overlap-boundary-before.txt','creator-stream-progress-before.txt'])assert.match(read('logs/'+name),/^not ok /m);
console.log(JSON.stringify({status:'Worked',files:seal.files.length,creatorTests:56,realVitestTests:3,demoCalls:7,sourcePin:seal.sourcePin}));
