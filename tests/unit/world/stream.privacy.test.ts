/** S4 privacy review: public yards may be shortcuts (D-068); an unwelcomed house interior may not. */
import { describe,expect,it } from 'vitest';
import { laneWorld,N3,goHere,stateHash } from './s3Harness';
import { emptyRun,runScript,SCRIPT_TICKS } from './s3Script';
import { indoorTile } from './s3Fixtures';
import { streamWorld } from './s4Harness';
import { agentRegion,isRegionActive,maskFor,spatialOfRegion } from '../../../src/sim/engine/regions';
import { freezeRegion,thawRegion } from '../../../src/sim/engine/streaming';

describe('S4 public-yard shortcut and private-interior lifecycle',()=>{
  it('the re-recorded n4 return leg uses only its public outdoor grid',()=>{
    const {sim,eng,members}=laneWorld({seed:7});
    const [a]=members,n4='wormwood:mildew_n4',driver={a:0,b:0},run=emptyRun();
    let samples=0;
    while(sim.state.tick<SCRIPT_TICKS){
      runScript(sim,members,sim.state.tick+1,driver,run,{every:1e9});
      const actor=sim.state.agents[a];
      if(agentRegion(eng,actor)!==n4)continue;
      const spatial=spatialOfRegion(eng,n4,'public')!;expect(spatial).not.toBeNull();
      const tile=spatial.tileOf(actor.pos);
      expect(maskFor(eng,actor,n4)).toBe('public');
      expect(spatial.isIndoor(tile.x,tile.z)).toBe(false);
      expect(spatial.isWalkable(tile.x,tile.z)).toBe(true);samples++;
    }
    expect(samples).toBeGreaterThan(0);
    expect(run.crossings.some(c=>c.agentId===a&&c.to===n4)).toBe(true);
    expect(run.crossings.some(c=>c.agentId===a&&c.from===n4&&c.to===N3)).toBe(true);
    expect(sim.faults()).toEqual([]);
  });

  it('a private interior is refused while active, dormant and thawed, with no queued action or charge',()=>{
    const {sim,eng,members}=streamWorld({seed:7});
    const [a]=members;
    for(let n=0;n<4;n++)sim.step();
    expect(isRegionActive(eng,N3)).toBe(true);
    const target={regionId:N3,...indoorTile(eng,N3)},funds=sim.state.household.funds;
    const refuse=()=>{
      const before=stateHash(sim.state);
      expect(sim.worldRoute!(a,target)).toEqual({ok:false,target,reason:'private'});
      expect(stateHash(sim.state)).toBe(before);
      expect(goHere(sim,a,target)).toMatchObject({ok:false,route:{ok:false,reason:'private'}});
      expect(sim.state.agents[a].active).toBeNull();expect(sim.state.agents[a].queue).toEqual([]);
      expect(sim.state.household.funds).toBe(funds);
    };
    refuse();expect(freezeRegion(eng,N3)).toBe(true);expect(isRegionActive(eng,N3)).toBe(false);
    refuse();expect(thawRegion(eng,N3)).toBe(true);expect(isRegionActive(eng,N3)).toBe(true);refuse();
    expect(sim.faults()).toEqual([]);
  });
});
