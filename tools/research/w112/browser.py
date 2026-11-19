"""Own isolated browser; UI-only setup, read-only outcome snapshots, no actor actions."""
import json
import hashlib
import os
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

out, setup = Path(sys.argv[1]), sys.argv[2]
out.mkdir(parents=True, exist_ok=True)
events = (out / 'browser-events.jsonl').open('a', encoding='utf-8', buffering=1)
def event(kind, detail):
    events.write(json.dumps({'time': time.time(), 'kind': kind, 'detail': detail}) + '\n')

SNAP = """() => {
 const g=window.__afterlife?.game,s=g?.sim?.state;
 return {screen:g?.screen,mode:g?.mode,speed:g?.speed,funds:s?.household?.funds,
   cazLot:g?.caz?.lotTemplate,storyArc:s?.flags?.storyArc,tick:s?.tick,fatal:g?.fatalError,
   household:s?.household,agents:s?.agents,objects:s?.objects,walls:s?.lot?.walls,
   placing:g?.buy?.placingDefId,moving:g?.buy?.movingObjectId,tool:g?.buildTool,
   preview:g?.buildPreviewLabel,ghost:window.__w112ghost??null,
   bodyText:document.body.innerText.slice(0,16000)};
}"""
try:
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context('/tmp/w112-profile', executable_path='/usr/bin/chromium',
            headless=False, no_viewport=True, args=['--no-sandbox','--disable-dev-shm-usage',
            '--window-size=1280,960','--window-position=0,0','--kiosk',
            '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
            '--disable-background-networking','--no-first-run','--no-default-browser-check'])
        ctx.tracing.start(screenshots=True, snapshots=True)
        page = ctx.pages[0]
        page.on('pageerror', lambda e: event('pageerror', str(e)))
        page.on('console', lambda m: event('console', {'type':m.type,'text':m.text}))
        page.on('requestfailed', lambda r: event('requestfailed', {'url':r.url,'failure':r.failure}))
        response=page.goto('http://127.0.0.1:4173/', wait_until='domcontentloaded')
        if response is None or response.status != 200: raise RuntimeError('game document did not load')
        event('served-index',{'sha256':hashlib.sha256(response.body()).hexdigest(),'status':response.status})
        page.wait_for_function("() => window.__afterlife?.game?.screen === 'menu'", timeout=180000)
        age = page.locator('.st-age-dialog .st-age__input')
        if age.is_visible():
            age.fill('1990')
            page.get_by_test_id('age-continue').click()
            event('setup', 'synthetic adult test profile through age UI')
        if setup in ('caz','starter'):
            page.locator('.sh-menu__item', has_text='New Game').click()
            page.wait_for_function("() => window.__afterlife.game.screen === 'newGame'", timeout=60000)
            lot = page.locator('.sh-lots [role="radio"][data-lot="starter"]')
            lot.wait_for(state='visible', timeout=60000)
            lot.click()
            page.wait_for_function("() => document.querySelector('.sh-lots [data-lot=starter]')?.getAttribute('aria-checked') === 'true'", timeout=60000)
            page.get_by_role('button', name='Create your household').click()
            page.wait_for_function("() => window.__afterlife.game.screen === 'caz'", timeout=60000)
            assert page.evaluate("() => window.__afterlife.game.caz.lotTemplate") == 'starter', 'UI did not select starter lot'
            event('setup', 'UI selected starter lot and opened CAZ')
        if setup == 'starter':
            page.locator('.sh-editor__start').click()
            page.wait_for_function("() => window.__afterlife.game.screen === 'game'", timeout=180000)
            page.wait_for_function("() => window.__afterlife.game.renderer.loadProgress() >= 1 && !!document.querySelector('.hud-funds')", timeout=180000)
            page.keyboard.press('0')
            page.wait_for_function("() => window.__afterlife.game.speed === 0", timeout=60000)
            assert page.evaluate("() => {const s=window.__afterlife.game.sim.state;return !s.flags.storyArc && s.household.funds===6500+500*(s.household.memberIds.length-1)}"), 'Starter setup has wrong story/funds'
            event('setup', 'UI entered starter home and pressed pause key')
            intro = page.get_by_role('button', name='Let’s go')
            if intro.count() and intro.is_visible():
                intro.click()
                event('setup', 'UI dismissed intro card')
        # Read-only forwarding spy, matching the existing placement suite.
        page.evaluate("""() => { const r=window.__afterlife?.game?.renderer;
          if(r?.setPlacementGhost){const original=r.setPlacementGhost.bind(r);
          r.setPlacementGhost=(g)=>{window.__w112ghost=g?JSON.parse(JSON.stringify(g)):null;return original(g)}} }""")
        first=page.evaluate(SNAP)
        renderer=page.evaluate("""() => {const gl=document.getElementById('game-canvas')?.getContext('webgl2');
          const ext=gl?.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null;}""")
        event('renderer',renderer)
        (out/'before.json').write_text(json.dumps(first,indent=2),encoding='utf-8')
        page.screenshot(path=str(out/'before.png'))
        (out/'browser-ready.json').write_text(json.dumps({'ready':True,'setup':setup,'browser':ctx.browser.version if ctx.browser else 'persistent Chromium','screen':first.get('screen')}),encoding='utf-8')
        next_shot=time.monotonic()
        with (out/'states.jsonl').open('a',encoding='utf-8',buffering=1) as states:
            while not (out/'stop-browser').exists():
                states.write(json.dumps({'time':time.time(),'state':page.evaluate(SNAP)})+'\n')
                if time.monotonic()>=next_shot:
                    page.screenshot(path=str(out/f'frame-{time.time_ns()}.png'))
                    next_shot=time.monotonic()+10
                page.wait_for_timeout(1000)
        (out/'after.json').write_text(json.dumps(page.evaluate(SNAP),indent=2),encoding='utf-8')
        page.screenshot(path=str(out/'after.png'))
        ctx.tracing.stop(path=str(out/'browser-trace.zip'))
        ctx.close()
except Exception as exc:
    event('fatal',repr(exc))
    raise
finally:
    events.close()
