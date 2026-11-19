"""Check final receipt/source/artifact bindings without running model-generated code."""
import hashlib, json, pathlib, subprocess, sys

root=pathlib.Path(sys.argv[1]).resolve()
repo=pathlib.Path(__file__).resolve().parents[3]
tools=repo/'tools/research/w108'
checks=[]
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path): return json.loads(path.read_text(encoding='utf-8-sig'))
def check(name,condition):
    checks.append({'check':name,'outcome':'Worked' if condition else 'Failed'})
    if not condition: raise AssertionError(name)

for run in ['run3','run4','native-smoke']:
    log=root/'evidence'/(run+'.log')
    if not log.exists():
        check(run+' completed log available',False)
    header=json.loads(log.read_text(encoding='utf-8').splitlines()[0])
    check(run+' launched inference snapshot',header['script_sha256']==sha(root/'evidence'/('infer-'+run+'.py')))
    check(run+' exact prop specification',header['props_sha256']==sha(tools/'props.json'))
    check(run+' exit0',(root/'evidence'/(run+'.exit')).read_text(encoding='utf-8').strip()=='0')
    check(run+' completion marker',any('"event": "batch_complete"' in line for line in log.read_text(encoding='utf-8').splitlines()))

for output,input_dir in [('arm-a-final','run3-raw'),('arm-b-final','run4-raw'),('arm-a-cleaned-final-v2','arm-a-cleanup-reproduced')]:
    report=read(root/output/'evaluation-summary.json')
    check(output+' evaluator binding',report['provenance']['evaluatorSha256']==sha(tools/'evaluate.mjs'))
    check(output+' LOD helper binding',report['provenance']['lodHelperSha256']==sha(tools/'lod.mjs'))
    check(output+' props binding',report['provenance']['propsSha256']==sha(tools/'props.json'))
    for row in report['results']:
        stem=row['id'];check(output+'/'+stem+' original response',row['sourceResponseSha256']==sha(root/input_dir/(stem+'.json')))
        if 'sha256' in row:
            check(output+'/'+stem+' GLB binding',row['sha256']==sha(root/output/(stem+'.glb')))
            check(output+'/'+stem+' LOD binding',row['lodSha256']==sha(root/output/(stem+'.lod1.glb')))
            check(output+'/'+stem+' nonempty preview',(root/output/(stem+'.png')).stat().st_size>1000)

for download in ['download-receipt.json','glb-download-receipt.json']:
    rows=read(root/'evidence'/download)['files']
    check(download+' all upstream digests checked',len(rows)>10 and all(r['upstream_digest_verified'] for r in rows))
    check(download+' weights present',any(r['file'].endswith('.safetensors') for r in rows))

for native_dir,input_dir in [('native-raw-final','native-smoke-raw'),('native-cleaned-final','native-smoke-cleaned-raw')]:
    row=read(root/native_dir/'native-report.json')
    check(native_dir+' harness binding',row['harnessSha256']==sha(tools/'native_html.mjs'))
    check(native_dir+' LOD helper binding',row['lodHelperSha256']==sha(tools/'lod.mjs'))
    check(native_dir+' original response binding',row['sourceResponseSha256']==sha(root/input_dir/'rusty-icebox.json'))
    if 'sha256' in row:
        check(native_dir+' GLB binding',row['sha256']==sha(root/native_dir/'native-1.glb'))
        check(native_dir+' independent rebuild binding',row['repeatSha256']==sha(root/native_dir/'native-2.glb'))
    check(native_dir+' exported LOD meshes retained',row['checks']['lodMeshRetention'])
    check(native_dir+' LOD topology retained',row['checks']['lodTopology'])

# Exact bytes must survive Git's checkout rules; receipt SHA256s are not normalized text hashes.
tree=subprocess.check_output(['git','ls-tree','-r','HEAD','docs/research/w108','tools/research/w108'],cwd=repo).decode('utf-8')
checked=0
tracked=set()
for line in tree.splitlines():
    meta,name=line.split('\t',1);expected=meta.split()[2];file=repo/name
    tracked.add(name)
    if not file.exists():continue
    content=file.read_bytes();actual=hashlib.sha1(f'blob {len(content)}\0'.encode()+content).hexdigest()
    if actual!=expected:
        # A changed working file is checked after the final commit, not silently accepted.
        check('Git byte preservation '+name,False)
    checked+=1
check('tracked bundle preserves exact bytes',checked>100)
manifest=[]
for prefix in [root,tools]:
    for file in sorted(prefix.rglob('*')):
        if file.is_file() and '__pycache__' not in file.parts and 'node_modules' not in file.parts and file.name not in ['bundle-audit.json','bundle-manifest.json']:
            relative=file.relative_to(repo).as_posix()
            check('bundle file retained in Git '+relative,relative in tracked)
            manifest.append({'path':relative,'bytes':file.stat().st_size,'sha256':sha(file)})
(root/'bundle-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8',newline='\n')
result={'outcome':'Worked','sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo).decode().strip(),'checks':checks,'trackedFilesByteChecked':checked,'manifestEntries':len(manifest)}
(root/'bundle-audit.json').write_text(json.dumps(result,indent=2),encoding='utf-8',newline='\n')
print(json.dumps({'outcome':'Worked','checks':len(checks),'trackedFilesByteChecked':checked,'manifestEntries':len(manifest)}))
