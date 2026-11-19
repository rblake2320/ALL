"""Publish selected W064 evidence, preserving private originals and both hashes."""
import argparse, hashlib, json, subprocess
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument('--raw', required=True)
ap.add_argument('--out', required=True)
a = ap.parse_args()
raw, out = Path(a.raw), Path(a.out)
out.mkdir(parents=True, exist_ok=False)
complete = {'main6', 'contrast2', 'store1', 'zoom2', 'zoom4'}
diagnostic = {'main1', 'main2', 'main3', 'main4', 'main5', 'contrast1', 'zoom1', 'zoom3'}
selected = []
for name in sorted(complete | diagnostic):
    for p in sorted((raw / name).iterdir()):
        if p.is_file() and (name in complete or p.name in {'report.json', 'launched-harness.py', 'launched-health.py', 'blocked-ax.json', 'blocked.jpg'}):
            selected.append(p)
selected += [p for p in sorted(raw.iterdir()) if p.is_file() and (p.name.endswith('-driver.txt') or p.name in {'host.json', 'npm-ci.txt', 'build-after-ci.txt', 'build-current.txt', 'feature-check.txt', 'run-pin-map.json'})]
variants = set()
for v in (str(Path.cwd()), str(Path.home())):
    for s in (v, v.replace('\\', '/')):
        variants.update((s, s.replace('\\', '\\\\')))
variants = sorted(variants, key=len, reverse=True)
rows = []
for p in selected:
    original = p.read_bytes()
    published = original
    if p.suffix.lower() in {'.json', '.txt', '.log', '.py'}:
        text = original.decode('utf-8-sig')
        for v in variants:
            text = text.replace(v, '<local-path>')
        # Only change bytes when a host path actually occurs; retain BOM/newlines otherwise.
        if text != original.decode('utf-8-sig'):
            published = text.encode('utf-8')
    rel = p.relative_to(raw)
    dest = out / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(published)
    rows.append(dict(path=rel.as_posix(), originalSha256=hashlib.sha256(original).hexdigest(), sha256=hashlib.sha256(published).hexdigest(), originalBytes=len(original), bytes=len(published), pathScrubbed=published != original))
seal = dict(format='sol-w064-evidence-v1', gamePin=subprocess.check_output(['git', 'rev-parse', '3b75d97'], text=True).strip(), sourceFixPin=subprocess.check_output(['git', 'rev-parse', '24ee342'], text=True).strip(), policy='Private originals retained. Published text substitutes local repository/home paths only. Outcomes, numbers and failures are unchanged. Diagnostic runs retain reports, launched source and any blocked-state artifacts; completed acceptance runs retain full files.', files=rows)
(out / 'seal.json').write_text(json.dumps(seal, indent=2) + '\n', encoding='utf-8')
print(json.dumps(dict(files=len(rows), bytes=sum(r['bytes'] for r in rows), scrubbed=sum(r['pathScrubbed'] for r in rows))))
