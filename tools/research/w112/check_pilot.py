"""Independent receipt checks for the bounded real-model capability pilot."""
import json
from pathlib import Path

root=Path('docs/research/w112')
p=root/'pilot1'
before=json.loads((p/'before.json').read_text(encoding='utf-8'))
after=json.loads((p/'after.json').read_text(encoding='utf-8'))
events=[json.loads(s) for s in (p/'browser-events.jsonl').read_text(encoding='utf-8').splitlines()]
steps=[json.loads(s) for s in (p/'steps.jsonl').read_text(encoding='utf-8').splitlines()]
checks=[]
def check(name,ok):
    checks.append({'name':name,'worked':bool(ok)})
    assert ok,name
check('actor exit zero',int((p/'actor.exit').read_text())==0)
check('actual initial menu',before['screen']=='menu')
check('actual final character editor',after['screen']=='caz' and 'Create-a-Zombie' in after['bodyText'])
check('bounded steps',0<len(steps)<=6)
check('no observer fatal/page/network errors',not any(e['kind'] in ['fatal','pageerror','requestfailed'] for e in events))
check('no console errors',not any(e['kind']=='console' and e['detail']['type']=='error' for e in events))
check('software renderer observed',any(e['kind']=='renderer' and 'SwiftShader' in e['detail'] for e in events))
calls=[]
for step in steps:
    results={r['tool_call_id']:r for r in step.get('tool_results',[])}
    for call in step.get('assistant_tool_calls',[]):
        calls.append(call)
        check('paired successful tool '+call['id'],call['id'] in results and not results[call['id']].get('is_error',False))
        args=json.loads(call['arguments'])
        for key in ('x','y'):
            if key in args: check('normalized '+call['id']+' '+key,0<=args[key]<=1000)
check('actual click calls exist',any(c['name']=='click' for c in calls))
for name in ['before.png','after.png']:
    check('retained PNG '+name,(p/name).read_bytes().startswith(b'\x89PNG\r\n\x1a\n'))
transfer=json.loads((root/'dist-transfer-check.json').read_text())
check('all 432 built files match transfer',transfer['all_match'] and transfer['files']==432)
receipt={'worked':len(checks),'failed':0,'steps':len(steps),'tool_calls':len(calls),'checks':checks,
 'scope':'One real-model menu-to-CAZ capability pilot; ten gameplay sessions remain separate.'}
(p/'independent-checks.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:receipt[k] for k in ['worked','failed','steps','tool_calls']}))
