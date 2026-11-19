"""Offline verdict for the W-064 browser probe; synthetic tests are harness tests only."""
import math
import hashlib
import time
import urllib.request
import urllib.parse

def wait_preview(process, url, log_path, expected, timeout=15):
    """Require this preview's listening marker, then hash the served executable files."""
    names = sorted(name for name in expected if name == 'index.html' or name.endswith(('.js', '.css')))
    if 'index.html' not in names or not any(name.endswith('.js') for name in names):
        raise ValueError('Built index and JavaScript hashes are required')
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if process.poll() is not None:
            raise RuntimeError('Owned preview exited before readiness')
        if log_path.exists() and url.rstrip('/') in log_path.read_text(encoding='utf-8', errors='replace'):
            break
        time.sleep(.05)
    else:
        raise TimeoutError('Owned preview listening marker missing; refusing to attach to another server')
    served = {}
    for name in names:
        if name.startswith('/') or '\\' in name or '..' in name.split('/'):
            raise ValueError('Unsafe served code path')
        if process.poll() is not None:
            raise RuntimeError('Owned preview exited during artifact verification')
        with urllib.request.urlopen(url.rstrip('/') + '/' + urllib.parse.quote(name, safe='/'), timeout=5) as response:
            data = response.read(16 * 1024 * 1024 + 1)
        if len(data) > 16 * 1024 * 1024:
            raise RuntimeError('Served executable file exceeds probe limit')
        served[name] = hashlib.sha256(data).hexdigest()
        if served[name] != expected[name]:
            raise RuntimeError(f'Served code hash differs: {name}')
    return served

def positive(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0

def served_code_matches(report):
    expected = {name: digest for name, digest in report.get('distHashes', {}).items()
                if name == 'index.html' or name.endswith(('.js', '.css'))}
    return 'index.html' in expected and any(name.endswith('.js') for name in expected) and report.get('servedCodeHashes') == expected

def assess(report, dist_after, expected_scenes):
    checks = report.get('checks', [])
    scenes = report.get('screens', [])
    health = report.get('health', [])
    problems = []
    if report.get('blocker') or not report.get('finished'):
        problems.append('run did not finish')
    if not report.get('distHashes') or report['distHashes'] != dist_after:
        problems.append('served bundle missing or changed during run')
    if not served_code_matches(report):
        problems.append('served executable hashes missing or different')
    if len(scenes) != len(expected_scenes) or {s['name'] for s in scenes} != set(expected_scenes):
        problems.append('expected scene coverage missing')
    if not health or len(health) != len(scenes) + 1:
        problems.append('per-scene and final health coverage missing')
    if any('AMD Radeon' not in h.get('renderer', '') or h.get('fatal') or h.get('contextLost') or
           len(h.get('buffer', [])) != 2 or any(n <= 0 for n in h['buffer']) for h in health):
        problems.append('renderer, context, fatal or drawing-buffer health failed')
    if report.get('errors') or report.get('consoleErrors'):
        problems.append('unhandled page or console error')
    if not checks:
        problems.append('no interaction checks executed')
    if any(c.get('status') not in {'Worked', 'Failed', 'Blocked'} for c in checks):
        problems.append('invalid interaction status')
    incomplete = any(c.get('status') == 'Blocked' for c in checks)
    failed = [c['name'] for c in checks if c.get('status') == 'Failed']
    violations = sum(len(s.get('violations', [])) for s in scenes)
    product_violations = sum(len(s.get('violations', [])) for s in scenes if not s.get('controlledTextFixture'))
    measurement = 'Blocked' if problems else 'Worked'
    product = 'Blocked' if problems or incomplete else 'Failed' if failed or product_violations else 'Worked'
    return dict(measurementStatus=measurement, productAcceptance=product,
                failedChecks=failed, axeViolatedRuleOccurrences=violations, productAxeViolatedRuleOccurrences=product_violations, blockers=problems,
                scope='Recorded keyboard/DOM/axe states only; rendered contrast and native zoom use separate probes.')


def assess_zoom(report, dist_after):
    samples = report.get('samples', [])
    problems = []
    if report.get('blocker') or not report.get('finished') or report.get('errors'):
        problems.append('zoom run incomplete or has browser errors')
    if not report.get('distHashes') or report['distHashes'] != dist_after:
        problems.append('served bundle missing or changed')
    if not served_code_matches(report):
        problems.append('served executable hashes missing or different')
    if [s.get('label') for s in samples] != ['100', '200', '400']:
        problems.append('three native zoom samples missing or out of order')
    scales = []
    if not problems:
        base = samples[0]
        base_heading = base.get('heading') or {}
        if base.get('width') != 1280 or not positive(base_heading.get('font')) or not positive(base.get('dpr')):
            problems.append('1280px baseline heading missing')
        else:
            for row, ratio, width in zip(samples, [1, 2, 4], [1280, 640, 320]):
                if not all(positive(row.get(k)) for k in ['dpr', 'width', 'visualScale']):
                    problems.append('zoom sample geometry missing');continue
                if abs(row['dpr'] / base['dpr'] - ratio) > .02 or abs(row['width'] - width) > 2 or abs(row.get('visualScale', 0) - 1) > .02:
                    problems.append('native DPR/viewport/visual-viewport zoom evidence mismatch')
                heading = row.get('heading') or {}
                if heading.get('text') != base_heading.get('text') or not positive(heading.get('font')):
                    problems.append('comparable Settings heading missing')
                else:
                    scales.append(dict(label=row['label'], physicalScale=heading['font'] * row['dpr'] / (base['heading']['font'] * base['dpr'])))
    route = any(row['physicalScale'] >= 1.95 for row in scales if row['label'] != '100')
    return dict(measurementStatus='Blocked' if problems else 'Worked',
                headingMagnification='Blocked' if problems else 'Worked' if route else 'Failed',
                headingScales=scales, blockers=problems,
                scope='Native 200/400% Settings-heading magnification; control reachability and other text require their recorded checks.')
