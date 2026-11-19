"""Rendered-background contrast samples where axe cannot resolve the 3D canvas backdrop.
Trusted diagnostic fixture hides HTML text without changing layout, then samples the revealed background.
Each result is a bounded rendered-scene measurement, not a full WCAG conformance verdict.
"""
import argparse,hashlib,io,json,math,re,runpy,subprocess,time,urllib.request
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('--out',default='dev/out/sol-w064/contrast');args=ap.parse_args()
out=Path(args.out);out.mkdir(parents=True,exist_ok=False)
(out/'launched-harness.py').write_bytes(Path(__file__).read_bytes())
health_path=Path(__file__).with_name('sol-a11y-health.py');(out/'launched-health.py').write_bytes(health_path.read_bytes())
wait_preview=runpy.run_path(str(health_path))['wait_preview']
def dist_hashes():return {p.relative_to(Path('dist')).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in Path('dist').rglob('*') if p.is_file()}
result=dict(pin=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),scenes=[],errors=[],distHashes=dist_hashes(),harnessSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),healthEvaluatorSha256=hashlib.sha256(health_path.read_bytes()).hexdigest())
def luminance(rgb):
    v=[x/255 for x in rgb];v=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in v]
    return .2126*v[0]+.7152*v[1]+.0722*v[2]
def ratio(a,b):
    x,y=sorted([luminance(a),luminance(b)]);return (y+.05)/(x+.05)
