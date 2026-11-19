"""Actual upstream native editable typing into a real isolated browser input; no model involved."""
import json
import base64
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
from northcua.runtime.mcp.desktop_native.backend import PyAutoGuiDesktopBackend

out = Path('/out')
report = {'xclip':shutil.which('xclip'), 'xsel':shutil.which('xsel'), 'expected':'fridge zombie cafe 2026', 'outcome':'Blocked'}
try:
    with sync_playwright() as p:
        browser = p.chromium.launch_persistent_context('/tmp/w112-clipboard-profile',
            executable_path='/usr/bin/chromium', headless=False, no_viewport=True,
            args=['--no-sandbox','--window-size=1280,960','--window-position=0,0','--kiosk'])
        page = browser.pages[0]
        page.set_content('<label>Native typing acceptance <input id="native-text" aria-label="Native typing acceptance"></label>')
        box = page.locator('#native-text').bounding_box()
        backend = PyAutoGuiDesktopBackend()
        report['geometry'] = page.evaluate('() => ({inner:[innerWidth,innerHeight],outer:[outerWidth,outerHeight],screen:[screen.width,screen.height],offset:[screenX,screenY]})')
        def native_shot(name):
            data, _ = backend.capture_desktop_screenshot()
            (out/name).write_bytes(base64.b64decode(data.split(',',1)[1]))
        native_shot('native-before.png')
        geometry = report['geometry']
        border = (geometry['outer'][0]-geometry['inner'][0])/2
        screen_x = geometry['offset'][0]+border+box['x']+box['width']/2
        screen_y = geometry['offset'][1]+geometry['outer'][1]-geometry['inner'][1]-border+box['y']+box['height']/2
        report['nativeClick'] = backend.click(screen_x,screen_y)
        native_shot('native-after-click.png')
        page.wait_for_function("() => document.activeElement?.id==='native-text'",timeout=5000)
        report['nativeResult'] = backend.type_text(report['expected'], target_kind='editable')
        page.wait_for_function("expected => document.querySelector('#native-text').value===expected",arg=report['expected'],timeout=5000)
        report['observed'] = page.locator('#native-text').input_value()
        report['outcome'] = 'Worked' if report['observed']==report['expected'] else 'Failed'
        page.screenshot(path=str(out/'clipboard.png'))
        browser.close()
except Exception as exc:
    report['error'] = repr(exc)
(out/'clipboard.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
raise SystemExit(0 if report['outcome']=='Worked' else 1)
