/**
 * FileStore against REAL temp directories (plus a fault-injecting fs wrapper for Windows lock
 * behaviour, disk-full and crashes at every step of the atomic write).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileStore, FileStoreError, nodeFs, STALE_TEMP_MIN_AGE_MS, type FsLike } from '../../../electron/fileStore';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afterlife-fs-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);
const errnoError = (code: string) => Object.assign(new Error(`${code}: injected`), { code });
/** Make a file look old (older than STALE_TEMP_MIN_AGE_MS) so init() treats it as a crash leftover. */
const backdate = (name: string, ageMs = STALE_TEMP_MIN_AGE_MS + 5_000) => {
  const t = (Date.now() - ageMs) / 1000;
  fs.utimesSync(path.join(dir, name), t, t);
};

/** Wrap node fs; `plan(op, path)` may throw to inject faults. */
function faultyFs(plan: (op: string, p: string) => void, calls: string[] = []): FsLike {
  const wrap =
    <A extends unknown[], R>(op: string, fn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      calls.push(`${op} ${path.basename(String(a[0]))}`);
      plan(op, String(a[0]));
      return fn(...a);
    };
  return {
    open: async (p, flags) => {
      calls.push(`open:${flags} ${path.basename(p)}`);
      plan(`open:${flags}`, p);
      const fh = await nodeFs.open(p, flags);
      return {
        writeFile: async (d) => {
          plan('write', p);
          return fh.writeFile(d);
        },
        readFile: () => fh.readFile(),
        stat: () => fh.stat(),
        sync: async () => {
          calls.push(`sync ${path.basename(p)}`);
          plan('sync', p);
          return fh.sync();
        },
        close: () => fh.close(),
      };
    },
    rename: wrap('rename', nodeFs.rename),
    unlink: wrap('unlink', nodeFs.unlink),
    readdir: wrap('readdir', nodeFs.readdir),
    mkdir: wrap('mkdir', nodeFs.mkdir),
    statfs: nodeFs.statfs,
  };
}

