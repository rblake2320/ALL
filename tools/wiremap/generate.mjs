import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import {parseLedger, verifyChain, validateRegistry, expandTests, sha256, writeAtomic} from '../../scripts/lib/featureLedger.mjs';

const roots = ['src','electron','tests','public','tools','scripts','docs'];
const excluded = new Set(['node_modules','.git','dist','coverage','parked-luna-20261106','evidence']);
const posix = p => p.split(path.sep).join('/');
export function inventory(root) {
  const files=[];
  function walk(dir) {
    for(const item of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      if(excluded.has(item.name)||item.isSymbolicLink()) continue;
      const p=path.join(dir,item.name), rel=posix(path.relative(root,p));
      if(item.isDirectory()) walk(p);
      else if(item.isFile() && !rel.startsWith('docs/wiremap/')) files.push(rel);
    }
  }
  for(const dir of roots) if(fs.existsSync(path.join(root,dir))) walk(path.join(root,dir));
  for(const file of ['package.json','tsconfig.json','vite.config.ts','index.html']) if(fs.existsSync(path.join(root,file))) files.push(file);
  return files;
}
export function command(root, executable, args) {
  try {return {ok:true,output:execFileSync(executable,args,{cwd:root,encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']}).trim()};}
  catch(e) {return {ok:false,error:e.code==='ETIMEDOUT'?'timeout':e.code==='ENOENT'?'command unavailable':`command exited ${e.status??e.code??'unknown'}`};}
}
function group(file) {
  if(file.startsWith('tests/')) return 'Tests';
  if(file.startsWith('public/')) return 'Assets';
  if(file.startsWith('src/sim/')) return 'Simulation';
  if(file.startsWith('src/render/')) return 'Renderer';
  if(file.startsWith('src/persistence/')) return 'Persistence';
  if(file.startsWith('src/')) return 'Game and UI';
  return 'Build and documentation';
}
export function references(file,text) {
  const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true), refs=[];
  function push(node,expr,type) {
    refs.push({specifier:expr && ts.isStringLiteralLike(expr)?expr.text:null,type,line:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1});
  }
  function visit(n) {
    if(ts.isImportDeclaration(n)||ts.isExportDeclaration(n)) {if(n.moduleSpecifier) push(n,n.moduleSpecifier,'static-import');}
    if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword) push(n,n.arguments[0],'dynamic-import');
    ts.forEachChild(n,visit);
  }
  visit(ast);
  return {refs,problems:ast.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' '))};
}
function resolveRelative(from,spec,files) {
  const target=path.posix.normalize(path.posix.join(path.posix.dirname(from),spec));
  const stem=target.replace(/\.(mjs|cjs|jsx|js)$/, '');
  // Match TS's extension substitution before JS; explicit existing .ts remains intact.
  const candidates=stem!==target?[stem+'.ts',stem+'.tsx',stem+'.mts',stem+'.cts',target]:[target,target+'.ts',target+'.tsx',target+'.js',target+'.mjs',target+'.json',target+'/index.ts',target+'/index.tsx',target+'/index.js'];
  return candidates.find(p=>files.has(p));
}
const journeySpecs=[
 ['start','Start → age gate → create household → playable lot',['tests/e2e/flow.mjs'],['game-controller','ui-shell']],
 ['interaction','Input → controller → simulation → visible result',['tests/e2e/flow.mjs'],['input-mouse-keyboard','sim-engine','renderer']],
 ['build-save','Buy/build/place → asset → save → reload',['tests/e2e/flow.mjs','tests/e2e/placement.mjs'],['persistence','game-controller']],
 ['economy','Quest / economy transaction → wallet UI → reload',[],['economy','quests','store-ui']],
 ['travel','Level selection → travel → level assets',[],[]],
 ['creatures','Townie / pet action → animation runtime',['tests/e2e/flow.mjs'],['characters','pets-art']],
 ['desktop','Packaged install → launch → save → uninstall',['tests/desktop/electron-verify.mjs','docs/desktop-reports/windows-verify.md'],['desktop-shell']],
 ['identity','Shipped bundle identity → source commit → matching tests',['scripts/verify-features.mjs'],['feature-ledger']],
];
export function buildMap(root,{offline=false,probe=command,ledgerKey=process.env.VERIFY_LEDGER_KEY||undefined}={}) {
  root=path.resolve(root);
  const files=inventory(root), fileSet=new Set(files), nodes=[],edges=[],diagnostics=[];
  const add=n=>{if(!nodes.some(x=>x.id===n.id))nodes.push(n);};
  const node=(id,label,kind,status='Unverified',detail='')=>add({id,label,kind,group:kind,status,detail});
  const edge=(from,to,type,detail='',line=null)=>edges.push({from,to,type,status:'Unverified',detail,line});
  for(const file of files) add({id:file,label:path.basename(file),kind:'file',group:group(file),source:file,status:'Unverified',detail:'Source inventory; no runtime health inferred.'});
  const top=probe(root,'git',['rev-parse','--show-toplevel']);
  const sameRoot=top.ok&&path.resolve(top.output).toLowerCase()===root.toLowerCase();
  const head=sameRoot?probe(root,'git',['rev-parse','HEAD']):{ok:false,error:'Source root is not the Git worktree root'};
  const tree=sameRoot?probe(root,'git',['status','--porcelain']):{ok:false,error:'Source root is not the Git worktree root'};
  if(!sameRoot)diagnostics.push({source:'git identity',status:'Blocked',detail:'Cannot bind this source inventory to the Git worktree root.'});
  const remote=offline?{ok:false,error:'offline mode'}:probe(root,'git',['ls-remote','origin','refs/heads/ship/final-phase']);
  const remoteSha=remote.ok?remote.output.split(/\s+/)[0]:null;
  const integrations=[{id:'remote-git',name:'Remote Git',status:remote.ok?'Working':'Blocked',detail:remote.ok?'git ls-remote returned the integration ref. This is connectivity, not game health.':remote.error}];
  node('integration:remote-git','Remote Git','Integration',integrations[0].status,integrations[0].detail);
  const origin=offline?{ok:false}:probe(root,'git',['remote','get-url','origin']);
  const repository=origin.ok?origin.output.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1]:null;
  const ci=repository&&/^[a-f0-9]{40}$/.test(remoteSha||'')?probe(root,'gh',['api',`repos/${repository}/commits/${remoteSha}/check-runs?per_page=100`]):{ok:false,error:offline?'offline mode':'GitHub repository/ref unavailable'};
  let ciData;
  try {
    if(!ci.ok) throw Error(ci.error);
    const parsed=JSON.parse(ci.output);
    if(!Array.isArray(parsed.check_runs)||!Number.isInteger(parsed.total_count)) throw Error('invalid check-run response');
    const runs=parsed.check_runs;
    const incomplete=runs.some(r=>r.status!=='completed'), failed=runs.some(r=>r.status==='completed'&&!['success','neutral','skipped'].includes(r.conclusion));
    ciData={id:'github-ci',name:'GitHub checks',status:failed?'Failed':incomplete?'Unverified':runs.some(r=>r.conclusion==='success')&&parsed.total_count===runs.length?'Working':'Unverified',commit:remoteSha,detail:`${runs.length} of ${parsed.total_count} checks fetched; source checks are not a player journey.`,checks:runs.map(r=>({name:r.name,status:r.status,conclusion:r.conclusion,url:r.html_url}))};
  } catch(e) {ciData={id:'github-ci',name:'GitHub checks',status:'Blocked',detail:e.message};}
  integrations.push(ciData); node('integration:github-ci','GitHub checks','Integration',ciData.status,ciData.detail);
  Object.assign(nodes.find(n=>n.id==='integration:github-ci'),{checks:ciData.checks||[],commit:ciData.commit||null});
  edge('integration:remote-git','integration:github-ci','commit-checks');
  for(const file of files.filter(f=>/\.(tsx?|jsx?|mjs|cjs|mts|cts)$/.test(f))) {
    const parsed=references(file,fs.readFileSync(path.join(root,file),'utf8'));
    for(const problem of parsed.problems) diagnostics.push({source:file,status:'Blocked',detail:problem});
    for(const r of parsed.refs) {
      let target;
      if(r.specifier===null) {target=`computed:${file}:${r.line}`;node(target,'Computed import','Unresolved','Unverified','Runtime expression cannot be resolved statically.');}
      else if(!r.specifier.startsWith('.')) {target=`external:${r.specifier}`;node(target,r.specifier,'External','Unverified','Package, alias, or platform import; not runtime-tested here.');}
      else {target=resolveRelative(file,r.specifier,fileSet);if(!target){target=`unresolved:${file}:${r.specifier}`;node(target,r.specifier,'Unresolved','Unverified','Literal reference was not resolved by this scanner; this is not an observed product failure.');}}
      edge(file,target,r.type,r.specifier===null?'computed import':r.specifier,r.line);
    }
  }
  node('product-data','Declared product data','Declaration');
  for(const file of files.filter(f=>/manifest.*\.json$/.test(f))) edge(file,'product-data','manifest-declaration');
  let registry,latest=null,ledgerStatus='Blocked',ledgerDetail='',registryText='';
  try {registryText=fs.readFileSync(path.join(root,'docs/verification/features.json'),'utf8'); registry=JSON.parse(registryText);const problems=validateRegistry(registry);if(problems.length)throw Error(problems.join('; '));}
  catch(e) {diagnostics.push({source:'docs/verification/features.json',status:'Blocked',detail:`feature registry: ${e.message}`});registry=null;}
  try {
    const raw=fs.readFileSync(path.join(root,'docs/verification/ledger.jsonl'),'utf8');
    const parsed=parseLedger(raw);
    if(parsed.entries.some(e=>e.mac)&&!ledgerKey)throw Error('Keyed ledger requires VERIFY_LEDGER_KEY; authentication unavailable');
    const chain=verifyChain(parsed.entries,ledgerKey);
    if(parsed.tornTail!==null) throw Error('ledger has a torn or malformed last line');
    if(!chain.ok) throw Error(chain.problems.join('; '));
    latest=parsed.entries.at(-1)||null; ledgerStatus=latest?'Working':'Unverified';
    ledgerDetail=ledgerKey?`W-090 hash chain and ${chain.keyed} HMAC seals verified; ${parsed.entries.length} entries.`:`Hash-chain integrity checked by W-090 verifier; ${parsed.entries.length} entries. Unkeyed integrity is not authenticated provenance.`;
  } catch(e) {ledgerDetail=`ledger: ${e.message}`;diagnostics.push({source:'docs/verification/ledger.jsonl',status:'Blocked',detail:ledgerDetail});}
  node('evidence:ledger','W-090 feature ledger','Evidence',ledgerStatus,ledgerDetail);
  const features=[];
  for(const f of registry?.features||[]) {
    const expansion=expandTests(root,f.tests||[]), result=latest?.results?.[f.id];
    let status='Unverified', detail='No matching executed result.';
    const current=!!(latest&&head.ok&&latest.commit===head.output&&latest.registrySha===sha256(registryText)&&!latest.dirty&&tree.ok&&tree.output==='');
    if(f.status==='planned') {status='Planned';detail='Declared work; no executed proof.';}
    else if(ledgerStatus==='Blocked'||expansion.missing.length){status='Blocked';detail=expansion.missing.length?`Missing tests: ${expansion.missing.join(', ')}`:ledgerDetail;}
    else if(result&&!current){status='Stale';detail='Result commit, registry digest, or clean-tree identity differs from this checkout.';}
    else if(result?.status==='pass'&&result.passed>0&&result.failed===0){status='Working';detail='Feature tests passed for this exact clean source/registry identity. This is test evidence, not an entire journey.';}
    else if(result?.status==='fail'){status='Failed';detail='Feature test result failed for this source identity.';}
    else if(result){status='Blocked';detail=`Recorded result: ${result.status}`;}
    const feature={...f,id:`feature:${f.id}`,featureId:f.id,label:f.name,kind:'feature',group:'Features',status,detail,tests:expansion.files,evidence:result?{commit:latest.commit,observedAt:latest.ts,sequence:latest.seq,result,source:'docs/verification/ledger.jsonl'}:null};
    features.push(feature);add(feature);edge(feature.id,'evidence:ledger','test-evidence');
    for(const test of expansion.files) if(fileSet.has(test))edge(feature.id,test,'registered-test');
  }
  const journeys=[];
  for(const [id,label,paths,featureIds] of journeySpecs) {
    const j={id:`journey:${id}`,label,kind:'journey',group:'Player journeys',status:'Unproven',detail:'Registered coverage below is not a current full-journey execution receipt.',sources:paths.filter(p=>fileSet.has(p)),missingSources:paths.filter(p=>!fileSet.has(p))};
    journeys.push(j);add(j);
    for(const p of j.sources)edge(j.id,p,'coverage-reference');
    for(const f of featureIds)if(features.some(x=>x.featureId===f))edge(j.id,`feature:${f}`,'component-coverage');
  }
  return {schema:2,observedAt:new Date().toISOString(),identity:{localHead:head.ok?head.output:null,remoteShipHead:remoteSha,workingTree:tree.ok?(tree.output?'dirty':'clean'):'unknown',testedBuildIdentity:null},coverage:{files:files.length,nodes:nodes.length,edges:edges.length,omissions:['Computed imports and package/alias resolution remain unverified.','Source links and component tests do not imply full player-journey success.','No game process or shared saves are touched by this viewer.']},nodes,edges,features,journeys,integrations,diagnostics};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2), offline=args.includes('--offline'), paths=args.filter(a=>a!=='--offline');
  const root=path.resolve(paths[0]||'.'), out=path.resolve(paths[1]||path.join(root,'docs/wiremap/generated.json'));
  const data=buildMap(root,{offline});writeAtomic(out,JSON.stringify(data,null,2));
  console.log(JSON.stringify({out,identity:data.identity,coverage:data.coverage,diagnostics:data.diagnostics}));
}
