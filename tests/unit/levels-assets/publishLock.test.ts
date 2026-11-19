// W-063: the shared asset-publish lock (tools/blender/common/publish_lock.py) used by build_all.py and
// build_levels.py. Real processes, real OS locks: a second publisher is refused while the first holds the lock,
// the lock is released when the holder exits (even if killed), and both builders use the shared helper instead of
// a POSIX-only copy (the original W-063 bug: build_levels.py imported fcntl unconditionally, so it crashed on Windows).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const LOCK_PY = join(ROOT, 'tools', 'blender', 'common', 'publish_lock.py');
const PY = process.platform === 'win32' ? 'python' : 'python3';
const hasPython = spawnSync(PY, ['--version']).status === 0;
let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'publock-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Start a holder and resolve once it printed LOCKED. `closed` is registered at spawn so it can never be missed. */
function hold(lock: string, seconds: number) {
  const child = spawn(PY, [LOCK_PY, lock, String(seconds)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  const ready = new Promise<void>((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (d) => { out += d; if (out.includes('LOCKED')) resolve(); });
    child.once('exit', (c) => reject(new Error(`holder exited early (${c}): ${out}`)));
  });
  ready.catch(() => {}); // a later rejection after success is not an unhandled error
  /** Kill only this child if it is still alive and wait until its handles are closed (Windows keeps the
   *  directory locked until then, so cleanup would hit EPERM). */
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  };
  return { child, ready, closed, stop };
}
const tryLock = (lock: string) => spawnSync(PY, [LOCK_PY, lock, '0'], { encoding: 'utf8' });

describe.runIf(hasPython)('shared publish lock (real processes)', () => {
  it('a second publisher is refused with exit 5 while the first holds the lock; free again after it exits', async () => {
    const lock = join(dir, 'nested', '.build.lock'); // parent dirs are created
    const h = hold(lock, 30);
    try {
      await h.ready;
      const second = tryLock(lock);
      expect(second.status).toBe(5);
      expect(second.stdout).toContain('HELD');
    } finally {
      await h.stop(); // kill must release the lock (OS-owned, no stale file state)
    }
    const third = tryLock(lock);
    expect(third.status).toBe(0);
    expect(third.stdout).toContain('LOCKED');
  });

  it('separate lock files do not block each other', async () => {
    const h = hold(join(dir, 'a.lock'), 30);
    try {
      await h.ready;
      expect(tryLock(join(dir, 'b.lock')).status).toBe(0);
    } finally {
      await h.stop();
    }
  });
});

describe('both builders use the shared cross-platform lock', () => {
  for (const rel of ['tools/blender/levels/build_levels.py', 'tools/blender/objects/build_all.py']) {
    it(`${rel}: no unconditional fcntl import, calls publish_lock.acquire, exits 5 when held`, () => {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      expect(src).not.toMatch(/^\s*import fcntl/m);
      expect(src).toMatch(/publish_lock\.acquire\(/);
      expect(src).toMatch(/except BlockingIOError:[\s\S]{0,200}return 5/);
    });
  }
  it('the helper handles Windows (msvcrt LK_NBLCK) and POSIX (fcntl LOCK_NB)', () => {
    const src = readFileSync(LOCK_PY, 'utf8');
    expect(src).toMatch(/os\.name == 'nt'[\s\S]*msvcrt\.locking\(f\.fileno\(\), msvcrt\.LK_NBLCK, 1\)/);
    expect(src).toMatch(/fcntl\.flock\(f, fcntl\.LOCK_EX \| fcntl\.LOCK_NB\)/);
  });
});
