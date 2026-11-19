"""Offline conservation/recalculation of retained W064 outcomes; does not launch the game."""
import hashlib, json, runpy
from pathlib import Path

root = Path('docs/desktop-reports/a11y-w064-evidence')
seal = json.loads((root / 'seal.json').read_text())
assert seal['format'] == 'sol-w064-evidence-v1'
assert len({f['path'] for f in seal['files']}) == len(seal['files'])
assert {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()} == {f['path'] for f in seal['files']} | {'seal.json'}
for f in seal['files']:
    p = root / f['path']
    assert p.resolve().is_relative_to(root.resolve())
    b = p.read_bytes()
    assert len(b) == f['bytes'] and hashlib.sha256(b).hexdigest() == f['sha256'], f['path']
    if not f['pathScrubbed']:
        assert f['sha256'] == f['originalSha256'] and f['bytes'] == f['originalBytes']

api = runpy.run_path('tests/desktop/sol-a11y-health.py')
expected = ['age-gate','menu','settings','caz','caz-preset','hud','buy','store','scaled-1280','scaled-390','settings-expanded','settings-rtl']
for name in ['main3', 'main4', 'main6']:
    r = json.loads((root / name / 'report.json').read_text())
    assert api['assess'](r, r['distHashes'], expected) == r['acceptance'], name
    assert r['acceptance']['measurementStatus'] == 'Worked'
    assert r['acceptance']['productAcceptance'] == 'Failed'
    assert hashlib.sha256((root / name / 'launched-harness.py').read_bytes()).hexdigest() == r['harnessSha256']
m = json.loads((root / 'main6/report.json').read_text())
assert len(m['checks']) == 23 and sum(c['status'] == 'Worked' for c in m['checks']) == 22
assert m['acceptance']['failedChecks'] == ['Pause Escape restores game canvas focus']
assert m['placementAfter']['count'] == m['placementBefore']['count'] + 1
assert m['placementBefore']['funds'] - m['placementAfter']['funds'] == m['placementPrice'] == 45
for name in ['zoom2', 'zoom4']:
    r = json.loads((root / name / 'report.json').read_text())
    assert api['assess_zoom'](r, r['distHashes']) == r['acceptance']
    assert r['acceptance']['headingMagnification'] == 'Worked'
    assert hashlib.sha256((root / name / 'launched-harness.py').read_bytes()).hexdigest() == r['harnessSha256']
z = json.loads((root / 'zoom4/report.json').read_text())
for sample, verdict in zip(z['samples'], z['layoutAcceptance']):
    assert sum(not f['inModal'] or not f['withinViewport'] for f in sample['focusProbe']) == verdict['focusOutside']
assert [v['focusOutside'] for v in z['layoutAcceptance']] == [0, 0, 17]
c = json.loads((root / 'contrast2/report.json').read_text())
assert c['acceptance']['measurementStatus'] == 'Worked' and not c['acceptance']['contrastReview'] and not c['errors'] and c['distStable']
for scene in c['scenes']:
    for t in scene['texts']:
        if t['status'] == 'Worked':
            assert t['minimum'] >= t['threshold']
s = json.loads((root / 'store1/report.json').read_text())
assert s['acceptance']['measurementStatus'] == 'Worked'
assert [x['focusContained'] for x in s['acceptance']['states']] == [True, True, False]
print(f"Worked: {len(seal['files'])} sealed files; stored main/zoom verdicts recalculate; contrast/Store outcomes conserved. Offline receipt check only.")
