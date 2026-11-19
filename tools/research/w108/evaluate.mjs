import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import vm from 'node:vm';import {fileURLToPath} from 'node:url';import {once} from 'node:events';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';import ts from 'typescript';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const root=process.cwd(),input=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]);
if(fs.existsSync(out)&&fs.readdirSync(out).length)throw Error('Refusing to overwrite earlier evaluation: '+out);
fs.mkdirSync(out,{recursive:true});
const lodSource=fs.readFileSync(new URL('./lod.mjs',import.meta.url));
const vendor=path.join(root,'node_modules/three'), results=[];let candidate='';
const sha=b=>createHash('sha256').update(b).digest('hex');
const provenance={startedAt:new Date().toISOString(),evaluatorSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),lodHelperSha256:sha(lodSource),propsSha256:sha(fs.readFileSync(new URL('./props.json',import.meta.url))),node:process.version,three:JSON.parse(fs.readFileSync(path.join(vendor,'package.json'),'utf8')).version,playwright:require('playwright/package.json').version,rendering:'Chrome headless SwiftShader, no shared GPU',preview:'960x720, RoomEnvironment IBL, ACESFilmic, orthographic matched bounds'};
const viewer=`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#1d1726}canvas{display:block}</style><script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script><script type="module">
import * as THREE from 'three';import {GLTFExporter} from '/addons/exporters/GLTFExporter.js';import {GLTFLoader} from '/addons/loaders/GLTFLoader.js';import {SimplifyModifier} from '/addons/modifiers/SimplifyModifier.js';import {RoomEnvironment} from '/addons/environments/RoomEnvironment.js';import {mergeVertices} from '/addons/utils/BufferGeometryUtils.js';import {createLod} from '/audit/lod.mjs';import {buildAsset} from '/candidate.js';
const metrics=group=>{group.updateMatrixWorld(true);let triangles=0,meshes=0;const mats=new Set(),names=new Set();group.traverse(n=>{if(n.isMesh){meshes++;triangles+=(n.geometry.index?n.geometry.index.count:n.geometry.attributes.position.count)/3*(n.isInstancedMesh?n.count:1);for(const m of (Array.isArray(n.material)?n.material:[n.material])){mats.add(m);names.add(m.name)}}});const b=new THREE.Box3().setFromObject(group),size=b.getSize(new THREE.Vector3()),center=b.getCenter(new THREE.Vector3());return {triangles,meshes,materials:mats.size,materialNames:[...names],min:b.min.toArray(),max:b.max.toArray(),size:size.toArray(),center:center.toArray()};};
const encode=async g=>new Uint8Array(await new GLTFExporter().parseAsync(g,{binary:true,onlyVisible:true}));
const b64=b=>{let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s);};
window.execute=async()=>{
 const asset=buildAsset(THREE);if(!asset?.isObject3D)throw Error('buildAsset did not return Object3D');asset.name=asset.name||'asset';
 const base=metrics(asset);if(!base.meshes||base.triangles>100000)throw Error('Empty or excessive geometry');
 const binary=await encode(asset),again=buildAsset(THREE);again.name=again.name||'asset';const repeat=await encode(again);
 const parsed=await new GLTFLoader().parseAsync(binary.buffer,'');const roundtrip=metrics(parsed.scene);
 const lodResult=createLod(asset,new SimplifyModifier(),mergeVertices),lod=lodResult.asset;
 const lodMetrics=metrics(lod),lodBinary=await encode(lod);const lodRoundtrip=metrics((await new GLTFLoader().parseAsync(lodBinary.buffer,'')).scene);
 const scene=new THREE.Scene();scene.background=new THREE.Color('#1d1726');scene.add(asset);scene.add(new THREE.HemisphereLight(0xe8e0c8,0x2b2f3a,2));const light=new THREE.DirectionalLight(0xffe5c5,4);light.position.set(4,6,5);scene.add(light);
 const size=Math.max(...base.size),aspect=960/720;const camera=new THREE.OrthographicCamera(-size*.8*aspect,size*.8*aspect,size*.8,-size*.8,.01,100);const target=new THREE.Vector3(...base.center);camera.position.copy(target).add(new THREE.Vector3(size*1.6,size*1.2,size*1.8));camera.lookAt(target);
 const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(960,720);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;const pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(new RoomEnvironment(),.04).texture;document.body.appendChild(renderer.domElement);renderer.render(scene,camera);
 return {base,roundtrip,lod:lodMetrics,lodRoundtrip,lodAudit:lodResult.audit,binary:b64(binary),repeat:b64(repeat),lodBinary:b64(lodBinary)};
};</script>`;
const server=http.createServer((req,res)=>{
 let bytes,type='text/javascript';const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/'){bytes=viewer;type='text/html';}
 else if(url.pathname==='/audit/lod.mjs')bytes=lodSource;
 else if(url.pathname==='/candidate.js')bytes=candidate;
 else if(url.pathname.startsWith('/vendor/')||url.pathname.startsWith('/addons/')){
  const prefix=url.pathname.startsWith('/vendor/')?'/vendor/':'/addons/',base=path.join(vendor,prefix==='/vendor/'?'build':'examples/jsm');
  const target=path.resolve(base,decodeURIComponent(url.pathname.slice(prefix.length)));
  if(!target.startsWith(base+path.sep)||!target.endsWith('.js')||!fs.existsSync(target)){res.writeHead(404);res.end();return;}bytes=fs.readFileSync(target);
 }else {res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; worker-src 'none'; frame-src 'none'; object-src 'none'"});res.end(bytes);
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
provenance.browser=browser.version();
try {for(const file of fs.readdirSync(input).filter(f=>f.endsWith('.json'))){
 const raw=JSON.parse(fs.readFileSync(path.join(input,file),'utf8'));if(!raw.prop)continue;const start=Date.now(),record={id:raw.prop.id,attempt:raw.attempt,sourceResponseSha256:sha(fs.readFileSync(path.join(input,file))),generationSeconds:raw.seconds,generationTokens:raw.output_tokens,paidCredits:0};
 let context;const browserErrors=[];
 try{
  if(!raw.response)throw Error('Generation produced no response');if(raw.token_limit_reached||raw.ended_eos===false)throw Error('Generation hit token/time limit; incomplete response rejected');
  const code=(raw.response.match(/```(?:javascript|js)?\s*([\s\S]*?)```/)?.[1]||raw.response).trim();
  const ast=ts.createSourceFile('candidate.js',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  if(ast.parseDiagnostics.length)throw Error('Generated syntax invalid: '+ts.flattenDiagnosticMessageText(ast.parseDiagnostics[0].messageText,' '));
  // Compile only, never execute in Node; catches duplicate lexical bindings missed by TS parseDiagnostics.
  new vm.Script(code,{filename:record.id+'.generated.js'});
  const forbidden=new Set(['fetch','XMLHttpRequest','WebSocket','Worker','process','require','eval','Function','document','window','globalThis','navigator','location','localStorage','sessionStorage','constructor','__proto__','setTimeout','setInterval','Date']);
  function inspect(n){if(ts.isImportDeclaration(n)||ts.isExportDeclaration(n)||n.kind===ts.SyntaxKind.ImportKeyword)throw Error('Generated imports/exports forbidden');if(ts.isIdentifier(n)&&forbidden.has(n.text))throw Error('Forbidden capability '+n.text);if(ts.isPropertyAccessExpression(n)&&n.name.text==='random')throw Error('Random generation forbidden');ts.forEachChild(n,inspect);}inspect(ast);
  candidate=code+'\nexport {buildAsset};';fs.writeFileSync(path.join(out,record.id+'.source.js'),code);
  context=await browser.newContext({viewport:{width:960,height:720}});await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());const page=await context.newPage(),errors=browserErrors;page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForFunction(()=>typeof window.execute==='function',{},{timeout:10000});
  let timer;const data=await Promise.race([page.evaluate(()=>window.execute()),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Asset execution/export timeout')),30000);})]).finally(()=>clearTimeout(timer));
  const binary=Buffer.from(data.binary,'base64'),repeat=Buffer.from(data.repeat,'base64'),lod=Buffer.from(data.lodBinary,'base64');
  fs.writeFileSync(path.join(out,record.id+'.glb'),binary);fs.writeFileSync(path.join(out,record.id+'.lod1.glb'),lod);await page.screenshot({path:path.join(out,record.id+'.png')});
  const finite=[...data.base.min,...data.base.max].every(Number.isFinite);
  const checks={nonempty:data.base.meshes>0&&data.base.triangles>0,finite,triangleBudget:data.base.triangles<=raw.prop.triangles,materialBudget:data.base.materials<=raw.prop.materials,dimensions:data.base.size.every((n,i)=>n<=raw.prop.size[i]+.005),floor:data.base.min[1]>=-.005&&data.base.min[1]<=.005,pivot:Math.abs(data.base.center[0])<=.005&&Math.abs(data.base.center[2])<=.005,paintMaterial:data.base.materialNames.includes('Paint'),byteIdenticalReexport:binary.equals(repeat),roundTripGeometry:data.base.triangles===data.roundtrip.triangles,lodReduction:data.lod.triangles<data.base.triangles,lodMeshRetention:data.lodRoundtrip.meshes===data.base.meshes,lodTopology:data.lodAudit.every(row=>!row.changed||row.topologyRetained),lodBounds:data.base.size.every((size,i)=>Math.abs(data.lodRoundtrip.min[i]-data.base.min[i])<=Math.max(.005,size*.02)&&Math.abs(data.lodRoundtrip.max[i]-data.base.max[i])<=Math.max(.005,size*.02)),pageErrors:errors.length===0};
  Object.assign(record,{base:data.base,lod:data.lod,lodRoundtrip:data.lodRoundtrip,lodAudit:data.lodAudit,checks,sha256:sha(binary),lodSha256:sha(lod),bytes:binary.length,geometryOutcome:Object.values(checks).every(Boolean)?'Worked':'Failed',errors,productionAdmission:'Not admitted: no catalog/interaction contract registration or W073 runtime clipping receipt'});
 }catch(error){Object.assign(record,{geometryOutcome:'Failed',error:String(error),browserErrors});}
 finally{if(context)await context.close();record.evaluationSeconds=(Date.now()-start)/1000;results.push(record);fs.writeFileSync(path.join(out,record.id+'.evaluation.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record));}
 }}finally{await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(out,'evaluation-summary.json'),JSON.stringify({provenance,observedAt:new Date().toISOString(),results},null,2));}
process.exitCode=results.length===0?2:results.some(r=>r.geometryOutcome!=='Worked')?1:0;
