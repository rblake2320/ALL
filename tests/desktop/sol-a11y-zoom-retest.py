"""Bounded native Chrome zoom acceptance: CUA applies the real browser zoom, this records DOM/rendered evidence."""
import argparse,hashlib,json,runpy,subprocess,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('--out',default='dev/out/sol-w064/zoom');ap.add_argument('--handoff-seconds',type=int,default=300);ap.add_argument('--probe-layout',action='store_true');args=ap.parse_args()
if not 30 <= args.handoff_seconds <= 1800:raise ValueError('handoff-seconds must be between30 and1800')
out=Path(args.out);out.mkdir(parents=True,exist_ok=False)
health_source=Path(__file__).with_name('sol-a11y-health.py').read_bytes();(out/'launched-health.py').write_bytes(health_source)
(out/'launched-harness.py').write_bytes(Path(__file__).read_bytes())
health_api=runpy.run_path(str(Path(__file__).with_name('sol-a11y-health.py')));assess_zoom=health_api['assess_zoom'];wait_preview=health_api['wait_preview']
def dist_hashes():return {p.relative_to(Path('dist')).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in Path('dist').rglob('*') if p.is_file()}
report=dict(pin=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),samples=[],errors=[],distHashes=dist_hashes(),harnessSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),healthEvaluatorSha256=hashlib.sha256(health_source).hexdigest(),handoffTimeoutSeconds=args.handoff_seconds)
def save():(out/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
def sample(page,label):
 row=page.evaluate('''() => {const h=document.querySelector('.ui-modal h2');return {dpr:devicePixelRatio,width:innerWidth,height:innerHeight,visualScale:visualViewport.scale,heading:h?{text:h.textContent,font:parseFloat(getComputedStyle(h).fontSize)}:null,rootFont:parseFloat(getComputedStyle(document.documentElement).fontSize),labels:Array.from(document.querySelectorAll('.ui-modal h2,.ui-modal h3,.ui-modal .ui-setting__label,.ui-modal button')).slice(0,20).map(e=>({text:e.textContent,font:parseFloat(getComputedStyle(e).fontSize),box:[e.getBoundingClientRect().width,e.getBoundingClientRect().height]}))};}''');row['label']=label;report['samples'].append(row);page.screenshot(path=str(out/f'{label}.jpg'),type='jpeg',quality=85);save()
 if args.probe_layout:
  row['layout']=page.evaluate('''() => {const p=document.querySelector('.ui-modal'),b=p.querySelector('.ui-modal__body'),r=p.getBoundingClientRect();return {viewport:[innerWidth,innerHeight],modalRect:[r.x,r.y,r.width,r.height],modalWidth:p.clientWidth,modalScrollWidth:p.scrollWidth,bodyWidth:b?.clientWidth,bodyScrollWidth:b?.scrollWidth};}''')
  page.locator('.ui-modal h2').click();row['focusProbe']=[]
  for _ in range(24):
   page.keyboard.press('Tab');page.wait_for_timeout(40)
   row['focusProbe'].append(page.evaluate('''() => {const e=document.activeElement,r=e.getBoundingClientRect(),scroll=[];for(let p=e;p;p=p.parentElement)if(p.scrollLeft)scroll.push({class:p.className,left:p.scrollLeft});return {tag:e.tagName,name:e.getAttribute('aria-label')||(e.textContent||'').trim().slice(0,60),inModal:!!e.closest('.ui-modal'),rect:[r.x,r.y,r.width,r.height],withinViewport:r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,scrollX,scrolledAncestors:scroll};}'''))
  save()
amd=next(x for x in runpy.run_path('tests/desktop/sol-dxgi.py')['adapters']() if x['vendor']==4098)
with (out/'preview.log').open('w') as log:
 s=subprocess.Popen(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','43943','--strictPort'],stdout=log,stderr=log)
 try:
  report['servedCodeHashes']=wait_preview(s,'http://127.0.0.1:43943/',out/'preview.log',report['distHashes']);save()
  with sync_playwright() as p:
   b=p.chromium.launch(channel='chrome',headless=False,args=['--use-angle=d3d11',f"--use-adapter-luid={amd['luid']}"])
   try:
    page=b.new_page(viewport=dict(width=1280,height=1024),device_scale_factor=1)
    page.on('pageerror',lambda e:report['errors'].append(str(e)))
    page.on('console',lambda m:report['errors'].append(m.text) if m.type=='error' else None)
    page.goto('http://127.0.0.1:43943',wait_until='networkidle')
    page.get_by_role('button',name='Not now',exact=True).click();page.evaluate("window.__afterlife.game.updateSettings({reduceMotion:true});window.__afterlife.game.openDialog('settings');document.title='Sol W064 Native Zoom Verification'")
    until=time.monotonic()+15
    while not page.locator('.ui-modal h2').count() and time.monotonic()<until:page.wait_for_timeout(100)
    assert page.locator('.ui-modal h2').count(),'settings fixture did not render'
    sample(page,'100')
    for label in ['200','400']:
     (out/f'ready{label}').write_text('ready');print(f'READY native{label}percent; create go{label} after CUA confirms zoom',flush=True)
     end=time.monotonic()+args.handoff_seconds
     while not(out/f'go{label}').exists() and time.monotonic()<end:page.wait_for_timeout(200)
     if not(out/f'go{label}').exists():raise TimeoutError('native zoom handoff')
     sample(page,label)
    report['rootVisualScale']=[dict(label=x['label'],scale=x['rootFont']*x['dpr']/(report['samples'][0]['rootFont']*report['samples'][0]['dpr'])) for x in report['samples']]
    report['finished']=True;report['acceptance']=assess_zoom(report,dist_hashes())
    if args.probe_layout:report['layoutAcceptance']=[dict(label=x['label'],focusOutside=sum(not f['inModal'] or not f['withinViewport'] for f in x['focusProbe']),horizontalFocusScroll=any(f['scrollX'] or f['scrolledAncestors'] for f in x['focusProbe']),geometry=x['layout']) for x in report['samples']]
    save()
   finally:b.close()
 except Exception as e:report['blocker']=str(e);report['acceptance']=assess_zoom(report,dist_hashes());save()
 finally:s.terminate();s.wait(timeout=15)
raise SystemExit(2 if report['acceptance']['headingMagnification']=='Blocked' else 1 if report['acceptance']['headingMagnification']=='Failed' or any(x['focusOutside'] or x['horizontalFocusScroll'] for x in report.get('layoutAcceptance',[])) else 0)
