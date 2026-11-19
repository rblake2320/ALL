"""Real S11 DOM/component acceptance with test-only controller ports, never a world traversal claim.
Own loopback Vite + temporary Chrome profile; never opens Electron/shared player saves.
Run from this worktree: python tests/desktop/sol-world-components.py --out dev/out/sol-world-s11/components1
"""
import argparse, hashlib, json, runpy, subprocess, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ap=argparse.ArgumentParser();ap.add_argument('--out',required=True);ap.add_argument('--port',type=int,default=43961);ap.add_argument('--bundle',help='Probe the production-built fixture directory instead of dev modules');a=ap.parse_args()
out=Path(a.out);out.mkdir(parents=True,exist_ok=False)
root=Path.cwd();here=Path(__file__).parent
paths=[p.resolve().relative_to(root) for p in [*Path('src/ui/world').glob('*'),*Path('tests/desktop/fixtures').glob('sol-world-ui.*'),Path(__file__),here/'sol-dxgi.py',here/'sol-world-build.mjs']]
def source_hashes():return {p.as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
r=dict(pin=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),scope='Real components, common Modal and theme; controller callbacks are test ports. No game/world integration claim.',sources=source_hashes(),served={},cases=[],errors=[])
def bundle_hashes():return {p.relative_to(Path(a.bundle)).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(a.bundle).rglob('*') if p.is_file()} if a.bundle else None
r['bundleHashes']=bundle_hashes()
for p in paths:
    dst=out/'sources'/p;dst.parent.mkdir(parents=True,exist_ok=True);dst.write_bytes(p.read_bytes())
