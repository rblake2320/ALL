import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve,sep,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
// Baseline mode exercises the OLD actual source() function, exporting it only for this probe.
const base=resolve(tmpdir());const adapter=mkdtempSync(join(base,'astra-source-adapter-'));
const current=await import('./astra-release.mjs');
let api=current;
if(process.env.ASTRA_BASELINE==='1'){
 const old=spawnSync('git',['show','92ca9dd:scripts/release/astra-release.mjs'],{encoding:'utf8',windowsHide:true});assert.equal(old.status,0);
 writeFileSync(join(adapter,'old.mjs'),old.stdout.replace('function source(root){','export function source(root){')+'\nexport function findNpmCli(execPath){const p=join(dirname(execPath),"node_modules/npm/bin/npm-cli.js");if(!existsSync(p))throw Error("npm missing");return p;}\nexport const comparePaths=(a,b)=>a.localeCompare(b,"en");\n');
 api=await import(pathToFileURL(join(adapter,'old.mjs')).href);
}
process.on('exit',()=>{assert(adapter.startsWith(base+sep+'astra-source-adapter-'));rmSync(adapter,{recursive:true,force:true});});
function git(root,...args){const r=spawnSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function fixture(t){const root=mkdtempSync(join(base,'astra-source-'));t.after(()=>{assert(root.startsWith(base+sep+'astra-source-'));rmSync(root,{recursive:true,force:true});});git(root,'init','-q');writeFileSync(join(root,'package.json'),JSON.stringify({version:'1.0.0'}));writeFileSync(join(root,'package-lock.json'),JSON.stringify({version:'1.0.0',packages:{'':{version:'1.0.0'}}}));writeFileSync(join(root,'a.txt'),'original');writeFileSync(join(root,'.gitignore'),'node_modules/\ndist/\nrelease/\nelectron/dist/\n');git(root,'add','.');git(root,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','fixture');return root;}
test('clean source accepted',t=>{const root=fixture(t);assert.equal(api.source(root,'web').version,'1.0.0');});
for(const flag of ['--assume-unchanged','--skip-worktree'])test('rejects masked tracked edit '+flag,t=>{const root=fixture(t);git(root,'update-index',flag,'a.txt');writeFileSync(join(root,'a.txt'),'masked!');assert.equal(git(root,'status','--porcelain'),'');assert.throws(()=>api.source(root,'web'));});
for(const hide of ['info','global'])test('rejects ignored source via '+hide,t=>{const root=fixture(t);mkdirSync(join(root,'src'));const rules='src/hidden.ts\n';if(hide==='info')writeFileSync(join(root,'.git/info/exclude'),rules);else{const excludes=join(root,'.git/test-global-excludes');writeFileSync(excludes,rules);git(root,'config','core.excludesFile',excludes);}writeFileSync(join(root,'src/hidden.ts'),'export const injected=true;');assert.equal(git(root,'status','--porcelain'),'');assert.throws(()=>api.source(root,'web'));});
test('allows only dependency and selected profile output roots',t=>{const root=fixture(t);for(const name of ['node_modules/p','dist/assets']){mkdirSync(join(root,name),{recursive:true});writeFileSync(join(root,name,'a.bin'),'x');}assert.equal(api.source(root,'web').version,'1.0.0');mkdirSync(join(root,'release'));writeFileSync(join(root,'release/old.exe'),'x');assert.throws(()=>api.source(root,'web'));assert.equal(api.source(root,'windows').version,'1.0.0');});
for(const layout of ['windows','nvm'])test('finds npm in '+layout+' layout',t=>{const root=fixture(t);const exe=join(root,'bin/node');const file=layout==='windows'?join(root,'bin/node_modules/npm/bin/npm-cli.js'):join(root,'lib/node_modules/npm/bin/npm-cli.js');mkdirSync(dirname(file),{recursive:true});writeFileSync(file,'// npm fixture');assert.equal(api.findNpmCli(exe),file);});
test('missing npm fails explicitly',t=>{const root=fixture(t);assert.throws(()=>api.findNpmCli(join(root,'bin/node')));});
test('path order distinguishes canonical-equivalent names',()=>{const a='dist/\u00e9.png',b='dist/e\u0301.png';assert.notEqual(api.comparePaths(a,b),0);assert.equal(api.comparePaths(a,b),a<b?-1:1);});
