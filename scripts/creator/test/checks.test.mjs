import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { minimalEnvironment, runRepositoryCommand, repositoryReceipt } from '../checks.mjs';
import { repo } from '../core.mjs';
import { pathRedactor, pathScrubber, publicCreatorError } from '../privacy.mjs';

test('log scrubber preserves UTF-8 and diagnostics across every byte split',()=>{
  const roots=[{path:'C:\\Users\\Rédacted User\\Game',label:'repo'},{path:'/tmp/private space/work',label:'workspace'},{path:'/Users/private-person',label:'home'}];
  const text='π before '+roots.map(r=>r.path).join('\n')+'\n'+roots[0].path.toUpperCase().replaceAll('\\','/')+'\n'+JSON.stringify(roots[0].path)+'\n'+encodeURIComponent(roots[1].path)+'\n relative/test.ts FAIL code7 é after';
  const expected=pathRedactor(roots).redact(text),bytes=Buffer.from(text);
  assert.ok(!expected.includes('private-person')&&!expected.includes('Rédacted'));
  assert.ok(expected.includes('relative/test.ts FAIL code7'));
  for(let split=0;split<=bytes.length;split++) {
    let output='';const scrub=pathScrubber(roots,s=>{output+=s;});
    scrub.write(bytes.subarray(0,split));scrub.write(bytes.subarray(split));scrub.end();scrub.end();
    assert.equal(output,expected,`split ${split}`);
  }
  let output='';const scrub=pathScrubber(roots,s=>{output+=s;});
  for(const b of bytes)scrub.write(Buffer.from([b]));scrub.end();assert.equal(output,expected);
});

test('log write failures are blocked and filesystem tool errors retain errno without paths',async()=>{
  const file=path.join(fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'creator-closed-log-')),'closed.txt');
  const fd=fs.openSync(file,'wx');fs.closeSync(fd);
  const result=await runRepositoryCommand(['-e','console.log("test")'],fd,10000);
  assert.equal(result.error,'LOG_WRITE_FAILED');
  const message=publicCreatorError(Object.assign(Error("EACCES: open '/outside/private/person/file'"),{code:'EACCES'}),[]);
  assert.equal(message,'Creator filesystem operation failed (EACCES).');
  assert.equal(publicCreatorError(Error('Invalid draft in /home/person/work'),[{path:'/home/person',label:'home'}]),'Invalid draft in [home]/work');
});

test('overlapping path roots never emit an identifying prefix at a stream boundary',()=>{
  const roots=[{path:'/long/private/home',label:'repo'},{path:'/home/x',label:'workspace'}];
  const bytes=Buffer.from('/long/private/home/x plus safe diagnostics');
  for(let split=0;split<=bytes.length;split++) {
    let output='';const scrub=pathScrubber(roots,s=>{output+=s;});
    scrub.write(bytes.subarray(0,split));scrub.write(bytes.subarray(split));scrub.end();
    assert.equal(output,'[repo]/x plus safe diagnostics',`split ${split}`);
  }
});

test('overlapping root chains make streaming progress without retaining the whole log',()=>{
  const roots=[{path:'/long/private/home',label:'repo'},{path:'/home/long/private',label:'workspace'}];
  let output='';const scrub=pathScrubber(roots,s=>{output+=s;});
  scrub.write(Buffer.from('/long/private/home'.repeat(200)));
  assert.ok(output.length>0,'Scrubber retained the entire overlapping log');
  scrub.end();assert.equal(output,'[repo]'.repeat(200));
});

