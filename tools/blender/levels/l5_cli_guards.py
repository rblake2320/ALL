"""Run actual Blender CLI negative controls against isolated, disposable outputs."""
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
EVIDENCE=HERE/'l5_evidence'

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def snapshot():
    paths=[ROOT/'public/assets/manifest.mausoleum.json',*(ROOT/'public/assets/models/levels/mausoleum').glob('*.glb')]
    return {str(p.relative_to(ROOT)):digest(p) for p in sorted(paths)}

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--blender',required=True);args=ap.parse_args()
    EVIDENCE.mkdir(exist_ok=True);before=snapshot();rows=[]
    def run(name,extra,code,want):
        cmd=[args.blender,'--background','--threads','2','--python-exit-code','1','--python',str(HERE/'l5_build.py'),'--',*extra]
        p=subprocess.run(cmd,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',errors='replace',timeout=120)
        (EVIDENCE/f'guard-{name}.txt').write_text(p.stdout,encoding='utf-8',newline='\n')
        rows.append(dict(name=name,exit=p.returncode,expectedExit=code,expectedText=want,rejected=p.returncode==code and want in p.stdout))
    with tempfile.TemporaryDirectory(prefix='astra-mausoleum-guards-') as td:
        out=Path(td)
        run('unknown-id',['--out',td,'--only','missing_model'],2,'unknown ids:')
        run('duplicate-id',['--out',td,'--only','organ_pipe,organ_pipe'],1,'duplicate model IDs')
        preview=out/'previews/mausoleum';preview.mkdir(parents=True,exist_ok=True)
        with open(preview/'.mausoleum.lock','a+') as f:
            f.seek(0)
            if os.name=='nt':
                import msvcrt
                msvcrt.locking(f.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
            run('held-build-lock',['--out',td,'--only','organ_pipe'],5,'another build_levels.py is publishing')
            run('held-verify-lock',['--out',td,'--only','organ_pipe','--verify'],5,'mausoleum build lock held')
        dest=out/'models/levels/mausoleum';dest.mkdir(parents=True)
        source=ROOT/'public/assets/models/levels/mausoleum/organ_pipe.glb'
        corrupt=bytearray(source.read_bytes());corrupt[-1]^=1
        (dest/source.name).write_bytes(corrupt)
        shutil.copyfile(ROOT/'public/assets/manifest.mausoleum.json',out/'manifest.mausoleum.json')
        damaged=digest(dest/source.name)
        run('tampered-bytes',['--out',td,'--only','organ_pipe','--verify'],4,'bytes differ')
        rows.append(dict(name='verify-does-not-overwrite',rejected=digest(dest/source.name)==damaged))
        sentinel=dest/'review-before-removal.glb';sentinel.write_bytes(b'park this before deletion')
        sentinel_hash=digest(sentinel)
        run('unrecognized-published-file',['--out',td,'--only','organ_pipe'],1,'unrecognized assets must be parked')
        rows.append(dict(name='unrecognized-file-preserved',rejected=sentinel.exists() and digest(sentinel)==sentinel_hash))
    with tempfile.TemporaryDirectory(prefix='astra-mausoleum-invalid-') as td:
        manifest=Path(td)/'manifest.mausoleum.json';manifest.write_bytes(b'{invalid')
        old=digest(manifest)
        run('malformed-manifest',['--out',td,'--only','organ_pipe'],1,'JSONDecodeError')
        rows.append(dict(name='malformed-manifest-preserved',rejected=digest(manifest)==old))
    after=snapshot()
    report=dict(cases=rows,publishedUnchanged=before==after,publishedBefore=before,publishedAfter=after)
    (EVIDENCE/'cli-guards.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8',newline='\n')
    ok=before==after and all(r['rejected'] for r in rows)
    print(json.dumps(dict(cases=len(rows),publishedUnchanged=before==after,worked=ok)))
    return 0 if ok else 1

if __name__=='__main__':raise SystemExit(main())
