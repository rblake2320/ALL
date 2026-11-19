"""S11 entry-control baseline on a real local build, private browser profile; no age answer/upload."""
import argparse, hashlib, json, re, runpy, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

ap=argparse.ArgumentParser();ap.add_argument('--out',required=True);ap.add_argument('--port',type=int,default=43961);ap.add_argument('--gestures',action='store_true');a=ap.parse_args()
out=Path(a.out);out.mkdir(parents=True,exist_ok=False)
here=Path(__file__).parent
assessor=runpy.run_path(str(here/'sol-world-ui-assess.py'))['assess']
wait_preview=runpy.run_path(str(here/'sol-a11y-health.py'))['wait_preview']
amd=next(x for x in runpy.run_path(str(here/'sol-dxgi.py'))['adapters']() if x['vendor']==4098)
for name in ['sol-world-ui-audit.py','sol-world-ui-assess.py','sol-a11y-health.py','sol-dxgi.py']:
    (out/name).write_bytes((here/name).read_bytes())

def hashes():return {p.relative_to(Path('dist')).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in Path('dist').rglob('*') if p.is_file()}
r=dict(pin=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),fixture='Public game APIs create a starter household; Not now leaves age unanswered. No cross-lot traversal claim.',distHashes=hashes(),sources={n:hashlib.sha256((out/n).read_bytes()).hexdigest() for n in ['sol-world-ui-audit.py','sol-world-ui-assess.py','sol-a11y-health.py','sol-dxgi.py']},errors=[],scenes=[],health=[])

def save():(out/'report.json').write_text(json.dumps(r,indent=2),encoding='utf-8')

def health(page):return page.evaluate("""() => {const g=window.__afterlife.game,gl=document.querySelector('#game-canvas').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:gl.getParameter(e.UNMASKED_RENDERER_WEBGL),fatal:g.fatalError,contextLost:g.renderer.stats().contextLost,buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight]}}""")

def gesture_probe(page):
    page.evaluate("() => {const g=window.__afterlife.game,id=g.sim.state.household.memberIds[0];g.setSpeed(0);g.selectAgent(id,false);g.renderer.focus(id,true);g.closeMenu()}")
    page.wait_for_timeout(350)
    point=page.evaluate("""() => {const g=window.__afterlife.game,c=document.querySelector('#game-canvas'),r=c.getBoundingClientRect(),a=g.sim.state.agents[g.selectedAgentId],out=[];for(let y=100;y<innerHeight-100;y+=20)for(let x=55;x<innerWidth-55;x+=20){if(document.elementFromPoint(x,y)!==c)continue;const p=g.renderer.pick(x-r.left,y-r.top,{agents:true,objects:true,tiles:true,walls:false});if(p.kind==='tile'&&Math.hypot(p.x+.5-a.pos.x,p.z+.5-a.pos.z)>=4)out.push({x,y,tile:{x:p.x,z:p.z}})}out.sort((a,b)=>Math.hypot(a.x-innerWidth/2,a.y-innerHeight/2)-Math.hypot(b.x-innerWidth/2,b.y-innerHeight/2));return out[0]||null}""")
    if not point:return dict(status='Blocked',reason='no unobscured ground pick')
    # queueCommand starts an idle actor's action immediately, even paused: count active + pending.
    def state():return page.evaluate("""() => {const g=window.__afterlife.game,a=g.sim.state.agents[g.selectedAgentId];return {actor:g.selectedAgentId,pos:a?.pos,camera:g.renderer.getCamera(),queue:a?[...(a.active?[a.active]:[]),...(a.queue||[])].filter(q=>q.source==='player').map(q=>({uid:q.uid,id:q.interactionId,target:q.target})):null,menu:g.menu?{target:g.menu.target,entries:g.menu.entries.map(e=>({label:e.label,disabled:e.disabled}))}:null}}""")
    before=state();page.touchscreen.tap(point['x'],point['y']);page.wait_for_timeout(200);after=state()
    tap_ok=before['actor']==after['actor'] and after['queue'] is not None and sum(q['id']=='engine_goHere' for q in after['queue'])==sum(q['id']=='engine_goHere' for q in before['queue'])+1 and after['menu'] is None
    menu_target=(after.get('menu') or {}).get('target')
    exact_target=menu_target==dict(kind='tile',**point['tile'])
    result=dict(status='Worked' if tap_ok or exact_target else 'Blocked',point=point,tap=dict(status='Worked' if tap_ok else 'Failed' if exact_target else 'Blocked',before=before,after=after))
    # A real menu command is an independent positive control that this ground target can receive Go Here.
    if after['menu']:
        go=page.get_by_role('menuitem',name=re.compile('go here',re.I))
        if go.count()==1:
            go.click();page.wait_for_timeout(150);positive=state()
            result['menuPositiveControl']=dict(status='Worked' if positive['actor']==before['actor'] and len(positive['queue'])==len(after['queue'])+1 else 'Failed',after=positive)
        else:result['menuPositiveControl']=dict(status='Blocked',reason='Go Here menu item unavailable',state=after)
    page.evaluate('window.__afterlife.game.closeMenu()');page.wait_for_timeout(100)
    cdp=page.context.new_cdp_session(page)
    def touch(event,points):cdp.send('Input.dispatchTouchEvent',dict(type=event,touchPoints=points))
    pan_before=state();x,y=point['x'],point['y']
    touch('touchStart',[dict(id=0,x=x,y=y)]);touch('touchMove',[dict(id=0,x=x+30,y=y)]);touch('touchEnd',[]);page.wait_for_timeout(150);pan_after=state()
    result['pan']=dict(status='Worked' if pan_before['actor']==pan_after['actor'] and pan_before['queue']==pan_after['queue'] and pan_after['menu'] is None and pan_before['camera']['target']!=pan_after['camera']['target'] else 'Failed',before=pan_before,after=pan_after)
    page.evaluate('window.__afterlife.game.closeMenu()')
    pinch_before=state()
    touch('touchStart',[dict(id=0,x=x-15,y=y),dict(id=1,x=x+15,y=y)])
    touch('touchMove',[dict(id=0,x=x-35,y=y),dict(id=1,x=x+35,y=y)])
    touch('touchEnd',[]);page.wait_for_timeout(150);pinch_after=state()
    result['pinch']=dict(status='Worked' if pinch_before['actor']==pinch_after['actor'] and pinch_before['queue']==pinch_after['queue'] and pinch_after['menu'] is None and pinch_before['camera']['distance']!=pinch_after['camera']['distance'] else 'Failed',before=pinch_before,after=pinch_after)
    cdp.detach();return result

