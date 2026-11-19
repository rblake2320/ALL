"""Hardware-gated, sequential real-browser scene measurements on a pinned production bundle.
Usage: python tests/desktop/sol-perf.py --runtime PATH --port UNUSED_PORT
Requires Python playwright and psutil; installed Chrome and Edge. No owner profiles used.
"""
import argparse, base64, gzip, hashlib, json, runpy, socket, subprocess, time, urllib.request
from pathlib import Path
from datetime import datetime, timezone
import psutil
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--runtime', required=True)
parser.add_argument('--port', type=int, required=True)
parser.add_argument('--out', default='evidence/sol-perf/'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
parser.add_argument('--scenes', default='all', help='all or comma-separated scenario names')
parser.add_argument('--trace-scenes', default='night,ultra')
parser.add_argument('--load-only', action='store_true', help='continuous cold-menu-to-playable test without frame-sampling delays')
args = parser.parse_args()
root = Path(args.runtime).resolve()
out = Path(args.out)
if out.exists() and any(out.iterdir()): raise FileExistsError(f'Refusing to overwrite prior evidence: {out.resolve()}')
out.mkdir(parents=True, exist_ok=True)
amd = next(a for a in runpy.run_path(str(Path(__file__).with_name('sol-dxgi.py')))['adapters']() if a['vendor'] == 4098)
pin = subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
report = dict(pin=pin, started=datetime.now(timezone.utc).isoformat(), adapter=amd, browsers=[],expectedScenes=[] if args.load_only else ['menu']+(['day','night','walls-up','cutaway','buy','three-zombies-3x','medium','high','ultra'] if args.scenes=='all' else args.scenes.split(',')))
source=Path(__file__).read_bytes()
(out/'launched-harness.py').write_bytes(source)
report['harnessSha256']=hashlib.sha256(source).hexdigest()
report['sourceDirty']=subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=root,text=True).strip()
if report['sourceDirty']: raise RuntimeError('Runtime source is dirty')
with (out/'build.log').open('w',encoding='utf-8') as buildlog:
    build=subprocess.run(['cmd.exe','/d','/c','npm run build'],cwd=root,stdout=buildlog,stderr=buildlog)