def save():(out/'report.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
def case(name,fn):
    try:
        details=fn();r['cases'].append(dict(name=name,status='Worked',details=details))
    except Exception as e:
        r['cases'].append(dict(name=name,status='Failed',error=str(e)))
        if 'page' in globals():page.screenshot(path=str(out/'failure.png'))
        save();raise
    save()
def fixture(page,expr):return page.evaluate('(f)=>{const q=window.solWorldFixture;return ('+expr+')(q)}')
def open_map(page):page.get_by_role('button',name='World map',exact=True).click();expect(page.get_by_role('dialog',name='World map')).to_be_visible()
def reset(page,url):page.goto(url,wait_until='networkidle');page.wait_for_function('window.solWorldFixture?.receipt.ready')
def layout(page,selector):
    return page.locator(selector).evaluate("""root=>{const rr=root.getBoundingClientRect();return {rect:[rr.x,rr.y,rr.width,rr.height],overflow:root.scrollWidth-root.clientWidth,buttons:[...root.querySelectorAll('button')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return {label:e.getAttribute('aria-label')||e.textContent,rect:[b.x,b.y,b.width,b.height],font:parseFloat(s.fontSize),foreground:s.color,background:s.backgroundColor}}),statuses:[...root.querySelectorAll('.world-place__status')].map(e=>({foreground:getComputedStyle(e).color,background:getComputedStyle(e.closest('.world-place')).backgroundColor}))}}""")
def contrast(fg,bg):
    import re
    def luminance(c):
        values=[float(n)/255 for n in re.findall(r'[\d.]+',c)[:3]]
        return sum(w*(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4) for w,v in zip([.2126,.7152,.0722],values))
    a,b=sorted([luminance(fg),luminance(bg)]);return (b+.05)/(a+.05)
def sizes(data):
    assert data['overflow']<=1,data
    assert all(b['rect'][2]>=43.9 and b['rect'][3]>=43.9 for b in data['buttons']),data
    for b in [*data['buttons'],*data['statuses']]:
        # The common Close icon has a transparent background; its colour is theme-owned.
        if b['background'].startswith('rgb('):
            b['contrast']=contrast(b['foreground'],b['background']);assert b['contrast']>=4.5,b

amd=next(x for x in runpy.run_path(str(here/'sol-dxgi.py'))['adapters']() if x['vendor']==4098)
with (out/'preview.log').open('w',encoding='utf-8') as log:
    command=['node','node_modules/vite/bin/vite.js']+(['preview','--outDir',a.bundle] if a.bundle else [])+['--host','127.0.0.1','--port',str(a.port),'--strictPort']
    server=subprocess.Popen(command,stdout=log,stderr=log)
    try:
        url=f'http://127.0.0.1:{a.port}/tests/desktop/fixtures/sol-world-ui.html'
        for _ in range(100):
            if server.poll() is not None:raise RuntimeError('Owned preview exited: '+(out/'preview.log').read_text())
            try:
                with urllib.request.urlopen(url,timeout=1) as resp:
                    if resp.status==200:break
            except Exception:time.sleep(.1)
        else:raise RuntimeError('Owned preview timeout')
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='chrome',headless=True,args=['--use-angle=d3d11',f"--use-adapter-luid={amd['luid']}"])
            r['browserVersion']=browser.version
            try:
                for name,w,h,touch in [('desktop',1280,720,False),('portrait',390,844,True),('landscape',844,390,True),('narrow',320,720,True)]:
                    context=browser.new_context(viewport=dict(width=w,height=h),device_scale_factor=1,is_mobile=touch,has_touch=touch,reduced_motion='reduce')
                    try:
                        page=context.new_page();page.on('pageerror',lambda e:r['errors'].append(str(e)));page.on('console',lambda m:r['errors'].append(m.text) if m.type=='error' else None)
                        def response(resp):
                            if resp.status==200 and ('/src/ui/' in resp.url or '/fixtures/sol-world-ui' in resp.url or '/assets/' in resp.url):
                                try:r['served'][resp.url.split(str(a.port))[-1]]=hashlib.sha256(resp.body()).hexdigest()
                                except Exception as e:r['errors'].append('response capture: '+str(e))
                        page.on('response',response)
                        reset(page,url)
                        def controls():
                            data=layout(page,'.world-navigation');sizes(data)
                            assert all(b['font']>=14 for b in data['buttons']),data
                            expect(page.get_by_role('navigation',name='World navigation')).to_be_visible()
                            page.get_by_role('button',name='Recentre',exact=True).click()
                            expect(page.locator('[data-world-actor="a"]')).to_be_focused()
                            expect(page.get_by_role('status')).to_contain_text('Camera centred on Frank.')
                            assert fixture(page,'q=>q.receipt.camera')==1
                            assert fixture(page,'q=>q.receipt.centredActor')=='a', 'Recentre framed the previously followed actor instead of the selected actor'
                            page.screenshot(path=str(out/f'{name}-controls.png'))
                            return data
                        case(name+' named controls, targets and recentre',controls)
                        def pins():
                            if touch:page.get_by_role('button',name='World map',exact=True).tap()
                            else:page.get_by_role('button',name='World map',exact=True).focus();page.keyboard.press('Enter')
                            dialog=page.get_by_role('dialog',name='World map');expect(dialog).to_be_visible()
                            data=layout(page,'.world-signs-dialog');sizes(data)
                            assert data['rect'][0]>=0 and data['rect'][0]+data['rect'][2]<=w+1,data
                            for label in ['Open','Closed — invitation required','Locked — earn access','Under construction']:expect(dialog.locator('.world-place__status').filter(has_text=label)).to_be_visible()
                            assert page.locator('.world-place--unfinished').evaluate("e=>getComputedStyle(e).borderStyle")=='dashed'
                            for label,text in [('Neighbour’s home','private home'),('Mausoleum Hills','closed or locked'),('Swampside Bayou','not open in this version'),('Old Graveyard','Walking to Old Graveyard.')]:
                                btn=dialog.get_by_role('button',name='Walk to '+label,exact=True)
                                if touch:btn.tap()
                                else:btn.focus();page.keyboard.press('Enter')
                                expect(dialog.get_by_role('status')).to_contain_text(text)
                            assert fixture(page,'q=>q.receipt.calls').__len__()==4
                            assert all(c['actorId']=='a' for c in fixture(page,'q=>q.receipt.calls'))
                            page.screenshot(path=str(out/f'{name}-places.png'))
                            page.keyboard.press('Escape');expect(dialog).to_have_count(0)
                            expect(page.get_by_role('button',name='World map',exact=True)).to_be_focused()
                            return data
                        case(name+' map keyboard/touch, pin labels, refusals and route dispatch',pins)
                        def signs_case():
                            page.get_by_role('button',name='Signs nearby',exact=True).click()
                            dialog=page.get_by_role('dialog',name='Signs nearby');expect(dialog).to_be_visible()
                            expect(dialog.locator('[data-world-sign]').first).to_have_attribute('data-world-sign','near')
                            expect(dialog).to_contain_text('<img src=x onerror=alert(1)>')
                            assert dialog.locator('img').count()==0
                            data=layout(page,'.world-signs-dialog');sizes(data)
                            footer=dialog.locator('footer button');footer.focus();page.keyboard.press('Tab')
                            expect(dialog.locator('.ui-modal__close')).to_be_focused()
                            page.keyboard.press('Shift+Tab');expect(footer).to_be_focused()
                            fixture(page,'q=>q.token()');expect(footer).to_be_focused()
                            page.screenshot(path=str(out/f'{name}-signs.png'))
                            page.keyboard.press('Escape');expect(dialog).to_have_count(0)
                            expect(page.get_by_role('button',name='Signs nearby',exact=True)).to_be_focused()
                            return data
                        case(name+' readable signs, escaped content, focus trap and restore',signs_case)
                        def failure_focus():
                            fixture(page,"q=>q.receipt.cameraMode='false'")
                            page.get_by_role('button',name='Recentre',exact=True).click();expect(page.get_by_role('status')).to_contain_text('cannot be centred')
                            fixture(page,"q=>q.receipt.cameraMode='throw'")
                            page.get_by_role('button',name='Recentre',exact=True).click();expect(page.get_by_role('status')).to_contain_text('cannot be centred')
                            assert fixture(page,'q=>q.receipt.errors')==['camera']
                            editor=page.get_by_role('textbox',name='Rename zombie');editor.focus();fixture(page,'q=>q.token()');expect(editor).to_be_focused()
                            page.get_by_role('button',name='World map',exact=True).focus();fixture(page,'q=>q.token()');expect(page.locator('[data-world-actor="a"]')).to_be_focused()
                            fixture(page,'q=>q.select(null)');expect(page.get_by_role('button',name='Recentre',exact=True)).to_be_disabled()
                            open_map(page);expect(page.get_by_role('button',name='Walk to Old Graveyard',exact=True)).to_be_disabled()
                            expect(page.get_by_role('dialog')).to_contain_text('Select a zombie to explore.')
                        case(name+' camera failure, editor focus and missing actor',failure_focus)
                    finally:context.close()
                context=browser.new_context(viewport=dict(width=1280,height=720));page=context.new_page()
                page.on('pageerror',lambda e:r['errors'].append(str(e)))
                page.on('console',lambda m:r['errors'].append(m.text) if m.type=='error' else None)
                try:
                    def race():
                        reset(page,url);fixture(page,"q=>q.receipt.mode='defer'");open_map(page)
                        # Deliver duplicate activation within the same task, before Preact paints disabled buttons.
                        page.get_by_role('button',name='Walk to Old Graveyard').evaluate('e=>{e.click();e.click()}')
                        expect(page.get_by_role('dialog').get_by_role('status')).to_contain_text('Finding a route')
                        assert len(fixture(page,'q=>q.receipt.calls'))==1
                        fixture(page,"q=>q.select('b')");expect(page.get_by_role('button',name='Walk to Old Graveyard')).to_be_enabled()
                        fixture(page,'q=>q.resolve()');expect(page.get_by_role('dialog').get_by_role('status')).to_have_text('')
                        fixture(page,"q=>q.receipt.mode='normal'")
                        page.get_by_role('button',name='Walk to Old Graveyard').click();expect(page.get_by_role('dialog').get_by_role('status')).to_contain_text('Walking to Old Graveyard.')
                        assert fixture(page,'q=>q.receipt.calls')[-1]['actorId']=='b'
                        fixture(page,"q=>q.receipt.mode='defer'");page.get_by_role('button',name='Walk to Old Graveyard').click()
                        fixture(page,'q=>q.unmount()');expect(page.get_by_text('Fixture unmounted')).to_be_visible();fixture(page,'q=>q.resolve()')
                        return fixture(page,'q=>q.receipt.calls')
                    case('same-frame duplicate, actor switch, stale reply and unmount',race)
                    def malformed():
                        reset(page,url);fixture(page,"q=>q.receipt.mode='throw'");open_map(page)
                        page.get_by_role('button',name='Walk to Old Graveyard').click();expect(page.get_by_role('dialog').get_by_role('status')).to_contain_text('Walking is unavailable')
                        assert fixture(page,'q=>q.receipt.errors')==['route']
                        fixture(page,'q=>q.malformed()');expect(page.get_by_role('alert')).to_contain_text('Some world information is unavailable.')
                        expect(page.get_by_role('button',name='Walk to Old Graveyard')).to_have_count(0)
                        return fixture(page,'q=>q.receipt.errors')
                    case('controller throw and ambiguous pin errors are visible',malformed)
                finally:context.close()
            finally:browser.close()
        r['sourcesAfter']=source_hashes();assert r['sourcesAfter']==r['sources'],'Sources changed during probe'
        r['bundleHashesAfter']=bundle_hashes();assert r['bundleHashes']==r['bundleHashesAfter'],'Bundle changed during probe'
        if a.bundle:
            assert r['served'],'No served artifact identity captured'
            for path,digest in r['served'].items():assert r['bundleHashes'].get(path.lstrip('/'))==digest,('Served artifact mismatch',path)
        assert not r['errors'],r['errors'];r['status']='Worked'
    except Exception as e:r['status']='Failed';r['error']=str(e)
    finally:
        server.terminate();server.wait(timeout=15);save()
print(json.dumps(dict(status=r['status'],worked=sum(c['status']=='Worked' for c in r['cases']),cases=len(r['cases']),errors=r['errors'],error=r.get('error'))))
raise SystemExit(0 if r['status']=='Worked' else 1)
