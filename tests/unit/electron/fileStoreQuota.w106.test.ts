/**
 * Security review 2026-11-05 L-5: a compromised renderer could fill the disk (512 keys × 64 MiB = 32 GiB). The file
 * store now also caps the TOTAL bytes stored (default 2 GiB). Small limits here keep the test fast.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEFAULT_MAX_TOTAL_BYTES, FileStore } from '../../../electron/fileStore';

const bytes = (n: number) => new Uint8Array(n).fill(7);
let dir = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'al-quota-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('L-5 FileStore total-bytes quota', () => {
  it('defaults to 2 GiB', () => {
    expect(DEFAULT_MAX_TOTAL_BYTES).toBe(2 * 1024 * 1024 * 1024);
  });

  it('exploit: filling the folder with many maximum-size values stops at the total quota (quota error, nothing written)', async () => {
    const s = new FileStore({ dir, maxValueBytes: 1000, maxKeys: 512, maxTotalBytes: 3500 });
    await s.write('a', bytes(1000));
    await s.write('b', bytes(1000));
    await s.write('c', bytes(1000));
    await expect(s.write('d', bytes(1000))).rejects.toMatchObject({ code: 'quota' });
    expect(fs.existsSync(path.join(dir, 'd.dat'))).toBe(false);
    expect(fs.readdirSync(dir).filter((n) => n.includes('.tmp-'))).toEqual([]);
    expect(s.usedBytes).toBe(3000);
    await s.write('d', bytes(500)); // still fits
    expect(s.usedBytes).toBe(3500);
  });

  it('overwrites are judged by the size change; shrinking and deleting free space', async () => {
    const s = new FileStore({ dir, maxValueBytes: 1000, maxTotalBytes: 2000 });
    await s.write('a', bytes(1000));
    await s.write('b', bytes(1000));
    await s.write('a', bytes(1000)); // same size: allowed when full
    await expect(s.write('c', bytes(1))).rejects.toMatchObject({ code: 'quota' });
    await s.write('a', bytes(200)); // shrink
    expect(s.usedBytes).toBe(1200);
    await s.remove('b');
    expect(s.usedBytes).toBe(200);
    await s.write('c', bytes(1000));
    await s.write('d', bytes(800));
    await expect(s.write('e', bytes(1))).rejects.toMatchObject({ code: 'quota' });
  });

  it('concurrent writes to different keys cannot overshoot together (reservation)', async () => {
    const s = new FileStore({ dir, maxValueBytes: 1000, maxTotalBytes: 2500 });
    const r = await Promise.allSettled(['a', 'b', 'c', 'd'].map((k) => s.write(k, bytes(1000))));
    expect(r.filter((x) => x.status === 'fulfilled').length).toBe(2);
    expect(r.filter((x) => x.status === 'rejected').every((x) => (x as PromiseRejectedResult).reason.code === 'quota')).toBe(true);
    expect(s.usedBytes).toBe(2000);
  });

  it('existing files count after a restart (sizes indexed by init)', async () => {
    fs.writeFileSync(path.join(dir, 'old.dat'), Buffer.alloc(1500));
    const s = new FileStore({ dir, maxValueBytes: 1000, maxTotalBytes: 2000 });
    await expect(s.write('new', bytes(600))).rejects.toMatchObject({ code: 'quota' });
    await s.write('new', bytes(500));
    expect(s.usedBytes).toBe(2000);
  });
});
