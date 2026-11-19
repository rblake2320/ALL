"""Check the sealed S4 receipts and optional current tracked source identity."""
import argparse, hashlib, json, subprocess
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument('--current-sources', action='store_true')
args = ap.parse_args()
root = Path(__file__).resolve().parents[2]
evidence = root / 'docs/desktop-reports/sol-world-stream-evidence'
seal = json.loads((evidence / 'seal.json').read_text(encoding='utf-8'))
actual = {p.relative_to(evidence).as_posix() for p in evidence.rglob('*') if p.is_file() and p.name != 'seal.json'}
assert actual == set(seal['files']), 'Evidence file set differs'
for name, digest in seal['files'].items():
    assert hashlib.sha256((evidence / name).read_bytes()).hexdigest() == digest, name
provenance = json.loads((evidence / 'provenance.json').read_text(encoding='utf-8'))
for name, digest in provenance['sourceFiles'].items():
    data = (root / name).read_bytes() if args.current_sources else subprocess.check_output(['git', 'show', provenance['sourceCommit'] + ':' + name], cwd=root)
    assert hashlib.sha256(data).hexdigest() == digest, name
assert subprocess.check_output(['git', 'diff', provenance['handoffCommit'], provenance['sourceCommit'], '--', 'src'], cwd=root) == b'', 'Runtime source changed after handoff'
for name, tokens in {
    'full-suite-before.txt': ['305 passed', '4 skipped', '6234 passed', '14 skipped'],
    'privacy.txt': ['10 passed', 'stream.privacy.test.ts'],
    'feature-gates-final.txt': ['world-streaming        27 passed, 0 failed', 'PASS      gate:typecheck', 'PASS      gate:build'],
    'merged-home-assets.txt': ['57 passed'],
    'source-assets.txt': ['412 asset(s) verified across 14 manifest(s), 0 error(s)'],
    'built-assets.txt': ['412 asset(s) verified across 14 manifest(s), 0 error(s)'],
}.items():
    text = (evidence / name).read_text(encoding='utf-8')
    for token in tokens:
        assert token in text, (name, token)
print(json.dumps({'status': 'Worked', 'sealedFiles': len(seal['files']), 'sourceFiles': len(provenance['sourceFiles']), 'currentSources': args.current_sources}))