describe('FileStore basics (real disk)', () => {
  it('write/read/list/remove round trip with readable file names', async () => {
    const s = new FileStore({ dir });
    await s.write('slot:autosave:primary', bytes('hello'));
    await s.write('profile:tutorialStage', bytes('3'));
    expect(text(await s.read('slot:autosave:primary'))).toBe('hello');
    expect(fs.readdirSync(dir).sort()).toEqual(['profile.tutorial~stage.dat', 'slot.autosave.primary.dat']);
    expect(await s.list('slot:')).toEqual(['slot:autosave:primary']);
    expect(await s.list('')).toEqual(['profile:tutorialStage', 'slot:autosave:primary']);
    await s.remove('slot:autosave:primary');
    await s.remove('slot:autosave:primary'); // idempotent
    expect(await s.read('slot:autosave:primary')).toBeNull();
    expect(await s.read('slot:never:primary')).toBeNull();
    const q = await s.quota();
    expect(q === null || q > 0).toBe(true);
  });

  it('atomic replace: the target is replaced, never appended or left partial', async () => {
    const s = new FileStore({ dir });
    await s.write('k', bytes('x'.repeat(10_000)));
    await s.write('k', bytes('short'));
    expect(text(await s.read('k'))).toBe('short');
    expect(fs.readdirSync(dir)).toEqual(['k.dat']);
  });

  it('init() removes stray temp files from crashed writes and never touches data files', async () => {
    fs.writeFileSync(path.join(dir, 'slot.a.primary.dat'), 'good');
    fs.writeFileSync(path.join(dir, 'slot.a.primary.dat.tmp-999-1'), 'torn');
    fs.writeFileSync(path.join(dir, 'slot.b.meta.dat.tmp-1-22'), 'torn');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'user file');
    // Crash leftovers come from a PREVIOUS run: backdate them past the live-writer grace period.
    backdate('slot.a.primary.dat.tmp-999-1');
    backdate('slot.b.meta.dat.tmp-1-22');
    const s = new FileStore({ dir });
    const { removedTemps } = await s.init();
    expect(removedTemps.sort()).toEqual(['slot.a.primary.dat.tmp-999-1', 'slot.b.meta.dat.tmp-1-22']);
    expect(fs.readdirSync(dir).sort()).toEqual(['notes.txt', 'slot.a.primary.dat']);
    expect(text(await s.read('slot:a:primary'))).toBe('good');
    expect(await s.list('')).toEqual(['slot:a:primary']);
  });

  it('reads ignore stray temp files that appear later', async () => {
    const s = new FileStore({ dir });
    await s.write('slot:a:primary', bytes('v1'));
    fs.writeFileSync(path.join(dir, 'slot.a.primary.dat.tmp-5-5'), 'garbage');
    expect(text(await s.read('slot:a:primary'))).toBe('v1');
    expect(await s.list('slot:')).toEqual(['slot:a:primary']);
  });

  it('creates the folder on demand and recreates it if deleted while running', async () => {
    const nested = path.join(dir, 'deep', 'saves');
    const s = new FileStore({ dir: nested });
    await s.write('k', bytes('1'));
    fs.rmSync(nested, { recursive: true, force: true });
    await s.write('k', bytes('2'));
    expect(text(await s.read('k'))).toBe('2');
  });

  it('rejects path traversal, reserved names and bad input before touching the disk', async () => {
    const s = new FileStore({ dir });
    for (const k of ['../outside', '..\\outside', 'C:\\x', '/etc/passwd', 'con', 'slot:NUL:primary', 'a/b', '', 'x'.repeat(200), 'a\u0000b']) {
      await expect(s.write(k, bytes('x'))).rejects.toMatchObject({ code: 'invalid' });
      await expect(s.read(k)).rejects.toMatchObject({ code: 'invalid' });
      await expect(s.remove(k)).rejects.toMatchObject({ code: 'invalid' });
    }
    await expect(s.list('../')).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.write('k', 'string' as unknown as Uint8Array)).rejects.toMatchObject({ code: 'invalid' });
    expect(fs.existsSync(path.join(dir, '..', 'outside'))).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('rejects oversized payloads and refuses to read oversized files', async () => {
    const s = new FileStore({ dir, maxValueBytes: 1000 });
    await expect(s.write('k', new Uint8Array(1001))).rejects.toMatchObject({ code: 'invalid' });
    fs.writeFileSync(path.join(dir, 'big.dat'), Buffer.alloc(2000));
    await expect(s.read('big')).rejects.toMatchObject({ code: 'io' });
    expect(fs.readdirSync(dir)).toEqual(['big.dat']);
  });

  it('caps the number of keys (a misbehaving renderer cannot fill the disk with files)', async () => {
    const s = new FileStore({ dir, maxKeys: 3 });
    await s.write('a', bytes('1'));
    await s.write('b', bytes('1'));
    await s.write('c', bytes('1'));
    await expect(s.write('d', bytes('1'))).rejects.toMatchObject({ code: 'quota' });
    await s.write('a', bytes('2')); // overwriting an existing key is always allowed
    await s.remove('b');
    await s.write('d', bytes('1'));
  });

  it('50 parallel writes to one key end with the last value and no temp files', async () => {
    const s = new FileStore({ dir });
    const payload = (i: number) => bytes(`value-${i}-` + 'z'.repeat(i * 37));
    await Promise.all(Array.from({ length: 50 }, (_, i) => s.write('slot:race:primary', payload(i))));
    expect(text(await s.read('slot:race:primary'))).toBe(text(payload(49)));
    expect(fs.readdirSync(dir)).toEqual(['slot.race.primary.dat']);
  });

  it('concurrent readers never observe a partial value', async () => {
    const s = new FileStore({ dir });
    const A = bytes('A'.repeat(200_000));
    const B = bytes('B'.repeat(150_000));
    await s.write('k', A);
    const seen = new Set<string>();
    const ops: Promise<unknown>[] = [];
    for (let i = 0; i < 30; i++) {
      ops.push(s.write('k', i % 2 ? A : B));
      ops.push(
        s.read('k').then((v) => {
          const t = text(v)!;
          seen.add(t.length === 200_000 && /^A+$/.test(t) ? 'A' : t.length === 150_000 && /^B+$/.test(t) ? 'B' : 'TORN');
        }),
      );
    }
    await Promise.all(ops);
    expect(seen.has('TORN')).toBe(false);
  });

  it('two store instances on one folder (no shared mutex) still never tear a value', async () => {
    const s1 = new FileStore({ dir, pid: 1 });
    const s2 = new FileStore({ dir, pid: 2 });
    const vals = Array.from({ length: 20 }, (_, i) => bytes(String(i).repeat(5000)));
    await Promise.all(vals.map((v, i) => (i % 2 ? s1 : s2).write('k', v)));
    const final = text(await s1.read('k'))!;
    expect(vals.map((v) => text(v))).toContain(final);
    expect(fs.readdirSync(dir)).toEqual(['k.dat']);
  });

  it('a second store initialising mid-write never deletes the first store\'s in-flight temp (deterministic interleaving)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inWrite = new Promise<void>((r) => (entered = r));
    const slowFs: FsLike = {
      ...nodeFs,
      open: async (p, flags) => {
        const fh = await nodeFs.open(p, flags);
        if (flags !== 'wx') return fh;
        return {
          ...fh,
          writeFile: async (d: Uint8Array) => {
            entered();
            await gate; // hold the temp file open while another store initialises
            return fh.writeFile(d);
          },
          sync: () => fh.sync(),
          close: () => fh.close(),
          stat: () => fh.stat(),
        } as typeof fh;
      },
    };
    const s1 = new FileStore({ dir, pid: 1, fs: slowFs });
    const pending = s1.write('k', bytes('first'));
    await inWrite;
    const tmpName = fs.readdirSync(dir).find((n) => n.startsWith('k.dat.tmp-'));
    expect(tmpName).toBeTruthy();
    backdate(tmpName!); // even an OLD-looking temp must survive while its writer is live in this process
    const s2 = new FileStore({ dir, pid: 2 });
    const { removedTemps } = await s2.init();
    expect(removedTemps).toEqual([]);
    release();
    await pending; // used to fail: ENOENT on rename
    expect(text(await s2.read('k'))).toBe('first');
    expect(fs.readdirSync(dir)).toEqual(['k.dat']);
  });

  it('init() leaves RECENT foreign temps alone (possible live writer in another process) and sweeps them once stale', async () => {
    fs.writeFileSync(path.join(dir, 'k.dat.tmp-4242-7'), 'other process, mid-write');
    const alive = (pid: number) => pid === 4242; // pretend pid 4242 is a live foreign writer
    const s = new FileStore({ dir, isPidAlive: alive });
    expect((await s.init()).removedTemps).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'k.dat.tmp-4242-7'))).toBe(true);
    backdate('k.dat.tmp-4242-7');
    const later = new FileStore({ dir, isPidAlive: alive });
    expect((await later.init()).removedTemps).toEqual(['k.dat.tmp-4242-7']);
  });

  it('init() deletes a RECENT temp at once when its pid is dead (crash leftover from a just-crashed run)', async () => {
    fs.writeFileSync(path.join(dir, 'k.dat.tmp-77777-3'), 'torn');
    const s = new FileStore({ dir, isPidAlive: () => false });
    expect((await s.init()).removedTemps).toEqual(['k.dat.tmp-77777-3']);
  });

  it('two-instance concurrent writes stay consistent across 15 repetitions (race regression)', async () => {
    for (let rep = 0; rep < 15; rep++) {
      const sub = path.join(dir, `rep${rep}`);
      fs.mkdirSync(sub);
      const a = new FileStore({ dir: sub, pid: 1 });
      const b = new FileStore({ dir: sub, pid: 2 });
      const vals = Array.from({ length: 12 }, (_, i) => bytes(`${rep}:${i}:` + 'z'.repeat(3000)));
      await Promise.all(vals.map((v, i) => (i % 2 ? a : b).write('k', v)));
      expect(vals.map((v) => text(v))).toContain(text(await a.read('k')));
      expect(fs.readdirSync(sub)).toEqual(['k.dat']);
    }
  });
});

