"""Exercise the real Blender driver against bad IDs, contention and tampered assets.

python tools/blender/levels/l3_cli_guards.py --blender /path/to/blender
Uses isolated output directories; hashes the published kit before/after.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
EVIDENCE=HERE/'l3_evidence'

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def snapshot():
    paths=[ROOT/'public/assets/manifest.rotrow.json',*(ROOT/'public/assets/models/levels/rotrow').glob('*.glb')]
    return {str(p.relative_to(ROOT)):digest(p) for p in sorted(paths)}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--blender',required=True)
    args=parser.parse_args()
    before=snapshot()
    rows=[]
    def run(name,extra,want):
        cmd=[args.blender,'--background','--threads','2','--python-exit-code','1','--python',
             str(HERE/'build_rotrow.py'),'--',*extra]
        p=subprocess.run(cmd,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',errors='replace',timeout=120)
        (EVIDENCE/f'guard-{name}.txt').write_text(p.stdout,encoding='utf-8')
        rows.append(dict(name=name,exit=p.returncode,expected=want,rejected=p.returncode!=0 and want in p.stdout))
    with tempfile.TemporaryDirectory(prefix='astra-rotrow-guards-') as td:
        out=Path(td)
        run('unknown-id',['--out',td,'--only','missing_model'],'unknown or duplicated model ID')
        run('duplicate-id',['--out',td,'--only','jukebox_ghoul,jukebox_ghoul'],'unknown or duplicated model ID')
        with open(out/'.rotrow-build.lock','a+') as f:
            f.seek(0)
            if os.name=='nt':
                import msvcrt
                msvcrt.locking(f.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
            run('held-lock',['--out',td,'--only','jukebox_ghoul'],'BlockingIOError')
        dest=out/'models/levels/rotrow'
        dest.mkdir(parents=True)
        source=ROOT/'public/assets/models/levels/rotrow/jukebox_ghoul.glb'
        corrupt=bytearray(source.read_bytes());corrupt[-1]^=1
        (dest/source.name).write_bytes(corrupt)
        shutil.copyfile(ROOT/'public/assets/manifest.rotrow.json',out/'manifest.rotrow.json')
        damaged=digest(dest/source.name)
        run('tampered-bytes',['--out',td,'--only','jukebox_ghoul','--verify'],'rebuild bytes differ')
        rows.append(dict(name='verify-does-not-overwrite',rejected=digest(dest/source.name)==damaged))
    after=snapshot()
    report=dict(cases=rows,publishedUnchanged=before==after,publishedBefore=before,publishedAfter=after)
    (EVIDENCE/'cli-guards.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    ok=before==after and all(r['rejected'] for r in rows)
    print(json.dumps(dict(cases=len(rows),publishedUnchanged=before==after,worked=ok)))
    return 0 if ok else 1

if __name__=='__main__': raise SystemExit(main())
