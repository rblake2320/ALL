import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(new URL('./validator/package.json',import.meta.url));
const validator=require('gltf-validator');
const out=path.resolve(process.argv[2]);
if(fs.existsSync(out))throw Error('Refusing to overwrite format-validation evidence');
fs.mkdirSync(out,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex'),rows=[];
for(const directory of process.argv.slice(3)){
 for(const name of fs.readdirSync(directory).filter(n=>n.endsWith('.glb'))){
  const file=path.join(directory,name),bytes=fs.readFileSync(file);
  let result;
  try{
   const report=await validator.validateBytes(new Uint8Array(bytes),{uri:name,maxIssues:1000,externalResourceFunction:async uri=>{throw Error('External resource forbidden: '+uri);}});
   result={file:file.replaceAll('\\','/'),sha256:hash(bytes),outcome:report.issues.numErrors?'Failed':report.issues.truncated?'Blocked':'Worked',report};
  }catch(error){result={file:file.replaceAll('\\','/'),sha256:hash(bytes),outcome:'Failed',error:String(error)};}
  rows.push(result);
 }
}
const result={validator:validator.version(),packageLockSha256:hash(fs.readFileSync(new URL('./validator/package-lock.json',import.meta.url))),observedAt:new Date().toISOString(),rows};
fs.writeFileSync(path.join(out,'format-report.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({validator:result.validator,files:rows.length,worked:rows.filter(r=>r.outcome==='Worked').length,failed:rows.filter(r=>r.outcome==='Failed').length,blocked:rows.filter(r=>r.outcome==='Blocked').length}));
process.exitCode=rows.length&&rows.every(r=>r.outcome==='Worked')?0:1;