describe('FileStore — Windows lock behaviour (EPERM/EACCES/EBUSY retry)', () => {
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    it(`retries rename on ${code} with backoff and succeeds when the lock clears`, async () => {
      let failures = 4;
      const calls: string[] = [];
      const sleeps: number[] = [];
      const s = new FileStore({
        dir,
        platform: 'win32',
        fs: faultyFs((op) => {
          if (op === 'rename' && failures-- > 0) throw errnoError(code);
        }, calls),
        sleep: async (ms) => void sleeps.push(ms),
      });
      await s.write('k', bytes('v1'));
      expect(text(await s.read('k'))).toBe('v1');
      expect(calls.filter((c) => c.startsWith('rename')).length).toBe(5);
      expect(sleeps).toEqual([10, 20, 40, 80]); // exponential backoff
      expect(fs.readdirSync(dir)).toEqual(['k.dat']);
    });
  }

  it('gives up after the ~2 s budget with code busy, keeps the old value, cleans its temp file', async () => {
    let t = 0;
    const s0 = new FileStore({ dir });
    await s0.write('k', bytes('old'));
    const s = new FileStore({
      dir,
      platform: 'win32',
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      fs: faultyFs((op) => {
        if (op === 'rename') throw errnoError('EPERM');
      }),
    });
    await expect(s.write('k', bytes('new'))).rejects.toMatchObject({ code: 'busy' });
    expect(t).toBeGreaterThanOrEqual(2000);
    expect(t).toBeLessThan(2600);
    expect(text(await s0.read('k'))).toBe('old');
    expect(fs.readdirSync(dir)).toEqual(['k.dat']);
  });

  it('non-retryable errors are not retried (ENOSPC -> quota immediately)', async () => {
    const calls: string[] = [];
    const s = new FileStore({
      dir,
      fs: faultyFs((op) => {
        if (op === 'write') throw errnoError('ENOSPC');
      }, calls),
      sleep: async () => {
        throw new Error('should not sleep');
      },
    });
    await expect(s.write('k', bytes('x'))).rejects.toMatchObject({ code: 'quota' });
    expect(fs.readdirSync(dir)).toEqual([]); // temp file cleaned
  });

  it('retries transient read locks and delete locks too', async () => {
    const s0 = new FileStore({ dir });
    await s0.write('k', bytes('v'));
    let readFails = 2;
    let unlinkFails = 2;
    const s = new FileStore({
      dir,
      sleep: async () => undefined,
      fs: faultyFs((op) => {
        if (op === 'open:r' && readFails-- > 0) throw errnoError('EBUSY');
        if (op === 'unlink' && unlinkFails-- > 0) throw errnoError('EPERM');
      }),
    });
    expect(text(await s.read('k'))).toBe('v');
    await s.remove('k');
    expect(fs.existsSync(path.join(dir, 'k.dat'))).toBe(false);
  });

  it('fsyncs the file always, the directory only on POSIX', async () => {
    for (const platform of ['linux', 'win32'] as const) {
      const sub = fs.mkdtempSync(path.join(dir, platform));
      const calls: string[] = [];
      const s = new FileStore({ dir: sub, platform, fs: faultyFs(() => undefined, calls) });
      await s.write('k', bytes('v'));
      const syncs = calls.filter((c) => c.startsWith('sync'));
      expect(syncs[0]).toMatch(/^sync k\.dat\.tmp-/);
      if (platform === 'linux') expect(syncs).toContain(`sync ${path.basename(sub)}`);
      else expect(syncs).toHaveLength(1);
    }
  });
});

