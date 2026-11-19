"""One original-image negative control and one repaired setup, CPU only and network-none."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

root = Path('/home/rblake2320/afterlife-astra-w112')
source = root/'setup-repair-20261106'
runs = [
    ('clipboard-negative', 'sha256:250e75035d00cb28d7248ed52adced302683cfc848ff1ba94890b1a57e5f68dd', True),
    ('setup-repaired', 'sha256:39fd903567a12d30e5748dc95d843b89adee23118e2f918e7ade288cebbd9082', False),
]
for name, image, clipboard_only in runs:
    name += sys.argv[1] if len(sys.argv)>1 else ''
    out = source/name
    out.mkdir(exist_ok=False)
    command = ['docker','run','--rm','--init','--name','astra-w112-'+name,
               '--label','owner=astra-w112','--network','none','--cpus','2','--memory','4g',
               '--shm-size','512m','--security-opt','no-new-privileges','--cap-drop','ALL',
               '--entrypoint','/usr/bin/timeout','-e',f'W112_CLIPBOARD_ONLY={int(clipboard_only)}',
               '-v',f'{source}:/source:ro','-v',f'{root}/dist-c7df1b4:/game:ro','-v',f'{out}:/out',
               image,'300','/bin/bash','/source/setup_retest.sh']
    receipt = {'command':command,'started':time.time(),
               'sourceSha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in source.iterdir() if p.is_file()}}
    (out/'launch.json').write_text(json.dumps(receipt,indent=2))
    with (out/'container.txt').open('w') as log:
        result = subprocess.run(command,stdout=log,stderr=subprocess.STDOUT)
    receipt.update(exit=result.returncode,finished=time.time())
    (out/'completion.json').write_text(json.dumps(receipt,indent=2))
    print(name,result.returncode,flush=True)
