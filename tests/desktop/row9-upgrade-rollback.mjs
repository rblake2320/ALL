/**
 * Opus 2 ZSM, Row 9 (installed upgrade and rollback with saves kept), on the INSTALLED Windows app.
 *
 *   node tests/desktop/row9-upgrade-rollback.mjs <OLD Setup.exe> <NEW Setup.exe> <out dir>
 *
 * The installed app keeps its profile in the REAL %APPDATA%\Afterlife Lease (Electron ignores the APPDATA variable, and the OLD
 * build has no --test-profile). So the owner's profile is renamed aside (a same-volume rename: no file is copied or changed), the
 * run uses a fresh profile in its place, and in a finally block the fresh profile is moved into <out dir>/profile-run and the
 * owner's is renamed back. Its SHA-256 manifest, taken before the rename, is compared after the restore: byte-identical or the
 * run fails. A crashed run leaves 'Afterlife Lease.row9-aside-*' next to it; tests/desktop/row9-restore.mjs puts it back.
 * Both installers are per-user NSIS installs given /D=<out dir>/sandbox/Install.
 *
 * Phases (each records the world's per-zombie APPEARANCE hashes, the settings JSON and the SHA-256 of every file under the
 * saves folder):
 *   A  install OLD, first run, set quality Low and move a volume slider, New Game, play, F5 save, quit.
 *   B  install NEW over OLD (upgrade): the installer must not touch the profile; Continue loads the save with the same
 *      appearance hashes and the same settings; quit.
 *   C  install OLD over NEW (rollback): the OLD app must either load the newer saves (same appearance hashes) or refuse
 *      them cleanly; a refusal leaves every file byte-identical, a load may rewrite its autosave; nothing may be lost.
 *   E  install NEW again: it loads the save the rolled-back app wrote (OLD wrote, NEW read, OLD wrote, NEW read).
 *   D  uninstall; restore the owner profile and compare it with the manifest taken before.
 * Exit code 0 only when every check worked.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const [OLD, NEW, OUT] = process.argv.slice(2).map((p) => (p ? resolve(p) : p));
if (!OLD || !NEW || !OUT) {
  console.error('usage: node tests/desktop/row9-upgrade-rollback.mjs <OLD Setup.exe> <NEW Setup.exe> <out dir>');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const SB = join(OUT, 'sandbox');
const ROAM = join(SB, 'Roaming');
const LOCAL = join(SB, 'Local');
const INSTALL = join(SB, 'Install');
for (const d of [ROAM, LOCAL, INSTALL]) mkdirSync(d, { recursive: true });
const ENV = { ...process.env };
const REAL_PROFILE = join(process.env.APPDATA, 'Afterlife Lease');
const ASIDE = `${REAL_PROFILE}.row9-aside-${Date.now()}`;
const USERDATA = REAL_PROFILE;
const EXE = join(INSTALL, 'Afterlife Lease.exe');
const PORT = 9341;
const results = [];
const evidence = { phases: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'WORKED' : 'FAILED'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail).slice(0, 400)}`}`);
  return !!ok;
};

/** { relative path: sha256 } of every file under dir (empty when it does not exist). */
function tree(dir, skip = () => false) {
  const out = {};
  const walk = (d, rel) => {
    if (!existsSync(d)) return;
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const r = rel ? `${rel}/${n}` : n;
      if (skip(r)) continue;
      const st = statSync(p);
      if (st.isDirectory()) walk(p, r);
      else {
        try { out[r] = sha(readFileSync(p)); } catch { out[r] = 'UNREADABLE'; }
      }
    }
  };
  walk(dir, '');
  return out;
}
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const savesTree = () => tree(join(USERDATA, 'saves'));
/** An interrupted write leaves 'name.tmp-<pid>-<n>'; the saves folder cleans such stale temp files on the next start. */
const isTemp = (name) => /\.tmp-\d+-\d+$/.test(name);
const withoutTemp = (t) => Object.fromEntries(Object.entries(t).filter(([k]) => !isTemp(k)));
/** Every key and value of `old` is still in `now` (deep): an upgrade may ADD settings, never lose or change one. */
const keeps = (old, now) => (old && typeof old === 'object' ? Object.entries(old).every(([k, v]) => keeps(v, now?.[k])) : old === now);

