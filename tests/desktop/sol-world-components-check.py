"""Offline integrity/acceptance check for sealed S11 component evidence (not game/world acceptance)."""
import argparse, hashlib, json
from pathlib import Path
ap=argparse.ArgumentParser();ap.add_argument('--root',default='docs/desktop-reports/sol-world-s11-components');ap.add_argument('--run',choices=['components7','components8'],default='components7');ap.add_argument('--current-sources',action='store_true');a=ap.parse_args()
root=Path(a.root);seal=json.loads((root/'seal.json').read_text(encoding='utf-8'))
assert seal['format']=='sol-world-components-v1'
assert {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}=={f['path'] for f in seal['files']}|{'seal.json'}
for f in seal['files']:
    p=root/f['path'];assert p.resolve().is_relative_to(root.resolve())
    b=p.read_bytes();assert len(b)==f['bytes'] and hashlib.sha256(b).hexdigest()==f['sha256'],f['path']
r=json.loads((root/a.run/'report.json').read_text())
assert r['status']=='Worked' and not r['errors'] and r['sources']==r['sourcesAfter'] and r['bundleHashes']==r['bundleHashesAfter']
assert len(r['cases'])==18 and len({c['name'] for c in r['cases']})==18 and all(c['status']=='Worked' for c in r['cases'])
for prefix in ['desktop','portrait','landscape','narrow']:assert sum(c['name'].startswith(prefix+' ') for c in r['cases'])==4
for path,sha in r['sources'].items():
    assert not Path(path).is_absolute() and '..' not in Path(path).parts,path
    assert hashlib.sha256((root/a.run/'sources'/path).read_bytes()).hexdigest()==sha,path
    if a.current_sources:assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==sha,path
for path,sha in r['bundleHashes'].items():assert hashlib.sha256((root/'production-bundle'/path).read_bytes()).hexdigest()==sha,path
assert len(r['served'])>=3
for path,sha in r['served'].items():assert r['bundleHashes'][path.lstrip('/')]==sha,path
for c in r['cases']:
    data=c.get('details')
    if isinstance(data,dict):
        assert data['overflow']<=1
        for b in data['buttons']:assert b['rect'][2]>=43.9 and b['rect'][3]>=43.9
        for b in [*data['buttons'],*data['statuses']]:
            if 'contrast' in b:assert b['contrast']>=4.5
if (root/'native2/report.json').exists():
    native=json.loads((root/'native2/report.json').read_text())
    assert native['status']=='Worked' and not native['errors'] and native['bundle']==r['bundleHashes']
    assert [s['label'] for s in native['samples']]==['100','200','400']
    for path,sha in native['sources'].items():
        assert not Path(path).is_absolute() and '..' not in Path(path).parts,path
        assert hashlib.sha256((root/'native2/sources'/path).read_bytes()).hexdigest()==sha,path
        if a.current_sources:assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==sha,path
    for s in native['samples']:
        assert len(s['focus'])==10 and all(f['within'] and f.get('withinScroll',True) for f in s['focus'])
        assert s['physicalControlRatio']>=int(s['label'])/100*.95
        assert s['physicalHeadingRatio']>=int(s['label'])/100*.95
    for label in ['200','400']:assert 'Zoom: '+label+'%' in (root/f'native2/native-ui-{label}.txt').read_text()
    for path,sha in native['served'].items():assert native['bundle'][path.lstrip('/')]==sha,path
    before=json.loads((root/'native1/report.json').read_text());assert before['status']=='Failed' and before['samples'][-1]['label']=='400'
    old=before['samples'][-1]['focus'][-1];assert old['name']=='Close' and not old['within']
    height=json.loads((root/'height2/report.json').read_text())
    for key in ['actual','restored']:
        rect=height[key]['elements'][-1]['rect'];assert rect[1]>=0 and rect[1]+rect[3]<=232
    rect=height['oldCapNegative']['elements'][-1]['rect'];assert rect[1]+rect[3]>232
    print('Worked: native100/200/400%, 30 focused-control observations; original failure and old-cap negative control retained.')
print(f"Worked: {len(seal['files'])} sealed files, 18 component scenarios; served production bytes and source snapshots verified.")
