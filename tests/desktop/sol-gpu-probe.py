"""Probe actual browser GPU selection without changing the owner's browser settings."""
import json
import runpy
from pathlib import Path
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright

out = Path('evidence/sol-perf')
out.mkdir(parents=True, exist_ok=True)
results = []
adapter_rows = runpy.run_path(str(Path(__file__).with_name('sol-dxgi.py')))['adapters']()
(out / 'dxgi-adapters.json').write_text(json.dumps(adapter_rows, indent=2), encoding='utf-8')
amd = next(a for a in adapter_rows if a['vendor'] == 4098)
with sync_playwright() as p:
    for channel in ['chrome', 'msedge']:
        for label, extra in [('low-power', ['--gpu-preference=low-power']), ('force-low-power', ['--force-low-power-gpu']), ('amd-luid', [f"--use-adapter-luid={amd['luid']}"])]:
            flags = ['--use-angle=d3d11', *extra]
            row = dict(channel=channel, flags=flags, started=datetime.now(timezone.utc).isoformat())
            try:
                browser = p.chromium.launch(channel=channel, headless=False, args=flags)
                try:
                    row['version'] = browser.version
                    session = browser.new_browser_cdp_session()
                    row['systemInfo'] = session.send('SystemInfo.getInfo')
                    page = browser.new_page(viewport={'width': 1920, 'height': 1080}, device_scale_factor=1)
                    page.goto('chrome://gpu' if channel == 'chrome' else 'edge://gpu')
                    page.wait_for_timeout(1500)
                    row['gpuPage'] = page.locator('info-view').inner_text(timeout=10000)
                    page.screenshot(path=str(out / f'{channel}-{label}.png'))
                    page.goto('about:blank')
                    row['webgl'] = page.evaluate('''() => {const c=document.createElement('canvas');const g=c.getContext('webgl2');if(!g)return {error:'no webgl2'};const e=g.getExtension('WEBGL_debug_renderer_info');return {renderer:g.getParameter(e.UNMASKED_RENDERER_WEBGL),vendor:g.getParameter(e.UNMASKED_VENDOR_WEBGL)};}''')
                    row['amdConfirmed'] = 'AMD' in row['webgl'].get('renderer', '') and 'Radeon' in row['webgl'].get('renderer', '')
                finally:
                    browser.close()
            except Exception as e:
                row['error'] = str(e)
            results.append(row)
            (out / 'adapter-probes.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
            print(json.dumps({k: row[k] for k in ['channel','flags','webgl','amdConfirmed','error'] if k in row}), flush=True)
