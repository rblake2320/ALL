/**
 * Backlog #22 probe: does lock contention on the journal lock produce a REAL unhandled rejection in the page, or only
 * a Playwright `pageerror` report?
 *
 *   node tests/e2e/webLocksProbe.mjs [--browser=chromium|firefox|webkit]
 *
 * Serves one tiny page on 127.0.0.1 (a secure context, so navigator.locks exists) that replays, verbatim, the
 * contention path of src/persistence/locks.ts webLocks().run(..., { ifAvailable: true }) — the request callback THROWS
 * a StorageError('busy') when the lock is taken — consumed exactly like src/persistence/journal.ts holdLock(), which
 * attaches a rejection handler to the request promise and resolves null. A second "holder" keeps the lock, so every
 * attempt is refused. The page counts window 'unhandledrejection' events; the driver counts Playwright `pageerror`
 * and console errors. Exit 0 = no unhandled rejection by either channel; 1 = at least one (the output says which).
 * Nothing from the game bundle is loaded, so a hit here is about the browser's Web Locks, not about game code.
 */
import { createRequire } from 'node:module';
import http from 'node:http';

const require = createRequire(import.meta.url);
const pw = require('playwright');
const which = (process.argv.find((a) => a.startsWith('--browser=')) || '--browser=chromium').slice(10);
const type = pw[which];
if (!type) throw new Error(`unknown browser ${which}`);

const PAGE = `<!doctype html><meta charset="utf-8"><title>locks probe</title><script>
window.__unhandled = [];
window.addEventListener('unhandledrejection', (e) => window.__unhandled.push(String(e.reason && (e.reason.name + ': ' + e.reason.message) || e.reason)));
class StorageError extends Error { constructor(code, m) { super(m); this.name = 'StorageError'; this.code = code; } }
// locks.ts webLocks().run with { ifAvailable: true }
function runIfAvailable(name, fn) {
  return navigator.locks.request(name, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
    if (!lock) throw new StorageError('busy', 'another window of the game is saving right now; try again shortly');
    return fn();
  });
}
// journal.ts holdLock (rejection handled, resolves null)
function holdLock(name) {
  return new Promise((resolve) => {
    let letGo; const done = new Promise((r) => (letGo = r)); let settled = false;
    const finished = runIfAvailable(name, async () => { settled = true; resolve({ release: () => { letGo(); return finished; } }); await done; })
      .then(() => undefined, () => { if (!settled) resolve(null); });
  });
}
window.__probe = async (n) => {
  if (!navigator.locks) return { error: 'no navigator.locks' };
  const name = 'afterlife-lease:journal:indexeddb:auto-0000abcd';
  const holder = await holdLock(name);           // "window A" holds the journal lock
  const results = [];
  for (let i = 0; i < n; i++) results.push(await holdLock(name)); // "window B" retries (recoverJournal / beginSession)
  // let any late unhandled-rejection reports fire
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 25));
  await holder.release();
  return { holder: !!holder, refused: results.filter((x) => x === null).length, unhandled: window.__unhandled.slice() };
};
</script>`;

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
let browser;
let code = 1;
try {
  browser = await type.launch({ headless: true });
  const page = await browser.newPage();
  const pageerrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageerrors.push(`${e.name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  await page.goto(url);
  const r = await page.evaluate((n) => window.__probe(n), 5);
  await page.waitForTimeout(500);
  console.log(JSON.stringify({ browser: which, version: browser.version(), ...r, pageerrors, consoleErrors }, null, 2));
  if (r.error) console.log(`INCONCLUSIVE: ${r.error}`);
  else {
    const real = r.unhandled.length;
    const driver = pageerrors.length;
    console.log(`window 'unhandledrejection': ${real} · Playwright pageerror: ${driver} · refused attempts: ${r.refused}/5`);
    if (real === 0 && driver === 0) {
      console.log('PASS  lock contention is fully handled (no unhandled rejection by either channel)');
      code = 0;
    } else if (real === 0) console.log('FAIL  driver-only: Playwright reports pageerror, the page itself sees no unhandled rejection');
    else console.log('FAIL  REAL unhandled rejection inside the page');
  }
} finally {
  await browser?.close().catch(() => undefined);
  server.close();
}
process.exit(code);
