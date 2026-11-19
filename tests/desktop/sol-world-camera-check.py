"""Recalculate retained S5 camera-port and HUD-framing observations; does not imply world traversal."""
import hashlib,json,math
from pathlib import Path
root=Path('docs/desktop-reports/sol-world-s11-camera');seal=json.loads((root/'seal.json').read_text());assert seal['format']=='sol-world-camera-v1'
assert {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}=={f['path'] for f in seal['files']}|{'seal.json'}
for f in seal['files']:
    p=root/f['path'];assert p.resolve().is_relative_to(root.resolve());b=p.read_bytes();assert len(b)==f['bytes'] and hashlib.sha256(b).hexdigest()==f['sha256'],f['path']
for name,count in [('camera1',14),('camera2',17)]:
    r=json.loads((root/name/'report.json').read_text());assert r['pin']=='d981020fcf136c34069a586b2be94df0c63a6262' and not r['errors']
    assert {s['name'] for s in r['scenes']}=={'desktop','portrait','landscape'}
    assert sum(len(s['cases']) for s in r['scenes'])==count
    for file,h in r['sources'].items():assert hashlib.sha256((root/name/file).read_bytes()).hexdigest()==h
    for file,h in r['served'].items():assert hashlib.sha256((root/'served-code'/file).read_bytes()).hexdigest()==h
    for s in r['scenes']:
        for h in [s['beforeHealth'],s['afterHealth']]:assert 'AMD' in h['renderer'] and not h['fatal'] and not h['contextLost'] and min(h['buffer'])>0
        a=s['before']['actor'];assert a and a['world']['x']-a['local']['x']==70 and a['world']['z']==a['local']['z']
        for c in s['cases']:
            if c['name']=='selected-actor framing envelope clears HUD':
                d=c['data'];areas=[]
                for b in d['blockers']:
                    a,z=d['rect'],b['rect'];area=max(0,min(a['x1'],z['x1'])-max(a['x0'],z['x0']))*max(0,min(a['y1'],z['y1'])-max(a['y0'],z['y0']));assert math.isclose(area,b['overlap'],abs_tol=1e-6);areas.append(area)
                assert c['status']==('Failed' if areas else 'Worked')
                if s['name']=='landscape':assert sum(areas)>783
            else:
                if c['name']=='real F recentres and follows selected actor':
                    q=c['after'];assert q['selected']==s['before']['selected']==q['following'];assert q['queue']==s['before']['queue'];assert max(abs(q['camera']['target'][k]-q['actor']['local'][k]) for k in ['x','z'])<.1
                elif c['name']=='reduced-motion recentre snaps synchronously':
                    q=c['after'];assert q['result'] and q['following']==q['selected'];assert max(abs(q['camera']['target'][k]-q['actor']['local'][k]) for k in ['x','z'])<.1
                elif c['name']=='actual touch pan stops follow without a walk or selection change':
                    b,z=c['before'],c['after'];assert z['following'] is None and z['selected']==b['selected'] and z['queue']==b['queue'] and z['camera']['target']!=b['camera']['target']
                elif c['name']=='unknown followed actor is refused without a camera jump':assert c['data']['result'] is False and c['data']['before']==c['data']['after']
                elif c['name']=='no selection or follow returns null/false':assert c['data']['actor'] is None and c['data']['result'] is False
                else:raise AssertionError('Unknown camera case '+c['name'])
                assert c['status']=='Worked'
    if name=='camera1':assert r['status']=='Worked'
    else:assert r['status']=='Failed' and sum(c['status']=='Failed' for s in r['scenes'] for c in s['cases'])==1
print('Worked: sealed S5 observations recalculate:14 camera-port checks pass; expanded17-case check finds one landscape HUD framing failure.')
