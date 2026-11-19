"""Native Chrome zoom/focus acceptance of the production S11 fixture. CUA supplies native zoom only.
Own browser/window/profile and preview; no Electron/shared save or owner browser.
"""
import argparse,hashlib,json,runpy,subprocess,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ap=argparse.ArgumentParser();ap.add_argument('--out',required=True);ap.add_argument('--port',type=int,default=43961);a=ap.parse_args()
out=Path(a.out);out.mkdir(exist_ok=False,parents=True)
bundle=Path('dev/out/sol-world-s11/components-dist')
def hashes():return {p.relative_to(bundle).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in bundle.rglob('*') if p.is_file()}
paths=[Path(__file__).resolve().relative_to(Path.cwd()),Path('tests/desktop/fixtures/sol-world-ui.tsx'),*Path('src/ui/world').glob('*')]
r=dict(pin=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),scope='Production components with test-only controller ports; actual native Chrome zoom, not game/world integration.',bundle=hashes(),sources={p.as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},samples=[],errors=[],served={})
for p in paths:
    dst=out/'sources'/p;dst.parent.mkdir(parents=True,exist_ok=True);dst.write_bytes(p.read_bytes())
def save():(out/'report.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
def probe(page,label):
    sample=page.evaluate("""()=>({label:'',dpr:devicePixelRatio,viewport:[innerWidth,innerHeight],outer:[outerWidth,outerHeight],visualScale:visualViewport.scale,rootFont:parseFloat(getComputedStyle(document.documentElement).fontSize),controlFont:parseFloat(getComputedStyle(document.querySelector('.world-control')).fontSize)})""")
    sample['label']=label;sample['focus']=[];r['samples'].append(sample);save()
    if label!='100':assert abs(sample['dpr']/r['samples'][0]['dpr']-int(label)/100)<.06,('Native zoom not applied',sample)
    for name in ['Selected zombie: Frank','Recentre','World map','Signs nearby']:
        button=page.get_by_role('button',name=name,exact=True);button.focus()
        entry=page.evaluate("""()=>{const e=document.activeElement,b=e.getBoundingClientRect();return {name:e.getAttribute('aria-label')||e.textContent,rect:[b.x,b.y,b.width,b.height],within:b.left>=-1&&b.top>=-1&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1}}""")
        sample['focus'].append(entry);assert entry['within'],entry
    page.get_by_role('button',name='World map',exact=True).focus();page.keyboard.press('Enter');dialog=page.get_by_role('dialog',name='World map');expect(dialog).to_be_visible()
    # Start at header Close, then native Tab through all four route controls and back.
    dialog.locator('.ui-modal__close').focus()
    for _ in range(6):
        entry=page.evaluate("""()=>{const e=document.activeElement,b=e.getBoundingClientRect(),d=e.closest('[role=dialog]'),body=d?.querySelector('.ui-modal__body'),v=body?.getBoundingClientRect();return {name:e.getAttribute('aria-label')||e.textContent,rect:[b.x,b.y,b.width,b.height],inModal:!!d,within:b.left>=-1&&b.top>=-1&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1,withinScroll:!body?.contains(e)||(b.top>=v.top-1&&b.bottom<=v.bottom+1),scroll:body?.scrollTop}}""")
        sample['focus'].append(entry);save();assert entry['within'] and entry['inModal'] and entry['withinScroll'],entry
        page.keyboard.press('Tab')
    assert len({f['name'] for f in sample['focus'] if f.get('inModal')})==5,sample
    sample['headingFont']=dialog.locator('h2').evaluate('e=>parseFloat(getComputedStyle(e).fontSize)')
    sample['modal']=dialog.evaluate('e=>({client:e.clientWidth,scroll:e.scrollWidth})');assert sample['modal']['scroll']<=sample['modal']['client']+1
    page.screenshot(path=str(out/(label+'-map.png')))
    page.keyboard.press('Escape');expect(page.get_by_role('button',name='World map',exact=True)).to_be_focused()
    page.get_by_role('button',name='Signs nearby',exact=True).focus();page.keyboard.press('Enter');dialog=page.get_by_role('dialog',name='Signs nearby');expect(dialog).to_be_visible()
    dialog.locator('footer button').focus();page.keyboard.press('Tab');expect(dialog.locator('.ui-modal__close')).to_be_focused()
    page.keyboard.press('Shift+Tab');expect(dialog.locator('footer button')).to_be_focused()
    page.keyboard.press('Escape');expect(page.get_by_role('button',name='Signs nearby',exact=True)).to_be_focused();save()
amd=next(x for x in runpy.run_path('tests/desktop/sol-dxgi.py')['adapters']() if x['vendor']==4098)
with (out/'preview.log').open('w',encoding='utf-8') as log:
    server=subprocess.Popen(['node','node_modules/vite/bin/vite.js','preview','--outDir',str(bundle),'--host','127.0.0.1','--port',str(a.port),'--strictPort'],stdout=log,stderr=log)
    try:
        url=f'http://127.0.0.1:{a.port}/tests/desktop/fixtures/sol-world-ui.html'
        for _ in range(100):
            if server.poll() is not None:raise RuntimeError('Owned preview exited')
            try:
                with urllib.request.urlopen(url,timeout=1) as response:
                    if response.status==200:break
            except Exception:time.sleep(.1)
        else:raise RuntimeError('Owned preview timeout')
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='chrome',headless=False,args=['--window-size=1280,1024','--use-angle=d3d11',f"--use-adapter-luid={amd['luid']}"])
            try:
                context=browser.new_context(no_viewport=True,reduced_motion='reduce');page=context.new_page()
                page.on('pageerror',lambda e:r['errors'].append(str(e)))
                page.on('console',lambda m:r['errors'].append(m.text) if m.type=='error' else None)
                def response(resp):
                    if resp.status==200 and ('/assets/' in resp.url or '/fixtures/sol-world-ui.html' in resp.url):r['served'][resp.url.split(str(a.port))[-1]]=hashlib.sha256(resp.body()).hexdigest()
                page.on('response',response)
                page.goto(url,wait_until='networkidle');page.wait_for_function('window.solWorldFixture?.receipt.ready');page.evaluate("document.title='Sol S11 Native Zoom'")
                r['browserVersion']=browser.version;probe(page,'100')
                for label in ['200','400']:
                    (out/('ready'+label)).write_text('ready');print('READY native '+label+' percent',flush=True)
                    deadline=time.monotonic()+240
                    while not (out/('go'+label)).exists() and time.monotonic()<deadline:page.wait_for_timeout(150)
                    if not (out/('go'+label)).exists():raise TimeoutError('Native zoom handoff '+label)
                    probe(page,label)
                for s in r['samples']:
                    s['physicalControlRatio']=s['controlFont']*s['dpr']/(r['samples'][0]['controlFont']*r['samples'][0]['dpr'])
                    s['physicalHeadingRatio']=s['headingFont']*s['dpr']/(r['samples'][0]['headingFont']*r['samples'][0]['dpr'])
                    for key in ['physicalControlRatio','physicalHeadingRatio']:assert s[key]>=int(s['label'])/100*.95,(key,s)
                assert not r['errors'],r['errors'];assert r['bundle']==hashes()
                assert r['sources']=={p.as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
                for path,sha in r['served'].items():assert r['bundle'][path.lstrip('/')]==sha,path
                r['status']='Worked'
            finally:browser.close()
    except Exception as e:
        r['status']='Failed' if r['samples'] else 'Blocked';r['error']=str(e)
    finally:server.terminate();server.wait(timeout=15);save()
print(json.dumps(dict(status=r['status'],samples=len(r['samples']),error=r.get('error'))),flush=True)
raise SystemExit(0 if r['status']=='Worked' else 1 if r['status']=='Failed' else 2)
