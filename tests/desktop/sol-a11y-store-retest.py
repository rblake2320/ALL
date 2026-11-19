"""Controlled Store layout/focus fixture: no age answer, purchase or unlock is submitted."""
import argparse,hashlib,json,runpy,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('--out',required=True);a=ap.parse_args()
out=Path(a.out);out.mkdir(parents=True,exist_ok=False)
source=Path(__file__).read_bytes();(out/'launched-harness.py').write_bytes(source)
health=Path(__file__).with_name('sol-a11y-health.py');(out/'launched-health.py').write_bytes(health.read_bytes());api=runpy.run_path(str(health))
def hashes():return {p.relative_to(Path('dist')).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in Path('dist').rglob('*') if p.is_file()}
r=dict(pin=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),harnessSha256=hashlib.sha256(source).hexdigest(),healthEvaluatorSha256=hashlib.sha256(health.read_bytes()).hexdigest(),distHashes=hashes(),states=[],errors=[],fixture='Unknown-age Store opened through game dialog API; no age answer or purchases')
def save():(out/'report.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
axe=Path('dev/out/sol-a11y-tools/node_modules/axe-core/axe.min.js').read_text(encoding='utf-8')
amd=next(x for x in runpy.run_path(str(Path(__file__).with_name('sol-dxgi.py')))['adapters']() if x['vendor']==4098)
with (out/'preview.log').open('w',encoding='utf-8') as log:
 server=subprocess.Popen(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','43945','--strictPort'],stdout=log,stderr=log)
 try:
  r['servedCodeHashes']=api['wait_preview'](server,'http://127.0.0.1:43945/',out/'preview.log',r['distHashes'])
  with sync_playwright() as p:
   b=p.chromium.launch(channel='chrome',headless=False,args=['--use-angle=d3d11',f"--use-adapter-luid={amd['luid']}"])
   try:
    page=b.new_page(viewport=dict(width=1920,height=1080),device_scale_factor=1,reduced_motion='reduce')
    page.on('pageerror',lambda e:r['errors'].append(str(e)));page.on('console',lambda m:r['errors'].append(m.text) if m.type=='error' else None)
    page.goto('http://127.0.0.1:43945/',wait_until='networkidle');page.get_by_role('button',name='Not now',exact=True).click()
    page.evaluate("window.__afterlife.game.updateSettings({quality:'low',reduceMotion:true,uiScale:1.4});window.__afterlife.game.openDialog('store');document.title='Sol W064 Store Layout'")
    page.locator('.st-dialog').wait_for(state='visible');cdp=page.context.new_cdp_session(page);cdp.send('Accessibility.enable')
    r['renderer']=page.evaluate("() => {const g=document.querySelector('#game-canvas').getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e.UNMASKED_RENDERER_WEBGL)}")
    assert 'AMD Radeon' in r['renderer']
    for name,w,h in [('wide',1920,1080),('390',390,844),('320',320,568)]:
     page.set_viewport_size(dict(width=w,height=h));page.wait_for_timeout(500)
     geometry=page.evaluate('''() => {const p=document.querySelector('.st-dialog'),b=p.querySelector('.ui-modal__body'),r=p.getBoundingClientRect();const text=[...p.querySelectorAll('.st-card__title,.st-card__desc,.st-age__label,.st-age__input,.st-card button')].map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,text:(e.textContent||'').slice(0,70),font:parseFloat(getComputedStyle(e).fontSize),x:r.x,y:r.y,width:r.width,height:r.height}});return {viewport:[innerWidth,innerHeight],rootFont:getComputedStyle(document.documentElement).fontSize,panel:{x:r.x,y:r.y,width:r.width,height:r.height},body:b?{width:b.clientWidth,scrollWidth:b.scrollWidth,height:b.clientHeight,scrollHeight:b.scrollHeight}:null,text};}''')
     page.evaluate(axe);finding=page.evaluate("async () => await axe.run(document.querySelector('.st-dialog'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}})")
     (out/f'{name}-axe.json').write_text(json.dumps(finding,indent=2),encoding='utf-8');(out/f'{name}-ax.json').write_text(json.dumps(cdp.send('Accessibility.getFullAXTree'),indent=2),encoding='utf-8')
     page.screenshot(path=str(out/f'{name}.png'));focus=[]
     for _ in range(24):
      page.keyboard.press('Tab');page.wait_for_timeout(35)
      focus.append(page.evaluate('''() => {const e=document.activeElement,r=e.getBoundingClientRect();return {tag:e.tagName,id:e.id,name:e.getAttribute('aria-label')||(e.textContent||'').slice(0,70),inStore:!!e.closest('.st-dialog'),rect:[r.x,r.y,r.width,r.height],withinViewport:r.x>=-1&&r.y>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1}}'''))
     row=dict(name=name,geometry=geometry,focus=focus,violations=[dict(id=v['id'],nodes=len(v['nodes'])) for v in finding['violations']]);r['states'].append(row);save()
     print(json.dumps({'state':name,'root':geometry['rootFont'],'violations':row['violations'],'focusOutside':sum(not f['inStore'] or not f['withinViewport'] for f in focus),'body':geometry['body']}),flush=True)
    r['finished']=True
   finally:b.close()
 except Exception as e:r['blocker']=str(e);save();raise
 finally:server.terminate();server.wait(timeout=15)
r['distStable']=hashes()==r['distHashes']
r['acceptance']=dict(measurementStatus='Worked' if r.get('finished') and len(r['states'])==3 and not r['errors'] and r['distStable'] else 'Blocked',states=[dict(name=s['name'],axeViolations=s['violations'],focusContained=all(f['inStore'] and f['withinViewport'] for f in s['focus']),bodyHorizontalOverflow=s['geometry']['body']['scrollWidth']>s['geometry']['body']['width']+1 if s['geometry']['body'] else None) for s in r['states']])
save();print(json.dumps(r['acceptance']),flush=True)
raise SystemExit(2 if r['acceptance']['measurementStatus']=='Blocked' else 1 if any(s['axeViolations'] or not s['focusContained'] or s['bodyHorizontalOverflow'] for s in r['acceptance']['states']) else 0)
