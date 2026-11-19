/** Real-engine exported fixtures for the built browser region check. Placements are explicit fixture setup. */
import { expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createNewWorld, createSimulation } from '../../../src/sim';
import type { EngineSimulation } from '../../../src/sim/engine';
import { thawRegion } from '../../../src/sim/engine/streaming';
import type { ObjectState } from '../../../src/sim/types';
import { homeRegionIdOf } from '../../../src/shared/town';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { createMemoryBackend } from '../../../src/persistence/backends/memory';
import { noLocks } from '../../../src/persistence/locks';
import { engineRepairHook } from '../../../src/persistence/semanticRepair';
import { opts } from '../quests/helpers';
import { makeMeta, silentLogger } from '../persistence/fixtures';
import { goHere, N3 } from './s3Harness';
import { startFire } from '../../../src/sim/systems/home/upkeep/fire';

it('exports real saved home/away cases with foreign services and fire, and retains every fixture through validation', async () => {
 let sim=createSimulation(createNewWorld(opts(7,2))) as unknown as EngineSimulation;
 expect(sim.dispatch({type:'setSettings',settings:{autonomy:'off',visitorsEnabled:false}}).ok).toBe(true);
 expect(thawRegion(sim.engine,N3)).toBe(true);
 const ids:Record<string,string>={};
 for(const [key,defId,region] of [['foreignHearth','hearth_stone',N3],['foreignVault','vault_crypt',N3],['homeStation','station_embalming',homeRegionIdOf(sim.state)]] as const){
  let obj:ObjectState|undefined;
  sim.engine.ctx.withRegion!(region,()=>{
   for(let z=1;z<27&&!obj;z++)for(let x=1;x<29;x++)if(sim.engine.ctx.spatial.checkPlace(defId,x,z,0,null).ok){obj=sim.engine.ctx.spawnObject(defId,{kind:'floor',x,z,rot:0});break;}
  });
  expect(obj,key).toBeDefined();ids[key]=obj!.id;
 }
 let fire:ObjectState|undefined;
 sim.engine.ctx.withRegion!(N3,()=>{fire=startFire(sim.engine.ctx,null,{at:{x:2.5,z:2.5},quiet:true})??undefined;});
 expect(fire).toBeDefined();
 ids.foreignFire=fire!.id;
 const actorId=sim.state.household.memberIds[0],out=process.env.WORLD_SERVICE_FIXTURE_OUT;
 const manifest:{cases:unknown[];setup:string}={cases:[],setup:'Real engine, registered-object fixture placements, real SaveManager export/validation, actual portal walk for away case'};
 const exportCase=async(name:string)=>{
  const mgr=new SaveManagerImpl({backend:createMemoryBackend(),locks:noLocks,logger:silentLogger,repair:engineRepairHook()});
  expect((await mgr.save(name,name,sim.serialize(),makeMeta())).ok).toBe(true);
  const load=await mgr.load(name);expect(load.ok).toBe(true);if(!load.ok)throw Error(load.error);
  expect(load.warnings).toEqual([]);
  const loaded=createSimulation(load.world);for(const id of Object.values(ids))expect(loaded.state.objects[id],id).toBeDefined();
  const file=await mgr.exportSlot(name);expect(file).not.toBeNull();
  const bytes=file!.data;
  manifest.cases.push({name,actorId,ids:{...ids},actorRegion:sim.state.agents[actorId].regionId??homeRegionIdOf(sim.state),sha256:createHash('sha256').update(bytes).digest('hex')});
  if(out){mkdirSync(out,{recursive:true});writeFileSync(`${out}/${name}.alsave`,bytes);}
  return loaded as unknown as EngineSimulation;
 };
 const home=await exportCase('home');
 expect(home.dispatch({type:'home',action:'hearthBuy',upgradeId:'wardRest'}).ok).toBe(false);
 expect(home.dispatch({type:'home',action:'stashPut',material:'bone',units:1}).ok).toBe(false);
 expect(home.dispatch({type:'home',action:'respec',agentId:actorId}).ok).toBe(true);
 // Restore the unmodified saved state before the actual walk: no respec cooldown can explain the away refusal.
 sim=await exportCase('home');
 expect(sim.state.homeServices!.respecDay[actorId]).toBeUndefined();
 expect(goHere(sim,actorId,{regionId:N3,x:14,z:27}).ok).toBe(true);
 for(let i=0;i<4000;i++){const a=sim.state.agents[actorId];if(a.regionId===N3&&!a.active&&!a.queue.length)break;sim.step();sim.drainEvents();}
 expect(sim.state.agents[actorId].regionId).toBe(N3);
 expect(sim.state.agents[actorId].presence).toBe('onLot');
 // A loose fire has a bounded lifetime; record a live registered fire in the foreign frame for the saved away case.
 if(!sim.state.objects[ids.foreignFire])sim.engine.ctx.withRegion!(N3,()=>{const f=startFire(sim.engine.ctx,null,{at:{x:2.5,z:2.5},quiet:true});if(!f)throw Error('Fixture fire failed');ids.foreignFire=f.id;});
 const away=await exportCase('away');
 expect(away.state.homeServices!.respecDay[actorId]).toBeUndefined();
 expect(away.dispatch({type:'home',action:'respec',agentId:actorId}).ok).toBe(false);
 expect(sim.faults()).toEqual([]);
 if(out)writeFileSync(`${out}/manifest.json`,JSON.stringify({...manifest,cases:manifest.cases.filter((_,i)=>i!==0)},null,2));
});
