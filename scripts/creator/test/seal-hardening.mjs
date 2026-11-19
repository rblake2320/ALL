// Explicit evidence packager: caller supplies private raw-log directory; never changes originals.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { kit,repo,sha } from '../core.mjs';
import { pathRedactor } from '../privacy.mjs';
const [raw]=process.argv.slice(2);
if(!raw||process.argv.length!==3)throw Error('Supply retained private log directory');
const target=path.join(repo,'docs/desktop-reports/sol-creator-hardening-evidence');fs.mkdirSync(target);
const roots=[{path:repo,label:'repo'},{path:raw,label:'evidence-workspace'},{path:os.homedir(),label:'home'}];
const {redact}=pathRedactor(roots),manifest=[];
function copyText(from,rel,scrub=true){
  const original=fs.readFileSync(from),text=original.toString('utf8'),bytes=scrub?Buffer.from(redact(text)):original;
  const dest=path.join(target,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes,{flag:'wx'});
  manifest.push({path:rel,originalSha256:sha(original),sha256:sha(bytes),sanitized:!bytes.equals(original)});
}
for(const name of ['creator-before-hardening.txt','creator-before-mcp-corrected.txt','creator-overlap-boundary-before.txt','creator-stream-progress-before.txt','creator-pinned-build.txt','creator-pinned-tests.txt','creator-feature-gates.txt','creator-pinned-log-summary.txt','creator-pinned-demo-summary.txt','checkout-v4.json','setup-node-v4.json'])copyText(path.join(raw,name),'logs/'+name);
const provenance=JSON.parse(fs.readFileSync(path.join(kit,'generated/provenance.json'),'utf8'));
for(const name of [...Object.keys(provenance.kitInputs),'test/checks.test.mjs','test/mcp.test.mjs','test/creator.test.mjs','test/provenance.test.mjs','test/live-check-log.mjs','test/seal-hardening.mjs','test/check-evidence.mjs','generated/engine.mjs','generated/provenance.json'])copyText(path.join(kit,name),'sources/'+name,false);
for(const [name,hash] of Object.entries(provenance.inputs)){
  const from=path.resolve(kit,name),relative=path.relative(repo,from).replaceAll('\\','/');
  if(relative.startsWith('../')||path.isAbsolute(relative))throw Error('Engine input escapes repo');
  if(sha(fs.readFileSync(from))!==hash)throw Error('Engine source changed');
  copyText(from,'engine-inputs/'+relative,false);
}
for(const [name,prefix] of [['creator-pinned-demo','demo'],['creator-pinned-log','live-log']]) {
  const base=path.join(raw,name);
  for(const file of fs.readdirSync(base,{recursive:true,withFileTypes:true}).filter(d=>d.isFile())) {
    const from=path.join(file.parentPath,file.name),rel=path.relative(base,from).replaceAll('\\','/');copyText(from,prefix+'/'+rel);
  }
}
fs.writeFileSync(path.join(target,'publication-map.json'),JSON.stringify({format:'creator-log-publication-v1',note:'Raw originals remain private. Display copies automatically scrub known host roots; raw and published identities are separate.',files:manifest},null,2)+'\n');
const files=[];
for(const d of fs.readdirSync(target,{recursive:true,withFileTypes:true}).filter(d=>d.isFile())) {
  const file=path.join(d.parentPath,d.name),rel=path.relative(target,file).replaceAll('\\','/');
  const bytes=fs.readFileSync(file);files.push({path:rel,bytes:bytes.length,sha256:sha(bytes)});
  if(redact(bytes.toString('utf8'))!==bytes.toString('utf8'))throw Error('Unredacted host root remains in '+rel);
}
const pin=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
fs.writeFileSync(path.join(target,'seal.json'),JSON.stringify({format:'sol-creator-hardening-v1',sourcePin:pin,files:files.sort((a,b)=>a.path.localeCompare(b.path))},null,2)+'\n');
console.log(JSON.stringify({files:files.length,pin,status:'Worked'}));
