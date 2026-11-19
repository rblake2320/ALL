/** Build history and coordinate checks must use the household home, not every region's local grid. */
import { describe, expect, it } from 'vitest';
import { createNewWorld, createSimulation } from '../../../src/sim';
import type { EngineSimulation } from '../../../src/sim/engine';
import { defaultAppearance } from '../../../src/shared/appearance';
import { homeRegionIdOf } from '../../../src/shared/town';
import { thawRegion } from '../../../src/sim/engine/streaming';
import { floorFrame } from '../../../src/sim/spatial/grid';
import { edgeKey } from '../../../src/sim/spatial/edges';
import { frameTiles } from '../../../src/sim/spatial/geometry';
import { isRug } from '../../../src/sim/spatial/defs';
import { WALL_SEGMENT_REFUND } from '../../../src/shared/styles';
import type { ObjectState } from '../../../src/sim/types';

const FOREIGN = 'wormwood:mildew_n3';
function fresh(neighbour = true): EngineSimulation {
 const sim = createSimulation(createNewWorld({ seed:7, householdName:'Build boundaries',lotTemplate:'derelict',difficulty:'normal',members:[
  {firstName:'Mort',lastName:'Graves',appearance:defaultAppearance(),traits:[],aspiration:null},
  {firstName:'Ghoulia',lastName:'Graves',appearance:defaultAppearance(),traits:[],aspiration:null},
 ]})) as unknown as EngineSimulation;
 if(neighbour)expect(thawRegion(sim.engine,FOREIGN)).toBe(true);
 return sim;
}
const foreignObjects=(sim:EngineSimulation)=>Object.values(sim.state.objects).filter(o=>o.regionId&&o.regionId!==homeRegionIdOf(sim.state));
const foreignBytes=(sim:EngineSimulation)=>JSON.stringify(foreignObjects(sim));
function free(sim:EngineSimulation,defId='plant_deadfern',outsideForeign=false){
 const coverage=new Set<string>();
 if(outsideForeign)for(const o of foreignObjects(sim)){
  const def=sim.content.objects[o.defId];const f=def&&o.placement.kind==='floor'?floorFrame(o,def):null;
  if(f)for(const p of frameTiles(f))coverage.add(`${p.x},${p.z}`);
 }
 for(let z=1;z<27;z++)for(let x=1;x<29;x++)if(!coverage.has(`${x},${z}`)&&sim.spatial.checkPlace(defId,x,z,0,null).ok)return{x,z};
 throw Error('No real home placement fixture');
}
function roundTrip(sim:EngineSimulation,p:{x:number;z:number}){
 const funds=sim.state.household.funds, price=sim.content.objects.plant_deadfern.price;
 const bought=sim.dispatch({type:'build',cmd:{type:'buy',defId:'plant_deadfern',...p,rot:0}});
 expect(bought.ok).toBe(true);expect(sim.state.household.funds).toBe(funds-price);
 expect(sim.dispatch({type:'undo'}).ok).toBe(true);expect(sim.state.household.funds).toBe(funds);
 const redone=sim.dispatch({type:'redo'});
 expect.soft(redone,JSON.stringify({p,redone})).toMatchObject({ok:true});
 expect.soft(sim.state.household.funds).toBe(funds-price);
 expect.soft(sim.state.objects[bought.id!]?.defId).toBe('plant_deadfern');
}

