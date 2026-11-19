"""Reproduce only the three small manual code unblocks from arm A; never repair geometry."""
import hashlib, json, pathlib, sys

source, output = map(pathlib.Path, sys.argv[1:3])
output.mkdir(parents=True, exist_ok=False)
for name in ['rusty-icebox', 'morgue-locker', 'damned-gramophone']:
    path = source/(name+'.json')
    raw = json.loads(path.read_text(encoding='utf-8-sig'))
    code = raw['response']
    if name == 'rusty-icebox':
        old = 'function roundedBox(w, h, d, r = 0.08, material, parent = group)'
        assert code.count(old) == 1
        code = code.replace(old, old.replace('r = 0.08', 'radiusInput = 0.08'))
        old = 'const r = Math.min(r, w / 2, h / 2, d / 2);'
        assert code.count(old) == 1
        code = code.replace(old, old.replace('Math.min(r,', 'Math.min(radiusInput,'))
    elif name == 'morgue-locker':
        old = '  const cabinet = roundedBox(1.12, 1.72, 0.76, 0.16, steel, 12);'
        assert code.count(old) == 1
        code = code.replace(old, '  const steelLight = materials.steelLight;\n'+old)
    else:
        assert code.startswith('```python\nimport THREE\n') and code.rstrip().endswith('```')
        code = code.removeprefix('```python\nimport THREE\n').rstrip().removesuffix('```').rstrip()
    raw['response'] = code
    raw['cleanup'] = {'kind': 'reproduced minimal manual unblock', 'geometryEdits': 0,
                      'parentSha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    (output/(name+'.json')).write_text(json.dumps(raw, indent=2), encoding='utf-8')
print('Reproduced three code unblocks; no geometry fixes or acceptance claimed.')
