"""Check the shipped short-viewport dialog and force the old cap as a negative control."""
import argparse,json,subprocess,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser();ap.add_argument('--out',required=True);a=ap.parse_args();out=Path(a.out);out.mkdir(parents=True,exist_ok=False)
(out/'launched-harness.py').write_bytes(Path(__file__).read_bytes())
with (out/'preview.log').open('w',encoding='utf-8') as log:
    server=subprocess.Popen(['node','node_modules/vite/bin/vite.js','preview','--outDir','dev/out/sol-world-s11/components-dist','--host','127.0.0.1','--port','43961','--strictPort'],stdout=log,stderr=log)
    try:
        url='http://127.0.0.1:43961/tests/desktop/fixtures/sol-world-ui.html'
        for _ in range(100):
            try:urllib.request.urlopen(url,timeout=1).close();break
            except Exception:time.sleep(.1)
        with sync_playwright() as p:
            browser=p.chromium.launch(channel='chrome')
            try:
                page=browser.new_page(viewport={'width':316,'height':232});page.goto(url,wait_until='networkidle')
                page.evaluate("document.documentElement.style.setProperty('--ui-zoom','4')")
                page.get_by_role('button',name='World map',exact=True).click();page.get_by_role('dialog').locator('.ui-modal__close').focus()
                def geometry():return page.evaluate("""()=>{const elements=[document.querySelector('.ui-modal-layer'),document.querySelector('.ui-modal'),document.querySelector('.ui-modal__body'),document.querySelector('.ui-modal__close')];return {viewport:[innerWidth,innerHeight],elements:elements.map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {class:e.className,rect:[r.x,r.y,r.width,r.height],maxHeight:s.maxHeight,minHeight:s.minHeight,overflow:s.overflow}})}}""")
                actual=geometry();page.screenshot(path=str(out/'actual.png'))
                page.locator('.ui-modal').evaluate("e=>e.style.maxHeight='min(88vh,100%)'")
                old=geometry();page.screenshot(path=str(out/'old-cap-negative.png'))
                page.locator('.ui-modal').evaluate("e=>e.style.removeProperty('max-height')")
                restored=geometry()
                r=dict(scope='Controlled 316x232 CSS viewport with native-zoom-equivalent root font; not native browser zoom.',actual=actual,oldCapNegative=old,restored=restored)
                (out/'report.json').write_text(json.dumps(r,indent=2),encoding='utf-8')
                for data in [actual,restored]:assert 0<=data['elements'][-1]['rect'][1] and data['elements'][-1]['rect'][1]+44<=232,data
                assert old['elements'][-1]['rect'][1]+44>232,old
                print('Worked: shipped cap keeps Close visible; old-cap negative control hides it.')
            finally:browser.close()
    finally:server.terminate();server.wait(timeout=15)