test('real child output automatically scrubs repository, home and workspace paths from both streams', async()=>{
  const root=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'creator private workspace-'));
  const file=path.join(root,'child.txt'),fd=fs.openSync(file,'wx');
  const roots=[repo.replace(/[\\/]+$/,''),os.homedir(),root];
  const payload=JSON.stringify(roots.flatMap(p=>[p,p.replaceAll('\\','/'),p.replaceAll('/','\\')]));
  let result;
  try {result=await runRepositoryCommand(['-e',`const s=${JSON.stringify(payload)};for(const c of Buffer.from(s))process.stdout.write(Buffer.from([c]));process.stderr.write(s);process.exitCode=7;`],fd,10000,[root]);}
  finally{fs.closeSync(fd);}
  const output=fs.readFileSync(file,'utf8');
  assert.equal(result.code,7);assert.ok(output.includes('[repo]')&&output.includes('[workspace]')&&output.includes('[home]'));
  for(const p of roots)for(const variant of [p,p.replaceAll('\\','/'),p.replaceAll('/','\\')])assert.ok(!output.includes(variant), 'Host root leaked');
});

test('repository child executes with a minimal environment and no provider tokens or Node injection', async () => {
  const filtered = minimalEnvironment({ PATH: 'expected-path', SystemRoot: 'expected-root', OPENAI_API_KEY: 'synthetic', MESHY_API_KEY: 'synthetic', NODE_OPTIONS: '--no-warnings', NODE_PATH: '/hostile', NODE_TEST_CONTEXT: 'child-v8' });
  assert.deepEqual(filtered, { PATH: 'expected-path', SystemRoot: 'expected-root', CI: 'true' });
  const file = path.join(fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'creator-child-env-')), 'child.txt');
  process.env.CREATOR_TEST_SECRET = 'synthetic-do-not-forward';
  const fd = fs.openSync(file, 'wx');
  let result;
  try {
    result = await runRepositoryCommand(['-e', 'console.log(JSON.stringify({secretPresent: "CREATOR_TEST_SECRET" in process.env, contextPresent: "NODE_TEST_CONTEXT" in process.env, ci: process.env.CI}))'], fd, 10000);
  } finally { fs.closeSync(fd); delete process.env.CREATOR_TEST_SECRET; }
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { secretPresent: false, contextPresent: false, ci: 'true' });
});

test('real child failure and timeout remain visible and cannot become repository success', async () => {
  for (const [argv, timedOut, code] of [[['-e', 'process.exit(7)'], false, 7], [['-e', 'setInterval(() => {}, 1000)'], true, null]]) {
    const file = path.join(fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'creator-child-fault-')), 'child.txt');
    const fd = fs.openSync(file, 'wx');
    let result;
    try { result = await runRepositoryCommand(argv, fd, timedOut ? 200 : 10000); } finally { fs.closeSync(fd); }
    assert.equal(result.timedOut, timedOut);
    if (!timedOut) assert.equal(result.code, code);
    const receipt = repositoryReceipt({ before: { head: 'test-pin', files: {} }, stableInputs: true,
      results: [{ ...result, outcome: timedOut ? 'Blocked' : 'Failed' }], verified: { artifact: 'synthetic', packSha256: 'a' }, afterPack: { packSha256: 'a' } });
    assert.equal(receipt.repositoryChecks.outcome, timedOut ? 'Blocked' : 'Failed');
    assert.equal(receipt.artifactVerification.outcome, 'Worked');
    assert.equal(receipt.publicationReady, false);
    assert.equal(Object.hasOwn(receipt, 'outcome'), false);
    assert.equal(Object.hasOwn(receipt, 'packSha256'), false);
    assert.match(receipt.repositoryChecks.scope, /pack is not loaded/);
    assert.match(receipt.artifactVerification.scope, /no contributor-pack CI, clipping or balance/);
  }
});

test('pack or repository drift is classified independently with no overall pack-admission verdict', () => {
  const receipt = repositoryReceipt({ before: { head: 'test-pin', files: {} }, stableInputs: false, results: [],
    verified: { artifact: 'synthetic', packSha256: 'a' }, afterPack: { packSha256: 'b' } });
  assert.equal(receipt.repositoryChecks.outcome, 'Blocked');
  assert.equal(receipt.artifactVerification.outcome, 'Blocked');
  assert.equal(receipt.publicationReady, false);
});
