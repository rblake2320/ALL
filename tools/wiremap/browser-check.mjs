import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {createServer} from './serve.mjs';
import {buildMap} from './generate.mjs';
import {sealEntry,sha256,GENESIS} from '../../scripts/lib/featureLedger.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const project=path.resolve(process.argv[2]||'.'),output=path.resolve(process.argv[3]||'docs/wiremap/evidence');fs.mkdirSync(output,{recursive:true});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'wiremap-browser-')),checks=[],servers=[],errors=[];
const put=(name,text)=>{const p=path.join(root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);};
const hash='a'.repeat(40);put('src/main.ts',`import './utility.js';`);put('src/utility.ts','export {};');put('tests/unit/example.test.ts','export {};');
const registry=JSON.stringify({features:[{id:'example',name:'Example feature',tests:['tests/unit/example.test.ts']}]});put('docs/verification/features.json',registry);
put('docs/verification/ledger.jsonl',JSON.stringify(sealEntry({seq:1,ts:'2026-11-06T00:00:00Z',commit:hash,dirty:false,registrySha:sha256(registry),results:{example:{status:'pass',passed:1,failed:0}}},GENESIS))+'\n');
const probe=(_r,c,a)=>a[0]==='rev-parse'?{ok:true,output:a[1]==='--show-toplevel'?root:hash}:a[0]==='status'?{ok:true,output:''}:{ok:false,error:'fixture offline'};
let fail=false;
async function serve(options){const server=createServer(options);servers.push(server);server.listen(0,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${server.address().port}`;}
let browser;
try {
 const url=await serve({root,generate:()=>{if(fail)throw Error('intentional refresh failure');return buildMap(root,{offline:true,probe});}});
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.getByText('Refreshed ',{exact:false}).waitFor();checks.push('rendered actual HTTP map');
 await page.getByLabel('Group',{exact:true}).selectOption('Features');assert.equal(await page.locator('#list .row').count(),1);checks.push('group filter');
 await page.getByLabel('Status',{exact:true}).selectOption('Working');assert.equal(await page.locator('#list .row').count(),1);checks.push('status filter');
 await page.locator('[data-node="feature:example"]').click();await page.getByRole('heading',{name:'Executed feature evidence'}).waitFor();assert((await page.locator('#detail').innerText()).includes(hash));checks.push('node selection exposes exact receipt identity');
 const source=page.locator('#detail a').filter({hasText:'tests/unit/example.test.ts'}).first();const response=await page.request.get(new URL(await source.getAttribute('href'),url).href);assert.equal(response.status(),200);assert.equal(await response.text(),'export {};');checks.push('source/test link returns actual file');
 await page.getByLabel('Group',{exact:true}).selectOption('all');await page.getByLabel('Status',{exact:true}).selectOption('all');await page.getByLabel('Search connections').fill('utility');assert(await page.locator('#list .row').count()>0);checks.push('search finds connected source');
 await page.getByLabel('Search connections').fill('');put('src/added.ts','export {};');await page.getByRole('button',{name:'Refresh now'}).click();await page.locator('[data-node="src/added.ts"]').waitFor();checks.push('refresh observes changed fixture');
 fail=true;await page.getByRole('button',{name:'Refresh now'}).click();await page.getByText('Refresh failed:',{exact:false}).waitFor();assert.equal(await page.locator('.badge.Working').count(),0);await page.getByLabel('Status',{exact:true}).selectOption('Stale');assert(await page.locator('#list .row').count()>0);checks.push('failed refresh demotes every Working badge to Stale');
 await page.screenshot({path:path.join(output,'refresh-failure.png'),fullPage:true});
 fail=false;await page.getByRole('button',{name:'Refresh now'}).click();await page.getByText('Refreshed ',{exact:false}).waitFor();await page.getByLabel('Status',{exact:true}).selectOption('Working');assert(await page.locator('#list .row').count()>0);checks.push('successful retry restores verified fixture state');
 await page.getByLabel('Status',{exact:true}).selectOption('all');put('src/watched.ts','export {};');await page.getByLabel('Watch every 45s').check();await page.locator('[data-node="src/watched.ts"]').waitFor({timeout:50000});await page.getByLabel('Watch every 45s').uncheck();checks.push('real 45-second watch observes a changed fixture');
 const live=buildMap(project);fs.writeFileSync(path.join(output,'live-map.json'),JSON.stringify(live,null,2));
 const liveUrl=await serve({root:project,generate:()=>buildMap(project)});await page.goto(liveUrl);await page.locator('[data-node="journey:start"]').waitFor();await page.locator('[data-node="journey:start"]').click();assert(await page.locator('#detail svg line').count()>0);checks.push('real project journey graph connects to tests and features');
 await page.screenshot({path:path.join(output,'live-map-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'live-map-mobile.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));checks.push('390px layout does not overflow');
 await page.getByLabel('Group',{exact:true}).selectOption('Integration');await page.locator('[data-node="integration:github-ci"]').click();await page.getByRole('heading',{name:'GitHub check runs'}).waitFor();assert((await page.locator('#detail').innerText()).includes('Checked integration commit:'));checks.push('GitHub check identity and results are selectable');
 assert.deepEqual(errors,[]);checks.push('no browser page errors');
 fs.writeFileSync(path.join(output,'browser-report.json'),JSON.stringify({outcome:'Worked',observedAt:new Date().toISOString(),browser:await browser.version(),checks,errors,sourceIdentity:live.identity,liveIntegrations:live.integrations},null,2));
 console.log(JSON.stringify({outcome:'Worked',checks:checks.length,output,liveIntegrations:live.integrations},null,2));
}catch(error){fs.writeFileSync(path.join(output,'browser-failure.json'),JSON.stringify({outcome:'Failed',checks,errors,error:String(error)},null,2));throw error;}
finally{if(browser)await browser.close();for(const server of servers)await new Promise(r=>server.close(r));assert(root.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(root).startsWith('wiremap-browser-'));fs.rmSync(root,{recursive:true,force:true});}
