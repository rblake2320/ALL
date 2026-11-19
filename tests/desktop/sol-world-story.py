"""Built-game story-start and save/resume acceptance; private Chrome AMD profile, no shared saves.
Uses DOM input for the new-game flow, public controller commands for edits/save, and read-only world inspection.
"""
import argparse, hashlib, json, runpy, subprocess, time, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
a = ap.parse_args()
out = Path(a.out)
out.mkdir(parents=True, exist_ok=False)
here = Path(__file__).resolve().parent
amd = next(x for x in runpy.run_path(str(here / 'sol-dxgi.py'))['adapters']() if x['vendor'] == 4098)
wait_preview = runpy.run_path(str(here / 'sol-a11y-health.py'))['wait_preview']
def hashes():
    return {p.relative_to('dist').as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in Path('dist').rglob('*') if p.is_file()}
report = dict(pin=subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(), bundle=hashes(), cases=[], errors=[], source=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
assert not subprocess.check_output(['git', 'diff', 'HEAD', '--', 'src']), 'Dirty product source'
def save():
    (out / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
def until(page, fn, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if page.evaluate(fn): return
        page.wait_for_timeout(100)
    raise TimeoutError(fn)
def state(page):
    return page.evaluate('()=>JSON.parse(JSON.stringify(window.__afterlife.game.sim.state))')
def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

with (out / 'preview.log').open('w') as log:
    server = subprocess.Popen(['node', 'node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '43963', '--strictPort'], stdout=log, stderr=log)
    try:
        url = 'http://127.0.0.1:43963/'
        report['served'] = wait_preview(server, url, out / 'preview.log', report['bundle'])
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True, args=['--mute-audio', '--use-angle=d3d11', f"--use-adapter-luid={amd['luid']}"])
            report['browserVersion'] = browser.version
            try:
                for index in range(2):
                    ctx = browser.new_context(viewport=dict(width=1280, height=720))
                    try:
                        page = ctx.new_page()
                        page.on('pageerror', lambda e: report['errors'].append(str(e)))
                        page.on('console', lambda m: report['errors'].append(m.text) if m.type == 'error' else None)
                        page.goto(url, wait_until='networkidle')
                        # This journey edits a typed name: answer the normal age question as an adult first.
                        page.locator('.st-age-dialog .st-age__input').fill('1990')
                        page.get_by_test_id('age-continue').click()
                        until(page, "()=>!document.querySelector('.st-age-dialog')")
                        until(page, "()=>window.__afterlife.game.screen==='menu'")
                        page.evaluate("()=>window.__afterlife.game.updateSettings({quality:'low',reduceMotion:true,tutorialEnabled:false,autonomy:'off'})")
                        page.locator('.sh-menu__item').filter(has_text='New Game').click()
                        selected = page.locator('.sh-lots [role="radio"][aria-checked="true"]').get_attribute('data-lot')
                        assert selected == 'derelict', f'Default story lot: {selected}'
                        page.get_by_role('button', name='Create your household').click()
                        until(page, "()=>window.__afterlife.game.screen==='caz' && !!document.querySelector('.sh-editor__start')")
                        page.locator('.sh-editor__start').click()
                        until(page, "()=>window.__afterlife.game.screen==='game' && !!window.__afterlife.game.sim")
                        page.evaluate('()=>window.__afterlife.game.setSpeed(0)')
                        before = state(page)
                        town = before['town']
                        assert town['start'] and town['start']['templateId'] in ['derelict', 'derelict_lean', 'derelict_lshape'] and not town['legacyHome'] and not town['expandPending'], f'Story town: {town}'
                        assert town['homeLotId'].endswith(town['start']['slotId']), 'Generated home slot disagrees with its start pick'
                        edit = page.evaluate("name=>window.__afterlife.game.renameHousehold(name)", f'Story Resume {index + 1}')
                        assert edit['ok'], edit
                        result = page.evaluate('async()=>{const g=window.__afterlife.game;g.setSpeed(0);return g.saveGame()}')
                        assert result['ok'], result
                        saved = state(page)
                        page.reload(wait_until='networkidle')
                        until(page, "()=>window.__afterlife.game.screen==='menu'")
                        assert page.evaluate('async()=>{const g=window.__afterlife.game;const ok=await g.continueLatest();if(g.sim)g.setSpeed(0);return ok}'), 'Continue refused the saved story world'
                        restored = state(page)
                        assert digest(restored) == digest(saved), 'Save/resume changed the world'
                        health = page.evaluate("()=>{const g=window.__afterlife.game,gl=document.querySelector('#game-canvas').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return {fatal:g.fatalError,renderer:gl.getParameter(e.UNMASKED_RENDERER_WEBGL),lost:gl.isContextLost(),faults:g.sim.faults()}}")
                        assert health['fatal'] is None and not health['lost'] and not health['faults'] and 'AMD' in health['renderer'], health
                        home = {k: v for k, v in saved['objects'].items() if not v.get('regionId') or v['regionId'] == town['homeLotId']}
                        # Geometry identity excludes object IDs, revisions, condition and gameplay data.
                        lot = {k: saved['lot'][k] for k in ['width', 'depth', 'buildable', 'sidewalkZ', 'entryPoints', 'floors']}
                        lot['walls'] = {edge: dict(paint=wall['paint'], opening=home.get(wall['openingId'], {}).get('defId')) for edge, wall in saved['lot']['walls'].items()}
                        layout = dict(lot=lot, objects=sorted([dict(defId=o['defId'], placement=o['placement'], tint=o.get('tint')) for o in home.values() if o['placement']['kind'] in ['floor', 'wall', 'opening']], key=lambda o: json.dumps(o, sort_keys=True)))
                        report['cases'].append(dict(status='Worked', seed=saved['seed'], start=town['start'], homeLotId=town['homeLotId'], geometry=digest(layout), savedSha256=digest(saved), restoredSha256=digest(restored), health=health))
                        page.screenshot(path=str(out / f'story-{index + 1}.png'))
                        save()
                    except Exception:
                        report['failureState'] = page.evaluate("()=>{const g=window.__afterlife?.game;return {screen:g?.screen,caz:g?.caz,world:g?.sim?.state,toasts:g?.toasts,fatal:g?.fatalError}}")
                        page.screenshot(path=str(out / 'failure.png'))
                        raise
                    finally:
                        ctx.close()
                # Additional actual built-game old-save journey: the genuine pre-cap four-pet export.
                import base64
                legacy_bytes = Path('tests/fixtures/world-batch-pets/pets-four-v2.alsave').read_bytes()
                expected_pets = json.loads(legacy_bytes)['payload']['pets']
                expected_pets['pets'] = [dict(pet, variant=pet.get('variant', 'normal')) for pet in expected_pets['pets']]
                legacy_ctx = browser.new_context(viewport=dict(width=1280, height=720))
                try:
                    legacy_page = legacy_ctx.new_page()
                    legacy_page.on('pageerror', lambda e: report['errors'].append(str(e)))
                    legacy_page.on('console', lambda m: report['errors'].append(m.text) if m.type == 'error' else None)
                    legacy_page.goto(url, wait_until='networkidle')
                    legacy_page.get_by_role('button', name='Not now', exact=True).click()
                    until(legacy_page, "()=>window.__afterlife.game.screen==='menu'")
                    imported = legacy_page.evaluate("""async b64=>{const g=window.__afterlife.game;g.updateSettings({quality:'low',reduceMotion:true,tutorialEnabled:false,autonomy:'off'});const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const r=await g.importSave(new File([bytes],'pets-four-v2.alsave'));let ok=!!r&&r.ok!==false;if(ok&&!g.sim)ok=await g.continueLatest();if(g.sim)g.setSpeed(0);return {ok,error:r?.error,fatal:g.fatalError}}""",base64.b64encode(legacy_bytes).decode())
                    assert imported['ok'] and imported['fatal'] is None, imported
                    before_legacy = state(legacy_page)
                    assert len(before_legacy['pets']['pets']) == 4
                    assert digest(before_legacy['pets']) == digest(expected_pets), 'Built import changed legacy animals'
                    legacy_page.evaluate("()=>window.__afterlife.game.openDialog('household')")
                    legacy_page.get_by_test_id('household-pets').wait_for()
                    for pet in expected_pets['pets']:
                        row = legacy_page.get_by_test_id('pet-'+pet['id'])
                        assert row.count() == 1 and pet['name'] in row.inner_text(), pet
                        care = row.locator('button:not([data-testid^="pet-look-"])')
                        assert care.count() == 3, pet
                        assert all(care.nth(i).is_enabled() for i in range(3)), pet
                        assert row.get_by_test_id('pet-look-normal').get_attribute('aria-pressed') == 'true', pet
                    legacy_page.screenshot(path=str(out/'legacy-four-household.png'))
                    # A locked cosmetic cannot change the grandfathered pet, and all four real care bindings work.
                    first_row = legacy_page.get_by_test_id('pet-'+expected_pets['pets'][0]['id'])
                    first_row.get_by_test_id('pet-look-undead').click()
                    assert digest(state(legacy_page)['pets']) == digest(expected_pets), 'Locked look changed an animal'
                    care_completed = []
                    for pet in expected_pets['pets']:
                        row = legacy_page.get_by_test_id('pet-'+pet['id'])
                        affection = next(p['needs']['affection'] for p in state(legacy_page)['pets']['pets'] if p['id'] == pet['id'])
                        row.get_by_role('button', name='Cuddle', exact=True).click()
                        legacy_page.evaluate("()=>{const g=window.__afterlife.game;g.closeDialog();g.setSpeed(3)}")
                        until(legacy_page, "()=>{const s=window.__afterlife.game.sim.state,id="+json.dumps(pet['id'])+";return !s.pets.pending.some(p=>p.targetId===id)&&s.pets.pets.find(p=>p.id===id)?.needs.affection>"+json.dumps(affection)+"}")
                        legacy_page.evaluate("()=>window.__afterlife.game.setSpeed(0)")
                        cared = next(p for p in state(legacy_page)['pets']['pets'] if p['id'] == pet['id'])
                        assert cared['needs']['affection'] > affection, f'Cuddle did not complete for {pet["id"]}'
                        care_completed.append(pet['id'])
                        legacy_page.evaluate("()=>window.__afterlife.game.openDialog('household')")
                    legacy_page.screenshot(path=str(out/'legacy-four-after-care.png'))
                    legacy_page.evaluate("()=>window.__afterlife.game.closeDialog()")
                    assert legacy_page.evaluate("async()=>{const r=await window.__afterlife.game.saveGame();return r.ok}"), 'Legacy save refused'
                    saved_legacy = state(legacy_page)
                    legacy_page.reload(wait_until='networkidle')
                    until(legacy_page,"()=>window.__afterlife.game.screen==='menu'")
                    assert legacy_page.evaluate("async()=>{const g=window.__afterlife.game;const r=await g.continueLatest();if(g.sim)g.setSpeed(0);return r}"), 'Legacy Continue refused'
                    restored_legacy = state(legacy_page)
                    assert digest(saved_legacy)==digest(restored_legacy), 'Built four-pet save/resume changed the world'
                    report['legacyFour'] = dict(status='Worked', ids=[pet['id'] for pet in restored_legacy['pets']['pets']], petsSha256=digest(restored_legacy['pets']), savedSha256=digest(saved_legacy), restoredSha256=digest(restored_legacy), visibleCareButtons=12, careCompleted=care_completed, importedPetsSha256=digest(expected_pets))
                    save()
                except Exception:
                    try:
                        report['legacyFourFailure'] = legacy_page.evaluate("()=>{const g=window.__afterlife?.game;return {screen:g?.screen,world:g?.sim?.state,toasts:g?.toasts,fatal:g?.fatalError}}")
                        legacy_page.screenshot(path=str(out/'legacy-four-failure.png'))
                        save()
                    except Exception as capture_error:
                        report['legacyFourCaptureError'] = str(capture_error)
                    raise
                finally:
                    legacy_ctx.close()
                assert report['cases'][0]['seed'] != report['cases'][1]['seed']
                assert report['cases'][0]['start'] != report['cases'][1]['start']
                assert not report['errors'], report['errors']
                assert hashes() == report['bundle'], 'Bundle changed during run'
                report['status'] = 'Worked'
            finally:
                browser.close()
    except Exception as e:
        report['status'] = 'Failed'
        report['error'] = str(e)
        report['traceback'] = traceback.format_exc()
    finally:
        server.terminate()
        server.wait(timeout=10)
        save()
print(json.dumps(dict(status=report['status'], cases=len(report['cases']), error=report.get('error'))))
raise SystemExit(0 if report['status'] == 'Worked' else 1)
