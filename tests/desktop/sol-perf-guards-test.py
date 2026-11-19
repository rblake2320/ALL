"""Adversarial regressions for the reviewed false-pass paths; extracts actual guards only."""
import ast, copy, hashlib, json
from pathlib import Path
source=Path(__file__).with_name('sol-perf.py').read_bytes()
tree=ast.parse(source)
env={}
nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ['validate_sample','completed']]
exec(compile(ast.Module(body=nodes,type_ignores=[]),'<actual guards>','exec'),env)
healthy=dict(renderer='ANGLE (AMD Radeon Graphics)',viewport=[1920,1080],buffer=[1920,1080],fatal=None,stats=dict(quality='low',contextLost=False,fps=60),screen='game',time=dict(tick=1),members=3,speed=1,mode='live')
after=copy.deepcopy(healthy);after['time']['tick']=61
env['validate_sample'](healthy,after,[healthy],'day',[1920,1080])
rows=[dict(case='healthy advancing sample accepted',worked=True)]
for name,patch in [('fatal',dict(fatal='injected')),('wrong adapter',dict(renderer='NVIDIA')),('wrong buffer',dict(buffer=[960,540])),('frozen sim',dict(time=dict(tick=1))),('missing member',dict(members=2)),('wrong screen',dict(screen='menu')),('mode drift',dict(mode='buy')),('zero renderer FPS',dict(stats=dict(quality='low',contextLost=False,fps=0))),('context lost',dict(stats=dict(quality='low',contextLost=True,fps=60)))]:
    changed=copy.deepcopy(after);changed.update(patch)
    try: env['validate_sample'](healthy,changed,[healthy],'day',[1920,1080])
    except AssertionError: rows.append(dict(case=name,worked=True))
    else: raise AssertionError(f'guard accepted {name}')
bad=copy.deepcopy(healthy);bad['fatal']='transient'
try: env['validate_sample'](healthy,after,[healthy,bad,healthy],'day',[1920,1080])
except AssertionError: rows.append(dict(case='transient fatal rejected',worked=True))
else: raise AssertionError('transient fatal accepted')
base=dict(expectedScenes=['menu'],browsers=[dict(channel=c,status='measured',scenes=[dict(name='menu')],errors=[],consoleErrors=[],requestFailures=[]) for c in ['chrome','msedge']])
assert env['completed'](base)
for field in ['errors','consoleErrors','requestFailures']:
    changed=copy.deepcopy(base);changed['browsers'][0][field]=['injected']
    assert not env['completed'](changed),field
    rows.append(dict(case=f'{field} rejects completion',worked=True))
changed=copy.deepcopy(base);changed['browsers'].pop();assert not env['completed'](changed)
rows.append(dict(case='missing browser rejected',worked=True))
changed=copy.deepcopy(base);changed['browsers'][0]['scenes']=[];assert not env['completed'](changed)
rows.append(dict(case='missing scenario rejected',worked=True))
out=Path('evidence/sol-perf/guards-regression.json')
out.write_text(json.dumps(dict(harnessSha256=hashlib.sha256(source).hexdigest(),checks=rows),indent=2),encoding='utf-8')
print(f'{len(rows)} guard cases Worked; controlled boundaries, no product mocks counted as gameplay.')
