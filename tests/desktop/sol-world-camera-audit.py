"""S11 actual-game camera/selection acceptance on an explicit S5 production checkpoint.
Private Chrome profile, no Electron/shared saves. Does not inject regions or substitute scenery for traversal.
"""
import argparse,hashlib,json,runpy,subprocess,time
from pathlib import Path
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('--out',required=True);ap.add_argument('--off-home',action='store_true');ap.add_argument('--hud-aware',action='store_true');ap.add_argument('--ordinary-input',action='store_true');ap.add_argument('--follow-resize',action='store_true');ap.add_argument('--autonomy',choices=['full','off'],default='full');ap.add_argument('--viewport',choices=['all','desktop','portrait','landscape'],default='all');ap.add_argument('--input-ref',action='append',default=[]);ap.add_argument('--build-gate',default='not-recorded');a=ap.parse_args();out=Path(a.out);out.mkdir(parents=True,exist_ok=False)
here=Path(__file__).resolve().parent;root=Path.cwd()
for name in ['sol-world-camera-audit.py','sol-dxgi.py','sol-a11y-health.py']:(out/name).write_bytes((here/name).read_bytes())
wait_preview=runpy.run_path(str(here/'sol-a11y-health.py'))['wait_preview']
amd=next(x for x in runpy.run_path(str(here/'sol-dxgi.py'))['adapters']() if x['vendor']==4098)
def hashes():return {p.relative_to(Path('dist')).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in Path('dist').rglob('*') if p.is_file()}
r=dict(pin=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),scope='Actual S5 game camera/follow/recentre. Public new-game fixture only. Home-only simulation checkpoint; no cross-region walking claim.',sources={name:hashlib.sha256((out/name).read_bytes()).hexdigest() for name in ['sol-world-camera-audit.py','sol-dxgi.py','sol-a11y-health.py']},bundle=hashes(),errors=[],scenes=[])
r['hudAware']=a.hud_aware
r['requestedViewports']=a.viewport
r['requestedAutonomy']=a.autonomy
r['followResize']=a.follow_resize
r['ordinaryInput']=a.ordinary_input
if a.off_home:
    r['scope']='Private owner-permitted S3+S5 composition: real cross-region command sets up off-home camera acceptance. Not a product branch or general traversal/seed acceptance.'
    r['compositionParents']=subprocess.check_output(['git','show','-s','--format=%P','HEAD'],text=True).split();r['permission']='PR1 comment6697497697';assert a.ordinary_input or len(r['compositionParents'])==2
    r['compositionInputs']=a.input_ref;r['buildGate']=a.build_gate
    for ref in a.input_ref:subprocess.run(['git','merge-base','--is-ancestor',ref,'HEAD'],check=True)
if a.ordinary_input:
    r['scope']='Unpublished consolidated player batch: ordinary canvas mouse/touch world walking, canonical gesture negatives, actual arrival and camera. Public starter fixture; full neighbourhood/story acceptance remains in the team batch.'
    r['permission']='Owner BATCH-PLAN-1106; local S11 input integration'
    assert subprocess.check_output(['git','diff','HEAD','--','src'])==b'', 'Product source differs from recorded commit'
