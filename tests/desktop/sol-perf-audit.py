"""Recompute acceptance from raw intervals. No browser or game is launched."""
import ast, gzip, hashlib, json
from pathlib import Path

root=Path('evidence/sol-perf')
baseline=json.loads((root/'run6/scene-results.json').read_text())
targeted=json.loads((root/'run7/scene-results.json').read_text())
probes=json.loads((root/'adapter-probes.json').read_text())
checks=[]
def check(name,ok,detail=None): checks.append(dict(name=name,ok=bool(ok),detail=detail))
check('same source pin',baseline['pin']==targeted['pin'] and baseline['pin'].startswith('752a73c'))
for name,r in [('run6',baseline),('run7',targeted)]:
    check(f'{name}: successful pristine build',r['buildExit']==0 and not r['sourceDirty'])
    check(f'{name}: launched harness hash',hashlib.sha256((root/name/'launched-harness.py').read_bytes()).hexdigest()==r['harnessSha256'])
    check(f'{name}: served index hash',r['servedIndexSha256']==r['distHashes']['index.html'])
check('identical rebuilt assets',baseline['distHashes']==targeted['distHashes'])
env={}
tree=ast.parse(Path('tests/desktop/sol-perf.py').read_bytes())
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='validate_sample'],type_ignores=[]),'<actual validator>','exec'),env)
for channel in ['chrome','msedge']:
    negatives=[p for p in probes if p['channel']==channel and 'luid' not in ' '.join(p['flags'])]
    positive=[p for p in probes if p['channel']==channel and 'luid' in ' '.join(p['flags'])]
    check(f'{channel}: reject wrong adapters',len(negatives)==2 and all(not p['amdConfirmed'] for p in negatives))
    check(f'{channel}: explicit AMD selected',len(positive)==1 and positive[0]['amdConfirmed'])
    b=next(b for b in baseline['browsers'] if b['channel']==channel)
    t=next(b for b in targeted['browsers'] if b['channel']==channel)
    check(f'{channel}: both runs completed',b['status']==t['status']=='measured',[b.get('blocker'),t.get('blocker')])
    check(f'{channel}: exact scene coverage',[s['name'] for s in b['scenes']]==['menu','day','night','walls-up','cutaway','buy','three-zombies-3x','medium','high','ultra'])
    check(f'{channel}: no page/console/network errors',all(not r[k] for r in [b,t] for k in ['errors','consoleErrors','requestFailures']))
    check(f'{channel}: UI quality selections applied',len(t['settingsUi'])==5 and all(s['requested']==s['actual'] for s in t['settingsUi']))
    for scene in b['scenes']+t['scenes']:
        d=scene['frameIntervalsMs']; fps=1000*len(d)/sum(d)
        check(f"{channel}/{scene['name']}: raw intervals agree",abs(fps-scene['fps'])<1e-8 and len(d)>100 and sum(d)>=15000)
        check(f"{channel}/{scene['name']}: actual AMD",all('AMD Radeon' in scene[k]['renderer'] for k in ['before','after']))
        expected=[2880,1620] if scene['before']['stats']['quality']=='ultra' else [1920,1080]
        try:
            env['validate_sample'](scene['before'],scene['after'],scene['healthSamples'],scene['name'],expected)
            valid=True
        except AssertionError: valid=False
        check(f"{channel}/{scene['name']}: health and workload",valid)
    for name in ['menu','day','night','walls-up','cutaway','buy','three-zombies-3x']:
        s=next(s for s in b['scenes'] if s['name']==name)
        check(f'{channel}/{name}: low 1080p workload',s['before']['stats']['quality']=='low' and s['before']['buffer']==[1920,1080] and (name=='menu' or s['before']['members']==3))
        check(f'{channel}/{name}: >=30fps',s['fps']>=30,s['fps'])
        rss=max(p['rss'] for p in s['memorySeries'])
        check(f'{channel}/{name}: sampled browser RSS <1.5GB decimal',rss<1_500_000_000,rss)
    check(f'{channel}: menu <15sec at50Mbps',t['coldMenuLoadSecondsAt50Mbps']<15,t['coldMenuLoadSecondsAt50Mbps'])
    check(f'{channel}: cold to playable <15sec at50Mbps',t['coldToPlayableSecondsAt50Mbps']<15,t['coldToPlayableSecondsAt50Mbps'])
    ps=t['playableState']
    check(f'{channel}: cold journey actual AMD Low playable',ps['screen']=='game' and ps['members']==3 and ps['stats']['quality']=='low' and ps['buffer']==[1920,1080] and 'AMD Radeon' in ps['renderer'] and not ps['fatal'])
    for name in ['high','ultra']:
        trace=json.loads(gzip.decompress((root/'run6'/f'{channel}-{name}.trace.json.gz').read_bytes()))
        check(f'{channel}/{name}: readable DevTools trace',len(trace['traceEvents'])>100)
result=dict(checks=checks,worked=sum(c['ok'] for c in checks),failed=sum(not c['ok'] for c in checks),scope='Pinned shared-host AMD starter-lot Low performance; quality comparisons and traces are separate measurements.')
(root/'acceptance.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k!='checks'},indent=2))
for c in checks:
    if not c['ok']: print(json.dumps(c))
raise SystemExit(1 if result['failed'] else 0)
