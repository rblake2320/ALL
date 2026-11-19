#!/usr/bin/env node
// W-094: build receipts and exact artifact verification. No publishing or installation.
import {createHash} from 'node:crypto';
import {createReadStream,existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HEX=/^[a-f0-9]{64}$/;
const PIN=/^[a-f0-9]{40}$/;
const PROFILES={web:['dist'],windows:['dist','electron/dist','release']};
export const comparePaths=(a,b)=>a<b?-1:a>b?1:0;
function requireThat(ok,message){if(!ok)throw Error(message);}
export async function sha(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
function safeName(name){return typeof name==='string'&&name.length>0&&!isAbsolute(name)&&!name.includes('\\')&&!name.includes(':')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..');}
function noLink(root,file){const rel=relative(root,file);requireThat(rel!==''&&!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel),'path escapes artifact root');let p=root;for(const part of rel.split(sep)){p=join(p,part);requireThat(!lstatSync(p).isSymbolicLink(),`linked artifact rejected: ${rel}`);}}
export async function inventory(root,roots){
 const files=[];const visit=async(dir)=>{for(const name of readdirSync(dir).sort()){const file=join(dir,name);noLink(root,file);const st=lstatSync(file);if(st.isDirectory())await visit(file);else{requireThat(st.isFile(),`non-file artifact: ${file}`);files.push({path:relative(root,file).split(sep).join('/'),bytes:st.size,sha256:await sha(file)});}}};
 for(const name of roots){requireThat(safeName(name),'unsafe artifact root');const dir=join(root,name);noLink(root,dir);requireThat(lstatSync(dir).isDirectory(),`artifact root not a directory: ${name}`);await visit(dir);}
 requireThat(files.length>0,'empty artifact inventory');return files.sort((a,b)=>comparePaths(a.path,b.path));
}
function git(root,args){const r=spawnSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});requireThat(r.status===0,`git failed: ${r.error?.message??r.stderr}`);return r.stdout.trim();}
export function source(root,profile='web'){
 requireThat(Object.hasOwn(PROFILES,profile),'unknown source profile');
 const entries=git(root,['ls-files','-v','-z']).split('\0').filter(Boolean);
 requireThat(entries.every(row=>row.startsWith('H ')),'masked or abnormal index entry; clear assume-unchanged/skip-worktree before building');
 requireThat(git(root,['status','--porcelain','--untracked-files=all'])==='','source tree is dirty; commit or park edits before building');
 // Enumerate ignored files too: info/exclude and global excludes can hide glob-imported source.
 // Exact top-level pathspec exclusions avoid accidentally permitting nested source/release folders.
 const allowed=['node_modules',...PROFILES[profile]];
 const hidden=git(root,['ls-files','--others','--ignored','--exclude-standard','-z','--','.',...allowed.map(p=>':(top,exclude)'+p)]);
 requireThat(hidden==='','ignored non-output files present; park them outside the source checkout');
 const commit=git(root,['rev-parse','HEAD']);requireThat(PIN.test(commit),'invalid source commit');
 const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));const lock=JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8'));
 requireThat(typeof pkg.version==='string'&&/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version),'unsupported package version');
 requireThat(lock.version===pkg.version&&lock.packages?.['']?.version===pkg.version,'package and lock versions disagree');
 return {commit,version:pkg.version};
}
export function findNpmCli(execPath=process.execPath){
 const bin=dirname(execPath);
 const candidates=[join(bin,'node_modules/npm/bin/npm-cli.js'),resolve(bin,'../lib/node_modules/npm/bin/npm-cli.js')];
 const found=candidates.find(p=>existsSync(p)&&lstatSync(p).isFile());
 requireThat(found,'npm CLI missing from Node installation (checked Windows and Unix/nvm layouts)');return found;
}
async function runnerIdentity(root){
 const name='scripts/release/astra-release.mjs';const file=resolve(root,name);
 requireThat(file===resolve(fileURLToPath(import.meta.url)),'run the release script belonging to this checkout');
 git(root,['ls-files','--error-unmatch',name]);
 const committed=spawnSync('git',['-C',root,'show','HEAD:'+name],{windowsHide:true,maxBuffer:4*1024*1024});
 requireThat(committed.status===0,'release runner is not committed');
 // Git may check out CRLF on Windows; compare normalized source, retain actual runtime bytes separately.
 requireThat(committed.stdout.toString().replaceAll('\r\n','\n')===readFileSync(file,'utf8').replaceAll('\r\n','\n'),'release runner differs from committed source');
 return sha(file);
}
export async function verifyArtifacts(root,receipt,expectedCommit){
 requireThat(receipt?.schema===1&&receipt.status==='built','receipt is not a completed build');
 requireThat(PIN.test(expectedCommit)&&receipt.source?.commit===expectedCommit,'source commit mismatch');
 const roots=Object.hasOwn(PROFILES,receipt.profile)?PROFILES[receipt.profile]:null;requireThat(roots,'unknown build profile');
 requireThat(Array.isArray(receipt.files)&&receipt.files.length>0,'empty receipt inventory');
 const seen=new Set();for(const f of receipt.files){requireThat(safeName(f.path)&&roots.some(r=>f.path.startsWith(r+'/')),'unsafe or out-of-profile file');requireThat(!seen.has(f.path),'duplicate artifact path');seen.add(f.path);requireThat(Number.isSafeInteger(f.bytes)&&f.bytes>=0&&HEX.test(f.sha256),'invalid artifact digest or size');}
 requireThat(receipt.files.some(f=>f.path==='dist/index.html'),'missing web entry point');
 if(receipt.profile==='windows'){
  requireThat(receipt.files.some(f=>f.path==='electron/dist/main.js'),'missing desktop entry point');
  requireThat(receipt.files.some(f=>f.path===`release/${receipt.source.version}/AfterlifeLease-Setup-${receipt.source.version}-x64.exe`),'missing versioned installer');
 }
 const actual=await inventory(root,roots);const expected=[...receipt.files].sort((a,b)=>comparePaths(a.path,b.path));
 requireThat(actual.length===expected.length,'artifact set changed');
 for(let i=0;i<actual.length;i++)requireThat(actual[i].path===expected[i].path&&actual[i].bytes===expected[i].bytes&&actual[i].sha256===expected[i].sha256,`artifact changed: ${expected[i].path}`);
 return {status:'verified',commit:expectedCommit,version:receipt.source.version,profile:receipt.profile,files:actual.length};
}
function parse(argv){const [action,...rest]=argv;requireThat(['build','verify'].includes(action),'usage: astra-release.mjs build|verify --root PATH --out NEW_DIRECTORY [--profile web|windows] OR verify --root PATH --receipt FILE --receipt-sha256 HASH --commit FULL_SHA');const opt={};for(let i=0;i<rest.length;i+=2){requireThat(['--root','--out','--profile','--receipt','--receipt-sha256','--commit'].includes(rest[i])&&rest[i+1]&&!rest[i+1].startsWith('--')&&!Object.hasOwn(opt,rest[i]),'unknown, duplicate or incomplete option');opt[rest[i]]=rest[i+1];}requireThat(opt['--root'],'--root required');return {action,opt,root:resolve(opt['--root'])};}
export async function main(argv){
 const {action,opt,root}=parse(argv);
 requireThat(!lstatSync(root).isSymbolicLink(),'linked source root rejected');
 const runnerSha256=await runnerIdentity(root);
 if(action==='verify'){
  requireThat(opt['--receipt']&&HEX.test(opt['--receipt-sha256']??'')&&PIN.test(opt['--commit']??''),'receipt, independently retained receipt SHA-256 and full commit required');
  requireThat(await sha(resolve(opt['--receipt']))===opt['--receipt-sha256'],'receipt digest mismatch');
  const receipt=JSON.parse(readFileSync(resolve(opt['--receipt']),'utf8'));const current=source(root,receipt.profile);
  requireThat(receipt.runnerSha256===runnerSha256,'release runner identity differs');
  requireThat(current.commit===opt['--commit']&&current.version===receipt.source?.version,'checkout identity differs from receipt');
  requireThat(await sha(join(root,'package-lock.json'))===receipt.lockSha256,'dependency lock changed');
  return verifyArtifacts(root,receipt,opt['--commit']);
 }
 const profile=opt['--profile']??'web';requireThat(Object.hasOwn(PROFILES,profile),'unknown build profile');
 requireThat(profile!=='windows'||process.platform==='win32','Windows build requires Windows');
 requireThat(opt['--out'],'--out required');const out=resolve(opt['--out']);const rel=relative(root,out);requireThat(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel),'receipt output must be outside source checkout');
 requireThat(!existsSync(out),'receipt directory already exists; use a unique directory');
 const before=source(root,profile);const roots=PROFILES[profile];for(const dir of roots)requireThat(!existsSync(join(root,dir)),`stale output exists: ${dir}; preserve it elsewhere before building`);
 const npm=findNpmCli();
 mkdirSync(out,{recursive:true});
 const receipt={schema:1,status:'building',profile,source:before,runnerSha256,lockSha256:await sha(join(root,'package-lock.json')),node:process.version,platform:process.platform,started:new Date().toISOString(),commands:[],files:[],releaseApproval:'not-assessed',signing:'not-assessed'};
 const run=(label,exe,args)=>{const started=new Date().toISOString();const r=spawnSync(exe,args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});writeFileSync(join(out,label+'.log'),(r.stdout??'')+(r.stderr??'')+(r.error?'\n'+r.error.message:''),{flag:'wx'});receipt.commands.push({label,args,started,finished:new Date().toISOString(),exit:r.status,signal:r.signal});requireThat(r.status===0&&!r.error&&!r.signal,`${label} failed; see ${join(out,label+'.log')}`);};
 try{
  run('install',process.execPath,[npm,'ci','--no-audit','--no-fund']);
  run('types',process.execPath,[npm,'run','typecheck']);
  run('build',process.execPath,[npm,'run',profile==='windows'?'dist:win':'build']);
  run('assets',process.execPath,['scripts/verify-assets.mjs','--root','dist/assets']);
  const after=source(root,profile);requireThat(after.commit===before.commit&&after.version===before.version,'source changed during build');requireThat(await sha(join(root,'package-lock.json'))===receipt.lockSha256,'lock changed during build');
  receipt.files=await inventory(root,roots);receipt.status='built';await verifyArtifacts(root,receipt,before.commit);
 }catch(error){receipt.status='failed';receipt.error=String(error.message);throw error;}
 finally{receipt.finished=new Date().toISOString();writeFileSync(join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});}
 const digest=await sha(join(out,'receipt.json'));writeFileSync(join(out,'receipt.sha256'),digest+'\n',{flag:'wx'});
 return {status:'built',commit:before.commit,version:before.version,profile,files:receipt.files.length,receipt:join(out,'receipt.json'),receiptSha256:digest,releaseApproval:'not-assessed'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
