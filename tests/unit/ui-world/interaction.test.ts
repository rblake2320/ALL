import { describe, expect, it } from 'vitest';
import { KEYMAP } from '../../../src/game/contracts';
import type { MapPinView, PointerSample, SelectedActorView, SignView } from '../../../src/shared/world';
import { decideWorldGesture, preparePins, prepareSigns, routeFeedback, validRouteTarget } from '../../../src/ui/world/interaction';

const actor:SelectedActorView={agentId:'a',regionId:'home',world:{x:-20,z:-10},local:{x:2,z:3},renderTier:'active'};
const target={regionId:'north',x:0,z:255};
const samples=(ms=100,dx=0):PointerSample[]=>[{id:1,type:'down',t:1000,x:0,y:0},{id:1,type:'up',t:1000+ms,x:dx,y:0}];
const pin=(regionId='north'):MapPinView=>({regionId,label:'North',status:'open',statusText:'Open',world:{x:-100,z:-100},memberIds:[]});
const sign=(id:string,x:number):SignView=>({id,regionId:'north',textKey:'world.north',text:'North gate',world:{x,z:0}});
const success={ok:true,target,portals:[],lengthTiles:0,etaGameMin:0};

describe('world walk gesture adapter uses the pinned shared classifier',()=>{
  it('accepts a tap for the same actor, including a region crossing',()=>{
    expect(decideWorldGesture(samples(),null,'a',actor,target)).toEqual({gesture:'tap',actorId:'a',target});
    expect(decideWorldGesture(samples(),null,'a',{...actor,regionId:'street'},target).actorId).toBe('a');
  });
  it.each(['b',null])('refuses a stale selected actor (%s)',id=>{
    expect(decideWorldGesture(samples(),null,'a',id?{...actor,agentId:id}:null,target).target).toBeNull();
  });
  it.each([
    ['pan',samples(100,11)],['longPress',samples(500)],['none',samples(400)],
    ['none',[samples()[0],{...samples()[1],type:'cancel'}]],
    ['none',[samples()[0]]],['none',[samples()[0],{...samples()[1],t:900}]],
    ['pinch',[samples()[0],{...samples()[1],id:2}]],
  ] as const)('never dispatches %s',(_kind,s)=>{
    const r=decideWorldGesture(s,null,'a',actor,target);
    expect(r.gesture).toBe(_kind);expect(r.actorId).toBeNull();expect(r.target).toBeNull();
  });
  it('honours the 300ms post-pan/pinch guard and the exact shared tap limits',()=>{
    expect(decideWorldGesture(samples(),701,'a',actor,target).target).toBeNull();
    expect(decideWorldGesture(samples(350,10),700,'a',actor,target).target).toEqual(target);
  });
  it('reuses F, while C remains wall view (no competing shortcut)',()=>{
    expect(KEYMAP.focusSelected).toEqual(['KeyF']);expect(KEYMAP.wallMode).toContain('KeyC');
  });
});

describe('local routes and signed world information',()=>{
  it('accepts only integral region-local tiles, never signed world coordinates',()=>{
    expect(validRouteTarget(target)).toBe(true);
    for(const value of [null,{}, {...target,regionId:' '}, {...target,x:-1},{...target,z:256},{...target,x:.5},{...target,x:NaN},{...target,z:Infinity}]) {
      expect(validRouteTarget(value)).toBe(false);
      expect(decideWorldGesture(samples(),null,'a',actor,value).target).toBeNull();
    }
  });
  it('preserves pin order and signed coordinates without mutating input',()=>{
    const input=[pin('west'),pin('east')]; const before=JSON.stringify(input);
    expect(preparePins(input)).toEqual({items:input,invalidCount:0});expect(JSON.stringify(input)).toBe(before);
  });
  it('drops every ambiguous duplicate and malformed pin, exposing their count',()=>{
    const r=preparePins([pin(),pin(),pin('ok'),{...pin('bad'),world:{x:NaN,z:0}},null as never]);
    expect(r.items.map(p=>p.regionId)).toEqual(['ok']);expect(r.invalidCount).toBe(4);
  });
  it('orders signs by distance then id without mutating input or using unsigned bounds',()=>{
    const input=[sign('far',100),sign('z',-2),sign('a',-2)];
    expect(prepareSigns(input,{x:-3,z:0}).items.map(s=>s.id)).toEqual(['a','z','far']);
    expect(input[0].id).toBe('far');
    expect(prepareSigns(input,null).items.map(s=>s.id)).toEqual(['a','far','z']);
  });
  it('rejects duplicate signs and non-finite positions with a visible count',()=>{
    const r=prepareSigns([sign('a',0),sign('a',1),sign('b',Infinity),null as never],null);
    expect(r.items).toEqual([]);expect(r.invalidCount).toBe(4);
  });
});

describe('route feedback never announces malformed or wrong-region success',()=>{
  it.each([
    ['noPath','There is no walking route there.'],
    ['private','That is a private home. You need permission to enter.'],
    ['locked','That place is closed or locked. Check its opening conditions.'],
    ['unfinished','That area is not open in this version yet.'],
  ])('announces %s in visible text', (reason,message)=>expect(routeFeedback({ok:false,target,reason},'north','North')).toEqual({ok:false,message}));
  it('accepts a zero-length route and rounds estimated minutes up without claiming arrival',()=>{
    expect(routeFeedback(success,'north','North')).toEqual({ok:true,message:'Walking to North. About 0 game minutes.'});
    expect(routeFeedback({...success,etaGameMin:1.2},'north','North').message).toContain('2 game minutes');
  });
  it.each([
    null,{}, {...success,ok:1}, {...success,target:{...target,regionId:'south'}},
    {...success,target:{...target,x:-2}}, {...success,portals:[null]}, {...success,portals:'north'},
    {...success,lengthTiles:-1}, {...success,etaGameMin:NaN}, {...success,etaGameMin:Infinity},
    {ok:false,target,reason:'unknown'},
  ])('refuses invalid output %#',result=>expect(routeFeedback(result,'north','North')).toEqual({ok:false,message:'Walking is unavailable right now. Please try again.'}));
});
