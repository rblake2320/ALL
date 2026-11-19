"""Recover the pilot versions after the batch extension; require the recorded live SHA-256."""
from pathlib import Path
import hashlib
import json

src=Path(__file__).parent
out=Path('docs/research/w112/pilot1/source')
out.mkdir(exist_ok=True)
records=[]
for line in Path('docs/research/w112/pilot1/pilot1-source-hashes.txt').read_text().splitlines():
    expected,remote=line.split(maxsplit=1)
    name=remote.rsplit('/',1)[-1]
    data=(src/name).read_bytes()
    text=data.decode('utf-8').replace('\r\n','\n')
    if name=='Dockerfile.harness':
        text=text.replace('@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df','')
    elif name=='configure.py':
        text=text.replace('import os\n','').replace("int(os.environ.get('W112_MAX_STEPS','6'))",'6')
    elif name=='browser.py':
        text=text.replace('import hashlib\n','').replace('household:s?.household,agents:s?.agents,','household:s?.household,')
        start=text.index("        response=page.goto(")
        end=text.index('        page.wait_for_function(',start)
        text=text[:start]+"        page.goto('http://127.0.0.1:4173/', wait_until='domcontentloaded')\n"+text[end:]
    elif name=='pilot.sh':
        start=text.index('if test -n "${W112_GOAL_ID:-}"; then')
        end=text.index('BROWSER=$!',start)
        text=text[:start]+'python /source/browser.py /out/browser menu >/out/browser.txt 2>&1 &\n'+text[end:]
        text=text.replace('--query "$(cat /out/query.txt)"',"--query 'You are testing only the Afterlife Lease game in this isolated window. Click New Game, choose the free starter home, and open Create your household. Stop when the character editor is visible. Do not open other applications or navigate away from the game.'")
        text=text.replace('--max-steps "${W112_MAX_STEPS:-6}" --session-id "${W112_GOAL_ID:-w112-pilot}"','--max-steps 6 --session-id w112-pilot')
    candidates=[data,text.encode(),text.replace('\n','\r\n').encode()]
    match=next((b for b in candidates if hashlib.sha256(b).hexdigest()==expected),None)
    if match is None: raise RuntimeError('cannot recover exact recorded source: '+name)
    (out/name).write_bytes(match)
    records.append({'file':name,'sha256':expected,'matched_live_record':True})
(out.parent/'source-recovery-check.json').write_text(json.dumps(records,indent=2)+'\n',encoding='utf-8')
print(f'{len(records)} exact pilot source files recovered and verified')
