"""One measured derivative of the native probe; raw output and failures stay intact."""
import datetime, hashlib, json, pathlib, sys
root=pathlib.Path('docs/research/w108')
source=root/'native-smoke-raw/rusty-icebox.json'
raw=json.loads(source.read_text(encoding='utf-8'))
html=(root/'native-smoke-result/candidate.html').read_text(encoding='utf-8')
assert html.count('          segments,')==1
html=html.replace('          segments,','          Math.min(segments, 1),')
marker='    // Color controls for the recolorable Paint materials'
assert html.count(marker)==1
patch='''    // W108 measured cleanup: consolidate paint, fit the target bounds, centre and ground.
    materials.enamel.name = "Paint";
    asset.traverse(node => {
      if (node.isMesh && [materials.enamelSide, materials.enamelLight].includes(node.material)) {
        node.material = materials.enamel;
      }
    });
    asset.updateMatrixWorld(true);
    const beforeBounds = new THREE.Box3().setFromObject(asset);
    const beforeSize = beforeBounds.getSize(new THREE.Vector3());
    asset.scale.setScalar(Math.min(0.8 / beforeSize.x, 1.4 / beforeSize.y, 0.8 / beforeSize.z));
    asset.updateMatrixWorld(true);
    const fittedBounds = new THREE.Box3().setFromObject(asset);
    const fittedCenter = fittedBounds.getCenter(new THREE.Vector3());
    asset.position.set(-fittedCenter.x, -fittedBounds.min.y, -fittedCenter.z);
    asset.updateMatrixWorld(true);
    asset.userData.w108Cleanup = "Paint consolidation, bevel segment cap, uniform fit, centred floor origin";
'''
html=html.replace(marker,patch+'\n'+marker)
raw['response']='```html\n'+html+'\n```'
raw['arm']='native-html-cleaned-derivative'
raw['cleanup']={'parentSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
 'diagnosisWindowStarted':json.loads((root/'native-smoke-result/native-report.json').read_text(encoding='utf-8'))['finishedAt'],
 'patchAppliedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'edits':['cap rounded-box bevel segments at one','merge side/light paint material references into main enamel','rename main material Paint','uniformly fit maximum dimensions','centre X/Z and floor Y'],
 'note':'Elapsed diagnosis/cleanup/retest window, not human hands-on time or only patch execution time; no catalog or bank admission.'}
output=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else root/'native-smoke-cleaned-raw'
output.mkdir(parents=True,exist_ok=False)
(output/'rusty-icebox.json').write_text(json.dumps(raw,indent=2),encoding='utf-8',newline='\n')
print(json.dumps(raw['cleanup'],indent=2))
