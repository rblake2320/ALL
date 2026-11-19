"""Recalculate final S5/S11 observations and verify all retained bytes, including failed attempts."""
import argparse, hashlib, json, math, subprocess
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument('--current-sources', action='store_true')
ap.add_argument('--root', type=Path)
args = ap.parse_args()
repo = Path(__file__).resolve().parents[2]
root = args.root or repo / 'docs/desktop-reports/sol-world-render-evidence'
sha = lambda b: hashlib.sha256(b).hexdigest()
read = lambda p: json.loads(p.read_text(encoding='utf-8'))
seal = read(root / 'seal.json')
actual = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and p != root / 'seal.json'}
assert actual == set(seal['files']), 'Evidence file set differs'
for name, digest in seal['files'].items():
    assert sha((root / name).read_bytes()) == digest, name
provenance = read(root / 'provenance.json')
for name, digest in provenance['s5BuildFiles'].items():
    assert sha((root / 's5-served' / name).read_bytes()) == digest
    if name != 'index.html':
        assert ('./' + name) in (root / 's5-served/index.html').read_text(encoding='utf-8')
if args.current_sources:
    for name, digest in provenance['sourceFiles'].items():
        assert sha((repo / name).read_bytes()) == digest, name
else:
    # One process, with binary-length framing; paths with spaces and arbitrary source bytes remain intact.
    names = list(provenance['sourceFiles'])
    specs = ''.join(provenance['sourceCommit'] + ':' + name + '\n' for name in names)
    data = subprocess.check_output(['git', 'cat-file', '--batch'], input=specs.encode('utf-8'), cwd=repo)
    at = 0
    for name in names:
        end = data.index(b'\n', at)
        header = data[at:end].split()
        assert len(header) == 3 and header[1] == b'blob', name
        size = int(header[2]); at = end + 1
        assert sha(data[at:at + size]) == provenance['sourceFiles'][name], name
        at += size
        assert data[at:at + 1] == b'\n'; at += 1
    assert at == len(data)
assert subprocess.check_output(['git', 'diff', provenance['handoffCommit'], provenance['sourceCommit'], '--', 'src'], cwd=repo) == b''

smoke = read(root / 'e2e1/report.json')
assert smoke['ok'] and len(smoke['results']) == 27
assert all(s['status'] == 'PASS' and s['failedChecks'] == 0 for s in smoke['results'])
assert not smoke['errors'] and smoke['fatal'] is None
placement = read(root / 'placement1/report.json')
assert placement['ok'] is False  # PENDING is deliberately not an overall PASS.
assert len(placement['results']) == 9
assert sum(s['status'] == 'PASS' for s in placement['results']) == 8
assert placement['results'][-1]['status'] == 'PENDING' and 'vehicles' in placement['results'][-1]['name']
assert not placement['errors'] and placement['fatal'] is None

def healthy(h):
    assert 'AMD' in h['renderer'] and not h['fatal'] and not h['contextLost'] and min(h['buffer']) > 0

def clear(f):
    b = f['rect']; w, h = f['viewport']
    assert 0 <= b['x0'] < b['x1'] <= w and 0 <= b['y0'] < b['y1'] <= h
    assert f['inside'] and not f['blockers']

def actor_picked(s):
    assert s['actorHit'] and s['pivot']['visible']
    assert any(p['hit'] and p['hit']['kind'] == 'agent' and p['hit']['agentId'] == s['selected'] for p in s['picks'])
    assert s['actor']['agentId'] == s['selected'] == s['following']