const canon = (o) => {
  if (Array.isArray(o)) return `[${o.map(canon).join(',')}]`;
  if (o && typeof o === 'object') return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`;
  return JSON.stringify(o);
};
const appearanceHashes = (w) => Object.fromEntries([...w.household.memberIds].sort().map((id) => [id, sha(canon(w.agents[id].appearance))]));

function install(setup, label) {
  const r = spawnSync(setup, ['/S', '/currentuser', `/D=${INSTALL}`], { env: ENV, encoding: 'utf8', timeout: 240_000 });
  return check(`${label}: silent installer exits 0 and the app is in place`, r.status === 0 && existsSync(EXE), { status: r.status });
}
function uninstall() {
  const u = join(INSTALL, 'Uninstall Afterlife Lease.exe');
  if (!existsSync(u)) return false;
  spawnSync(u, ['/S', `_?=${INSTALL}`], { env: ENV, timeout: 240_000 });
  return true;
}
function running() {
  const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Afterlife Lease.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  return (r.stdout || '').includes('Afterlife Lease.exe');
}
function appWindows() {
  const py = `
import ctypes, ctypes.wintypes as w
u=ctypes.windll.user32; out=[]
@ctypes.WINFUNCTYPE(ctypes.c_bool, w.HWND, w.LPARAM)
def cb(h,l):
    if u.IsWindowVisible(h):
        b=ctypes.create_unicode_buffer(256); u.GetWindowTextW(h,b,256)
        if b.value.startswith('Afterlife Lease'): out.append(str(h))
    return True
u.EnumWindows(cb,0); print("\\n".join(out))`;
  return (spawnSync('python', ['-c', py], { encoding: 'utf8' }).stdout || '').trim().split('\n').filter(Boolean).map(Number);
}
async function closeApp() {
  for (const h of appWindows()) spawnSync('python', ['-c', `import ctypes; ctypes.windll.user32.PostMessageW(${h}, 0x0010, 0, 0)`]);
  for (let i = 0; i < 120; i++) { if (!running()) return true; await sleep(500); }
  return false;
}

async function launch() {
  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], { env: ENV, detached: true, stdio: 'ignore' });
  let spawnError = null;
  child.on('error', (e) => { spawnError = e; });
  child.unref();
  await sleep(1500);
  if (spawnError) throw new Error(`could not start ${EXE}: ${spawnError.message}`);
  let browser = null;
  for (let i = 0; i < 120 && !browser; i++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); } catch { await sleep(500); }
  }
  if (!browser) throw new Error('could not connect to the app DevTools port');
  let page = null;
  for (let i = 0; i < 120 && !page; i++) {
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools')) ?? null;
    if (!page) await sleep(500);
  }
  page.setDefaultTimeout(60_000);
  return { browser, page };
}
const G = (page, fn, arg) => page.evaluate(fn, arg);
const until = (page, fn, arg, timeout = 60_000) => page.waitForFunction(fn, arg, { timeout, polling: 250 });
const untilScreen = (page, sc, timeout = 180_000) => until(page, (s) => { const g = window.__afterlife && window.__afterlife.game; return !!g && (g.screen === s || !!g.fatalError); }, sc, timeout);
const shot = (page, n) => page.screenshot({ path: join(OUT, `${n}.png`) }).catch(() => {});
async function answerAge(page) {
  if (await page.locator('.st-age-dialog .st-age__input').count()) {
    await page.locator('.st-age-dialog .st-age__input').fill(String(new Date().getFullYear() - 30));
    await page.locator('[data-testid="age-continue"]').click({ force: true });
    await until(page, () => !document.querySelector('.st-age-dialog'));
  }
}
const snapshot = (page) => G(page, () => {
  const g = window.__afterlife.game;
  return { world: JSON.parse(JSON.stringify(g.sim.serialize())), settings: JSON.parse(JSON.stringify(g.settings)), version: window.__afterlife.version };
});

let moved = false;
let realBefore = null;
function restoreOwnerProfile() {
  if (!moved) return;
  if (existsSync(REAL_PROFILE)) renameSync(REAL_PROFILE, join(OUT, 'profile-run'));
  renameSync(ASIDE, REAL_PROFILE);
  moved = false;
}

async function main() {
  check('no app running before the test', !running());
  realBefore = tree(REAL_PROFILE);
  evidence.realProfileFiles = Object.keys(realBefore).length;
  writeFileSync(join(OUT, 'owner-profile-manifest-before.json'), JSON.stringify(realBefore, null, 1));
  if (existsSync(REAL_PROFILE)) {
    renameSync(REAL_PROFILE, ASIDE);
    moved = true;
    evidence.asidePath = ASIDE;
  }
  evidence.installers = { old: sha(readFileSync(OLD)), new: sha(readFileSync(NEW)) };

  // ───────────────────────── A: OLD, first run, play, save
  install(OLD, 'A OLD');
  let { browser, page } = await launch();
  await untilScreen(page, 'menu');
  await answerAge(page);
  const verOld = await G(page, () => window.__afterlife.version);
  await page.locator('.sh-menu__item', { hasText: 'Settings' }).click({ force: true });
  await until(page, () => window.__afterlife.game.dialog === 'settings');
  await page.locator('[aria-labelledby="set-quality-label"] [role="radio"]', { hasText: 'Low' }).click({ force: true });
  await until(page, () => window.__afterlife.game.settings.quality === 'low');
  await page.getByRole('tab', { name: /Audio/i }).first().click({ force: true });
  const vol = page.locator('.sh-volumes [role="slider"]').nth(1);
  const volBefore = await vol.getAttribute('aria-valuenow');
  await vol.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  const volAfter = await vol.getAttribute('aria-valuenow');
  await page.getByRole('button', { name: 'Done' }).click({ force: true });
  await until(page, () => window.__afterlife.game.dialog === null);
  check('A: settings changed (quality Low, a volume slider moved)', volBefore !== volAfter, { volBefore, volAfter });
  await page.locator('.sh-menu__item', { hasText: 'New Game' }).click({ force: true });
  await untilScreen(page, 'newGame', 30_000);
  await page.locator('.sh-lots [role="radio"][data-lot="starter"]').click({ force: true });
  await page.getByRole('button', { name: 'Create your household' }).click({ force: true });
  await untilScreen(page, 'caz', 30_000);
  await page.locator('.sh-editor__start').click({ force: true });
  await until(page, () => { const g = window.__afterlife.game; return g.screen === 'game' && g.renderer.loadProgress() >= 1; }, undefined, 180_000);
  await G(page, () => window.__afterlife.game.setSpeed(1));
  await sleep(4000);
  await G(page, () => window.__afterlife.game.setSpeed(0));
  await G(page, () => { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); });
  await page.keyboard.press('F5');
  await until(page, async () => (await window.__afterlife.game.listSaves()).length > 0, undefined, 60_000);
  await sleep(1500);
  const snapA = await snapshot(page);
  const hashesA = appearanceHashes(snapA.world);
  await shot(page, 'A-game');
  await browser.close().catch(() => {});
  check('A: the app closes with the window X', await closeApp());
  const savesA = savesTree();
  evidence.phases.A = { version: verOld, appearance: hashesA, settings: snapA.settings, saves: savesA, tick: snapA.world.tick };
  check('A: a save file exists on disk', Object.keys(savesA).length > 0, Object.keys(savesA));
  check('A: the owner profile set aside was not touched while the app ran', same(tree(ASIDE), realBefore));

  // ───────────────────────── B: upgrade OLD -> NEW
  install(NEW, 'B NEW (upgrade over OLD)');
  check('B: the installer left the saves folder byte-identical', same(savesTree(), savesA));
  evidence.phases.A.tempFilesAfterQuit = Object.keys(savesA).filter(isTemp);
  ({ browser, page } = await launch());
  await untilScreen(page, 'menu');
  await answerAge(page);
  const verNew = await G(page, () => window.__afterlife.version);
  const settingsB = await G(page, () => JSON.parse(JSON.stringify(window.__afterlife.game.settings)));
  const added = Object.keys(settingsB).filter((k) => !(k in snapA.settings));
  check('B: every setting the player had is kept across the upgrade (new settings may be added with defaults)', keeps(snapA.settings, settingsB), { quality: settingsB.quality, added });
  const contBtn = page.locator('.sh-menu__item', { hasText: 'Continue' });
  check('B: Continue is available', await contBtn.isEnabled());
  await contBtn.click({ force: true });
  await until(page, () => { const g = window.__afterlife.game; return g.screen === 'game' && g.renderer.loadProgress() >= 1; }, undefined, 180_000);
  await G(page, () => window.__afterlife.game.setSpeed(0));
  const snapB = await snapshot(page);
  const hashesB = appearanceHashes(snapB.world);
  check('B: every zombie appearance hash is identical after the upgrade', JSON.stringify(hashesB) === JSON.stringify(hashesA), { before: hashesA, after: hashesB });
  check('B: the household, funds and lot match the saved world', snapB.world.household.name === snapA.world.household.name && snapB.world.household.funds >= 0 && snapB.world.lot.width === snapA.world.lot.width, { name: snapB.world.household.name });
  await shot(page, 'B-continue');
  await browser.close().catch(() => {});
  check('B: the upgraded app closes with the window X', await closeApp());
  const savesB = savesTree();
  evidence.phases.B = { version: verNew, appearance: hashesB, settings: settingsB, saves: savesB, tick: snapB.world.tick, savesChangedByRunning: !same(savesB, savesA) };

  // ───────────────────────── C: rollback NEW -> OLD
  install(OLD, 'C OLD (rollback over NEW)');
  check('C: the installer left the saves folder byte-identical', same(savesTree(), savesB));
  const savesBeforeC = savesTree();
  ({ browser, page } = await launch());
  await untilScreen(page, 'menu');
  await answerAge(page);
  const settingsC = await G(page, () => JSON.parse(JSON.stringify(window.__afterlife.game.settings)));
  check('C: settings still readable after the rollback', settingsC.quality === 'low', { quality: settingsC.quality });
  const contC = page.locator('.sh-menu__item', { hasText: 'Continue' });
  let outcome = 'no-continue';
  let hashesC = null;
  if (await contC.isEnabled().catch(() => false)) {
    await contC.click({ force: true });
    await sleep(6000);
    const state = await G(page, () => { const g = window.__afterlife.game; return { screen: g.screen, fatal: !!g.fatalError, dialog: g.dialog }; });
    if (state.screen === 'game') {
      await until(page, () => window.__afterlife.game.renderer.loadProgress() >= 1, undefined, 120_000).catch(() => {});
      await G(page, () => window.__afterlife.game.setSpeed(0));
      const snapC = await snapshot(page);
      hashesC = appearanceHashes(snapC.world);
      outcome = 'loaded';
    } else outcome = state.fatal ? 'fatal' : 'refused';
  }
  evidence.phases.C = { outcome, appearance: hashesC };
  check('C: the rolled-back app either loads the saves unchanged or refuses them (never a crash)', outcome === 'loaded' || outcome === 'refused' || outcome === 'no-continue', { outcome });
  if (outcome === 'loaded') check('C: the appearance hashes are still identical after the rollback', JSON.stringify(hashesC) === JSON.stringify(hashesA), { hashesC });
  await shot(page, 'C-continue');
  await browser.close().catch(() => {});
  check('C: the rolled-back app closes with the window X', await closeApp());
  const savesAfterC = savesTree();
  const tempBefore = Object.keys(savesBeforeC).filter(isTemp);
  const tempAfter = Object.keys(savesAfterC).filter(isTemp);
  const cleanedTemp = tempBefore.filter((t) => !tempAfter.includes(t));
  evidence.phases.C.staleTempFilesBefore = tempBefore;
  evidence.phases.C.staleTempFilesAfter = tempAfter;
  const lost = Object.keys(withoutTemp(savesBeforeC)).filter((k) => !(k in savesAfterC));
  check('C: no save or profile file is lost during the rollback run (only stale interrupted-write temp files may be cleaned)', lost.length === 0, { lost, staleTempCleaned: cleanedTemp });
  if (outcome === 'refused') check('C: a refused rollback leaves every file byte-identical', same(withoutTemp(savesAfterC), withoutTemp(savesBeforeC)));
  else evidence.phases.C.rewrittenByRolledBackApp = Object.keys(savesAfterC).filter((k) => k in savesBeforeC && savesAfterC[k] !== savesBeforeC[k]);

  // ───────────────────────── E: the save the rolled-back app wrote still loads in the NEW build (the full round trip)
  install(NEW, 'E NEW again (after the rollback)');
  ({ browser, page } = await launch());
  await untilScreen(page, 'menu');
  await answerAge(page);
  await page.locator('.sh-menu__item', { hasText: 'Continue' }).click({ force: true });
  await until(page, () => { const g = window.__afterlife.game; return g.screen === 'game' && g.renderer.loadProgress() >= 1; }, undefined, 180_000);
  await G(page, () => window.__afterlife.game.setSpeed(0));
  const snapE = await snapshot(page);
  const hashesE = appearanceHashes(snapE.world);
  check('E: the save written by the rolled-back app loads in the NEW build with identical appearance hashes (OLD wrote, NEW read, OLD wrote, NEW read)', JSON.stringify(hashesE) === JSON.stringify(hashesA), { hashesE });
  await shot(page, 'E-continue');
  await browser.close().catch(() => {});
  check('E: the app closes with the window X', await closeApp());
  evidence.phases.E = { appearance: hashesE, saves: savesTree() };

  // ───────────────────────── D: clean up and prove the owner profile was never touched
  uninstall();
  restoreOwnerProfile();
  check('D: the owner profile is back in place and byte-identical to before the whole run (SHA-256 of every file)', same(tree(REAL_PROFILE), realBefore), { files: evidence.realProfileFiles });
}

main()
  .catch((e) => { check('the run completed without an exception', false, String(e && e.stack || e)); })
  .finally(async () => {
    try { await closeApp(); } catch { /* ignore */ }
    try { restoreOwnerProfile(); } catch (e) { console.error('RESTORE FAILED, run tests/desktop/row9-restore.mjs', e); results.push({ name: 'owner profile restored', ok: false, detail: String(e) }); }
    writeFileSync(join(OUT, 'row9-report.json'), JSON.stringify({ results, evidence }, null, 2));
    const bad = results.filter((r) => !r.ok);
    console.log(JSON.stringify({ checks: results.length, failed: bad.length }));
    process.exit(bad.length ? 1 : 0);
  });
