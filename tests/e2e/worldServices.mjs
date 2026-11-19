/** Built home-service region acceptance. Public controller commands/menus, private fresh browser profiles.
 * First produce fixtures: WORLD_SERVICE_FIXTURE_OUT=<dir> npx vitest run tests/unit/world/homeServicesBuiltFixture.test.ts
 * Then npm run build; node tests/e2e/worldServices.mjs --fixtures=<dir> --out=<dir>.
 * This checks command boundaries and menu eligibility; it does not claim the gated build/respec UI is enabled.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPreview } from './lib/server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const arg=(key)=>process.argv.find(s=>s.startsWith(`--${key}=`))?.slice(key.length+3);
const fixtures=arg('fixtures'),out=arg('out');
assert(fixtures&&out,'--fixtures=<generated dir> and --out=<new evidence dir> required');
assert(!existsSync(out),'Evidence directory already exists');mkdirSync(out,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(readFileSync(join(fixtures,'manifest.json'),'utf8'));
const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
assert.equal(git('diff','HEAD','--','src'),'','Dirty product source');
const report={pin:git('rev-parse','HEAD'),src:git('rev-parse','HEAD:src'),producer:hash(readFileSync(new URL('../unit/world/homeServicesBuiltFixture.test.ts',import.meta.url))),driver:hash(readFileSync(new URL(import.meta.url))),cases:[],errors:[],warnings:[],status:'Failed'};
report.compiledPin=arg('compiled-pin')??report.pin;assert.equal(git('rev-parse',`${report.compiledPin}:src`),report.src,'Compiled source differs');
let server,browser;
try{
 const dist=resolve(root,'dist'),html=readFileSync(join(dist,'index.html'));
 const entry=html.toString().match(/<script[^>]+src="([^"]+)"/);assert(entry,'No built script');
 server=await startPreview({root,distDir:dist,log:()=>{}});
 assert.equal(hash(Buffer.from(await(await fetch(server.url)).arrayBuffer())),hash(html));
 const entryPath=entry[1].replace(/^\//,'');const entryBytes=readFileSync(join(dist,entryPath));
 assert.equal(hash(Buffer.from(await(await fetch(new URL(entry[1],server.url))).arrayBuffer())),hash(entryBytes));
 report.served={index:hash(html),entry:entryPath,entrySha256:hash(entryBytes)};
 browser=await chromium.launch({headless:true,args:['--mute-audio','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});report.browserVersion=browser.version();
 for(const fixture of manifest.cases){
  const bytes=readFileSync(join(fixtures,`${fixture.name}.alsave`));assert.equal(hash(bytes),fixture.sha256);
  const context=await browser.newContext({viewport:{width:1280,height:720}}),page=await context.newPage();
  page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());else if(m.type()==='warning')report.warnings.push(m.text());});
  await page.goto(server.url);await page.waitForFunction(()=>window.__afterlife?.game.screen==='menu',undefined,{timeout:60000});
  const imported=await page.evaluate(async({base64,fixture})=>{
   const g=window.__afterlife.game;g.updateSettings({quality:'low',reduceMotion:true,tutorialEnabled:false,autonomy:'off'});g.economy?.answerAgeGate?.(1990);
   const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));const result=await g.importSave(new File([bytes],`${fixture.name}.alsave`));
   if(!result?.ok)return{ok:false,error:result?.error};if(!g.sim)await g.continueLatest();g.setSpeed(0);
   const a=g.sim?.state.agents[fixture.actorId];return{ok:!!a,fatal:g.fatalError,region:a?.regionId??g.sim.state.town.homeLotId,ids:fixture.ids};
  },{base64:bytes.toString('base64'),fixture});
  assert(imported.ok,JSON.stringify(imported));assert.equal(imported.fatal,null);assert.equal(imported.region,fixture.actorRegion);
  const observed=await page.evaluate(f=>{
   const g=window.__afterlife.game,sim=g.sim;const before=JSON.stringify(sim.serialize());
   const menu=(id)=>{g.closeMenu();g.openMenuFor({kind:'object',id},100,100);const entries=g.menu?.entries?.map(e=>e.interactionId)??[];g.closeMenu();return entries;};
   const menus={foreignVault:menu(f.ids.foreignVault),foreignHearth:menu(f.ids.foreignHearth),homeStation:menu(f.ids.homeStation)};
   const hearth=g.home({type:'home',action:'hearthBuy',upgradeId:'wardRest'}),vault=g.home({type:'home',action:'stashPut',material:'bone',units:1});
   const deniedWorldUnchanged=JSON.stringify(sim.serialize())===before;
   const priorRespec=sim.state.homeServices.respecDay[f.actorId]??null;
   const respec=g.home({type:'home',action:'respec',agentId:f.actorId});
   return{menus,hearth,vault,deniedWorldUnchanged,priorRespec,respec,respecDay:sim.state.homeServices.respecDay[f.actorId]??null,fatal:g.fatalError,faults:sim.faults(),foreignFireStillPresent:!!sim.state.objects[f.ids.foreignFire]};
  },fixture);
  assert(!observed.hearth.ok&&/Place the Hearth/.test(observed.hearth.reason),JSON.stringify(observed));
  assert(!observed.vault.ok&&/Place a Crypt Vault/.test(observed.vault.reason),JSON.stringify(observed));
  assert(observed.deniedWorldUnchanged);assert(![...observed.menus.foreignVault,...observed.menus.foreignHearth].some(id=>id.startsWith('__home:')));
  assert.equal(observed.priorRespec,null);assert(observed.foreignFireStillPresent);
  assert.equal(observed.respec.ok,fixture.name==='home',JSON.stringify(observed));
  if(fixture.name==='away')assert.match(observed.respec.reason,/not at home/);
  else {assert.notEqual(observed.respecDay,null);assert(observed.menus.homeStation.includes('__home:embalming'));await page.evaluate(id=>window.__afterlife.game.openMenuFor({kind:'object',id},100,100),fixture.ids.homeStation);await page.getByText('Respec at the table',{exact:true}).waitFor({state:'visible',timeout:30000});}
  assert.equal(observed.fatal,null);assert.deepEqual(observed.faults,[]);
  report.cases.push({name:fixture.name,fixtureSha256:fixture.sha256,status:'Worked',observed});
  await page.screenshot({path:join(out,`${fixture.name}.png`)});await context.close();
 }
 assert.equal(report.cases.length,2);assert.deepEqual(report.errors,[]);report.status='Worked';
}catch(e){report.error=String(e.stack??e);process.exitCode=1;}
finally{await browser?.close();await server?.stop();writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({status:report.status,cases:report.cases.length,error:report.error}));