def save():(out/'report.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
def wait_predicate(page,predicate,timeout=25000):
    # Direct CDP evaluation of a function; avoid wait_for_function's page-side eval under the shipped CSP.
    deadline=time.monotonic()+timeout/1000
    while time.monotonic()<deadline:
        if page.evaluate(predicate):return
        page.wait_for_timeout(100)
    raise TimeoutError('Public game predicate did not complete')
def state(page,recentre=False):return page.evaluate("""doRecentre=>{const g=window.__afterlife.game,r=g.renderer,result=doRecentre?r.recentre():null,a=g.sim.state.agents[g.selectedAgentId],view=r.selectedActor();const picks=view?[.25,.6,.95,1.25,1.5].map(y=>{const p=r.worldToScreen(view.world.x-70,y,view.world.z);return {y,point:p,hit:p.visible?r.pick(p.x,p.y,{agents:true,objects:false,tiles:false,walls:false}):null}}):[];return {result,selected:g.selectedAgentId,actor:view,pivot:view?r.worldToScreen(view.world.x-70,.55,view.world.z):null,picks,actorHit:picks.some(p=>p.hit?.kind==='agent'&&p.hit.agentId===g.selectedAgentId),viewport:[innerWidth,innerHeight],following:r.following(),camera:r.getCamera(),queue:a?[...(a.active?[a.active]:[]),...(a.queue||[])].filter(q=>q.source==='player').map(q=>q.uid):[],tick:g.sim.state.tick,town:g.sim.state.town?{v:g.sim.state.town.v,homeLotId:g.sim.state.town.homeLotId,expandPending:g.sim.state.town.expandPending,active:g.sim.state.town.stream.active}:null}}""",recentre)
def framing(page):return page.evaluate("""()=>{const r=window.__afterlife.game.renderer,a=r.selectedActor(),points=[];for(const dx of [-.3,.3])for(const dz of [-.3,.3])for(const y of [0,1.6])points.push(r.worldToScreen(a.world.x-70+dx,y,a.world.z+dz));const rect={x0:Math.min(...points.map(p=>p.x)),x1:Math.max(...points.map(p=>p.x)),y0:Math.min(...points.map(p=>p.y)),y1:Math.max(...points.map(p=>p.y))};const blockers=[...document.querySelectorAll('[data-hud-region],.ui-modal')].map(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return {class:e.className,rect:{x0:b.left,x1:b.right,y0:b.top,y1:b.bottom},visible:b.width>1&&b.height>1&&b.width*b.height<innerWidth*innerHeight*.5&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0,overlap:Math.max(0,Math.min(rect.x1,b.right)-Math.max(rect.x0,b.left))*Math.max(0,Math.min(rect.y1,b.bottom)-Math.max(rect.y0,b.top))}}).filter(b=>b.visible&&b.overlap>0);return {scope:'Standard 0.6-tile by1.6m actor framing envelope; not exact skinned-mesh bounds.',actorId:a.agentId,rect,viewport:[innerWidth,innerHeight],inside:rect.x0>=0&&rect.y0>=0&&rect.x1<=innerWidth&&rect.y1<=innerHeight,blockers,head:r.bubbleAnchors().find(h=>h.agentId===a.agentId)||null}}""")
def health(page):return page.evaluate("""()=>{const g=window.__afterlife.game,c=document.querySelector('#game-canvas'),gl=c.getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:gl.getParameter(e.UNMASKED_RENDERER_WEBGL),fatal:g.fatalError,contextLost:gl.isContextLost(),buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],stats:g.renderer.stats()}}""")
def centred(s):
    assert s['actor'] and s['selected']==s['actor']['agentId']
    if a.hud_aware:return s['actorHit'] and s['pivot']['visible'] and all(__import__('math').isfinite(s['camera']['target'][k]) for k in ['x','z'])
    # Home scene frame is lot-local; SelectedActorView explicitly carries the separate world frame.
    return max(abs(s['camera']['target'][k]-s['actor']['local'][k]) for k in ['x','z'])<.1
with (out/'preview.log').open('w',encoding='utf-8') as log:
    server=subprocess.Popen(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','43961','--strictPort'],stdout=log,stderr=log)
    try:
        url='http://127.0.0.1:43961/';r['served']=wait_preview(server,url,out/'preview.log',r['bundle']);save()
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='chrome',headless=True,args=['--mute-audio','--use-angle=d3d11',f"--use-adapter-luid={amd['luid']}"])
            r['browserVersion']=browser.version
            try:
                for name,w,h,touch in [('desktop',1280,720,False),('portrait',390,844,True),('landscape',844,390,True)]:
                    if a.viewport!='all' and a.viewport!=name:continue
                    context=browser.new_context(viewport=dict(width=w,height=h),device_scale_factor=1,is_mobile=touch,has_touch=touch,reduced_motion='reduce')
                    try:
                        page=context.new_page();page.on('pageerror',lambda e:r['errors'].append(str(e)));page.on('console',lambda m:r['errors'].append(m.text) if m.type=='error' else None)
                        page.goto(url,wait_until='networkidle');page.get_by_role('button',name='Not now',exact=True).click()
                        page.evaluate("async options=>{const g=window.__afterlife.game,autonomy=options.autonomy;g.updateSettings({quality:'low',reduceMotion:true,tutorialEnabled:false,autonomy});g.beginNewGame();g.updateCaz({lotTemplate:'starter'});if(options.ordinary)g.addCazMember();await g.startGame();g.updateSettings({autonomy});g.setSpeed(0);document.title='Sol S11 Actual Camera Acceptance'}",dict(autonomy=a.autonomy,ordinary=a.ordinary_input))
                        wait_predicate(page,"()=>window.__afterlife.game.screen==='game' && !!document.querySelector('.hud-household')",60000);page.wait_for_timeout(1000)
                        row=dict(name=name,viewport=[w,h],cases=[],beforeHealth=health(page));r['scenes'].append(row);save()
                        assert 'AMD' in row['beforeHealth']['renderer'],row['beforeHealth']
                        page.evaluate("()=>{const g=window.__afterlife.game;g.selectAgent(g.sim.state.household.memberIds[0],false);g.renderer.follow(null);g.renderer.panWorld(5,2)}")
                        page.wait_for_timeout(250);before=state(page);row['before']=before;save()
                        assert before['actor'] and before['following'] is None
                        page.locator('#game-canvas').focus();page.keyboard.press('f')
                        # Native input includes event delivery and a rendered/selectable actor, not a fixed frame delay.
                        wait_predicate(page,"()=>{const g=window.__afterlife.game,r=g.renderer,a=r.selectedActor();return a&&r.following()===g.selectedAgentId&&[.25,.6,.95,1.25,1.5].some(y=>{const p=r.worldToScreen(a.world.x-70,y,a.world.z);return p.visible&&r.pick(p.x,p.y,{agents:true,objects:false,tiles:false,walls:false})?.agentId===g.selectedAgentId})}")
                        focused=state(page)
                        row['cases'].append(dict(name='real F recentres and follows selected actor',status='Worked' if centred(focused) and focused['following']==before['selected'] and before['selected']==focused['selected'] and before['queue']==focused['queue'] else 'Failed',after=focused));save()
                        frame=framing(page)
                        row['cases'].append(dict(name='selected-actor framing envelope clears HUD',status='Worked' if frame['inside'] and not frame['blockers'] else 'Failed',data=frame));save()
                        # A port invocation is sampled synchronously: Reduce motion must snap, not merely converge later.
                        page.evaluate('window.__afterlife.game.renderer.panWorld(4,1)')
                        # Establish a visibly panned frame before testing the synchronous reduced-motion snap.
                        # A fixed 250 ms sampled the old projection under a real 3.5-fps CPU render.
                        wait_predicate(page,"()=>{const r=window.__afterlife.game.renderer,a=r.selectedActor(),p=a?r.worldToScreen(a.world.x-70,.55,a.world.z):null,q="+json.dumps(focused['pivot'])+";return r.following()===null&&p&&Math.hypot(p.x-q.x,p.y-q.y)>2}")
                        panned=state(page)
                        reduced=state(page,True)
                        if a.hud_aware:snap=__import__('math').hypot(reduced['pivot']['x']-focused['pivot']['x'],reduced['pivot']['y']-focused['pivot']['y'])<1 and __import__('math').hypot(panned['pivot']['x']-focused['pivot']['x'],panned['pivot']['y']-focused['pivot']['y'])>2
                        else:snap=centred(reduced)
                        row['cases'].append(dict(name='reduced-motion recentre snaps synchronously',status='Worked' if reduced['result'] and centred(reduced) and reduced['following']==before['selected'] and snap else 'Failed',before=panned,expected=focused,after=reduced));save()
                        if touch:
                            pt=page.evaluate("""()=>{const c=document.querySelector('#game-canvas');for(let y=100;y<innerHeight-70;y+=20)for(let x=60;x<innerWidth-60;x+=20)if(document.elementFromPoint(x,y)===c&&document.elementFromPoint(x+40,y)===c)return {x,y};return null}""")
                            if not pt:raise RuntimeError('No unobscured canvas area for actual touch pan')
                            pan_before=state(page);cdp=context.new_cdp_session(page)
                            cdp.send('Input.dispatchTouchEvent',dict(type='touchStart',touchPoints=[dict(id=1,**pt)]));cdp.send('Input.dispatchTouchEvent',dict(type='touchMove',touchPoints=[dict(id=1,x=pt['x']+40,y=pt['y'])]));cdp.send('Input.dispatchTouchEvent',dict(type='touchEnd',touchPoints=[]));cdp.detach();page.wait_for_timeout(200);pan_after=state(page)
                            row['cases'].append(dict(name='actual touch pan stops follow without a walk or selection change',status='Worked' if pan_after['following'] is None and pan_after['selected']==pan_before['selected'] and pan_after['queue']==pan_before['queue'] and pan_after['camera']['target']!=pan_before['camera']['target'] else 'Failed',before=pan_before,after=pan_after));save()
                        unknown=page.evaluate("()=>{const g=window.__afterlife.game,before=g.renderer.getCamera();g.renderer.follow('sol-unknown-actor');const result=g.renderer.recentre();return {result,before,after:g.renderer.getCamera()}}")
                        row['cases'].append(dict(name='unknown followed actor is refused without a camera jump',status='Worked' if unknown['result'] is False and unknown['before']==unknown['after'] else 'Failed',data=unknown))
                        no_actor=page.evaluate("()=>{const g=window.__afterlife.game,r=g.renderer;r.follow(null);g.selectAgent(null,false);return {selected:g.selectedAgentId,actor:r.selectedActor(),result:r.recentre()}}")
                        # The controller's normal maintainSelection() may reselect a living member next frame.
                        # Probe the null input synchronously, and retain that lifecycle separately from this port guard.
                        page.wait_for_timeout(100);row['selectionAfterFrame']=state(page)
                        row['cases'].append(dict(name='no selection or follow returns null/false',status='Worked' if no_actor['actor'] is None and no_actor['result'] is False else 'Failed',data=no_actor))
                        page.evaluate("()=>{const g=window.__afterlife.game;g.selectAgent(g.sim.state.household.memberIds[0],false);g.renderer.recentre()}");page.wait_for_timeout(150)
                        if a.off_home:
                            if a.ordinary_input:
                                # Frame a real ground tile for device input; no actor/route state writes.
                                def frame_ground():
                                    setup=page.evaluate("""()=>{const g=window.__afterlife.game,r=g.renderer;r.follow(null);return r.frameAt({x:14.5,y:0,z:32.5},{x:innerWidth*.7,y:innerHeight*.4},true)}""")
                                    assert setup,'Ground camera framing refused';page.wait_for_timeout(400)
                                    picked=page.evaluate("""()=>{const g=window.__afterlife.game,r=g.renderer,c=document.querySelector('#game-canvas'),p=r.worldToScreen(14.5,0,32.5),pick=r.pick(p.x,p.y,{agents:true,objects:true,walls:false,tiles:true});return {point:p,canvas:document.elementFromPoint(p.x,p.y)===c,pick}}""")
                                    assert picked['canvas'] and picked['point']['visible'] and picked['pick']['kind']=='worldTile' and picked['pick']['target']==dict(regionId='street:mildew:2',x=14,z=2),picked
                                    return picked['point']
                                pt=frame_ground();row['ordinaryInputPoint']=pt;save()
                                if touch:
                                    page.evaluate("""()=>{const g=window.__afterlife.game;window.__solNativeEvents=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,e=>{const row={type,id:e.pointerId,device:e.pointerType,x:e.clientX,y:e.clientY,t:e.timeStamp,target:e.target?.id||e.target?.className};queueMicrotask(()=>{const a=g.sim.state.agents[g.selectedAgentId];row.player=[...(a.active?[a.active]:[]),...a.queue].filter(q=>q.source==='player').map(q=>({uid:q.uid,interactionId:q.interactionId,target:q.target,params:q.params}));});window.__solNativeEvents.push(row);if(window.__solNativeEvents.length>128)window.__solNativeEvents.shift()},true)}""")
                                    for gesture in ['longPress','cancel','pinch']:
                                        cdp=context.new_cdp_session(page);start=dict(id=1,x=pt['x'],y=pt['y'])
                                        cdp.send('Input.dispatchTouchEvent',dict(type='touchStart',touchPoints=[start]))
                                        if gesture=='longPress':page.wait_for_timeout(550);cdp.send('Input.dispatchTouchEvent',dict(type='touchEnd',touchPoints=[]))
                                        elif gesture=='cancel':cdp.send('Input.dispatchTouchEvent',dict(type='touchCancel',touchPoints=[]))
                                        else:
                                            second=dict(id=2,x=pt['x']+30,y=pt['y']);cdp.send('Input.dispatchTouchEvent',dict(type='touchStart',touchPoints=[start,second]));cdp.send('Input.dispatchTouchEvent',dict(type='touchMove',touchPoints=[start,dict(second,x=pt['x']+60)]));cdp.send('Input.dispatchTouchEvent',dict(type='touchEnd',touchPoints=[start]));cdp.send('Input.dispatchTouchEvent',dict(type='touchEnd',touchPoints=[]))
                                        cdp.detach();page.wait_for_timeout(100);after=state(page)
                                        row['cases'].append(dict(name='actual '+gesture+' on world ground enqueues no walk',status='Worked' if not after['queue'] and after['selected']==before['selected'] else 'Failed',after=after,nativeEvents=page.evaluate('window.__solNativeEvents')));save();pt=frame_ground()
                                    page.locator('#game-canvas').focus();cdp=context.new_cdp_session(page)
                                    cdp.send('Input.dispatchTouchEvent',dict(type='touchStart',touchPoints=[dict(id=1,x=pt['x'],y=pt['y'])]))
                                    page.keyboard.press('Tab');changed=state(page)
                                    cdp.send('Input.dispatchTouchEvent',dict(type='touchEnd',touchPoints=[]));cdp.detach();page.wait_for_timeout(100)
                                    race=page.evaluate("""()=>{const g=window.__afterlife.game;return {selected:g.selectedAgentId,player:g.sim.state.household.memberIds.flatMap(id=>{const a=g.sim.state.agents[id];return [...(a.active?[a.active]:[]),...a.queue].filter(q=>q.source==='player').map(q=>({actor:id,uid:q.uid}))})}}""")
                                    row['cases'].append(dict(name='actual selection change while touch is held orders neither actor',status='Worked' if changed['selected']!=before['selected'] and race['selected']==changed['selected'] and not race['player'] else 'Failed',changed=changed,after=race));save()
                                    page.locator('#game-canvas').focus();page.keyboard.press('Shift+Tab');assert state(page)['selected']==before['selected'];pt=frame_ground()
                                before_input=state(page);row['ordinaryInputBefore']=before_input;assert not before_input['queue'];save()
                                if touch:page.touchscreen.tap(pt['x'],pt['y'])
                                else:page.mouse.click(pt['x'],pt['y'])
                                page.wait_for_timeout(100)
                                queued=page.evaluate("""()=>{const g=window.__afterlife.game,a=g.sim.state.agents[g.selectedAgentId];return {selected:g.selectedAgentId,active:a.active,queue:a.queue}}""")
                                row['ordinaryInputQueued']=queued;save()
                                player=[q for q in ([queued['active']] if queued['active'] else [])+queued['queue'] if q['source']=='player']
                                assert queued['selected']==before['selected'] and len(player)==1,queued
                                command=player[0];assert command['interactionId']=='engine_goHere' and command['params']['regionId']=='street:mildew:2' and command['target']==dict(kind='tile',x=14,z=2),command
                                route=page.evaluate("()=>{const g=window.__afterlife.game;return g.sim.worldRoute(g.selectedAgentId,{regionId:'street:mildew:2',x:14,z:2})}")
                            else:route=page.evaluate("()=>{const g=window.__afterlife.game;return g.walkTo(g.selectedAgentId,{regionId:'street:mildew:2',x:14,z:2})}")
                            row['routeSetup']=route;save();assert route['ok'],route
                            page.evaluate("""()=>{const g=window.__afterlife.game,s=g.sim,orig=s.step,id=g.selectedAgentId,t=window.__solWalkTrace={steps:0,samples:[],firstArrived:null};s.step=function(...args){const v=orig.apply(s,args),a=s.state.agents[id];t.steps++;const q={tick:s.state.tick,regionId:a.regionId,pos:{...a.pos},presence:a.presence,active:a.active?{id:a.active.interactionId,source:a.active.source}:null,autonomy:s.state.settings.autonomy};if(q.regionId==='street:mildew:2'&&Math.hypot(q.pos.x-14.5,q.pos.z-2.5)<.15&&!t.firstArrived)t.firstArrived=q;t.samples.push(q);if(t.samples.length>500)t.samples.shift();return v;};window.__solWalkRestore=()=>{s.step=orig;};}""")
                            page.evaluate('window.__afterlife.game.setSpeed(3)')
                            try:wait_predicate(page,"()=>{const g=window.__afterlife.game,a=g.sim.state.agents[g.selectedAgentId];return a.regionId==='street:mildew:2'&&Math.hypot(a.pos.x-14.5,a.pos.z-2.5)<.15}")
                            except Exception:
                                row['walkTimeout']=dict(state=state(page),health=health(page),trace=page.evaluate('window.__solWalkTrace'),faults=page.evaluate('window.__afterlife.game.sim.faults()'));save();page.screenshot(path=str(out/(name+'-walk-timeout.png')));raise
                            finally:
                                row['walkTrace']=page.evaluate('window.__solWalkTrace');page.evaluate('window.__solWalkRestore()');save()
                            page.evaluate('window.__afterlife.game.setSpeed(0)');page.wait_for_timeout(200)
                            arrived=state(page);row['arrived']=arrived;save()
                            # Independent map reference: canonical n2 home(70,0), street2(70,30), both rotation0.
                            # Public walkTo moves naturally to tile(14,2), not an injected/teleported position.
                            page.evaluate('window.__afterlife.game.renderer.panWorld(5,2)');page.wait_for_timeout(150)
                            page.locator('#game-canvas').focus();page.keyboard.press('f');page.wait_for_timeout(100)
                            away=state(page)
                            away_frame=framing(page)
                            alignment=away['actorHit'] and away_frame['inside'] and not away_frame['blockers'] if a.hud_aware else max(abs(away['camera']['target'][k]+off-away['actor']['world'][k]) for k,off in [('x',70),('z',0)])<.15 and away['pivot']['visible'] and abs(away['pivot']['x']-w/2)<1 and abs(away['pivot']['y']-h/2)<1
                            correct=away['actor']['regionId']=='street:mildew:2' and away['selected']==before['selected']==away['following'] and max(abs(away['actor']['world'][k]-v) for k,v in [('x',84.5),('z',32.5)])<.15 and alignment
                            row['cases'].append(dict(name='real off-home walk then F centres world position and preserves actor',status='Worked' if correct else 'Failed',after=away,frame=away_frame));save()
                            if a.ordinary_input:
                                home_setup=page.evaluate("""()=>{const g=window.__afterlife.game,r=g.renderer;r.follow(null);r.frameAt({x:13.5,y:0,z:28.5},{x:innerWidth*.7,y:innerHeight*.4},true);return {home:g.sim.state.town.homeLotId,before:[...(g.sim.state.agents[g.selectedAgentId].active?[g.sim.state.agents[g.selectedAgentId].active]:[]),...g.sim.state.agents[g.selectedAgentId].queue].filter(q=>q.source==='player').map(q=>q.uid)}}""");page.wait_for_timeout(400)
                                home_point=page.evaluate("""()=>{const r=window.__afterlife.game.renderer,p=r.worldToScreen(13.5,0,28.5);return {point:p,canvas:document.elementFromPoint(p.x,p.y)===document.querySelector('#game-canvas'),pick:r.pick(p.x,p.y,{agents:true,objects:true,walls:false,tiles:true})}}""")
                                row['homeInputSetup']=dict(setup=home_setup,point=home_point);save();assert home_point['canvas'] and home_point['pick']['kind']=='tile' and home_point['pick']['x']==13 and home_point['pick']['z']==28,home_point
                                pt=home_point['point']
                                if touch:page.touchscreen.tap(pt['x'],pt['y'])
                                else:page.mouse.click(pt['x'],pt['y'])
                                home_actions=page.evaluate("""()=>{const g=window.__afterlife.game,a=g.sim.state.agents[g.selectedAgentId];return [...(a.active?[a.active]:[]),...a.queue].filter(q=>q.source==='player')}""")
                                fresh=[q for q in home_actions if q['uid'] not in home_setup['before']];row['homeInputActions']=home_actions;save();assert len(fresh)==1 and fresh[0]['params']['regionId']==home_setup['home'] and fresh[0]['target']==dict(kind='tile',x=13,z=28),fresh
                                page.evaluate("""()=>{const g=window.__afterlife.game,s=g.sim,orig=s.step,id=g.selectedAgentId,t=window.__solHomeArrival={first:null};s.step=function(...args){const v=orig.apply(s,args),a=s.state.agents[id],regionId=a.regionId??s.state.town.homeLotId;if(!t.first&&regionId===s.state.town.homeLotId&&Math.hypot(a.pos.x-13.5,a.pos.z-28.5)<.15)t.first={tick:s.state.tick,regionId,rawRegionId:a.regionId??null,pos:{...a.pos}};return v};window.__solHomeRestore=()=>{s.step=orig}}""")
                                page.evaluate('window.__afterlife.game.setSpeed(3)')
                                try:wait_predicate(page,'()=>!!window.__solHomeArrival.first',30000)
                                finally:row['homeArrival']=page.evaluate('window.__solHomeArrival');page.evaluate('window.__solHomeRestore()');save()
                                page.evaluate('window.__afterlife.game.setSpeed(0)');row['cases'].append(dict(name='ordinary home-ground input returns the away member to the named home region',status='Worked',data=row['homeArrival']));save()
                            if a.follow_resize:
                                # A longer public street walk stays in flight through all three viewport phases.
                                # Read-only per-tick arrival capture also handles an ambient idle starting next tick.
                                target=dict(regionId='street:mildew:3',x=14,z=2)
                                returned=page.evaluate("target=>{const g=window.__afterlife.game;return g.walkTo(g.selectedAgentId,target)}",target)
                                row['returnSetup']=dict(target=target,result=returned);save();assert returned['ok'],returned
                                page.evaluate("""target=>{const g=window.__afterlife.game,s=g.sim,orig=s.step,id=g.selectedAgentId,t=window.__solFollowTrace={firstArrived:null,steps:0};s.step=function(...args){const v=orig.apply(s,args),a=s.state.agents[id];t.steps++;if(!t.firstArrived&&a.regionId===target.regionId&&Math.hypot(a.pos.x-target.x-.5,a.pos.z-target.z-.5)<.15)t.firstArrived={tick:s.state.tick,regionId:a.regionId,pos:{...a.pos},active:a.active?{id:a.active.interactionId,source:a.active.source}:null};return v};window.__solFollowRestore=()=>{s.step=orig}}""",target)
                                page.evaluate('window.__afterlife.game.setSpeed(1)');samples=[]
                                for phase,pw,ph in [('original',w,h),('rotated',h,w),('restored',w,h)]:
                                    page.set_viewport_size(dict(width=pw,height=ph));page.wait_for_timeout(650)
                                    for i in range(8):
                                        sample=dict(phase=phase,state=state(page),frame=framing(page));samples.append(sample)
                                        row['followResizeSamples']=samples;save();page.wait_for_timeout(150)
                                    page.screenshot(path=str(out/(name+'-follow-'+phase+'.png')))
                                moved=len({(s['state']['actor']['world']['x'],s['state']['actor']['world']['z']) for s in samples})
                                bad=[i for i,s in enumerate(samples) if s['state']['following']!=before['selected'] or s['state']['selected']!=before['selected'] or not s['frame']['inside'] or s['frame']['blockers']]
                                row['cases'].append(dict(name='continuous real walking follow survives viewport rotation and restore clear of HUD',status='Worked' if moved>=8 and not bad else 'Failed',samples=len(samples),distinctPositions=moved,badSampleIndices=bad));save()
                                page.evaluate('window.__afterlife.game.setSpeed(3)')
                                try:wait_predicate(page,'()=>!!window.__solFollowTrace.firstArrived',60000)
                                finally:
                                    row['followArrivalTrace']=page.evaluate('window.__solFollowTrace');page.evaluate('window.__solFollowRestore()');save()
                                page.evaluate('window.__afterlife.game.setSpeed(0)');row['followDestination']=state(page);row['followDestinationFrame']=framing(page);save()
                        row['afterHealth']=health(page);page.screenshot(path=str(out/(name+'.png')));save()
                        for v in [row['beforeHealth'],row['afterHealth']]:assert 'AMD' in v['renderer'] and not v['fatal'] and not v['contextLost'] and min(v['buffer'])>0,v
                        assert all(c['status']=='Worked' for c in row['cases']),row['cases']
                        print(json.dumps(dict(viewport=name,cases=len(row['cases']),status='Worked')),flush=True)
                    finally:context.close()
            finally:browser.close()
        r['bundleAfter']=hashes();assert r['bundle']==r['bundleAfter'] and not r['errors'],r['errors'];r['status']='Worked'
    except Exception as e:r['status']='Failed' if r['scenes'] else 'Blocked';r['error']=str(e)
    finally:r['bundleAfter']=hashes();server.terminate();server.wait(timeout=15);save()
print(json.dumps(dict(status=r['status'],scenes=len(r['scenes']),error=r.get('error'))),flush=True)
raise SystemExit(0 if r['status']=='Worked' else 1 if r['status']=='Failed' else 2)