with (out/'preview.log').open('w',encoding='utf-8') as log:
    server=subprocess.Popen(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',str(a.port),'--strictPort'],stdout=log,stderr=log)
    try:
        url=f'http://127.0.0.1:{a.port}/';r['servedCodeHashes']=wait_preview(server,url,out/'preview.log',r['distHashes']);save()
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='chrome',headless=False,args=['--use-angle=d3d11',f"--use-adapter-luid={amd['luid']}"])
            r['browserVersion']=browser.version
            try:
                for name,w,h,touch in [('desktop',1280,720,False),('portrait',390,844,True),('landscape',844,390,True)]:
                    context=browser.new_context(viewport=dict(width=w,height=h),device_scale_factor=1,has_touch=touch,is_mobile=touch,reduced_motion='reduce')
                    try:
                        page=context.new_page();page.on('pageerror',lambda e:r['errors'].append(str(e)));page.on('console',lambda m:r['errors'].append(m.text) if m.type=='error' else None)
                        page.goto(url,wait_until='networkidle');page.get_by_role('button',name='Not now',exact=True).click()
                        page.evaluate("async () => {const g=window.__afterlife.game;g.updateSettings({quality:'low',reduceMotion:true,tutorialEnabled:false});g.beginNewGame();g.updateCaz({lotTemplate:'starter'});await g.startGame();document.title='Sol W025 S11 UI baseline'}")
                        page.wait_for_function("window.__afterlife.game.screen==='game' && !!document.querySelector('.hud-household')",timeout=60000)
                        page.wait_for_timeout(1000)
                        row=page.evaluate("""() => {const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&!e.closest('[inert]')};const buttons=[...document.querySelectorAll('button,[role=button]')].filter(visible);const label=e=>e.getAttribute('aria-label')||(e.textContent||'').trim();const find=re=>{const e=buttons.find(b=>re.test(label(b)));if(!e)return null;const r=e.getBoundingClientRect();return {name:label(e),rect:[r.x,r.y,r.width,r.height],visible:visible(e),disabled:e.disabled||e.getAttribute('aria-disabled')==='true'}};return {viewport:[innerWidth,innerHeight],touch:matchMedia('(pointer:coarse)').matches,phoneLayout:document.documentElement.hasAttribute('data-phone'),townReady:window.__afterlife.game.sim.state.town?.v===2,controls:{map:find(/^(world map|neighbou?rhood map|overview map|open map|map)$/i),recentre:find(/^(recent(?:er|re)|centre on|center on|focus camera:)/i)},visibleButtons:buttons.map(label)}}""")
                        row['name']=name
                        if a.gestures and touch:row['gestures']=gesture_probe(page)
                        r['scenes'].append(row);r['health'].append(health(page));page.screenshot(path=str(out/f'{name}.png'));save()
                        print(json.dumps(dict(viewport=name,controls=row['controls'],townReady=row['townReady'],touch=row['touch'])),flush=True)
                        if name=='landscape':r['health'].append(health(page))
                    finally:context.close()
                r['finished']=True
            finally:browser.close()
    except Exception as e:r['blocker']=str(e);save()
    finally:server.terminate();server.wait(timeout=15)
r['acceptance']=assessor(r,hashes())
if a.gestures:
    g=[s.get('gestures',{}) for s in r['scenes'] if s['name'] in ['portrait','landscape']]
    r['gestureAcceptance']='Blocked' if len(g)!=2 or any(x.get('status')!='Worked' or any(x.get(k,{}).get('status')=='Blocked' for k in ['tap','pan','pinch']) or x.get('tap',{}).get('status')=='Failed' and x.get('menuPositiveControl',{}).get('status')!='Worked' for x in g) else 'Failed' if any(x.get(k,{}).get('status')!='Worked' for x in g for k in ['tap','pan','pinch']) else 'Worked'
save();print(json.dumps(r['acceptance']),flush=True)
raise SystemExit(2 if r['acceptance']['measurementStatus']=='Blocked' or r.get('gestureAcceptance')=='Blocked' else 1 if r['acceptance']['controlAcceptance']=='Failed' or r.get('gestureAcceptance')=='Failed' else 0)
