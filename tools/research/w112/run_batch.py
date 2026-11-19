"""Bounded sequential collection. Actor success is never promoted to a game verdict."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

ROOT=Path('/home/rblake2320/afterlife-astra-w112')
IMAGE='sha256:250e75035d00cb28d7248ed52adced302683cfc848ff1ba94890b1a57e5f68dd'
MODEL='astra-w112-nano-317dd35f'
BATCH=ROOT/'batch1'

def inspect(name):
    p=subprocess.run(['docker','inspect',name],capture_output=True,text=True)
    return json.loads(p.stdout)[0] if p.returncode==0 else None

def stop_owned(name):
    info=inspect(name)
    if info is None: return 'already absent'
    if info['Config']['Labels'].get('owner')!='astra-w112':
        raise RuntimeError(f'refusing foreign container {name}')
    subprocess.run(['docker','stop','--time','20',info['Id']],check=True,capture_output=True)
    return info['Id']

def write_atomic(path,value):
    temp=path.with_suffix(path.suffix+'.tmp')
    with temp.open('w',encoding='utf-8') as f:
        json.dump(value,f,indent=2); f.flush(); os.fsync(f.fileno())
    temp.replace(path)

def main():
    BATCH.mkdir(exist_ok=False)
    frozen=BATCH/'source'
    shutil.copytree(ROOT/'source',frozen)
    goals=json.loads((frozen/'goals.json').read_text())
    if len(goals)!=10 or len({g['id'] for g in goals})!=10: raise RuntimeError('require ten unique goals')
    model=inspect(MODEL)
    if model is None or model['Config']['Labels'].get('owner')!='astra-w112': raise RuntimeError('owned model absent')
    provenance={'started':time.time(),'pid':os.getpid(),'model_container_id':model['Id'],
        'game_pin':'c7df1b42f5b02777235ee5948e2f961c6b038532','image':IMAGE,
        'source_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in frozen.iterdir() if p.is_file()}}
    write_atomic(BATCH/'provenance.json',provenance)
    rows=[]
    try:
        for goal in goals:
            sid=goal['id']; out=BATCH/sid; out.mkdir()
            name='astra-w112-batch1-'+sid
            command=['docker','run','--rm','--init','--name',name,'--label','owner=astra-w112',
                '--network','astra-w112','--cpus','4','--memory','6g','--shm-size','512m',
                '--security-opt','no-new-privileges','--cap-drop','ALL',
                '-e','W112_MAX_STEPS=12','-e',f'W112_GOAL_ID={sid}',
                '-v',f'{frozen}:/source:ro','-v',f'{ROOT}/dist-c7df1b4:/game:ro','-v',f'{out}:/out',
                IMAGE,'/source/pilot.sh']
            started=time.time(); timed_out=False
            write_atomic(out/'launch.json',{'goal':goal,'command':command,'started':started})
            try:
                with (out/'container.txt').open('w') as log:
                    p=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,timeout=1150)
                code=p.returncode
            except subprocess.TimeoutExpired:
                timed_out=True; code=124
                stop_owned(name)
            finally:
                if inspect(name) is not None: stop_owned(name)
            before=out/'browser/before.json'; after=out/'browser/after.json'
            actor=out/'actor.txt'
            row={'id':sid,'exit':code,'elapsed_seconds':time.time()-started,'timed_out':timed_out,
                'actor_started':actor.exists() and actor.stat().st_size>0,
                'before_retained':before.exists(),'after_retained':after.exists(),
                'game_verdict':'pending independent review; actor exit is not outcome acceptance'}
            if after.exists(): row['final_screen']=json.loads(after.read_text()).get('screen')
            rows.append(row)
            write_atomic(out/'collection.json',row)
            write_atomic(BATCH/'progress.json',{'sessions':rows,'completed':False})
            print(json.dumps(row),flush=True)
        write_atomic(BATCH/'progress.json',{'sessions':rows,'completed':True})
    finally:
        current=inspect(MODEL)
        if current and current['Id']==model['Id']:
            stopped=stop_owned(MODEL)
            write_atomic(BATCH/'cleanup.json',{'model_stopped_id':stopped,'time':time.time()})

if __name__=='__main__': main()