report['buildExit']=build.returncode
if build.returncode: raise RuntimeError(f'Build failed: {out / "build.log"}')
report['distHashes']={str(p.relative_to(root/'dist')).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in (root/'dist').rglob('*') if p.is_file()}
def save(): (out/'scene-results.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
def until(page, expression, timeout=180):
    end=time.time()+timeout
    while time.time()<end:
        if page.evaluate(expression): return
        page.wait_for_timeout(200)
    raise TimeoutError(expression)
def host():
    return dict(cpuPercent=psutil.cpu_percent(interval=0.2),availableMemory=psutil.virtual_memory().available,nvidia=subprocess.check_output(['nvidia-smi','--query-gpu=utilization.gpu,memory.used','--format=csv,noheader'],text=True).strip())
def state(page):
    return page.evaluate('''() => {const g=window.__afterlife.game,c=document.querySelector('#game-canvas'),gl=c.getContext('webgl2'); const e=gl.getExtension('WEBGL_debug_renderer_info');return {screen:g.screen,mode:g.mode,speed:g.speed,fatal:g.fatalError,settings:g.settings,stats:g.renderer.stats(),time:g.sim?.time(),members:g.sim?.state.household.memberIds.length,viewport:[innerWidth,innerHeight],buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],renderer:gl.getParameter(e.UNMASKED_RENDERER_WEBGL)};}''')
def validate_sample(before,after,health,name,expected):
    assert health,'no during-sample health records'
    assert all('AMD Radeon' in s['renderer'] and s['buffer']==expected and not s['fatal'] and not s['stats']['contextLost'] and s['stats']['fps']>0 for s in [before,after,*health]),'post/during-sample health failure'
    assert after['stats']['quality']==before['stats']['quality'] and after['mode']==before['mode'] and after['speed']==before['speed'],'scenario changed'
    if name!='menu':
        assert before['members']==after['members']==3 and before['screen']==after['screen']=='game','game workload changed'
        assert after['time']['tick']>before['time']['tick'],'simulation did not advance'

def completed(report):
    return len(report['browsers'])==2 and {b['channel'] for b in report['browsers']}=={'chrome','msedge'} and all(b.get('status')=='measured' and not b.get('errors') and not b.get('consoleErrors') and not b.get('requestFailures') and [s['name'] for s in b['scenes']]==report['expectedScenes'] for b in report['browsers'])
def measure(page, cdp, name, channel, trace=False):
    page.bring_to_front()
    page.wait_for_timeout(2500)
    before=state(page)
    assert 'AMD Radeon' in before['renderer'], before['renderer']
    expected=[2880,1620] if before['stats']['quality']=='ultra' else [1920,1080]
    assert before['viewport']==[1920,1080] and before['buffer']==expected, before
    assert not before['fatal'],before['fatal']
    row=dict(name=name,before=before,hostBefore=host())
    if trace:
        cdp.send('Tracing.start',{'categories':'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline','transferMode':'ReturnAsStream'})
    page.evaluate('''() => {const s=window.__solperf={frames:[],health:[],done:false};let start,last,next=0;function f(t){if(start===undefined){start=t;last=t;requestAnimationFrame(f);return;}s.frames.push(t-last);last=t;if(t>=next){const g=window.__afterlife.game,c=document.querySelector('#game-canvas'),gl=c.getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');s.health.push({fatal:g.fatalError,renderer:gl.getParameter(e.UNMASKED_RENDERER_WEBGL),buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],stats:g.renderer.stats(),tick:g.sim?.state.tick});next=t+500;}if(t-start>=15000)s.done=true;else requestAnimationFrame(f);}requestAnimationFrame(f);}''')
    row['memorySeries']=[]
    browser_cdp=page.context.browser.new_browser_cdp_session()
    end=time.monotonic()+60
    while not page.evaluate('window.__solperf.done'):
        if time.monotonic()>end: raise TimeoutError('frame sampler did not finish')
        processes=browser_cdp.send('SystemInfo.getProcessInfo')['processInfo']
        row['memorySeries'].append(dict(at=time.monotonic(),rss=sum(psutil.Process(p['id']).memory_info().rss for p in processes)))
        page.wait_for_timeout(500)
    browser_cdp.detach()
    sample=page.evaluate('window.__solperf')
    frames=sample['frames']
    row['healthSamples']=sample['health']
    row['instrumented']=trace
    if trace:
        done=[]
        cdp.on('Tracing.tracingComplete',lambda e: done.append(e))
        cdp.send('Tracing.end')
        deadline=time.time()+30
        while not done and time.time()<deadline: page.wait_for_timeout(100)
        if not done: raise RuntimeError('trace did not finish')
        stream=done[0]['stream']
        with gzip.open(out/f'{channel}-{name}.trace.json.gz','wb') as f:
            while True:
                chunk=cdp.send('IO.read',{'handle':stream})
                f.write(base64.b64decode(chunk['data']) if chunk.get('base64Encoded') else chunk['data'].encode())
                if chunk.get('eof'): break
        cdp.send('IO.close',{'handle':stream})
    ordered=sorted(frames)
    row.update(fps=1000*len(frames)/sum(frames),p95ms=ordered[int((len(ordered)-1)*.95)],p99ms=ordered[int((len(ordered)-1)*.99)],maxms=max(frames),frameIntervalsMs=frames,after=state(page),hostAfter=host())
    after=row['after']
    validate_sample(before,after,row['healthSamples'],name,expected)
    row['valid']=True
    row['lowTargetMet']=row['fps']>=30 and max(m['rss'] for m in row['memorySeries'])<1_500_000_000 if before['stats']['quality']=='low' else None
    procs=cdp.send('Performance.getMetrics')['metrics']
    row['performanceMetrics']=procs
    bs=page.context.browser.new_browser_cdp_session()
    ids=bs.send('SystemInfo.getProcessInfo')['processInfo']
    row['browserProcessMemory']=[]
    for proc in ids:
        try:
            mem=psutil.Process(proc['id']).memory_info()
            row['browserProcessMemory'].append(dict(pid=proc['id'],type=proc['type'],rss=mem.rss))
        except psutil.NoSuchProcess: row['browserProcessMemory'].append(dict(pid=proc['id'],exited=True))
    bs.detach()
    page.screenshot(path=str(out/f'{channel}-{name}.jpg'),type='jpeg',quality=75)
    print(f"{channel} {name}: {row['fps']:.1f} fps p95={row['p95ms']:.1f}ms",flush=True)
    return row

with (out/'preview.log').open('w',encoding='utf-8') as log:
    server=subprocess.Popen(['node',str(root/'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port',str(args.port),'--strictPort'],cwd=root,stdout=log,stderr=log)
    try:
        url=f'http://127.0.0.1:{args.port}/'
        for _ in range(100):
            if server.poll() is not None: raise RuntimeError('preview exited; see preview.log')
            try:
                if urllib.request.urlopen(url,timeout=.5).status==200: break
            except OSError: time.sleep(.1)
        else: raise RuntimeError('preview startup timeout')
        report['servedIndexSha256']=hashlib.sha256(urllib.request.urlopen(url).read()).hexdigest()
        assert report['servedIndexSha256']==report['distHashes']['index.html'],'served index differs from built index'
        with sync_playwright() as p:
            for channel in ['chrome','msedge']:
                result=dict(channel=channel,scenes=[],errors=[])
                report['browsers'].append(result)
                browser=p.chromium.launch(channel=channel,headless=False,args=['--use-angle=d3d11',f"--use-adapter-luid={amd['luid']}"])
                try:
                    result['version']=browser.version
                    page=browser.new_page(viewport={'width':1920,'height':1080},device_scale_factor=1)
                    page.on('pageerror',lambda e: result['errors'].append(str(e)))
                    result['consoleErrors']=[]
                    result['requestFailures']=[]
                    page.on('console',lambda m: result['consoleErrors'].append(m.text) if m.type=='error' else None)
                    page.on('requestfailed',lambda r: result['requestFailures'].append(dict(url=r.url,error=r.failure)))
                    page.on('response',lambda r: result['requestFailures'].append(dict(url=r.url,status=r.status)) if r.status>=400 else None)
                    cdp=page.context.new_cdp_session(page)
                    cdp.send('Performance.enable')
                    cdp.send('Network.enable')
                    cdp.send('Network.emulateNetworkConditions',dict(offline=False,latency=20,downloadThroughput=6250000,uploadThroughput=6250000))
                    boot=time.monotonic()
                    page.goto(url,wait_until='networkidle')
                    until(page,"() => window.__afterlife?.game.screen==='menu'")
                    result['coldMenuLoadSecondsAt50Mbps']=time.monotonic()-boot
                    if page.locator('.st-age-dialog').count():
                        page.locator('.st-age-dialog').get_by_role('button',name='Not now',exact=True).click()
                    page.locator('.sh-menu__item',has_text='Settings').click()
                    result['settingsUi']=[]
                    for quality in ['low','medium','high','ultra','low']:
                        page.get_by_role('radio',name=quality.capitalize(),exact=True).click()
                        actual=page.evaluate('window.__afterlife.game.settings.quality')
                        assert actual==quality,(quality,actual)
                        result['settingsUi'].append(dict(requested=quality,actual=actual))
                    page.get_by_role('button',name='Done',exact=True).click()
                    page.evaluate("window.__afterlife.game.updateSettings({quality:'low',pixelRatio:1,tutorialEnabled:false,pauseWhenUnfocused:false,autoPauseOnEvents:false})")
                    if not args.load_only: result['scenes'].append(measure(page,cdp,'menu',channel))
                    page.locator('.sh-menu__item',has_text='New Game').click()
                    page.get_by_role('button',name='Create your household').click()
                    until(page,"() => window.__afterlife.game.screen==='caz'")
                    for _ in range(2): page.locator('.sh-member-add').click()
                    errors=page.evaluate('window.__afterlife.game.validateCaz()')
                    assert not errors,errors
                    cdp.send('Network.emulateNetworkConditions',dict(offline=False,latency=20,downloadThroughput=6250000,uploadThroughput=6250000))
                    load_start=time.monotonic()
                    page.locator('.sh-editor__start').click()
                    until(page,"() => window.__afterlife.game.screen==='game' && window.__afterlife.game.renderer.loadProgress()>=1")
                    result['lotLoadSecondsAt50Mbps']=time.monotonic()-load_start
                    result['coldToPlayableSecondsAt50Mbps']=time.monotonic()-boot
                    result['playableState']=state(page)
                    cdp.send('Network.emulateNetworkConditions',dict(offline=False,latency=0,downloadThroughput=-1,uploadThroughput=-1))
                    # Controlled day/night fixture: only the fresh throwaway world's tick is changed.
                    for name,tick,wall,mode,speed,quality in [('day',0,'cutaway','live',1,'low'),('night',3360,'cutaway','live',1,'low'),('walls-up',0,'up','live',1,'low'),('cutaway',0,'cutaway','live',1,'low'),('buy',0,'cutaway','buy',1,'low'),('three-zombies-3x',0,'cutaway','live',3,'low'),('medium',0,'cutaway','live',1,'medium'),('high',0,'cutaway','live',1,'high'),('ultra',0,'cutaway','live',1,'ultra')]:
                        if args.load_only: continue
                        if args.scenes!='all' and name not in args.scenes.split(','): continue
                        page.evaluate('''v=>{const g=window.__afterlife.game;g.sim.state.tick=v.tick;g.setWallMode(v.wall);g.setMode(v.mode);g.setSpeed(v.speed);g.updateSettings({quality:v.quality,pixelRatio:1});}''',dict(tick=tick,wall=wall,mode=mode,speed=speed,quality=quality))
                        result['scenes'].append(measure(page,cdp,name,channel,trace=name in args.trace_scenes.split(',')))
                        save()
                    assert not result['errors'] and not result['consoleErrors'] and not result['requestFailures'],'recorded page/console/network error'
                    result['status']='measured'
                except Exception as e:
                    result['status']='blocked'
                    result['blocker']=str(e)
                    print(f'{channel} BLOCKED: {e}',flush=True)
                finally: browser.close();save()
    finally:
        server.terminate()
        server.wait(timeout=15)
        report['finished']=datetime.now(timezone.utc).isoformat()
        save()
if not completed(report): raise SystemExit(1)
