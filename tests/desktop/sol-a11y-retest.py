"""Read-only production-browser accessibility audit. No shipped game source is changed.
Install axe-core@4.14.0 in dev/out/sol-a11y-tools; use a new --out for every run.
"""
import argparse, hashlib, json, re, runpy, subprocess, time, urllib.request
from pathlib import Path
from datetime import datetime,timezone
from playwright.sync_api import sync_playwright

ap=argparse.ArgumentParser();ap.add_argument('--port',type=int,required=True);ap.add_argument('--out',required=True);ap.add_argument('--pause-on-menu',action='store_true');ap.add_argument('--zoom-check',action='store_true');a=ap.parse_args()
root=Path.cwd();out=Path(a.out)
if out.exists():raise FileExistsError(out)
out.mkdir(parents=True)
source=Path(__file__).read_bytes();(out/'launched-harness.py').write_bytes(source)
axe_path=root/'dev/out/sol-a11y-tools/node_modules/axe-core/axe.min.js'
axe=axe_path.read_text(encoding='utf-8')
health_source=Path(__file__).with_name('sol-a11y-health.py').read_bytes();(out/'launched-health.py').write_bytes(health_source)
health_api=runpy.run_path(str(Path(__file__).with_name('sol-a11y-health.py')));assess=health_api['assess'];wait_preview=health_api['wait_preview']
report=dict(pin=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),started=datetime.now(timezone.utc).isoformat(),axeVersion=json.loads(axe_path.with_name('package.json').read_text())['version'],axeSha256=hashlib.sha256(axe_path.read_bytes()).hexdigest(),harnessSha256=hashlib.sha256(source).hexdigest(),healthEvaluatorSha256=hashlib.sha256(health_source).hexdigest(),checks=[],screens=[],errors=[],consoleErrors=[],warnings=[],health=[])
report['distHashes']={str(p.relative_to(root/'dist')).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in (root/'dist').rglob('*') if p.is_file()}
def save(): (out/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')

def health(page):return page.evaluate('''() => {const g=window.__afterlife.game,gl=document.querySelector('#game-canvas').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:gl.getParameter(e.UNMASKED_RENDERER_WEBGL),fatal:g.fatalError,contextLost:g.renderer.stats().contextLost,buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight]};}''')
def result(name,ok,detail=None):
    report['checks'].append(dict(name=name,status='Worked' if ok else 'Failed',detail=detail));save();print(f"{'Worked' if ok else 'Failed'}: {name}",flush=True)
def until(page,fn,timeout=90):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        if page.evaluate(fn):return
        page.wait_for_timeout(100)
    raise TimeoutError(fn)
def focus(page):return page.evaluate('''() => {let e=document.activeElement;return {tag:e?.tagName,id:e?.id,label:e?.getAttribute('aria-label'),text:e?.textContent?.trim().slice(0,100),role:e?.getAttribute('role'),outline:e?getComputedStyle(e).outline:null,inDialog:!!e?.closest('[aria-modal="true"]')};}''')
def world_focus(page):
    for _ in range(20):
        page.keyboard.press('F6')
        if page.evaluate("document.activeElement===document.body || document.activeElement?.id==='game-canvas'"):return True
    return False
def activate(page,locator,label):
    locator.wait_for(state='visible',timeout=15000)
    trail=[]
    for _ in range(180):
        if locator.count()==1 and locator.evaluate('(e)=>e===document.activeElement || e.contains(document.activeElement)'):
            page.keyboard.press('Enter');page.wait_for_timeout(150);result(label,True,trail);return True
        page.keyboard.press('Tab');trail.append(focus(page))
    result(label,False,trail);return False
def scan(page,cdp,name):
    page.wait_for_timeout(350)
    page.evaluate(axe)
    findings=page.evaluate("async () => await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}})")
    (out/f'{name}-axe.json').write_text(json.dumps(findings,indent=2),encoding='utf-8')
    tree=cdp.send('Accessibility.getFullAXTree')
    (out/f'{name}-ax.json').write_text(json.dumps(tree,indent=2),encoding='utf-8')
    page.screenshot(path=str(out/f'{name}.jpg'),type='jpeg',quality=80)
    view=page.evaluate('''() => ({screen:window.__afterlife.game.screen,dialog:window.__afterlife.game.dialog,focus:(()=>{let e=document.activeElement;return {tag:e.tagName,id:e.id,label:e.getAttribute('aria-label'),text:e.textContent?.slice(0,80)}})(),rootFont:getComputedStyle(document.documentElement).fontSize,viewport:[innerWidth,innerHeight],scroll:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],lang:document.documentElement.lang,dir:document.documentElement.dir,overflow:Array.from(document.querySelectorAll('button,input,[role="tab"],h1,h2,h3,label')).filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&(r.right>innerWidth+1||r.left< -1)}).slice(0,35).map(e=>({tag:e.tagName,text:(e.getAttribute('aria-label')||e.textContent||'').slice(0,80),x:e.getBoundingClientRect().x,width:e.getBoundingClientRect().width}))})''')
    report['health'].append(health(page))
    report['screens'].append(dict(name=name,controlledTextFixture=name=='settings-expanded',violations=[dict(id=v['id'],impact=v['impact'],nodes=len(v['nodes'])) for v in findings['violations']],incomplete=[dict(id=v['id'],nodes=len(v['nodes'])) for v in findings['incomplete']],view=view));save()
    print(f"Scan {name}: {len(findings['violations'])} axe rule violations",flush=True)
def exercise(page,label,fn):
    try:fn()
    except Exception as e:report['checks'].append(dict(name=label,status='Blocked',detail=str(e)));save();print(f'Blocked: {label}: {e}',flush=True)

adapters=runpy.run_path(str(Path(__file__).with_name('sol-dxgi.py')))['adapters']();amd=next(x for x in adapters if x['vendor']==4098);report['adapter']=amd
with (out/'preview.log').open('w',encoding='utf-8') as log:
 server=subprocess.Popen(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',str(a.port),'--strictPort'],stdout=log,stderr=log)
 try:
  url=f'http://127.0.0.1:{a.port}/'
  report['servedCodeHashes']=wait_preview(server,url,out/'preview.log',report['distHashes']);save()
  with sync_playwright() as p:
   browser=p.chromium.launch(channel='chrome',headless=False,args=['--use-angle=d3d11',f"--use-adapter-luid={amd['luid']}",'--force-renderer-accessibility'])
   try:
    report['browserVersion']=browser.version
    context=browser.new_context(viewport=dict(width=1920,height=1080),device_scale_factor=1,reduced_motion='reduce')
    page=context.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)))
    page.on('console',lambda m:report['consoleErrors'].append(m.text) if m.type=='error' else report['warnings'].append(m.text) if m.type=='warning' else None)
    cdp=context.new_cdp_session(page);cdp.send('Accessibility.enable')
    page.goto(url,wait_until='networkidle');until(page,"() => window.__afterlife?.game.screen==='menu'")
    page.evaluate("document.title='Afterlife Lease - Sol W064 Retest'")
    if a.pause_on_menu:
     (out/'menu-ready').write_text('ready')
     print('Native handoff: menu ready; waiting up to120sec for dev/out/sol-a11y-resume',flush=True)
     end=time.monotonic()+120
     while not (root/'dev/out/sol-a11y-resume').exists() and time.monotonic()<end:page.wait_for_timeout(200)
    report['renderer']=page.evaluate("() => {const g=document.querySelector('canvas').getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e.UNMASKED_RENDERER_WEBGL)}")
    assert 'AMD Radeon' in report['renderer']
    scan(page,cdp,'age-gate')
    activate(page,page.get_by_role('button',name='Not now',exact=True),'keyboard dismiss age gate')
    result('OS reduced-motion is exposed',page.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"))
    report['osMotionDefault']=page.evaluate("() => ({setting:window.__afterlife.game.settings.reduceMotion,rootClass:document.documentElement.className,animations:document.getAnimations().filter(a=>a.playState==='running').length,orbit:window.__afterlife.game.renderer.camera().position.toArray()})")
    page.wait_for_timeout(1000);report['osMotionAfter']=page.evaluate("() => ({animations:document.getAnimations().filter(a=>a.playState==='running').length,orbit:window.__afterlife.game.renderer.camera().position.toArray()})")
    page.evaluate("window.__afterlife.game.updateSettings({quality:'low',tutorialEnabled:false,pauseWhenUnfocused:false})")
    scan(page,cdp,'menu')
    activate(page,page.locator('.sh-menu__item',has_text='Settings'),'keyboard open settings')
    scan(page,cdp,'settings')
    trapped=[]
    for _ in range(35):page.keyboard.press('Tab');trapped.append(focus(page))
    result('settings Tab stays in modal',all(x['inDialog'] for x in trapped),trapped)
    page.keyboard.press('Escape');until(page,"() => window.__afterlife.game.dialog===null && !document.querySelector('[aria-modal=\"true\"]')")
    page.wait_for_timeout(100)
    result('Escape closes settings and restores focus',page.locator('.sh-menu__item',has_text='Settings').evaluate('(e)=>e===document.activeElement'),focus(page))
    activate(page,page.locator('.sh-menu__item',has_text='New Game'),'keyboard choose new game')
    activate(page,page.get_by_role('button',name='Create your household',exact=True),'keyboard enter CAZ')
    until(page,"() => window.__afterlife.game.screen==='caz'")
    scan(page,cdp,'caz')
    if page.get_by_role('textbox',name='First name',exact=True).count():
     report['cazNameMode']='free-text'
     activate(page,page.get_by_role('textbox',name='First name',exact=True),'keyboard reach first name')
     page.keyboard.press('Control+a');page.keyboard.type('   ');page.keyboard.press('Tab')
     result('CAZ invalid first name is announced as error',page.locator('[role="alert"]').count()>0 or page.locator('[aria-invalid="true"]').count()>0)
     scan(page,cdp,'caz-invalid')
     activate(page,page.get_by_role('textbox',name='First name',exact=True),'keyboard return to first name')
     page.keyboard.press('Control+a');page.keyboard.type('Mortimer');page.keyboard.press('Tab')
    else:
     report['cazNameMode']='unanswered-age-preset'
     preset=page.get_by_role('button',name=re.compile(r'^First name\b'))
     before=preset.inner_text()
     assert activate(page,preset,'keyboard open preset first-name picker')
     page.get_by_role('listbox').wait_for(state='visible')
     page.keyboard.press('ArrowDown');page.keyboard.press('Enter');page.wait_for_timeout(200)
     report['presetNameChoice']=dict(before=before,after=preset.inner_text())
     result('keyboard selects a nonempty preset without free-text entry',report['presetNameChoice']['before']!=report['presetNameChoice']['after'] and bool(report['presetNameChoice']['after'].strip()),report['presetNameChoice'])
     scan(page,cdp,'caz-preset')
    activate(page,page.locator('.sh-editor__start'),'keyboard start playable household')
    until(page,"() => window.__afterlife.game.screen==='game' && window.__afterlife.game.renderer.loadProgress()>=1",180)
    page.evaluate("window.__afterlife.game.updateSettings({quality:'low',tutorialEnabled:false,showFps:false})")
    page.wait_for_timeout(500)
    story=page.get_by_role('button',name='Let’s go',exact=True)
    if page.evaluate('!!window.__afterlife.game.storyIntro'):story.wait_for(state='visible',timeout=10000)
    report['storyIntroductionVisible']=story.count()>0
    if story.count():
     for _ in range(15):
      if story.evaluate('(e)=>e===document.activeElement'):break
      page.keyboard.press('F6')
     assert activate(page,story,'keyboard dismiss story introduction')
     story.wait_for(state='detached',timeout=10000)
    assert world_focus(page),'world keyboard focus unavailable'
    if page.evaluate('window.__afterlife.game.speed!==0'):page.keyboard.press('Space')
    scan(page,cdp,'hud')
    regions=[]
    for _ in range(10):page.keyboard.press('F6');regions.append(focus(page))
    result('F6 reaches HUD controls',len({(x['id'],x['label'],x['text']) for x in regions})>=3,regions)
    assert world_focus(page),'world focus unavailable before Buy hotkey'
    page.keyboard.press('b');until(page,"() => window.__afterlife.game.mode==='buy' && !!document.querySelector('.hud-buy')",15)
    for _ in range(15):
     if page.evaluate("!!document.activeElement?.closest('.hud-buy')"):break
     page.keyboard.press('F6')
    assert page.evaluate("!!document.activeElement?.closest('.hud-buy')"),'F6 did not reach the Buy region'
    scan(page,cdp,'buy')
    activate(page,page.get_by_role('searchbox'),'keyboard reach buy search')
    page.keyboard.type('fern')
    activate(page,page.locator('.hud-item').filter(has_text='Fern').first,'keyboard select Fern from catalog')
    def placement(tracked=None):return page.evaluate("tracked => {const g=window.__afterlife.game,id=tracked||g.buy.placingDefId;return {placing:g.buy.placingDefId,tracked:id,count:Object.values(g.sim.state.objects).filter(o=>o.defId===id).length,funds:g.sim.state.household.funds,mode:g.mode,focus:document.activeElement?.tagName}}",tracked)
    report['placementBefore']=placement()
    assert report['placementBefore']['placing'],'catalog selection was not established'
    result('F6 returns focus to world',world_focus(page),focus(page))
    page.keyboard.press('ArrowRight');page.wait_for_timeout(150)
    def announcement():return page.locator('[data-testid="placement-live"]').inner_text()
    directions=['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'];free='Can place here' in announcement()
    for leg in range(20):
     if free:break
     for _ in range(leg//2+1):
      page.keyboard.press(directions[leg%4]);page.wait_for_timeout(80)
      free='Can place here' in announcement()
      if free:break
    assert free,'keyboard could not find an announced free tile'
    report['keyboardPlacementAnnouncement']=announcement()
    report['placementPrice']=page.evaluate("id=>window.__afterlife.game.sim.content.objects[id].price",report['placementBefore']['placing'])
    page.keyboard.press('Enter');page.wait_for_timeout(200)
    report['placementAfter']=placement(report['placementBefore']['placing'])
    result('keyboard places selected Fern for its catalog price',report['placementAfter']['count']==report['placementBefore']['count']+1 and report['placementAfter']['funds']==report['placementBefore']['funds']-report['placementPrice'],dict(before=report['placementBefore'],after=report['placementAfter'],price=report['placementPrice']))
    page.keyboard.press('Enter');page.wait_for_timeout(150)
    refused=placement(report['placementBefore']['placing'])
    result('occupied keyboard placement is refused without charging',refused['count']==report['placementAfter']['count'] and refused['funds']==report['placementAfter']['funds'] and "Can't place here" in announcement(),dict(state=refused,announcement=announcement()))
    helper=(root/'tests/e2e/lib/inpage.mjs').read_text(encoding='utf-8')
    fn=re.search(r'export function findPlaceTile\([\s\S]*?\n}\n',helper).group().replace('export ','',1)
    page.locator('.hud-item').filter(has_text='Fern').first.click()
    report['pointerPlacementBefore']=placement(report['placementBefore']['placing'])
    points=page.evaluate(fn,dict(defId=report['placementBefore']['placing']))
    if points:
        page.mouse.click(points[0]['sx'],points[0]['sy']);page.wait_for_timeout(200)
        report['pointerPlacementControl']=placement(report['placementBefore']['placing'])
        result('pointer control places the same Fern',report['pointerPlacementControl']['count']>report['pointerPlacementBefore']['count'],dict(before=report['pointerPlacementBefore'],after=report['pointerPlacementControl']))
    else:result('pointer control has a valid placement tile',False,points)
    page.keyboard.press('Escape');world_focus(page);page.keyboard.press('l');page.keyboard.press('g')
    until(page,"() => window.__afterlife.game.dialog==='store'")
    scan(page,cdp,'store')
    year=page.get_by_test_id('age-year')
    assert year.count()==1,'Store age-year fixture missing'
    for _ in range(100):
     if year.evaluate('(e)=>e===document.activeElement'):break
     page.keyboard.press('Tab')
    else:raise RuntimeError('Age-year field not keyboard reachable')
    page.keyboard.press('ArrowRight');report['storeKeyboardFocus']=focus(page)
    page.keyboard.press('Escape');result('keyboard closes store',page.evaluate("window.__afterlife.game.dialog!=='store'"))
    assert world_focus(page),'world focus unavailable before Pause chain'
    report['pauseChainOpener']=focus(page)
    page.keyboard.press('Escape');until(page,"() => window.__afterlife.game.dialog==='pause'")
    assert activate(page,page.locator('.sh-pause__item',has_text='Settings'),'keyboard opens Pause Settings')
    until(page,"() => window.__afterlife.game.dialog==='settings'")
    page.keyboard.press('Escape');until(page,"() => window.__afterlife.game.dialog==='pause'");page.wait_for_timeout(200)
    result('Settings Escape returns to Pause Settings item',page.locator('.sh-pause__item',has_text='Settings').evaluate('(e)=>e===document.activeElement'),focus(page))
    page.keyboard.press('Escape');until(page,"() => window.__afterlife.game.dialog===null");page.wait_for_timeout(1200)
    result('Pause Escape restores game canvas focus',page.evaluate("document.activeElement?.id==='game-canvas'"),focus(page))
    # Independent positive control: explicitly focused canvas, instead of the F6 BODY route above.
    page.locator('#game-canvas').focus();page.keyboard.press('Escape');until(page,"() => window.__afterlife.game.dialog==='pause'")
    page.locator('.sh-pause__item').first.wait_for(state='visible');page.wait_for_timeout(250)
    page.keyboard.press('Escape');until(page,"() => window.__afterlife.game.dialog===null");page.wait_for_timeout(1200)
    result('explicit-canvas Pause control restores canvas focus',page.evaluate("document.activeElement?.id==='game-canvas'"),focus(page))
    # Controlled fixtures below test existing preferences/layout without pretending they are a keyboard journey.
    page.evaluate("window.__afterlife.game.updateSettings({reduceMotion:true,uiScale:1.4,colorblindNeeds:true});window.__afterlife.game.setSpeed(0)")
    page.wait_for_timeout(400)
    report['motionPreferenceOn']=page.evaluate("() => ({setting:window.__afterlife.game.settings.reduceMotion,classes:document.documentElement.className,animations:document.getAnimations().filter(a=>a.playState==='running').map(a=>({name:a.animationName,duration:a.effect?.getTiming().duration}))})")
    for name,w,h in [('scaled-1280',1280,720),('scaled-390',390,844)]:
     page.set_viewport_size(dict(width=w,height=h));scan(page,cdp,name)
    page.set_viewport_size(dict(width=1920,height=1080));page.evaluate("window.__afterlife.game.updateSettings({uiScale:1});window.__afterlife.game.openDialog('settings')")
    page.wait_for_timeout(200)
    report['expansionCount']=page.evaluate('''() => {const w=document.createTreeWalker(document.querySelector('.ui-modal'),NodeFilter.SHOW_TEXT);let n,count=0;while(n=w.nextNode()){if(n.textContent.trim().length>=3 && /[A-Za-z]/.test(n.textContent)){const s=n.textContent;n.textContent='['+s+' '+s.slice(0,Math.ceil(s.length*.5))+']';count++}}return count;}''')
    scan(page,cdp,'settings-expanded')
    page.evaluate("window.__afterlife.game.closeDialog();window.__afterlife.game.openDialog('settings');document.documentElement.dir='rtl'")
    scan(page,cdp,'settings-rtl')
    if a.zoom_check:
     page.evaluate("document.documentElement.dir='ltr'")
     scan(page,cdp,'zoom-before')
     print('ZOOM HANDOFF: apply Chrome native200percent, then create zoom-capture in this output directory',flush=True)
     (out/'zoom-ready').write_text('ready')
     end=time.monotonic()+120
     while not (out/'zoom-capture').exists() and time.monotonic()<end:page.wait_for_timeout(200)
     if not (out/'zoom-capture').exists():raise TimeoutError('native zoom handoff')
     scan(page,cdp,'zoom-200')
     report['zoomState']=page.evaluate('''() => ({dpr:devicePixelRatio,width:innerWidth,visualScale:visualViewport.scale,font:getComputedStyle(document.documentElement).fontSize,bodyFont:getComputedStyle(document.body).fontSize})''')
    report['health'].append(health(page));report['finished']=datetime.now(timezone.utc).isoformat();save()
   except Exception as e:
    report['blocker']=str(e);save();print(f'BLOCKED audit continuation: {e}',flush=True)
    try:
     report['blockedState']=page.evaluate("() => ({screen:window.__afterlife.game.screen,mode:window.__afterlife.game.mode,dialog:window.__afterlife.game.dialog,story:!!window.__afterlife.game.storyIntro,hint:window.__afterlife.game.hint?.id,focus:document.activeElement?.outerHTML.slice(0,700)})")
     (out/'blocked-ax.json').write_text(json.dumps(cdp.send('Accessibility.getFullAXTree'),indent=2),encoding='utf-8');save()
    except Exception as state_error:report['blockedStateError']=str(state_error);save()
    try:page.screenshot(path=str(out/'blocked.jpg'))
    except Exception as shot_error:report['screenshotError']=str(shot_error);save()
   finally:browser.close()
 finally:server.terminate();server.wait(timeout=15);save()
dist_after={str(p.relative_to(root/'dist')).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in (root/'dist').rglob('*') if p.is_file()}
expected=['age-gate','menu','settings','caz','caz-preset' if report.get('cazNameMode')=='unanswered-age-preset' else 'caz-invalid','hud','buy','store','scaled-1280','scaled-390','settings-expanded','settings-rtl']
if a.zoom_check:expected+=['zoom-before','zoom-200']
report['acceptance']=assess(report,dist_after,expected);save()
print(json.dumps(report['acceptance']),flush=True)
raise SystemExit(0 if report['acceptance']['productAcceptance']=='Worked' else 2 if report['acceptance']['productAcceptance']=='Blocked' else 1)
