import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {buildMap,references} from './generate.mjs';
import {createServer} from './serve.mjs';
import {sealEntry,sha256,GENESIS,verifyChain} from '../../scripts/lib/featureLedger.mjs';

const commit='a'.repeat(40);
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wiremap-test-'));
 t.after(()=>{const p=path.resolve(root);assert(p.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(p).startsWith('wiremap-test-'));fs.rmSync(p,{recursive:true,force:true});});
 const put=(name,data)=>{const p=path.join(root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);};
 put('src/main.ts',`import {v} from './util.js'; import './side'; export {x} from './dir'; import('./absent'); import('./'+which); import 'external-lib';`);
 put('src/util.ts','export const v=1;');put('src/side.ts','export {};');put('src/dir/index.ts','export const x=1;');put('tests/unit/sample.test.ts','test("example",()=>{});');
 const reg=JSON.stringify({features:[{id:'example',name:'Example',tests:['tests/unit/sample.test.ts']},{id:'future',name:'Future',status:'planned'}]});
 put('docs/verification/features.json',reg);
 const entry=sealEntry({seq:1,ts:'2026-11-06T00:00:00Z',commit,dirty:false,registrySha:sha256(reg),results:{example:{status:'pass',passed:1,failed:0,files:1}}},GENESIS);
 const ledger=e=>put('docs/verification/ledger.jsonl',JSON.stringify(e)+'\n');ledger(entry);
 const probe=(_root,exe,args)=>{
  if(exe==='git'&&args[0]==='rev-parse')return {ok:true,output:args[1]==='--show-toplevel'?root:commit};
  if(exe==='git'&&args[0]==='status')return {ok:true,output:''};
  return {ok:false,error:'fixture offline'};
 };
 return {root,put,entry,ledger,probe,map:options=>buildMap(root,{offline:true,probe,...options})};
}
test('actual TypeScript parser resolves JS-to-TS, side effects, directory imports; every endpoint exists',t=>{
 const f=fixture(t),map=f.map(),ids=new Set(map.nodes.map(n=>n.id));
 for(const target of ['src/util.ts','src/side.ts','src/dir/index.ts'])assert(map.edges.some(e=>e.from==='src/main.ts'&&e.to===target));
 for(const e of map.edges){assert(ids.has(e.from),e.from);assert(ids.has(e.to),e.to);}
 assert(map.nodes.some(n=>n.id.includes('absent')&&n.status==='Unverified'));
 assert(map.nodes.some(n=>n.id.startsWith('computed:')&&n.status==='Unverified'));
 assert(map.nodes.some(n=>n.id==='external:external-lib'));
});
test('comments and strings are not import edges; syntax errors are explicit',t=>{
 assert.equal(references('a.ts',`// import './fake';\nconst s="import('./fake')";`).refs.length,0);
 const f=fixture(t);f.put('src/broken.ts','const x = ;');assert(f.map().diagnostics.some(d=>d.source==='src/broken.ts'&&d.status==='Blocked'));
});
test('same clean commit and registry may verify feature, never source file or journey',t=>{
 const map=fixture(t).map();assert.equal(map.features[0].status,'Working');assert.equal(map.features[1].status,'Planned');
 assert(map.nodes.filter(n=>n.kind==='file').every(n=>n.status==='Unverified'));
 assert.equal(map.journeys.length,8);assert(map.journeys.every(n=>n.status==='Unproven'));
 assert(map.edges.some(e=>e.from==='feature:example'&&e.to==='tests/unit/sample.test.ts'));
 assert.equal(map.features[0].evidence.commit,commit);
});
for(const reason of ['commit','registry','dirty','local-dirty'])test(`mismatched ${reason} makes prior feature receipt Stale`,t=>{
 const f=fixture(t);let e={...f.entry};if(reason==='commit')e.commit='b'.repeat(40);if(reason==='registry')e.registrySha='b'.repeat(64);if(reason==='dirty')e.dirty=true;
 f.ledger(sealEntry(e,GENESIS));const probe=reason==='local-dirty'?((r,c,a)=>a[0]==='status'?{ok:true,output:' M src/main.ts'}:f.probe(r,c,a)):f.probe;
 assert.equal(f.map({probe}).features[0].status,'Stale');
});
for(const problem of ['malformed','tampered','missing','empty'])test(`ledger ${problem} cannot verify feature`,t=>{
 const f=fixture(t);
 if(problem==='malformed')f.put('docs/verification/ledger.jsonl','{bad');
 if(problem==='tampered')f.ledger({...f.entry,commit:'b'.repeat(40)});
 if(problem==='missing')fs.unlinkSync(path.join(f.root,'docs/verification/ledger.jsonl'));
 if(problem==='empty')f.put('docs/verification/ledger.jsonl','');
 const map=f.map();assert.notEqual(map.features[0].status,'Working');
 if(problem!=='empty')assert(map.diagnostics.some(d=>d.source.endsWith('ledger.jsonl')&&d.status==='Blocked'));
});
test('malformed feature registry is visible, missing test is Blocked, zero-pass result is not Working',t=>{
 const f=fixture(t);f.put('docs/verification/features.json','{bad');assert(f.map().diagnostics.some(d=>d.source.endsWith('features.json')&&d.status==='Blocked'));
 const g=fixture(t);fs.unlinkSync(path.join(g.root,'tests/unit/sample.test.ts'));assert.equal(g.map().features[0].status,'Blocked');
 const h=fixture(t);h.ledger(sealEntry({...h.entry,results:{example:{status:'pass',passed:0,failed:0}}},GENESIS));assert.notEqual(h.map().features[0].status,'Working');
});
test('missing git stays unknown; remote Git is correctly named; unavailable checks are Blocked',t=>{
 const f=fixture(t),map=f.map({probe:()=>({ok:false,error:'command unavailable'})});
 assert.equal(map.identity.workingTree,'unknown');assert.equal(map.integrations[0].name,'Remote Git');assert(map.integrations.every(i=>i.status==='Blocked'));
});
test('an enclosing Git repository cannot supply a false source identity',t=>{
 const f=fixture(t),map=f.map({probe:(r,c,a)=>a[1]==='--show-toplevel'?{ok:true,output:path.dirname(f.root)}:f.probe(r,c,a)});
 assert.equal(map.identity.localHead,null);assert.equal(map.identity.workingTree,'unknown');assert.notEqual(map.features[0].status,'Working');
});
for(const mode of ['correct','wrong','missing','unsealed'])test(`keyed ledger ${mode} key/seal handling fails closed`,t=>{
 const f=fixture(t),key='unit-test-only';
 if(mode!=='unsealed')f.ledger(sealEntry(f.entry,GENESIS,key));
 const map=f.map({ledgerKey:mode==='missing'?undefined:mode==='wrong'?'wrong-unit-test-key':key});
 assert.equal(map.features[0].status,mode==='correct'?'Working':'Blocked');
 assert.equal(JSON.stringify(map).includes(key),false);
 if(mode==='correct')assert(map.nodes.find(n=>n.id==='evidence:ledger').detail.includes('1 HMAC seals verified'));
});
for(const sealedIndex of [0,1])test(`mixed ledger with sealed entry ${sealedIndex+1} is Blocked with correct key`,t=>{
 const f=fixture(t),key='mixed-ledger-test-key';
 const first=sealEntry(f.entry,GENESIS,sealedIndex===0?key:undefined);
 const second=sealEntry({...f.entry,seq:2},first.hash,sealedIndex===1?key:undefined);
 const entries=[first,second];
 assert.equal(verifyChain(entries).ok,true,'negative control must have an otherwise valid hash chain');
 f.put('docs/verification/ledger.jsonl',entries.map(e=>JSON.stringify(e)).join('\n')+'\n');
 const map=f.map({ledgerKey:key}),ledger=map.nodes.find(n=>n.id==='evidence:ledger');
 assert.equal(map.features[0].status,'Blocked');
 assert.equal(ledger.status,'Blocked');
 assert.match(ledger.detail,/no HMAC seal/);
 assert.equal(ledger.detail.includes('HMAC seals verified'),false);
 assert.equal(JSON.stringify(map).includes(key),false);
});
test('CI requires complete returned coverage and at least one success; failed checks remain Failed',t=>{
 const f=fixture(t);
 for(const [body,expected] of [[{total_count:1,check_runs:[{status:'completed',conclusion:'success'}]},'Working'],[{total_count:1,check_runs:[{status:'completed',conclusion:'failure'}]},'Failed'],[{total_count:2,check_runs:[{status:'completed',conclusion:'success'}]},'Unverified'],[{total_count:1,check_runs:[{status:'completed',conclusion:'skipped'}]},'Unverified']]){
  const probe=(r,c,a)=>c==='gh'?{ok:true,output:JSON.stringify(body)}:a[0]==='ls-remote'?{ok:true,output:commit+' refs/heads/ship/final-phase'}:a[0]==='remote'?{ok:true,output:'git@github.com:rblake2320/afterlife-lease.git'}:f.probe(r,c,a);
  assert.equal(f.map({offline:false,probe}).integrations[1].status,expected);
 }
});
async function listen(t,options){const s=createServer(options);s.listen(0,'127.0.0.1');await once(s,'listening');t.after(()=>new Promise(resolve=>s.close(resolve)));return `http://127.0.0.1:${s.address().port}`;}
test('HTTP refresh observes changed fixture; failure returns 503 instead of cached green data',async t=>{
 const f=fixture(t);let fail=false;const url=await listen(t,{root:f.root,generate:()=>{if(fail)throw Error('forced failure');return f.map();}});
 let response=await fetch(url+'/api/map');assert.equal(response.status,200);assert.equal((await response.json()).features[0].status,'Working');
 f.put('src/new.ts','export {};');assert((await (await fetch(url+'/api/map')).json()).nodes.some(n=>n.id==='src/new.ts'));
 fail=true;response=await fetch(url+'/api/map');assert.equal(response.status,503);const body=await response.json();assert.equal(body.stale,true);assert.equal(body.nodes,undefined);
});
test('loopback serves actual source; rejects traversal, arbitrary files, symlinks, methods and unknown routes',async t=>{
 const f=fixture(t);const secret=path.join(path.dirname(f.root),'wiremap-outside-'+path.basename(f.root));fs.writeFileSync(secret,'private');t.after(()=>fs.unlinkSync(secret));
 f.put('.env','private');fs.symlinkSync(path.dirname(f.root),path.join(f.root,'src','outside'),'junction');
 const url=await listen(t,{root:f.root,generate:()=>f.map()});
 const source=await fetch(url+'/api/source?path=src%2Futil.ts');assert.equal(source.status,200);assert.equal(await source.text(),'export const v=1;');
 for(const p of ['../'+path.basename(secret),'.env','src/outside/'+path.basename(secret),'src/%2e%2e/.env'])assert.equal((await fetch(url+'/api/source?path='+encodeURIComponent(p))).status,404);
 assert.equal((await fetch(url+'/missing')).status,404);assert.equal((await fetch(url+'/api/map',{method:'POST'})).status,405);
});
