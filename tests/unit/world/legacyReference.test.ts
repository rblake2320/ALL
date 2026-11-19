import { expect, it } from 'vitest';
import { createNewWorld, createSimulation } from '../../../src/sim';
import { newHomeBuildState } from '../../../src/shared/homeBuild';
import { ac1Options, ac1SaveHash } from './ac1Harness';
import { legacyReferenceWorld, legacyReferenceHash } from './legacyReference';
import { stateHash } from './s3Harness';

const world = () => createSimulation(createNewWorld(ac1Options('starter', 7))).serialize();
it('legacy accounting comparison changes only an inert service block, never mutates input or hides pets', () => {
 const w=world(),before=JSON.stringify(w),old=structuredClone(w);delete old.homeServices;
 expect(legacyReferenceWorld(w)).toEqual(old);expect(JSON.stringify(w)).toBe(before);
 expect(legacyReferenceHash(w)).toBe(stateHash(old));expect(ac1SaveHash(legacyReferenceWorld(w))).toBe(ac1SaveHash(old));
 const changed=structuredClone(w);changed.pets!.strays[0].trust+=1;
 expect(legacyReferenceHash(changed)).not.toBe(legacyReferenceHash(w));
});
it.each(['essence','owned','stash','wardrobe','respec','homeBuild','futureDay'] as const)('full current hashes retain %s and historical comparison refuses it', kind => {
 const w=world(),before=stateHash(w),id=w.household.memberIds[0],hs=w.homeServices!;
 if(kind==='essence')hs.hearth.essence=1;
 if(kind==='owned')hs.hearth.owned=['wardRest'];
 if(kind==='stash')hs.stash={...hs.stash,bone:1};
 if(kind==='wardrobe')hs.wardrobe={[id]:{slots:[],activeId:null,lastSwapTick:null,nextId:2}};
 if(kind==='respec')hs.respecDay={[id]:1};
 if(kind==='homeBuild')w.homeBuild=newHomeBuildState('starter');
 if(kind==='futureDay')hs.essenceDay=99999;
 expect(stateHash(w)).not.toBe(before);const preserved=JSON.stringify(w);
 expect(()=>legacyReferenceWorld(w)).toThrow();expect(JSON.stringify(w)).toBe(preserved);
});
