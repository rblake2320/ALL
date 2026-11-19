// Isolated native HTML export probe. Generated JavaScript executes only in Chromium.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const receiptPath=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);
if(fs.existsSync(out))throw Error('Refusing to overwrite native probe output');
fs.mkdirSync(out,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const lodSource=fs.readFileSync(new URL('./lod.mjs',import.meta.url));
const raw=JSON.parse(fs.readFileSync(receiptPath,'utf8').replace(/^\uFEFF/,''));
const record={sourceResponseSha256:hash(fs.readFileSync(receiptPath)),harnessSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),lodHelperSha256:hash(lodSource),startedAt:new Date().toISOString(),prop:raw.prop,arm:raw.arm,paidCredits:0,routeReplacements:[],blockedRequests:[],pageErrors:[],consoleErrors:[],productionAdmission:'Not admitted; capability probe awaiting review'};
const vendor=path.resolve('node_modules/three');
const baseMetrics=`function metrics(group){group.updateMatrixWorld(true);let triangles=0,meshes=0;const materials=new Set(),names=new Set();group.traverse(n=>{if(n.isMesh){meshes++;triangles+=(n.geometry.index?n.geometry.index.count:n.geometry.attributes.position.count)/3*(n.isInstancedMesh?n.count:1);for(const m of(Array.isArray(n.material)?n.material:[n.material])){materials.add(m);names.add(m.name);}}});const b=new THREE.Box3().setFromObject(group);return {triangles,meshes,materials:materials.size,materialNames:[...names],min:b.min.toArray(),max:b.max.toArray(),size:b.getSize(new THREE.Vector3()).toArray(),center:b.getCenter(new THREE.Vector3()).toArray()};}`;
const measureHTML=`<!doctype html><style>body{margin:0}</style><script type="importmap">{"imports":{"three":"/vendor/build/three.module.js"}}</script><script type="module">
import * as THREE from 'three';import {GLTFLoader} from '/vendor/examples/jsm/loaders/GLTFLoader.js';import {GLTFExporter} from '/vendor/examples/jsm/exporters/GLTFExporter.js';import {SimplifyModifier} from '/vendor/examples/jsm/modifiers/SimplifyModifier.js';import {RoomEnvironment} from '/vendor/examples/jsm/environments/RoomEnvironment.js';import {mergeVertices} from '/vendor/examples/jsm/utils/BufferGeometryUtils.js';import {createLod} from '/audit/lod.mjs';
${baseMetrics}
const b64=b=>{let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s);};
window.measure=async data=>{const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));const asset=(await new GLTFLoader().parseAsync(bytes.buffer,'')).scene;const base=metrics(asset);if(base.meshes===0||base.triangles>100000)throw Error('Empty or excessive exported geometry');
const repeat=await new GLTFExporter().parseAsync(asset,{binary:true,onlyVisible:true}),roundtrip=metrics((await new GLTFLoader().parseAsync(repeat,'')).scene);
const lodResult=createLod(asset,new SimplifyModifier(),mergeVertices),lod=lodResult.asset;const lodMetrics=metrics(lod),lodBuffer=await new GLTFExporter().parseAsync(lod,{binary:true,onlyVisible:true}),lodRoundtrip=metrics((await new GLTFLoader().parseAsync(lodBuffer,'')).scene);
const scene=new THREE.Scene();scene.background=new THREE.Color('#1d1726');scene.add(asset);scene.add(new THREE.HemisphereLight(0xe8e0c8,0x2b2f3a,2));const light=new THREE.DirectionalLight(0xffe5c5,4);light.position.set(4,6,5);scene.add(light);const size=Math.max(...base.size),camera=new THREE.OrthographicCamera(-size*.8*960/720,size*.8*960/720,size*.8,-size*.8,.01,100),target=new THREE.Vector3(...base.center);camera.position.copy(target).add(new THREE.Vector3(size*1.6,size*1.2,size*1.8));camera.lookAt(target);const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(960,720);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;scene.environment=new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(),.04).texture;document.body.appendChild(renderer.domElement);renderer.render(scene,camera);window.showLOD=()=>{asset.visible=false;scene.add(lod);renderer.render(scene,camera);};return {base,roundtrip,lod:lodMetrics,lodRoundtrip,lodAudit:lodResult.audit,lodBinary:b64(new Uint8Array(lodBuffer))};};</script>`;
let html='',server,browser;
const allowedHosts=new Set(['cdn.jsdelivr.net','unpkg.com','esm.sh','cdn.skypack.dev']);
function vendorFile(url){
 let relative;
 if(url.pathname.startsWith('/vendor/'))relative=url.pathname.slice('/vendor/'.length);
 else if(allowedHosts.has(url.hostname)){
  const match=url.pathname.match(/(?:\/npm)?\/three@[^/]+\/(build\/[^?]+|examples\/jsm\/[^?]+)/);
  if(match)relative=match[1];
  else if(/^\/three(?:@[^/]+)?(?:\/?\+esm)?\/?$/.test(url.pathname))relative='build/three.module.js';
 }
 if(!relative)return null;
 const target=path.resolve(vendor,decodeURIComponent(relative));
 return target.startsWith(vendor+path.sep)&&target.endsWith('.js')&&fs.existsSync(target)?target:null;
}
try{
 if(!raw.ended_eos||raw.token_limit_reached)throw Error('Incomplete native response; rejected before browser execution');
 const response=raw.response.split('</think>').at(-1),blocks=[...response.matchAll(/```html\s*([\s\S]*?)```/gi)].map(m=>m[1]);
 html=blocks.filter(x=>/<\/html>/i.test(x)).at(-1)||response.slice(response.search(/<!doctype html|<html/i));
 if(!/<html/i.test(html)||!/<\/html>/i.test(html))throw Error('No complete HTML document');
 fs.writeFileSync(path.join(out,'candidate.html'),html);
 server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost'),file=vendorFile(url);let bytes;
  if(url.pathname==='/audit/lod.mjs'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(lodSource);return;}
  if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(url.pathname==='/')bytes=html;else if(url.pathname==='/measure')bytes=measureHTML;else if(file)bytes=fs.readFileSync(file);else {res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':file?'text/javascript':'text/html','Cache-Control':'no-store','Content-Security-Policy':`default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://esm.sh https://cdn.skypack.dev; style-src 'unsafe-inline'; connect-src ${url.pathname==='/measure'?"'self'":"'none'"}; img-src data: blob:; worker-src 'none'; frame-src 'none'; object-src 'none'`});res.end(bytes);
 });server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu','--enable-unsafe-swiftshader','--use-angle=swiftshader']});record.browser=browser.version();record.three=JSON.parse(fs.readFileSync(path.join(vendor,'package.json'),'utf8')).version;
 async function context(){const c=await browser.newContext({viewport:{width:960,height:720},acceptDownloads:true});await c.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===origin)return route.continue();const f=vendorFile(u);if(f){record.routeReplacements.push({url:u.href,local:path.relative(vendor,f),sha256:hash(fs.readFileSync(f))});return route.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(f),headers:{'Access-Control-Allow-Origin':'*'}});}record.blockedRequests.push(u.href);return route.abort();});return c;}
 const exports=[];
 for(let attempt=1;attempt<=2;attempt++){
  const c=await context();try{const page=await c.newPage();page.on('pageerror',e=>record.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')record.consoleErrors.push(m.text());});await page.goto(origin,{waitUntil:'load',timeout:15000});
   const button=page.getByRole('button',{name:/export.*glb|download.*glb/i}).first();await button.waitFor({timeout:15000});
   const downloadPromise=page.waitForEvent('download',{timeout:30000});await button.click();const download=await downloadPromise;if(await download.failure())throw Error(await download.failure());
   const target=path.join(out,`native-${attempt}.glb`);await download.saveAs(target);const bytes=fs.readFileSync(target);if(bytes.length>50*1024*1024||bytes.subarray(0,4).toString()!=='glTF')throw Error('Invalid or excessive downloaded GLB');exports.push(bytes);await page.screenshot({path:path.join(out,`native-${attempt}.png`)});
  }finally{await c.close();}
 }
 record.byteIdenticalRebuild=exports[0].equals(exports[1]);record.sha256=hash(exports[0]);record.repeatSha256=hash(exports[1]);record.bytes=exports[0].length;
 const c=await context();try{const page=await c.newPage();page.on('pageerror',e=>record.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')record.consoleErrors.push(m.text());});await page.goto(origin+'/measure');await page.waitForFunction(()=>typeof window.measure==='function',{},{timeout:10000});let timer;
  const measured=await Promise.race([page.evaluate(b=>window.measure(b),exports[0].toString('base64')),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('GLB audit timeout')),30000);})]).finally(()=>clearTimeout(timer));
  const {base,roundtrip,lod,lodRoundtrip,lodAudit}=measured;const checks={nonempty:base.meshes>0&&base.triangles>0,finite:[...base.min,...base.max].every(Number.isFinite),triangleBudget:base.triangles<=raw.prop.triangles,materialBudget:base.materials<=raw.prop.materials,dimensions:base.size.every((n,i)=>n<=raw.prop.size[i]+.005),floor:base.min[1]>=-.005&&base.min[1]<=.005,pivot:Math.abs(base.center[0])<=.005&&Math.abs(base.center[2])<=.005,paintMaterial:base.materialNames.includes('Paint'),byteIdenticalReexport:record.byteIdenticalRebuild,roundTripGeometry:base.triangles===roundtrip.triangles,lodReduction:lod.triangles<base.triangles,lodMeshRetention:lodRoundtrip.meshes===base.meshes,lodTopology:lodAudit.every(row=>!row.changed||row.topologyRetained),lodBounds:base.size.every((size,i)=>Math.abs(lodRoundtrip.min[i]-base.min[i])<=Math.max(.005,size*.02)&&Math.abs(lodRoundtrip.max[i]-base.max[i])<=Math.max(.005,size*.02)),pageErrors:record.pageErrors.length===0&&record.consoleErrors.length===0&&record.blockedRequests.length===0};
  Object.assign(record,{base,roundtrip,lod,lodRoundtrip,lodAudit,checks,geometryOutcome:Object.values(checks).every(Boolean)?'Worked':'Failed'});fs.writeFileSync(path.join(out,'native.lod1.glb'),Buffer.from(measured.lodBinary,'base64'));await page.screenshot({path:path.join(out,'audit-preview.png')});await page.evaluate(()=>window.showLOD());await page.screenshot({path:path.join(out,'lod-preview.png')});
 }finally{await c.close();}
}catch(e){record.geometryOutcome='Failed';record.error=String(e);}
finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));record.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'native-report.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record));}
process.exitCode=record.geometryOutcome==='Worked'?0:1;
