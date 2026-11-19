"""Build W-053 into its own manifest.rotrow.json; common exporter/validation reused.

Blender --background --threads 4 --python-exit-code 1 --python this.py --
  [--only id,id] [--preview] [--verify] [--out assets-root] [--no-ao]
All models in a batch must pass strict validation before any is published.
Existing assets are never pruned. The OS releases the per-output lock on exit.
"""
import argparse
import json
import os
import sys
import tempfile
import traceback
from pathlib import Path

HERE=Path(__file__).resolve()
sys.path.insert(0,str(HERE.parents[1]))
from levels import l3_specs, l3_market, l3_venues, l3_club, l3_street
from levels import build_levels as core

def render_exported(spec,path,previews,args):
    """Preview the shipped bytes after re-import, not the authoring scene."""
    import bpy
    from common import export, preview
    export.reset_scene()
    with export.quiet(): bpy.ops.import_scene.gltf(filepath=str(path))
    if spec.kind in ('item','carry'):
        k=min(8.0,max(1.0,.35/max(spec.w,spec.d,spec.height)))
        for obj in bpy.context.scene.objects:
            if obj.parent is None:
                obj.scale*=k; obj.location*=k
    w,d=(5,5) if spec.kind=='env' else (max(1,round(spec.w)),max(1,round(spec.d)))
    preview.render_preview(previews/f'{spec.id}.png',w,d,core.preview_kind(spec),args.res,args.samples,
                           hide=tuple(spec.states)+('broken',))

def lock(root):
    root.mkdir(parents=True,exist_ok=True)
    f=open(root/'.rotrow-build.lock','a+')
    try:
        if os.name=='nt':
            import msvcrt
            f.seek(0)
            try: msvcrt.locking(f.fileno(),msvcrt.LK_NBLCK,1)
            except OSError as e: raise BlockingIOError(str(e)) from e
        else:
            import fcntl
            fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:
        f.close(); raise
    return f

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only',default='')
    parser.add_argument('--preview',action='store_true')
    parser.add_argument('--verify',action='store_true')
    parser.add_argument('--out')
    parser.add_argument('--no-ao',dest='ao',action='store_false',default=True)
    parser.add_argument('--res',type=int,default=384)
    parser.add_argument('--samples',type=int,default=16)
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    args=parser.parse_args(argv)
    # one exporter per kit (tools/blender/toolchains.json): refuse to publish with another Blender
    import pathlib as _pathlib
    sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parents[1]))
    from common import toolchain as _toolchain
    _toolchain.require('levels/rotrow', scratch=bool(args.out) and not args.verify)
    root=HERE.parents[3]
    assets=Path(args.out).resolve() if args.out else root/'public/assets'
    output=assets/'models/levels/rotrow'
    manifest=assets/'manifest.rotrow.json'
    previews=root/'tools/blender/out/levels/rotrow'
    previews.mkdir(parents=True,exist_ok=True)
    specs=l3_specs.specs()
    ids=args.only.split(',') if args.only else list(specs)
    if len(ids)!=len(set(ids)) or any(i not in specs for i in ids):
        parser.error('unknown or duplicated model ID')
    handle=lock(previews if not args.out else assets)
    try:
        with tempfile.TemporaryDirectory(prefix='rotrow-stage-',dir=previews) as td:
            stage=Path(td)
            rows=[]; errors=[]
            for sid in ids:
                try:
                    result=core.build_one(specs[sid],'rotrow',args,stage,None)
                    if sid=='jukebox_ghoul':
                        # Shared exporter labels procedural sources; retain truthful
                        # provenance for this one generated-and-adapted source.
                        from common import glb, export
                        path=stage/f'{sid}.glb'
                        js,binchunk=glb.read_chunks(path.read_bytes())
                        js['asset']['copyright']='Afterlife Lease; Meshy-generated source, Astra flat-material adaptation'
                        glb.write_glb(path,js,binchunk)
                        result['entry']['sha256']=export.sha256(path)
                        result['entry']['bytes']=path.stat().st_size
                    if args.preview: render_exported(specs[sid],stage/f'{sid}.glb',previews,args)
                except Exception as exc:
                    errors.append(f'{sid}: build failed: {type(exc).__name__}: {exc}')
                    traceback.print_exc()
                    continue
                rows.append(result['entry'])
                errors.extend(f'{sid}: {w}' for w in result['warnings'])
                print(f'{sid}: {result["entry"]["triangles"]}/{specs[sid].budget} tris, {result["entry"]["bytes"]} bytes',flush=True)
            report=dict(models=rows,errors=errors,verify=args.verify)
            if args.verify:
                prior=json.loads(manifest.read_text(encoding='utf-8'))
                byid={e['id']:e for e in prior['models']}
                for e in rows:
                    sid=e['id']
                    if not (output/f'{sid}.glb').exists() or (output/f'{sid}.glb').read_bytes()!=(stage/f'{sid}.glb').read_bytes():
                        errors.append(f'{sid}: rebuild bytes differ')
                    if byid.get(sid)!=e: errors.append(f'{sid}: manifest entry differs')
            if not errors and not args.verify:
                prior=json.loads(manifest.read_text(encoding='utf-8')) if manifest.exists() else {'models':[]}
                merged={e['id']:e for e in prior['models']}
                merged.update({e['id']:e for e in rows})
                output.mkdir(parents=True,exist_ok=True)
                for sid in ids: os.replace(stage/f'{sid}.glb',output/f'{sid}.glb')
                tmp=assets/'.manifest.rotrow.tmp.json'
                tmp.write_text(core.manifest_text(list(merged.values())),encoding='utf-8',newline='\n')
                os.replace(tmp,manifest)
            (previews/('verify.json' if args.verify else 'build.json')).write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
            for err in errors: print('FAILED:',err,file=sys.stderr)
            return 1 if errors else 0
    finally: handle.close()

if __name__=='__main__': sys.exit(main())
