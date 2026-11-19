"""One-command local W-055 acceptance: npm ci first; pass --blender /path/to/blender."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
EVIDENCE=HERE/'l5_evidence'

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def source_hashes():
    paths=[*HERE.glob('l5_*.py'),HERE/'l5_check_runtime.mjs',ROOT/'package.json',ROOT/'package-lock.json']
    paths.extend(ROOT/p for p in ('tests/unit/levels-assets/mausoleum.test.ts','tests/unit/levels-assets/rotrow.test.ts','docs/verification/features.json'))
    for sub in ('common','objects','levels'):
        paths.extend(p for p in (ROOT/'tools/blender'/sub).glob('*.py') if not p.name.startswith('l5_'))
    return {p.relative_to(ROOT).as_posix():digest(p) for p in sorted(set(paths))}

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--blender',required=True);args=ap.parse_args()
    EVIDENCE.mkdir(exist_ok=True)
    prefix=[args.blender,'--background','--threads','4','--python-exit-code','1','--python','tools/blender/levels/l5_build.py','--']
    npm=shutil.which('npm.cmd' if os.name=='nt' else 'npm')
    node=shutil.which('node')
    if not npm or not node:raise RuntimeError('Node/npm required; run npm ci first')
    steps=[
      ('build',prefix+['--preview','--res','384','--samples','24']),
      ('rebuild',prefix+['--verify']),
      ('runtime-audit',[node,'tools/blender/levels/l5_check_runtime.mjs']),
      ('cli-guards',[sys.executable,'tools/blender/levels/l5_cli_guards.py','--blender',args.blender]),
      ('contact-sheets',[sys.executable,'tools/blender/levels/l5_preview_sheets.py']),
      ('typecheck',[npm,'run','typecheck']),
      ('levels-tests',[npm,'test','--','tests/unit/levels-assets','--maxWorkers=2','--minWorkers=1']),
      ('verify-assets',[npm,'run','verify:assets']),
      ('web-build',[npm,'run','build']),
      ('verify-built-assets',[node,'scripts/verify-assets.mjs','--root','dist/assets']),
      ('built-runtime-audit',[node,'tools/blender/levels/l5_check_runtime.mjs','dist/assets','tools/blender/levels/l5_evidence/built-runtime-audit.json']),
    ]
    before=source_hashes();rows=[]
    head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    started=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    try:
        for name,cmd in steps:
            t=time.monotonic();log=EVIDENCE/(name+'.txt')
            with log.open('w',encoding='utf-8',newline='\n') as f:
                f.write(json.dumps({'command':cmd,'cwd':str(ROOT)})+'\n');f.flush()
                result=subprocess.run(cmd,cwd=ROOT,stdout=f,stderr=subprocess.STDOUT,timeout=1200)
            # Git's repository-wide eol=lf rule must not change the receipt-bound log bytes.
            log.write_text(log.read_text(encoding='utf-8'),encoding='utf-8',newline='\n')
            row=dict(check=name,exit=result.returncode,seconds=round(time.monotonic()-t,3),log=log.relative_to(ROOT).as_posix(),sha256=digest(log))
            rows.append(row);print(json.dumps(row),flush=True)
            if result.returncode:break
    finally:
        after=source_hashes()
        report=dict(startedUtc=started,baselineCommit=head,steps=rows,sourceHashes=before,sourceUnchanged=before==after,
                    worked=len(rows)==len(steps) and all(r['exit']==0 for r in rows) and before==after)
        (EVIDENCE/'acceptance.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8',newline='\n')
    return 0 if report['worked'] else 1

if __name__=='__main__':raise SystemExit(main())
