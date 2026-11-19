import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve,sep} from 'node:path';
import {inventory,verifyArtifacts} from './astra-release.mjs';
const commit='a'.repeat(40);
async function fixture(t){const base=resolve(tmpdir()),root=mkdtempSync(join(base,'astra-release-'));t.after(()=>{assert(root.startsWith(base+sep+'astra-release-'));rmSync(root,{recursive:true,force:true});});mkdirSync(join(root,'dist/assets'),{recursive:true});writeFileSync(join(root,'dist/index.html'),'good');writeFileSync(join(root,'dist/assets/model.bin'),'model');return {root,receipt:{schema:1,status:'built',profile:'web',source:{commit,version:'1.0.0'},files:await inventory(root,['dist'])}};}
test('real files verify with exact inventory',async t=>{const {root,receipt}=await fixture(t);assert.equal((await verifyArtifacts(root,receipt,commit)).files,2);});
for(const [name,mutate] of [
 ['changed bytes of equal length',({root})=>writeFileSync(join(root,'dist/index.html'),'evil')],
 ['added artifact',({root})=>writeFileSync(join(root,'dist/extra.js'),'x')],
 ['missing artifact',({root})=>rmSync(join(root,'dist/index.html'))],
 ['duplicate row',({receipt})=>receipt.files.push({...receipt.files[0]})],
 ['path traversal',({receipt})=>receipt.files[0].path='../outside'],
 ['Windows absolute path',({receipt})=>receipt.files[0].path='C:/outside'],
 ['backslash escape',({receipt})=>receipt.files[0].path='dist\\..\\outside'],
 ['wrong commit',({receipt})=>receipt.source.commit='b'.repeat(40)],
 ['failed build receipt',({receipt})=>receipt.status='failed'],
 ['empty inventory',({receipt})=>receipt.files=[]],
 ['unknown profile',({receipt})=>receipt.profile='__proto__'],
 ['invalid digest',({receipt})=>receipt.files[0].sha256='not-a-hash'],
 ['fractional size',({receipt})=>receipt.files[0].bytes=1.5],
 ['missing installer',({receipt})=>receipt.profile='windows'],
])test('rejects '+name,async t=>{const f=await fixture(t);mutate(f);await assert.rejects(verifyArtifacts(f.root,f.receipt,commit));});
test('rejects linked directories even inside artifact root',async t=>{const f=await fixture(t);symlinkSync(join(f.root,'dist/assets'),join(f.root,'dist/link'),process.platform==='win32'?'junction':'dir');await assert.rejects(inventory(f.root,['dist']),/linked artifact/);});
