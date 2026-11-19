/** Validate actual exported models with Three's GLTFLoader. Ordinary Node after npm ci. */
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Box3,Vector3,Raycaster} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const here=dirname(fileURLToPath(import.meta.url));
const assets=resolve(process.argv[2]||resolve(here,'../../../public/assets'));
const manifest=JSON.parse(readFileSync(resolve(assets,'manifest.mausoleum.json'),'utf8'));
const failures=[],rows=[],guards=[];
const sha=b=>createHash('sha256').update(b).digest('hex');
const expected=Array.from(readFileSync(resolve(here,'l5_specs.py'),'utf8').matchAll(/^ \('([^']+)',/gm),m=>m[1]);
const specs=new Map(Array.from(readFileSync(resolve(here,'l5_specs.py'),'utf8').matchAll(
 /^ \('([^']+)',([\d.]+),([\d.]+),([\d.]+),(\d+),'([^']+)'\),/gm),m=>[m[1],{w:+m[2],d:+m[3],h:+m[4],budget:+m[5]}]));
if(specs.size!==28||expected.length!==28)throw new Error('incomplete source inventory');
function checkContainer(js){
 const errors=[];
 if((js.images||[]).length||(js.textures||[]).length)errors.push('image textures');
 if((js.buffers||[]).some(b=>b.uri))errors.push('external buffer');
 if((js.skins||[]).length||(js.animations||[]).length)errors.push('unexpected animation');
 return errors;
}
function checkRoster(entries){
 const ids=entries.map(e=>e.id),errors=[];
 if(ids.length!==expected.length || expected.some(id=>!ids.includes(id)) || new Set(ids).size!==ids.length)errors.push('roster');
 return errors;
}
function checkModel(e,bytes,scene){
 const errors=[];
 const spec=specs.get(e.id);
 if(!spec||e.budget!==spec.budget||JSON.stringify(e.tileFootprint)!==JSON.stringify([spec.w,spec.d])||'footprint' in e)errors.push('source contract');
 if(e.file!==`models/levels/mausoleum/${e.id}.glb`)errors.push('path');
 if(e.sha256!==sha(bytes)||e.bytes!==bytes.length)errors.push('digest');
 const box=new Box3(),p=new Vector3(),names=new Set(),materials=new Set();
 let triangles=0,vertices=0,finite=true,meshCount=0;
 scene.updateMatrixWorld(true);
 scene.traverse(o=>{
  names.add(o.name);
  if(!o.matrixWorld.elements.every(Number.isFinite))finite=false;
  if(!o.isMesh)return;
  meshCount++;
  const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>materials.add(m.name));
  const pos=o.geometry.getAttribute('position'),index=o.geometry.index;
  if(!pos||!pos.count){errors.push('empty geometry');return;}
  vertices+=pos.count;triangles+=(index?index.count:pos.count)/3;
  let excluded=false;for(let a=o;a;a=a.parent)if(e.states.includes(a.name))excluded=true;
  for(let i=0;i<pos.count;i++){
   p.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);
   if(!p.toArray().every(Number.isFinite))finite=false;
   if(!excluded)box.expandByPoint(p);
  }
  for(const attr of Object.values(o.geometry.attributes))if(!Array.from(attr.array).every(Number.isFinite))finite=false;
 });
 if(!finite)errors.push('non-finite');
 if(!meshCount||!vertices||box.isEmpty())errors.push('empty model');
 if(e.kind==='floor'||e.kind==='item'){
  if(Math.abs(box.min.y)>=.01)errors.push('ground contact');
  if(spec&&(Math.max(Math.abs(box.min.x),Math.abs(box.max.x))>spec.w*.575 || Math.max(Math.abs(box.min.z),Math.abs(box.max.z))>spec.d*.575))errors.push('tile envelope');
 }
 if(triangles!==e.triangles||triangles>e.budget||triangles<40)errors.push('triangle budget');
 for(const n of e.parts)if(!names.has(n))errors.push(`missing part:${n}`);
 for(const n of e.materials)if(!materials.has(n))errors.push(`missing material:${n}`);
 for(const name of e.parts.filter(n=>['flame'].includes(n))){
  let strength=0;
  scene.getObjectByName(name)?.traverse(o=>{
   if(o.isMesh)for(const mat of (Array.isArray(o.material)?o.material:[o.material]))
    if(mat.emissive)strength=Math.max(strength,mat.emissiveIntensity*Math.max(mat.emissive.r,mat.emissive.g,mat.emissive.b));
  });
  if(!Number.isFinite(strength)||strength<2||strength>6.01)errors.push(`emissive:${name}`);
 }
 for(const [k,actual] of [['min',box.min.toArray()],['max',box.max.toArray()]]){
  if(!Array.isArray(e.bounds?.[k])||actual.some((v,i)=>Math.abs(v-e.bounds[k][i])>.0002))errors.push('bounds');
 }
 return {errors,meshCount,vertices,triangles,bounds:{min:box.min.toArray(),max:box.max.toArray()}};
}
function worldVertices(part){
 const points=[];part.updateWorldMatrix(true,true);
 part.traverse(o=>{if(o.isMesh){const p=o.geometry.getAttribute('position');for(let i=0;i<p.count;i++)points.push(new Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld));}});
 return points;
}
function checkMotion(part,axis){
 const before=worldVertices(part),q=part.quaternion.clone();
 const pivot=part.getWorldPosition(new Vector3());
 const samples=[];
 for(const angle of [-.12,.12,.6]){
  part.quaternion.copy(q);part.rotateOnAxis(new Vector3(...axis),angle);
  const after=worldVertices(part);
  const finite=after.every(p=>p.toArray().every(Number.isFinite));
  const moved=after.length===before.length&&after.some((p,i)=>p.distanceTo(before[i])>.001);
  samples.push({angle,vertices:after.length,finite,moved,pivotFixed:part.getWorldPosition(new Vector3()).distanceTo(pivot)<1e-8});
 }
 part.quaternion.copy(q);part.updateWorldMatrix(true,true);
 return {part:part.name,samples,worked:samples.every(s=>s.vertices>0&&s.finite&&s.moved&&s.pivotFixed)};
}
function closedLawn(scene){
 const edges=new Map();let faces=0;
 scene.traverse(o=>{
  if(!o.isMesh||o.material.name!=='MhLawn')return;
  const g=o.geometry,p=g.getAttribute('position'),idx=g.index;
  const key=i=>new Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld).toArray().map(v=>v.toFixed(4)).join(',');
  for(let i=0;i<(idx?idx.count:p.count);i+=3){
   const v=[0,1,2].map(j=>key(idx?idx.getX(i+j):i+j));faces++;
   for(let j=0;j<3;j++){const e=[v[j],v[(j+1)%3]].sort().join('|');edges.set(e,(edges.get(e)||0)+1);}
  }
 });
 return {faces,edges:edges.size,badEdges:[...edges.values()].filter(n=>n!==2).length,
         worked:faces>0&&edges.size>0&&[...edges.values()].every(n=>n===2)};
}
function visiblePendulum(scene){
 scene.updateMatrixWorld(true);
 const hits=new Raycaster(new Vector3(0,.53,2),new Vector3(0,0,-1),0,4).intersectObject(scene,true);
 const first=hits[0]?.object;
 for(let o=first;o;o=o.parent)if(o.name==='pendulum')return true;
 return false;
}
failures.push(...checkRoster(manifest.models));
const declared=manifest.models.map(e=>e.id+'.glb').sort();
const present=readdirSync(resolve(assets,'models/levels/mausoleum')).filter(n=>n.endsWith('.glb')).sort();
if(JSON.stringify(declared)!==JSON.stringify(present))failures.push('file roster');
let sample;
for(const e of manifest.models){
 if(e.file!==`models/levels/mausoleum/${e.id}.glb`){failures.push(`${e.id}: path`);continue;}
 const bytes=readFileSync(resolve(assets,e.file));
 try{
  const js=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8'));
  failures.push(...checkContainer(js).map(x=>`${e.id}: ${x}`));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const r=checkModel(e,bytes,gltf.scene);rows.push({id:e.id,sha256:sha(bytes),...r});
  failures.push(...r.errors.map(x=>`${e.id}: ${x}`));
  if(e.id==='organ_pipe')sample={e,bytes,scene:gltf.scene};
  if(e.id==='green_putting'){
   const closure=closedLawn(gltf.scene);rows.at(-1).closedLawn=closure;
   if(!closure.worked)failures.push(`${e.id}: open lawn surface`);
   const bad=gltf.scene.clone(true);let cut=false;
   bad.traverse(o=>{if(!cut&&o.isMesh&&o.material.name==='MhLawn'){
    o.geometry=o.geometry.clone();o.geometry.setIndex(Array.from(o.geometry.index.array).slice(3));cut=true;
   }});
   guards.push({name:'open lawn shell',rejected:cut&&!closedLawn(bad).worked});
  }
  if(e.id==='clock_grandfather'){
   const visible=visiblePendulum(gltf.scene);rows.at(-1).pendulumVisible=visible;
   if(!visible)failures.push(`${e.id}: pendulum occluded`);
   const hidden=gltf.scene.clone(true);hidden.getObjectByName('pendulum').position.z-=1;
   guards.push({name:'occluded clock pendulum',rejected:!visiblePendulum(hidden)});
  }
  for(const name of e.parts.filter(n=>['door','record','head','flag','pendulum'].includes(n))){
   const part=gltf.scene.getObjectByName(name);
   if(!part){failures.push(`${e.id}:${name} missing motion node`);continue;}
   const motion=checkMotion(part,['pendulum','head'].includes(name)?[0,0,1]:[0,1,0]);
   if(!motion.worked)failures.push(`${e.id}:${name} motion`);
   rows.at(-1).motion??=[];rows.at(-1).motion.push(motion);
  }
 }catch(err){failures.push(`${e.id}: load ${err.message}`);}
}
if(!sample)failures.push('missing negative-control source');
else{
 for(const [name,mutate,want] of [
  ['wrong digest',e=>{e.sha256='0'.repeat(64)},'digest'],
  ['wrong size',e=>{e.bytes++},'digest'],
  ['path escape',e=>{e.file='../outside.glb'},'path'],
  ['missing required part',e=>{e.parts.push('nonexistent_part')},'missing part:nonexistent_part'],
  ['tight triangle budget',e=>{e.budget=1},'triangle budget'],
  ['false bounds',e=>{e.bounds.max[0]+=1},'bounds'],
  ['inflated source budget',e=>{e.budget+=1000},'source contract'],
  ['wrong tile footprint',e=>{e.tileFootprint=[20,20]},'source contract'],
 ]){const e=structuredClone(sample.e);mutate(e);const rejected=checkModel(e,sample.bytes,sample.scene).errors.includes(want);guards.push({name,rejected});}
 const bad=sample.scene.clone(true);bad.traverse(o=>{if(o.isMesh)o.geometry=o.geometry.clone();});
 let poisoned=false;bad.traverse(o=>{if(o.isMesh&&!poisoned){o.geometry.attributes.position.array[0]=NaN;poisoned=true;}});
 guards.push({name:'non-finite geometry',rejected:checkModel(sample.e,sample.bytes,bad).errors.includes('non-finite')});
 const empty=sample.scene.clone(true);empty.clear();guards.push({name:'empty scene',rejected:checkModel(sample.e,sample.bytes,empty).errors.includes('empty model')});
 guards.push({name:'empty motion node',rejected:!checkMotion(empty,[0,1,0]).worked});
 const floating=sample.scene.clone(true);floating.position.y+=1;
 guards.push({name:'floating model',rejected:checkModel(sample.e,sample.bytes,floating).errors.includes('ground contact')});
 guards.push({name:'missing model',rejected:checkRoster(manifest.models.slice(1)).includes('roster')});
 guards.push({name:'duplicate model',rejected:checkRoster([...manifest.models,manifest.models[0]]).includes('roster')});
 const dark=sample.scene.clone(true);dark.traverse(o=>{if(o.isMesh){
  const clone=m=>{const c=m.clone();c.emissiveIntensity=0;return c;};
  o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material);
 }});
 guards.push({name:'unlit required glow',rejected:checkModel(sample.e,sample.bytes,dark).errors.includes('emissive:flame')});
}
for(const [name,js,want] of [
 ['image texture rejected',{images:[{}]},'image textures'],
 ['external buffer rejected',{buffers:[{uri:'outside.bin'}]},'external buffer'],
 ['unexpected animation rejected',{animations:[{}]},'unexpected animation'],
])guards.push({name,rejected:checkContainer(js).includes(want)});
failures.push(...guards.filter(g=>!g.rejected).map(g=>`guard:${g.name}`));
const report={manifestSha256:sha(readFileSync(resolve(assets,'manifest.mausoleum.json'))),models:rows.length,triangles:rows.reduce((n,r)=>n+r.triangles,0),guards,failures,rows};
writeFileSync(process.argv[3]?resolve(process.argv[3]):resolve(here,'l5_evidence/runtime-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({models:report.models,triangles:report.triangles,guards:guards.length,failures}));
if(failures.length)process.exitCode=1;
