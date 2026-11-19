"""Verify sealed baseline bytes and recalculate the final S11 UI/gesture observations offline."""
import hashlib, json, runpy
from pathlib import Path

root=Path('docs/desktop-reports/sol-world-s11-evidence')
seal=json.loads((root/'seal.json').read_text(encoding='utf-8'))
assert seal['format']=='sol-world-s11-v1'
assert {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}=={f['path'] for f in seal['files']}|{'seal.json'}
for f in seal['files']:
    p=root/f['path'];assert p.resolve().is_relative_to(root.resolve())
    b=p.read_bytes();assert len(b)==f['bytes'] and hashlib.sha256(b).hexdigest()==f['sha256'],f['path']
assess=runpy.run_path('tests/desktop/sol-world-ui-assess.py')['assess']
for name in ['before1','before2','before3','before4','before5']:
    r=json.loads((root/name/'report.json').read_text())
    assert assess(r,r['distHashes'])==r['acceptance'],name
    for file,sha in r['sources'].items():assert hashlib.sha256((root/name/file).read_bytes()).hexdigest()==sha
r=json.loads((root/'before5/report.json').read_text())
assert r['acceptance']['measurementStatus']=='Worked' and r['acceptance']['controlAcceptance']=='Failed'
assert len(r['acceptance']['findings'])==3 and all(f['action']=='map' for f in r['acceptance']['findings'])
assert r['gestureAcceptance']=='Failed'
phones=[s for s in r['scenes'] if s['touch']]
assert {s['name'] for s in phones}=={'portrait','landscape'}
for s in phones:
    g=s['gestures'];assert g['status']=='Worked' and g['tap']['status']=='Failed'
    before,after=g['tap']['before'],g['tap']['after']
    target=dict(kind='tile',**g['point']['tile'])
    assert before['actor']==after['actor'] and before['queue']==after['queue'] and after['menu']['target']==target
    p=g['menuPositiveControl'];assert p['status']=='Worked' and p['after']['actor']==before['actor']
    added=[q for q in p['after']['queue'] if q['uid'] not in {a['uid'] for a in after['queue']}]
    assert len(added)==1 and added[0]['id']=='engine_goHere' and added[0]['target']==target
    for kind in ['pan','pinch']:
        v=g[kind];assert v['status']=='Worked'
        assert v['before']['actor']==v['after']['actor'] and v['before']['queue']==v['after']['queue'] and v['after']['menu'] is None
    assert g['pan']['before']['camera']['target']!=g['pan']['after']['camera']['target']
    assert g['pinch']['before']['camera']['distance']!=g['pinch']['after']['camera']['distance']
print(f"Worked: {len(seal['files'])} sealed files; UI and final gesture findings recalculate. Offline evidence verification, not a runtime implementation.")
