/** Validate actual exported models with Three's GLTFLoader. Ordinary Node after npm ci. */
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Box3,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const here=dirname(fileURLToPath(import.meta.url));
const assets=resolve(process.argv[2]||resolve(here,'../../../public/assets'));
const manifest=JSON.parse(readFileSync(resolve(assets,'manifest.rotrow.json'),'utf8'));
const failures=[],rows=[],guards=[];
const sha=b=>createHash('sha256').update(b).digest('hex');
const expected=Array.from(readFileSync(resolve(here,'l3_specs.py'),'utf8').matchAll(/^ \('([^']+)',/gm),m=>m[1]);
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
 if(e.file!==`models/levels/rotrow/${e.id}.glb`)errors.push('path');
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
 if(triangles!==e.triangles||triangles>e.budget||triangles<40)errors.push('triangle budget');
 for(const n of e.parts)if(!names.has(n))errors.push(`missing part:${n}`);
 for(const n of e.materials)if(!materials.has(n))errors.push(`missing material:${n}`);
 for(const name of e.parts.filter(n=>['glow','screen','bulb'].includes(n))){
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
failures.push(...checkRoster(manifest.models));
const declared=manifest.models.map(e=>e.id+'.glb').sort();
const present=readdirSync(resolve(assets,'models/levels/rotrow')).filter(n=>n.endsWith('.glb')).sort();
if(JSON.stringify(declared)!==JSON.stringify(present))failures.push('file roster');
let sample;
for(const e of manifest.models){
 if(e.file!==`models/levels/rotrow/${e.id}.glb`){failures.push(`${e.id}: path`);continue;}
 const bytes=readFileSync(resolve(assets,e.file));
 try{
  const js=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8'));
  failures.push(...checkContainer(js).map(x=>`${e.id}: ${x}`));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const r=checkModel(e,bytes,gltf.scene);rows.push({id:e.id,sha256:sha(bytes),...r});
  failures.push(...r.errors.map(x=>`${e.id}: ${x}`));
  if(e.id==='fridge_rotpop')sample={e,bytes,scene:gltf.scene};
  for(const name of e.parts.filter(n=>['door','bag','platter_L','platter_R'].includes(n))){
   const part=gltf.scene.getObjectByName(name),before=new Box3().setFromObject(part),old=part.position.clone(),q=part.quaternion.clone();
   if(name==='door'&&e.id==='pod_nap')part.position.z-=.8;else part.rotateY(.6);
   gltf.scene.updateMatrixWorld(true);const after=new Box3().setFromObject(part);
   const moved=before.min.distanceTo(after.min)+before.max.distanceTo(after.max)>.0001;
   // Round turntables can have invariant bounds: check their transform instead.
   const changed=moved||part.quaternion.angleTo(q)>.1;
   if(!changed||!after.min.toArray().concat(after.max.toArray()).every(Number.isFinite))failures.push(`${e.id}:${name} motion`);
   rows.at(-1).motion??=[]; rows.at(-1).motion.push({part:name,changed,finite:after.min.toArray().concat(after.max.toArray()).every(Number.isFinite)});
   part.position.copy(old);part.quaternion.copy(q);gltf.scene.updateMatrixWorld(true);
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
 ]){const e=structuredClone(sample.e);mutate(e);const rejected=checkModel(e,sample.bytes,sample.scene).errors.includes(want);guards.push({name,rejected});}
 const bad=sample.scene.clone(true);bad.traverse(o=>{if(o.isMesh)o.geometry=o.geometry.clone();});
 let poisoned=false;bad.traverse(o=>{if(o.isMesh&&!poisoned){o.geometry.attributes.position.array[0]=NaN;poisoned=true;}});
 guards.push({name:'non-finite geometry',rejected:checkModel(sample.e,sample.bytes,bad).errors.includes('non-finite')});
 const empty=sample.scene.clone(true);empty.clear();guards.push({name:'empty scene',rejected:checkModel(sample.e,sample.bytes,empty).errors.includes('empty model')});
 guards.push({name:'missing model',rejected:checkRoster(manifest.models.slice(1)).includes('roster')});
 guards.push({name:'duplicate model',rejected:checkRoster([...manifest.models,manifest.models[0]]).includes('roster')});
 const dark=sample.scene.clone(true);dark.traverse(o=>{if(o.isMesh){
  const clone=m=>{const c=m.clone();c.emissiveIntensity=0;return c;};
  o.material=Array.isArray(o.material)?o.material.map(clone):clone(o.material);
 }});
 guards.push({name:'unlit required glow',rejected:checkModel(sample.e,sample.bytes,dark).errors.includes('emissive:glow')});
}
for(const [name,js,want] of [
 ['image texture rejected',{images:[{}]},'image textures'],
 ['external buffer rejected',{buffers:[{uri:'outside.bin'}]},'external buffer'],
 ['unexpected animation rejected',{animations:[{}]},'unexpected animation'],
])guards.push({name,rejected:checkContainer(js).includes(want)});
failures.push(...guards.filter(g=>!g.rejected).map(g=>`guard:${g.name}`));
const report={manifestSha256:sha(readFileSync(resolve(assets,'manifest.rotrow.json'))),models:rows.length,triangles:rows.reduce((n,r)=>n+r.triangles,0),guards,failures,rows};
writeFileSync(resolve(here,'l3_evidence/runtime-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({models:report.models,triangles:report.triangles,guards:guards.length,failures}));
if(failures.length)process.exitCode=1;