for run, viewports, count in [('camera9', {'desktop', 'portrait', 'landscape'}, 20), ('camera12', {'portrait'}, 8)]:
    r = read(root / run / 'report.json')
    assert r['status'] == 'Worked' and not r['errors'] and r['hudAware']
    assert r['requestedAutonomy'] == 'off' and r['buildGate'] == 'full-build-worked'
    assert set(r['compositionInputs']) == set(provenance['compositionInputs'])
    assert r['bundle'] == r['bundleAfter'] and r['pin'] == provenance['privateCompositionCommit']
    assert {s['name'] for s in r['scenes']} == viewports
    assert sum(len(s['cases']) for s in r['scenes']) == count
    for name, digest in r['served'].items():
        assert r['bundle'][name] == digest and sha((root / 'composition-served' / name).read_bytes()) == digest
    for name, digest in r['sources'].items():
        assert sha((root / run / name).read_bytes()) == digest
    for scene in r['scenes']:
        healthy(scene['beforeHealth']); healthy(scene['afterHealth'])
        assert scene['beforeHealth']['renderer'] == scene['afterHealth']['renderer']
        before = scene['before']
        for c in scene['cases']:
            assert c['status'] == 'Worked'
            name = c['name']
            if name == 'real F recentres and follows selected actor':
                s = c['after']; actor_picked(s)
                assert s['selected'] == before['selected'] and s['queue'] == before['queue']
            elif name == 'selected-actor framing envelope clears HUD': clear(c['data'])
            elif name == 'reduced-motion recentre snaps synchronously':
                b, e, s = c['before'], c['expected'], c['after']; actor_picked(s)
                assert s['result'] and math.hypot(s['pivot']['x'] - e['pivot']['x'], s['pivot']['y'] - e['pivot']['y']) < 1
                assert math.hypot(b['pivot']['x'] - e['pivot']['x'], b['pivot']['y'] - e['pivot']['y']) > 2
            elif name == 'actual touch pan stops follow without a walk or selection change':
                b, s = c['before'], c['after']
                assert s['following'] is None and s['selected'] == b['selected'] and s['queue'] == b['queue'] and s['camera']['target'] != b['camera']['target']
            elif name == 'unknown followed actor is refused without a camera jump':
                d = c['data']; assert d['result'] is False and d['before'] == d['after']
            elif name == 'no selection or follow returns null/false':
                assert c['data']['actor'] is None and c['data']['result'] is False
            elif name == 'real off-home walk then F centres world position and preserves actor':
                s = c['after']; actor_picked(s); clear(c['frame'])
                assert s['actor']['regionId'] == 'street:mildew:2'
                for frame, x, z in [('world', 84.5, 32.5), ('local', 14.5, 2.5)]:
                    assert math.hypot(s['actor'][frame]['x'] - x, s['actor'][frame]['z'] - z) < .15
                assert scene['routeSetup']['ok'] and scene['walkTrace']['firstArrived']
            elif name == 'continuous real walking follow survives viewport rotation and restore clear of HUD':
                samples = scene['followResizeSamples']; assert len(samples) == 24
                assert {s['phase'] for s in samples} == {'original', 'rotated', 'restored'}
                distinct = len({(s['state']['actor']['world']['x'], s['state']['actor']['world']['z']) for s in samples})
                assert distinct == c['distinctPositions'] and distinct >= 8 and not c['badSampleIndices']
                for sample in samples:
                    assert sample['state']['selected'] == sample['state']['following'] == before['selected']; clear(sample['frame'])
                    assert sample['frame']['viewport'] == ([844, 390] if sample['phase'] == 'rotated' else [390, 844])
                assert scene['returnSetup']['result']['ok']
                arrived = scene['followArrivalTrace']['firstArrived']; assert arrived['regionId'] == 'street:mildew:3'
                assert math.hypot(arrived['pos']['x'] - 14.5, arrived['pos']['z'] - 2.5) < .15
                actor_picked(scene['followDestination']); clear(scene['followDestinationFrame'])
            else: raise AssertionError('Unknown case: ' + name)

for run, status in [('camera3', 'Blocked'), *[('camera' + str(i), 'Failed') for i in [4, 5, 6, 7, 8, 10, 11]]]:
    assert read(root / run / 'report.json')['status'] == status
for name, tokens in {
    'feature-gates.txt': ['world-render-view      32 passed, 0 failed', 'PASS      gate:typecheck', 'PASS      gate:build'],
    'render-regression.txt': ['25 passed', '333 passed'],
    'source-assets.txt': ['412 asset(s) verified across 14 manifest(s), 0 error(s)'],
    'built-assets.txt': ['412 asset(s) verified across 14 manifest(s), 0 error(s)'],
}.items():
    text = (root / name).read_text(encoding='utf-8')
    assert all(t in text for t in tokens), name
print(json.dumps({'status': 'Worked', 'sealedFiles': len(seal['files']), 'smoke': '27/27', 'placement': '8 passed, 1 vehicle pending', 'camera9': '20/20', 'camera12': '8/8 with 24 follow/resize samples', 'currentSources': args.current_sources}))
