/**
 * Windows file-system quirks the generic lock-retry loop cannot fix:
 *
 *  - READ-ONLY ATTRIBUTE: MoveFileEx(REPLACE_EXISTING) and DeleteFile fail with ERROR_ACCESS_DENIED
 *    (EPERM in Node) for a target carrying FILE_ATTRIBUTE_READONLY — saves restored from a backup tool,
 *    copied from read-only media or "protected" by a cleanup utility. That is not a transient lock:
 *    retrying for 2 s and reporting "locked by another program" means the slot can NEVER be saved or
 *    deleted again. The store must clear the attribute (chmod +w, the only mode bit Windows honours)
 *    and carry on — on win32 only, and only for its own data files.
 *  - BUFFER POOLING: small reads come back as views into Node's shared 8 KiB allocation pool; handing
 *    such a view to IPC/structured clone can expose (or at least copy) unrelated pool bytes. Reads must
 *    return a tight, exclusively-owned buffer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileStore, nodeFs, type FileHandleLike, type FsLike } from '../../../electron/fileStore';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afterlife-winq-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);
const errnoError = (code: string) => Object.assign(new Error(`${code}: operation not permitted (injected)`), { code });

/** Real-disk fs that emulates NTFS's read-only attribute semantics on top of POSIX. */
function ntfsLikeFs(readOnly: Set<string>, calls: string[]): FsLike {
  return {
    open: (p, flags) => nodeFs.open(p, flags),
    rename: async (from, to) => {
      calls.push(`rename ${path.basename(to)}`);
      if (readOnly.has(to)) throw errnoError('EPERM');
      await nodeFs.rename(from, to);
    },
    unlink: async (p) => {
      calls.push(`unlink ${path.basename(p)}`);
      if (readOnly.has(p)) throw errnoError('EPERM');
      await nodeFs.unlink(p);
    },
    readdir: (p) => nodeFs.readdir(p),
    mkdir: (p) => nodeFs.mkdir(p),
    stat: async (p) => {
      const st = await fs.promises.stat(p);
      return { size: st.size, mode: readOnly.has(p) ? 0o100444 : 0o100666 };
    },
    chmod: async (p, mode) => {
      calls.push(`chmod ${path.basename(p)} ${mode.toString(8)}`);
      if (mode & 0o200) readOnly.delete(p);
    },
  };
}

describe('FileStore — read-only attribute on Windows', () => {
  it('overwriting a read-only save clears the attribute instead of failing as "locked" after 2 s', async () => {
    await new FileStore({ dir }).write('slot:a:primary', bytes('old'));
    const target = path.join(dir, 'slot.a.primary.dat');
    const readOnly = new Set([target]);
    const calls: string[] = [];
    const sleeps: number[] = [];
    const s = new FileStore({ dir, platform: 'win32', fs: ntfsLikeFs(readOnly, calls), sleep: async (ms) => void sleeps.push(ms) });
    await s.write('slot:a:primary', bytes('new'));
    expect(text(await s.read('slot:a:primary'))).toBe('new');
    expect(calls.filter((c) => c.startsWith('chmod'))).toEqual(['chmod slot.a.primary.dat 666']);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeLessThan(100); // no 2 s retry storm
    expect(fs.readdirSync(dir)).toEqual(['slot.a.primary.dat']); // temp cleaned
  });

  it('deleting a read-only save clears the attribute and deletes it', async () => {
    await new FileStore({ dir }).write('slot:a:meta', bytes('m'));
    const target = path.join(dir, 'slot.a.meta.dat');
    const calls: string[] = [];
    const s = new FileStore({ dir, platform: 'win32', fs: ntfsLikeFs(new Set([target]), calls), sleep: async () => undefined });
    await s.remove('slot:a:meta');
    expect(fs.existsSync(target)).toBe(false);
    expect(calls).toContain('chmod slot.a.meta.dat 666');
  });

  it('a genuine lock (target NOT read-only) is retried, never chmod-ed', async () => {
    await new FileStore({ dir }).write('k', bytes('old'));
    let failures = 3;
    const calls: string[] = [];
    const base = ntfsLikeFs(new Set(), calls);
    const s = new FileStore({
      dir,
      platform: 'win32',
      sleep: async () => undefined,
      fs: {
        ...base,
        rename: async (a, b) => {
          if (failures-- > 0) throw errnoError('EPERM');
          return base.rename(a, b);
        },
      },
    });
    await s.write('k', bytes('new'));
    expect(text(await s.read('k'))).toBe('new');
    expect(calls.some((c) => c.startsWith('chmod'))).toBe(false);
  });

  it('POSIX: permission errors are never "fixed" by changing file modes', async () => {
    await new FileStore({ dir }).write('k', bytes('old'));
    const target = path.join(dir, 'k.dat');
    const calls: string[] = [];
    let t = 0;
    const s = new FileStore({
      dir,
      platform: 'linux',
      fs: ntfsLikeFs(new Set([target]), calls),
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
    });
    await expect(s.write('k', bytes('new'))).rejects.toMatchObject({ name: 'FileStoreError' });
    expect(calls.some((c) => c.startsWith('chmod'))).toBe(false);
    expect(text(await new FileStore({ dir }).read('k'))).toBe('old');
  });
});

describe('FileStore — reads return exclusively owned bytes', () => {
  it('a pooled/offset Buffer from fs is copied into a tight Uint8Array', async () => {
    await new FileStore({ dir }).write('k', bytes('hello'));
    const pool = new ArrayBuffer(8192);
    new Uint8Array(pool).fill(0x41); // "secret" neighbour bytes in the shared pool
    const pooledFs: FsLike = {
      ...nodeFs,
      open: async (p, flags) => {
        const fh = await nodeFs.open(p, flags);
        const wrapped: FileHandleLike = {
          writeFile: (d) => fh.writeFile(d),
          stat: () => fh.stat(),
          sync: () => fh.sync(),
          close: () => fh.close(),
          readFile: async () => {
            const real = await fh.readFile();
            const view = Buffer.from(pool, 100, real.byteLength);
            view.set(real);
            return view;
          },
        };
        return wrapped;
      },
    };
    const out = await new FileStore({ dir, fs: pooledFs }).read('k');
    expect(text(out)).toBe('hello');
    expect(out!.byteOffset).toBe(0);
    expect(out!.buffer.byteLength).toBe(out!.byteLength);
  });
});