assert ratio([0,0,0],[255,255,255])==21 and ratio([127]*3,[127]*3)==1
def sample(page,name):
    page.wait_for_timeout(300)
    texts=page.evaluate('''() => {const scope=[...document.querySelectorAll('.ui-modal')].at(-1)||document.querySelector('#ui-root');scope.setAttribute('data-sol-contrast-root','true');const w=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT);let n;const a=[];while(n=w.nextNode()){if(!n.textContent.trim())continue;const e=n.parentElement,s=getComputedStyle(e);if(e.closest('.u-sr-only,.ui-sr-only,script,style') || (e.closest('[aria-hidden="true"]') && !e.closest('.ui-badge--count')))continue;const range=document.createRange();range.selectNode(n);let rects=[...range.getClientRects()].filter(r=>r.width>1&&r.height>1&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight);rects=rects.map(r=>{let l=Math.max(0,r.left),t=Math.max(0,r.top),right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom);for(let p=e;p;p=p.parentElement){const cs=getComputedStyle(p),b=p.getBoundingClientRect();if(['hidden','clip','auto','scroll'].includes(cs.overflowX)){l=Math.max(l,b.left+p.clientLeft);right=Math.min(right,b.left+p.clientLeft+p.clientWidth)}if(['hidden','clip','auto','scroll'].includes(cs.overflowY)){t=Math.max(t,b.top+p.clientTop);bottom=Math.min(bottom,b.top+p.clientTop+p.clientHeight)}}return {x:l,y:t,width:right-l,height:bottom-t}}).filter(r=>r.width>1&&r.height>1);if(!rects.length||s.visibility==='hidden'||s.display==='none')continue;let opacity=1;for(let p=e;p;p=p.parentElement)opacity*=Number(getComputedStyle(p).opacity);if(opacity===0)continue;a.push({text:n.textContent.trim().slice(0,100),color:s.color,textShadow:s.textShadow,font:parseFloat(s.fontSize),weight:s.fontWeight,opacity,disabled:!!e.closest(':disabled,[aria-disabled="true"]'),className:e.className,rects:rects.map(r=>({x:r.x,y:r.y,w:r.width,h:r.height}))});}return a;}''')
    page.screenshot(path=str(out/f'{name}-visible.png'))
    style=page.add_style_tag(content='[data-sol-contrast-root], [data-sol-contrast-root] * {color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;}')
    try: image=Image.open(io.BytesIO(page.screenshot())).convert('RGB');image.save(out/f'{name}-background.png')
    finally:style.evaluate('(e)=>e.remove()');page.evaluate("document.querySelector('[data-sol-contrast-root]')?.removeAttribute('data-sol-contrast-root')")
    rows=[]
    for t in texts:
        c=[float(x) for x in re.findall(r'[\d.]+',t['color'])]
        if len(c)<3 or not t['color'].startswith(('rgb(', 'rgba(')): rows.append(dict(**t,status='Blocked unsupported color'));continue
        if len(c)>3 and c[3]==0:rows.append(dict(**t,status='Exempt logo gradient'));continue
        if not re.search(r'\w',t['text']):rows.append(dict(**t,status='Exempt decoration'));continue
        alpha=(c[3] if len(c)>3 else 1)*t['opacity'];values=[]
        for r in t['rects']:
            left=max(0,math.ceil(r['x']));right=min(image.width,math.floor(r['x']+r['w']));top=max(0,math.ceil(r['y']));bottom=min(image.height,math.floor(r['y']+r['h']))
            for y in range(top,bottom,3):
                for x in range(left,right,3):
                    bg=image.getpixel((x,y));fg=[alpha*c[i]+(1-alpha)*bg[i] for i in range(3)];values.append(ratio(fg,bg))
        if not values:continue
        minimum=min(values);threshold=3 if t['font']>=24 or (t['font']>=18.66 and int(t['weight'])>=700) else 4.5
        rows.append(dict(**t,minimum=minimum,maximum=max(values),threshold=threshold,status='Exempt disabled' if t['disabled'] else 'Worked' if minimum>=threshold else 'Review contrast'))
    result['scenes'].append(dict(name=name,texts=rows));(out/'report.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(name,len(rows),'sampled;',sum(r['status']=='Review contrast' for r in rows),'need review',flush=True)
amd=next(x for x in runpy.run_path('tests/desktop/sol-dxgi.py')['adapters']() if x['vendor']==4098)
with (out/'preview.log').open('w') as log:
 s=subprocess.Popen(['node','node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','43944','--strictPort'],stdout=log,stderr=log)
 try:
  result['servedCodeHashes']=wait_preview(s,'http://127.0.0.1:43944/',out/'preview.log',result['distHashes'])
  with sync_playwright() as p:
   b=p.chromium.launch(channel='chrome',headless=False,args=['--use-angle=d3d11',f"--use-adapter-luid={amd['luid']}"])
   try:
    page=b.new_page(viewport=dict(width=1920,height=1080),device_scale_factor=1,reduced_motion='reduce');page.on('pageerror',lambda e:result['errors'].append(str(e)));page.on('console',lambda m:result['errors'].append(m.text) if m.type=='error' else None);page.goto('http://127.0.0.1:43944',wait_until='networkidle');page.get_by_role('button',name='Not now',exact=True).click()
    page.evaluate("window.__afterlife.game.updateSettings({quality:'low',reduceMotion:true,tutorialEnabled:false})");sample(page,'menu')
    page.evaluate("window.__afterlife.game.openDialog('settings')");sample(page,'settings');page.evaluate("window.__afterlife.game.closeDialog()")
    page.locator('.sh-menu__item',has_text='New Game').click();page.get_by_role('button',name='Create your household',exact=True).click();sample(page,'caz')
    page.locator('.sh-editor__start').click();end=time.monotonic()+120
    while not page.evaluate("window.__afterlife.game.screen==='game' && window.__afterlife.game.renderer.loadProgress()>=1") and time.monotonic()<end:page.wait_for_timeout(200)
    page.evaluate("window.__afterlife.game.setSpeed(0)");sample(page,'hud');page.keyboard.press('g');sample(page,'store')
    labels=page.locator('.st-bundle__label')
    if labels.count():labels.last.evaluate('(e)=>e.scrollIntoView({block:"center"})')
    sample(page,'store-scrolled')
   finally:b.close()
 except Exception as e:result['blocker']=str(e);(out/'report.json').write_text(json.dumps(result,indent=2),encoding='utf-8');raise
 finally:s.terminate();s.wait(timeout=15)

result['finished']=True
result['distStable']=dist_hashes()==result['distHashes']
review=[dict(scene=s['name'],text=t['text'],minimum=t.get('minimum'),maximum=t.get('maximum'),threshold=t.get('threshold'),shadow=t.get('textShadow')) for s in result['scenes'] for t in s['texts'] if t['status']=='Review contrast']
blocked=[dict(scene=s['name'],text=t['text'],status=t['status']) for s in result['scenes'] for t in s['texts'] if t['status'].startswith('Blocked')]
result['acceptance']=dict(measurementStatus='Worked' if len(result['scenes'])==6 and not result['errors'] and result['distStable'] and not blocked else 'Blocked',contrastReview=review,blocked=blocked,scope='Rendered-background text-contrast sampling; review shadowed/borderline candidates before a conformance claim')
(out/'report.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result['acceptance']),flush=True)
raise SystemExit(2 if result['acceptance']['measurementStatus']=='Blocked' else 1 if review else 0)
