"""Build arithmetic from retained receipts; never infer a pass for a missing gate."""
import hashlib, json, pathlib, sys

root = pathlib.Path(sys.argv[1])
arms = json.loads((pathlib.Path(__file__).with_name('arms.json')).read_text(encoding='utf-8'))
spec = json.loads((pathlib.Path(__file__).with_name('props.json')).read_text(encoding='utf-8'))
expected = {p['id'] for p in spec['props']}
gate_keys = {'nonempty','finite','triangleBudget','materialBudget','dimensions','floor','pivot','paintMaterial','byteIdenticalReexport','roundTripGeometry','lodReduction','lodMeshRetention','lodBounds','lodTopology','pageErrors'}
result = {}
messages = {}
for name, raw_dir, evaluated in [('scene', 'run3-raw', 'arm-a-final'), ('glb', 'run4-raw', 'arm-b-final')]:
    report = root/evaluated/'evaluation-summary.json'
    if not report.exists():
        result[name] = {'outcome': 'Blocked', 'reason': 'complete evaluation not available'}
        continue
    rows = json.loads(report.read_text(encoding='utf-8-sig'))['results']
    assert {r['id'] for r in rows} == expected and len(rows) == 6, 'Incomplete or duplicate sample coverage'
    originals = {p.stem: json.loads(p.read_text(encoding='utf-8-sig')) for p in (root/raw_dir).glob('*.json')}
    assert set(originals) == expected
    for row in rows:
        original = originals[row['id']]
        assert row['sourceResponseSha256'] == hashlib.sha256((root/raw_dir/(row['id']+'.json')).read_bytes()).hexdigest()
        assert original['model_revision'] == arms[name]['revision']
        assert original['prop'] == next(p for p in spec['props'] if p['id'] == row['id'])
        assert original['cudnn_enabled'] is False
        assert row['generationSeconds'] == original['seconds'] > 0
        assert row['generationTokens'] == original['output_tokens'] > 0
        if 'base' in row:
            assert set(row['checks']) == gate_keys
            assert all(type(v) is bool for v in row['checks'].values())
            assert row['geometryOutcome'] == ('Worked' if all(row['checks'].values()) else 'Failed')
        else:
            assert row['geometryOutcome'] == 'Failed'
        key = row['id']
        if key in messages:
            assert original['messages'] == messages[key]['messages'], 'Prompt drift'
            assert original['seed'] == messages[key]['seed'], 'Seed drift'
        messages[key] = original
    keys = sorted(gate_keys)
    gates = {k: {'Worked': sum(r.get('checks', {}).get(k) is True for r in rows),
                 'Failed': sum(r.get('checks', {}).get(k) is False for r in rows),
                 'Blocked_by_earlier_rejection': sum(k not in r.get('checks', {}) for r in rows)} for k in keys}
    seconds = sum(r['generationSeconds'] for r in rows)
    tokens = sum(r['generationTokens'] for r in rows)
    result[name] = {'pin': arms[name], 'samples': 6, 'executable_without_cleanup': sum('base' in r for r in rows),
                    'all_static_gates_worked': sum(r['geometryOutcome'] == 'Worked' for r in rows),
                    'gate_counts': gates, 'generation_seconds': seconds, 'output_tokens': tokens,
                    'output_tokens_per_second': tokens/seconds, 'paid_credits': 0,
                    'production_admitted': 0, 'cost_per_admitted_asset': None,
                    'cost_note': 'No assets admitted; electricity/hardware cost not measured.',
                    'rows': rows}
output = root/'comparison.json'
output.write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps({k:{n:v for n,v in arm.items() if n not in ['rows','gate_counts','pin']} for k,arm in result.items()}, indent=2))