describe('FileStore — crash at every step of the atomic write', () => {
  const steps = ['open:wx', 'write', 'sync', 'rename'];
  for (const step of steps) {
    it(`crash at ${step}: old value intact, stray temp removed on next start`, async () => {
      const s0 = new FileStore({ dir });
      await s0.write('slot:a:primary', bytes('OLD'));
      // Simulate a process crash: the step throws AND cleanup is impossible (unlink also dies).
      let crashed = false;
      const s = new FileStore({
        dir,
        fs: faultyFs((op) => {
          if (op === step) {
            crashed = true;
            throw errnoError('EIO');
          }
          if (crashed && op === 'unlink') throw errnoError('EIO');
        }),
      });
      await expect(s.write('slot:a:primary', bytes('NEW'))).rejects.toBeInstanceOf(FileStoreError);
      const restarted = new FileStore({ dir });
      await restarted.init();
      expect(text(await restarted.read('slot:a:primary'))).toBe('OLD');
      expect(fs.readdirSync(dir)).toEqual(['slot.a.primary.dat']);
    });
  }

  it('a crash after rename (before dir fsync) already shows the NEW value', async () => {
    const s = new FileStore({
      dir,
      platform: 'linux',
      fs: faultyFs((op, p) => {
        if (op === 'open:r' && p === dir) throw errnoError('EIO'); // dir fsync fails
      }),
    });
    await s.write('k', bytes('NEW')); // dir fsync failure does not undo a committed write
    expect(text(await new FileStore({ dir }).read('k'))).toBe('NEW');
  });
});

describe('FileStore — real Windows-style lock (file held open exclusively)', () => {
  it.skipIf(process.platform === 'win32')('a reader holding the target open does not break writes on POSIX', async () => {
    const s = new FileStore({ dir });
    await s.write('k', bytes('v1'));
    const fh = await fsp.open(path.join(dir, 'k.dat'), 'r');
    try {
      await s.write('k', bytes('v2'));
    } finally {
      await fh.close();
    }
    expect(text(await s.read('k'))).toBe('v2');
  });

  // Windows twin: an open handle on the target makes the replacing rename fail (EPERM) for as long as it is held.
  it.runIf(process.platform === 'win32')(
    'on Windows a held-open target makes the write fail as busy, keeps the old value, and succeeds after release',
    async () => {
      const s = new FileStore({ dir, retry: { maxElapsedMs: 200 } });
      await s.write('k', bytes('v1'));
      const fh = await fsp.open(path.join(dir, 'k.dat'), 'r');
      try {
        await expect(s.write('k', bytes('v2'))).rejects.toMatchObject({ name: 'FileStoreError', code: 'busy' });
        expect(text(await s.read('k'))).toBe('v1');
      } finally {
        await fh.close();
      }
      await s.write('k', bytes('v2'));
      expect(text(await s.read('k'))).toBe('v2');
      expect(fs.readdirSync(dir)).toEqual(['k.dat']);
    },
  );
});
