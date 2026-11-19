"""Check retained local-model evidence identity, not semantic correctness."""
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1])
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
cfg=read(root/'input.json'); progress=read(root/'progress.json'); guard=read(root/'guard.json')
assert progress['state']=='complete','batch not complete'
topics={t['id']:t for t in cfg['topics']}
assert len(topics)==len(cfg['topics'])==10,'topic coverage mismatch'
assert len(progress['finished'])==len(topics),'result count mismatch'
assert {r['id'] for r in progress['finished']}==set(topics),'missing/extra topic'
checks=[]
for row in progress['finished']:
    ident=row['id'];raw=read(root/'raw'/f'{ident}-0.json');packet=read(root/'draft-packets'/f'{ident}.json')
    assert row['status']=='generated-review-pending','draft status changed'
    assert raw['done'] and raw['done_reason']!='length','truncated generation'
    assert hashlib.sha256(raw['response'].encode()).hexdigest()==row['sha256'],'response hash mismatch'
    assert json.loads(raw['response'])==packet,'draft differs from raw response'
    assert packet['topic_id']==ident,'topic mismatch'
    assert all(f['source_id'] in topics[ident]['sources'] for f in packet['facts']),'unallowed citation'
    assert len(packet['acceptance'])>=2,'missing acceptance scenarios'
    checks.append(ident)
sources=read(root/'source-receipts.json')
assert {s['id'] for s in sources}=={s['id'] for s in cfg['sources']},'source coverage mismatch'
assert all(s.get('usable') or s.get('fallback') for s in sources),'silent source failure'
assert guard['server_exit']==0 and not guard['stopped'],'worker guard/server failure'
print(json.dumps({'worked':True,'topics':checks,'source_count':len(sources),'full_fetches':sum(bool(s['usable']) for s in sources),'semantic_review':'separate: raw model drafts remain unapproved'},indent=2))
