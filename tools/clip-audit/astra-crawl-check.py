"""Checks recorded request-F samples, including controls and exact reported reproduction."""
import hashlib
import json
from pathlib import Path

out = Path('docs/research/crawl-diagnostic')
report = json.loads((out / 'report.json').read_text(encoding='utf-8'))
rows = [json.loads(line) for line in (out / 'samples.jsonl').read_text(encoding='utf-8').splitlines()]
groups = {}
for row in rows:
    groups.setdefault(row['id'], []).append(row)
checks = []
def check(name, ok):
    checks.append({'name': name, 'worked': bool(ok)})
    assert ok, name

check('24 runtime cases plus raw clip control', len(groups) == 25)
check('no fallback warnings', report['warnings'] == [])
for body in ['classic', 'shield']:
    for height in [0, 0.5, 1]:
        prefix = f'{body}@h{height}'
        direct = groups[prefix + ':crawl-legless']
        resolved = groups[prefix + ':walk-legless']
        check(prefix + ' walk resolves same crawl geometry',
              [(r['t'], r['minY'], r['bones']) for r in direct] ==
              [(r['t'], r['minY'], r['bones']) for r in resolved])
        check(prefix + ' cycle covered including end', len(direct) >= 193 and direct[0]['t'] == 0)
        check(prefix + ' root remains floor zero', all(r['rootY'] == 0 for r in direct))
        check(prefix + ' minima belong to referenced triangles', all(abs(r['minY'] - r['referencedMinY']) < 1e-8 for r in direct))
        check(prefix + ' hand bone origins above floor', all(min(r['bones']['hand_L'], r['bones']['hand_R']) > 0 for r in direct))
at2 = next(r for r in groups['shield@h1:crawl-legless'] if r['t'] == 2)
check('Terra 413.8 mm reproduces within 0.05 mm', abs(at2['minY'] * 1000 + 413.8) < 0.05)
check('t=2 is end clamp, not a loop at 0.4', 1.599 < at2['effectiveTime'] < 1.6)
check('raw classic hands above floor', all(min(r['bones']['hand_L'], r['bones']['hand_R']) > 0 for r in groups['raw-zombie-glb:crawl']))
lift = report['liftControl']
check('root lift grounds lowest vertex', abs(lift['minY']) < 1e-8)
check('root lift floats both hand origins above 0.5m', min(lift['bones']['hand_L'], lift['bones']['hand_R']) > 0.5)
for path, expected in report['assets'].items():
    check('asset hash ' + path, hashlib.sha256((Path('public/assets') / path).read_bytes()).hexdigest() == expected)
result = {'worked': len(checks), 'failed': 0, 'checks': checks,
          'files': {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in
                    [out / 'report.json', out / 'samples.jsonl', Path(__file__),
                     Path('tools/clip-audit/astra-crawl-diagnostic.ts'), Path('tools/clip-audit/astra-crawl-shots.ts')]}}
(out / 'checks.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(f'{len(checks)} checks Worked')