describe('build/buy with real furnished neighbours',()=>{
 it('buy→undo→redo preserves money and ID despite a foreign floor at the same local tile',()=>{
  const sim=fresh();
  let tile:{x:number;z:number}|null=null;
  for(const o of foreignObjects(sim)){
   const def=sim.content.objects[o.defId];if(o.placement.kind!=='floor'||isRug(def))continue;
   const frame=floorFrame(o,def);if(!frame)continue;
   tile=frameTiles(frame).find(p=>sim.spatial.checkPlace('plant_deadfern',p.x,p.z,0,null).ok)??null;
   if(tile)break;
  }
  expect(tile).not.toBeNull();const original=foreignBytes(sim);
  roundTrip(sim,tile!);expect(foreignBytes(sim)).toBe(original);
 });
 it('home-only buy→undo→redo preserves money and the original object ID',()=>{
  const sim=fresh(false);roundTrip(sim,free(sim));
 });
 for(const action of ['sell','move'] as const)it(`refuses ${action} of actual neighbour furniture without changing any world value`,()=>{
  const sim=fresh();const fridge=foreignObjects(sim).find(o=>sim.content.objects[o.defId].tags.includes('fridge'))!;
  expect(fridge).toBeDefined();const target=free(sim,fridge.defId);const before=JSON.stringify(sim.serialize());
  const cmd=action==='sell'?{type:'sell' as const,objectId:fridge.id}:{type:'move' as const,objectId:fridge.id,...target,rot:0 as const};
  expect.soft(sim.build.preview(cmd).ok).toBe(false);
  expect.soft(sim.dispatch({type:'build',cmd}).ok).toBe(false);
  expect(JSON.stringify(sim.serialize())).toBe(before);
 });
 it('home wall removal never removes or refunds a foreign opening on the same local edge',()=>{
  const sim=fresh(),control=fresh(false);
  const door=foreignObjects(sim).find(o=>o.placement.kind==='opening'&&!sim.state.lot.walls[o.placement.edge]&&control.build.preview({type:'addWalls',edges:[o.placement.edge]}).ok)!;
  expect(door).toBeDefined();if(door.placement.kind!=='opening')throw Error('Fixture is not an opening');
  const edge=door.placement.edge;
  expect(sim.dispatch({type:'build',cmd:{type:'addWalls',edges:[edge]}}).ok).toBe(true);
  const original=foreignBytes(sim),funds=sim.state.household.funds;
  const removed=sim.dispatch({type:'build',cmd:{type:'removeWalls',edges:[edge]}});
  expect(removed.ok).toBe(true);
  expect.soft(sim.state.household.funds).toBe(funds+WALL_SEGMENT_REFUND);
  expect(foreignBytes(sim)).toBe(original);
 });
 it('a foreign multi-tile footprint cannot block a valid home wall on the same local edge',()=>{
  const sim=fresh(),control=fresh(false);let edge:ReturnType<typeof edgeKey>|undefined;
  for(const o of foreignObjects(sim)){
   if(o.placement.kind!=='floor')continue;
   const frame=floorFrame(o,sim.content.objects[o.defId]);if(!frame)continue;
   const tiles=frameTiles(frame),covered=new Set(tiles.map(p=>`${p.x},${p.z}`));
   for(const p of tiles){
    const candidates=[];
    if(covered.has(`${p.x+1},${p.z}`))candidates.push(edgeKey('v',p.x+1,p.z));
    if(covered.has(`${p.x},${p.z+1}`))candidates.push(edgeKey('h',p.x,p.z+1));
    edge=candidates.find(e=>!sim.state.lot.walls[e]&&control.build.preview({type:'addWalls',edges:[e]}).ok);
    if(edge)break;
   }
   if(edge)break;
  }
  expect(edge).toBeDefined();const before=foreignBytes(sim);
  expect(sim.build.preview({type:'addWalls',edges:[edge!]}).ok).toBe(true);
  expect(sim.dispatch({type:'build',cmd:{type:'addWalls',edges:[edge!]}}).ok).toBe(true);
  expect(foreignBytes(sim)).toBe(before);
  expect(sim.dispatch({type:'undo'}).ok).toBe(true);expect(foreignBytes(sim)).toBe(before);
 });
 it('building a blocking home chair relocates only the home actor, not an away actor at the same local position',()=>{
  const sim=fresh(),p=free(sim,'chair_creaky');const [home,away]=sim.state.household.memberIds.map(id=>sim.state.agents[id]);
  for(const a of [home,away]){a.pos={x:p.x+.5,z:p.z+.5};a.prevPos={...a.pos};}
  away.regionId=FOREIGN;const before=JSON.stringify(away),homePos={...home.pos};
  expect(sim.spatial.isWalkable(home.pos.x,home.pos.z)).toBe(true);
  expect(sim.dispatch({type:'build',cmd:{type:'buy',defId:'chair_creaky',...p,rot:0}}).ok).toBe(true);
  expect.soft(home.pos).not.toEqual(homePos);
  expect(JSON.stringify(away)).toBe(before);
 });
 for(const kind of ['foreign fire','foreign meal','home fire'] as const)it(`${kind}: restored furniture checks only the home frame and preserves real home hazards`,()=>{
  const sim=fresh(),p=free(sim,'plant_deadfern',true),funds=sim.state.household.funds;
  const r=sim.dispatch({type:'build',cmd:{type:'buy',defId:'plant_deadfern',...p,rot:0}});expect(r.ok).toBe(true);
  expect(sim.dispatch({type:'undo'}).ok).toBe(true);
  let other:ObjectState|undefined;
  const spawn=()=>{other=sim.engine.ctx.spawnObject(kind==='foreign meal'?'item_meal':'item_fire',{kind:'loose',x:p.x+.5,z:p.z+.5,y:0,parentId:null,surfaceIndex:null,facing:0});};
  if(kind==='home fire')spawn();else expect(sim.engine.ctx.withRegion!(FOREIGN,spawn)).not.toBe(false);
  expect(other).toBeDefined();const before=JSON.stringify(other);
  const redone=sim.dispatch({type:'redo'});
  expect.soft(redone.ok).toBe(kind!=='home fire');
  expect.soft(sim.state.household.funds).toBe(kind==='home fire'?funds:funds-sim.content.objects.plant_deadfern.price);
  expect(JSON.stringify(other)).toBe(before);
 });
});
