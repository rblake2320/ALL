"""Windows-compatible entrypoint using the canonical level-kit build engine."""
import os
import json
from pathlib import Path
import sys
HERE=Path(__file__).resolve()
sys.path.insert(0,str(HERE.parents[1]))
from levels import build_levels as core,l5_specs,l5_interiors,l5_gallery,l5_grounds,l5_architecture
from common import export,preview,publish_lock

OriginalPaths=core.Paths
class Paths(OriginalPaths):
    def __init__(self,level,out):
        super().__init__(level,out)
        self.manifest=(out if out else core.PUBLIC)/'manifest.mausoleum.json'
        self.preview=(out/'previews' if out else core.ROOT/'tools/blender/out')/'mausoleum'
        self.preview.mkdir(parents=True,exist_ok=True)
        if self.manifest.exists():
            data=json.loads(self.manifest.read_text(encoding='utf-8'))
            rows=data.get('models')
            if data.get('version')!=1 or not isinstance(rows,list):raise ValueError('invalid mausoleum manifest')
            ids=[r.get('id') for r in rows]
            if len(set(ids))!=len(ids) or any(i not in l5_specs.specs() for i in ids) or any(r.get('level')!='mausoleum' for r in rows):
                raise ValueError('unexpected manifest entries must be reviewed before building')
        if self.glb_dir.exists():
            extras=[p.name for p in self.glb_dir.glob('*.glb') if p.stem not in l5_specs.specs()]
            if extras:raise ValueError(f'unrecognized assets must be parked before building: {extras}')
def lock(p):
    return publish_lock.acquire(p.preview/'.mausoleum.lock')

def write_text_atomic(path,text):
    # The receipt's digest must identify the same bytes checked into Git on Windows/Linux.
    data=text.encode('utf-8')
    if path.exists() and path.read_bytes()==data:return False
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name('.'+path.name+'.tmp')
    with open(tmp,'wb') as f:
        f.write(data);f.flush();os.fsync(f.fileno())
    os.replace(tmp,path)
    return True
original_build=core.build_one
original_verify=core.verify
original_publish=core._build_and_publish

def build_and_publish(specs,ids,args,p):
    try:f=lock(p)
    except BlockingIOError:
        print('another build_levels.py is publishing; try again later',file=sys.stderr);return 5
    try:return original_publish(specs,ids,args,p)
    finally:f.close()

def verify(specs,ids,args,p):
    try:f=lock(p)
    except BlockingIOError:
        print('mausoleum build lock held',file=sys.stderr);return 5
    try:return original_verify(specs,ids,args,p)
    finally:f.close()
def build_one(spec,level,args,out,previews):
    result=original_build(spec,level,args,out,None)
    if result['warnings']:raise ValueError('; '.join(result['warnings']))
    entry=result['entry'];entry['tileFootprint']=entry.pop('footprint')
    if previews is not None:
        import bpy
        export.reset_scene()
        with export.quiet():bpy.ops.import_scene.gltf(filepath=str(out/f'{spec.id}.glb'))
        if spec.kind=='item':
            for obj in bpy.context.scene.objects:
                if obj.parent is None:obj.scale*=2;obj.location*=2
        preview.render_preview(previews/f'{spec.id}.png',max(1,round(spec.w)),max(1,round(spec.d)),
                               core.preview_kind(spec),args.res,args.samples)
    return result

if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    if '--only' in args:
        ids=args[args.index('--only')+1].split(',')
        if len(ids)!=len(set(ids)):raise ValueError('duplicate model IDs')
    core.LEVELS={'mausoleum':l5_specs};core.Paths=Paths;core._build_and_publish=build_and_publish;core.build_one=build_one
    core._write_text_atomic=write_text_atomic
    core.verify=verify
    core.SHEET_GROUPS=[(c,(c,)) for c in ('interiors','gallery','grounds','architecture','store','items')]
    raise SystemExit(core.main(['--level','mausoleum','--strict',*args]))
