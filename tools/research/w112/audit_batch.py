"""Read retained W112 receipts; never promote actor exit or model prose to a gameplay verdict."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rows(path):
    with path.open(encoding='utf-8') as f:
        return [json.loads(line) for line in f if line.strip()]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('batch', type=Path)
    parser.add_argument('out', type=Path)
    args = parser.parse_args()
    root, out = args.batch, args.out
    out.mkdir(parents=True, exist_ok=False)
    provenance = read(root/'provenance.json')
    progress = read(root/'progress.json')
    goals = read(root/'source/goals.json')
    checks, sessions = [], []

    def check(name, condition):
        checks.append({'check': name, 'worked': bool(condition)})

    check('collector completed exactly ten named goals', progress['completed'] and
          [r['id'] for r in progress['sessions']] == [g['id'] for g in goals] and len(goals) == 10)
    check('cleanup names the launched model container',
          read(root/'cleanup.json')['model_stopped_id'] == provenance['model_container_id'])
    for name, expected in provenance['source_sha256'].items():
        check('frozen source hash '+name, sha(root/'source'/name) == expected)
    shutil.copytree(root/'source', out/'source')
    for name in ['provenance.json', 'progress.json', 'cleanup.json']:
        shutil.copyfile(root/name, out/name)

    for goal in goals:
        sid = goal['id']
        folder = root/sid
        dest = out/sid
        dest.mkdir()
        before, after = read(folder/'browser/before.json'), read(folder/'browser/after.json')
        steps_path = folder/'artifacts'/sid/'steps.jsonl'
        steps, states = rows(steps_path), rows(folder/'browser/states.jsonl')
        events = rows(folder/'browser/browser-events.jsonl')
        hashes = {}
        for name in ['launch.json', 'collection.json', 'actor.exit', 'actor.txt',
                     'browser/before.json', 'browser/after.json', 'browser/before.png',
                     'browser/after.png', 'browser/browser-events.jsonl']:
            target = dest/name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(folder/name, target)
            hashes[name] = sha(folder/name)
        hashes['raw_steps.jsonl'] = sha(steps_path)
        hashes['raw_states.jsonl'] = sha(folder/'browser/states.jsonl')
        compact_steps, tool_errors = [], []
        for step in steps:
            result_by_id = {r['tool_call_id']: r for r in step.get('tool_results', [])}
            for call in step.get('assistant_tool_calls', []):
                result = result_by_id.get(call['id'])
                check(sid+' paired tool '+call['id'], result is not None)
                if result is not None and result.get('is_error'):
                    tool_errors.append({'call': call, 'content': result.get('content')})
            compact_steps.append({
                k: step.get(k) for k in ['session_step', 'status', 'assistant_text',
                                        'assistant_tool_calls', 'terminal_decision']})
            compact_steps[-1]['tool_results'] = [
                {k: r.get(k) for k in ['tool_call_id', 'name', 'content', 'status', 'is_error', 'raw_image_path']}
                for r in step.get('tool_results', [])]
        (dest/'steps-no-images.json').write_text(json.dumps(compact_steps, indent=2), encoding='utf-8')
        # Retain distinct observed world/UI states with their real observation times.
        # Images/LLM request bodies are omitted here, not deleted from the raw archive.
        timeline = []
        previous = None
        for sample in states:
            state = sample['state']
            projection = {k: state.get(k) for k in ['screen', 'mode', 'funds', 'objects', 'walls', 'placing', 'moving', 'tool', 'preview', 'ghost']}
            if projection != previous:
                timeline.append({'time': sample['time'], 'state': projection})
                previous = projection
        (dest/'world-transitions.json').write_text(json.dumps(timeline, indent=2), encoding='utf-8')
        health_errors = [e for e in events if e['kind'] in ['fatal', 'pageerror', 'requestfailed'] or
                         e['kind'] == 'console' and e['detail'].get('type') == 'error']
        old, new = before.get('objects') or {}, after.get('objects') or {}
        added = {k: v for k, v in new.items() if k not in old}
        removed = {k: v for k, v in old.items() if k not in new}
        moved = {k: {'before': old[k].get('placement'), 'after': v.get('placement')}
                 for k, v in new.items() if k in old and old[k].get('placement') != v.get('placement')}
        decision = steps[-1].get('terminal_decision') if steps else None
        actor_text = (folder/'actor.txt').read_text(encoding='utf-8')
        # The terminal summary may be emitted after the last recorded tool step.
        terminal = 'empty_response' if 'empty_response' in actor_text else 'max_steps' if 'max_steps' in actor_text else 'inspect raw log'
        is_story_shack = before.get('funds') == 2500 and 'coffin_pine' in [o['defId'] for o in old.values()] and 'THE CONDEMNED SHACK' in before.get('bodyText', '')
        sessions.append({
            'id': sid, 'goal': goal, 'actorExit': int((folder/'actor.exit').read_text()),
            'terminalReason': terminal, 'lastStepDecision': decision, 'steps': len(steps),
            'initialScreen': before.get('screen'), 'finalScreen': after.get('screen'),
            'initialFunds': before.get('funds'), 'finalFunds': after.get('funds'),
            'claimedStarterButObservedStoryShack': goal['setup']=='starter' and is_story_shack,
            'addedObjects': added, 'removedObjects': removed, 'movedObjects': moved,
            'wallCountBefore': len(before.get('walls') or {}), 'wallCountAfter': len(after.get('walls') or {}),
            'observationSamples': len(states), 'distinctWorldUiStates': len(timeline),
            'toolErrors': tool_errors, 'browserHealthErrors': health_errors,
            'hashes': hashes, 'gameplayVerdict': 'not assigned by this collector; inspect actual transitions and goal requirements',
        })
        check(sid+' collection matches actor exit', read(folder/'collection.json')['exit'] == sessions[-1]['actorExit'])
        check(sid+' monotonic observer records', len(states)>1 and all(b['time']>=a['time'] for a,b in zip(states,states[1:])))
    report = {'scope':'Receipt integrity and observed deltas, not gameplay acceptance',
              'sourceArchiveSha256':'bce8fc39e48d2ad1fa9619227d1fe11d0deed4b30d23c32f63b1cfcf48db738c',
              'gamePin':provenance['game_pin'], 'checks':checks,
              'worked':sum(c['worked'] for c in checks), 'failed':sum(not c['worked'] for c in checks),
              'sessions':sessions}
    (out/'audit.json').write_text(json.dumps(report,indent=2), encoding='utf-8')
    print(json.dumps({'worked':report['worked'],'failed':report['failed'],'sessions':[
        {k:r[k] for k in ['id','terminalReason','steps','claimedStarterButObservedStoryShack','initialFunds','finalFunds','addedObjects','removedObjects','movedObjects']}
        for r in sessions]}))


if __name__ == '__main__':
    main()
