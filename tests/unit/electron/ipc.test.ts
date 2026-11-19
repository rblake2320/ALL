import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createIpcHandlers, isTrustedSenderUrl, toBytes, type StorageLike } from '../../../electron/ipcHandlers';
import { FileStore, FileStoreError } from '../../../electron/fileStore';
import { INVOKE_CHANNELS, IPC } from '../../../electron/ipcChannels';

function setup(store?: StorageLike) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afterlife-ipc-'));
  const s = store ?? new FileStore({ dir });
  let fullscreen = false;
  let quits = 0;
  let opened = 0;
  const logs: string[] = [];
  const h = createIpcHandlers({
    store: s,
    window: () => ({ setFullscreen: (on) => void (fullscreen = on), isFullscreen: () => fullscreen }),
    app: { openSavesFolder: async () => void opened++, quit: () => void quits++ },
    maxValueBytes: 1024,
    log: (l, m) => logs.push(`${l} ${m}`),
  });
  return { h, dir, logs, state: () => ({ fullscreen, quits, opened }) };
}

describe('IPC handlers — happy path', () => {
  it('storage round trip through IpcResult', async () => {
    const { h } = setup();
    expect(await h.invoke[IPC.storageWrite](['slot:a:primary', new Uint8Array([1, 2, 3])])).toEqual({ ok: true, value: null });
    const r = await h.invoke[IPC.storageRead](['slot:a:primary']);
    expect(r.ok && Array.from(r.value as Uint8Array)).toEqual([1, 2, 3]);
    expect(await h.invoke[IPC.storageList](['slot:'])).toEqual({ ok: true, value: ['slot:a:primary'] });
    expect(await h.invoke[IPC.storageRemove](['slot:a:primary'])).toEqual({ ok: true, value: null });
    expect(await h.invoke[IPC.storageRead](['slot:a:primary'])).toEqual({ ok: true, value: null });
    const q = await h.invoke[IPC.storageQuota]([]);
    expect(q.ok).toBe(true);
  });

  it('window and app controls', async () => {
    const { h, state } = setup();
    expect(await h.invoke[IPC.setFullscreen]([true])).toEqual({ ok: true, value: null });
    expect(await h.invoke[IPC.isFullscreen]([])).toEqual({ ok: true, value: true });
    expect(await h.invoke[IPC.openSavesFolder]([])).toEqual({ ok: true, value: null });
    h.quit([]);
    expect(state()).toEqual({ fullscreen: true, quits: 1, opened: 1 });
  });

  it('every invoke channel has a handler', () => {
    const { h } = setup();
    for (const ch of INVOKE_CHANNELS) expect(typeof h.invoke[ch]).toBe('function');
  });
});

describe('IPC handlers — adversarial input', () => {
  const writes: [string, unknown[]][] = [
    ['no args', []],
    ['extra args', ['k', new Uint8Array(1), 'extra']],
    ['string data', ['k', 'hello']],
    ['plain array data', ['k', [1, 2, 3]]],
    ['object data', ['k', { 0: 1, length: 1 }]],
    ['null data', ['k', null]],
    ['oversized data', ['k', new Uint8Array(1025)]],
    ['DataView', ['k', new DataView(new ArrayBuffer(4))]],
    ['traversal key', ['../../etc/passwd', new Uint8Array(1)]],
    ['windows traversal key', ['..\\..\\Windows\\win.ini', new Uint8Array(1)]],
    ['reserved key', ['CON', new Uint8Array(1)]],
    ['reserved segment', ['slot:aux:primary', new Uint8Array(1)]],
    ['numeric key', [5, new Uint8Array(1)]],
    ['object key', [{ toString: () => 'slot:a:primary' }, new Uint8Array(1)]],
    ['huge key', ['k'.repeat(10_000), new Uint8Array(1)]],
  ];
  for (const [name, args] of writes) {
    it(`write rejects ${name} with code invalid and writes nothing`, async () => {
      const { h, dir } = setup();
      const r = await h.invoke[IPC.storageWrite](args);
      expect(r).toMatchObject({ ok: false, code: 'invalid' });
      expect(fs.readdirSync(dir)).toEqual([]);
    });
  }

  it('accepts Buffer and ArrayBuffer (structured clone shapes)', async () => {
    const { h } = setup();
    expect((await h.invoke[IPC.storageWrite](['a', Buffer.from([1])])).ok).toBe(true);
    expect((await h.invoke[IPC.storageWrite](['b', new Uint8Array([2]).buffer])).ok).toBe(true);
    expect(Array.from(toBytes(new Uint16Array([1, 2]), 100))).toEqual([1, 0, 2, 0]);
  });

  it('other channels validate argument count and types', async () => {
    const { h, state } = setup();
    expect(await h.invoke[IPC.storageRead]([])).toMatchObject({ ok: false, code: 'invalid' });
    expect(await h.invoke[IPC.storageRead](['a', 'b'])).toMatchObject({ ok: false, code: 'invalid' });
    expect(await h.invoke[IPC.storageList](['../'])).toMatchObject({ ok: false, code: 'invalid' });
    expect(await h.invoke[IPC.storageList]([null])).toMatchObject({ ok: false, code: 'invalid' });
    expect(await h.invoke[IPC.storageQuota](['x'])).toMatchObject({ ok: false, code: 'invalid' });
    expect(await h.invoke[IPC.setFullscreen](['yes'])).toMatchObject({ ok: false, code: 'invalid' });
    expect(await h.invoke[IPC.setFullscreen]([1])).toMatchObject({ ok: false, code: 'invalid' });
    expect(state().fullscreen).toBe(false);
    h.quit(['now']);
    expect(state().quits).toBe(0);
    expect(await h.invoke[IPC.storageRead]('not-an-array' as unknown as unknown[])).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('store errors map to codes and never leak absolute paths', async () => {
    const failing: StorageLike = {
      read: async () => {
        throw new FileStoreError('busy', 'locked C:\\Users\\alice\\AppData\\Roaming\\Afterlife Lease\\saves\\x.dat');
      },
      write: async () => {
        throw new FileStoreError('quota', 'Not enough disk space (/home/alice/.config/x/saves/y.dat)');
      },
      remove: async () => {
        throw new Error('EIO: /home/alice/secret/path/file');
      },
      list: async () => [],
      quota: async () => null,
    };
    const { h, logs } = setup(failing);
    const r = await h.invoke[IPC.storageRead](['k']);
    expect(r).toMatchObject({ ok: false, code: 'busy' });
    expect(JSON.stringify(r)).not.toMatch(/alice/);
    const w = await h.invoke[IPC.storageWrite](['k', new Uint8Array(1)]);
    expect(w).toMatchObject({ ok: false, code: 'quota' });
    expect(JSON.stringify(w)).not.toMatch(/alice/);
    const d = await h.invoke[IPC.storageRemove](['k']);
    expect(d).toMatchObject({ ok: false, code: 'io' });
    expect(JSON.stringify(d)).not.toMatch(/alice/);
    expect(logs.some((l) => l.startsWith('error'))).toBe(true);
  });

  it('store errors never leak an account folder that contains a space', async () => {
    const failing: StorageLike = {
      // Node's own message: both ends of a rename, quoted
      read: async () => {
        throw new FileStoreError('io', "replacing x.dat: ENOENT: no such file or directory, rename 'C:\\Users\\Jane Doe\\AppData\\Roaming\\Afterlife Lease\\saves\\x.tmp' -> 'C:\\Users\\Jane Doe\\AppData\\Roaming\\Afterlife Lease\\saves\\x.dat'");
      },
      // FileStore.doInit puts the saves folder into the context, unquoted; the hint after it must survive
      write: async () => {
        throw new FileStoreError('io', 'Permission denied (creating C:\\Users\\Jane Doe\\AppData\\Roaming\\Afterlife Lease\\saves: EPERM) — check that the saves folder is writable');
      },
      remove: async () => {
        throw new Error("listing /Users/Jane Doe/Library/Application Support/Afterlife Lease/saves: EACCES: permission denied, scandir '/Users/Jane Doe/Library/Application Support/Afterlife Lease/saves'");
      },
      list: async () => {
        throw new Error("ENOENT: no such file or directory, scandir 'C:/Users/Jane Doe'");
      },
      quota: async () => null,
    };
    const { h } = setup(failing);
    expect(await h.invoke[IPC.storageRead](['k'])).toEqual({ ok: false, code: 'io', message: "replacing x.dat: ENOENT: no such file or directory, rename '<path>' -> '<path>'" });
    expect(await h.invoke[IPC.storageWrite](['k', new Uint8Array(1)])).toEqual({ ok: false, code: 'io', message: 'Permission denied (creating <path> EPERM) — check that the saves folder is writable' });
    expect(await h.invoke[IPC.storageRemove](['k'])).toEqual({ ok: false, code: 'io', message: "listing <path> EACCES: permission denied, scandir '<path>'" });
    expect(await h.invoke[IPC.storageList](['slot:'])).toEqual({ ok: false, code: 'io', message: "ENOENT: no such file or directory, scandir '<path>'" });
  });

  it('a missing window is handled (no crash)', async () => {
    const h = createIpcHandlers({
      store: new FileStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'afterlife-ipc-')) }),
      window: () => null,
      app: { openSavesFolder: async () => undefined, quit: () => undefined },
      maxValueBytes: 10,
    });
    expect(await h.invoke[IPC.setFullscreen]([true])).toEqual({ ok: true, value: null });
    expect(await h.invoke[IPC.isFullscreen]([])).toEqual({ ok: true, value: false });
  });
});

describe('sender trust', () => {
  it('trusts only app://game (and the dev origin when configured)', () => {
    expect(isTrustedSenderUrl('app://game/index.html', null)).toBe(true);
    expect(isTrustedSenderUrl('app://game/', null)).toBe(true);
    for (const u of [
      'app://evil/index.html',
      'app://game.evil.com/',
      'app://user:pw@game/',
      'app://game:8080/',
      'file:///C:/game/index.html',
      'https://example.com/',
      'http://localhost:5173/',
      'devtools://devtools/bundled/inspector.html',
      'chrome://gpu',
      'javascript:alert(1)',
      'about:blank',
      '',
      'not a url',
    ]) {
      expect(isTrustedSenderUrl(u, null), u).toBe(false);
    }
    expect(isTrustedSenderUrl(undefined, null)).toBe(false);
    expect(isTrustedSenderUrl('http://localhost:5173/src/main.tsx', 'http://localhost:5173')).toBe(true);
    expect(isTrustedSenderUrl('http://localhost:5174/', 'http://localhost:5173')).toBe(false);
    expect(isTrustedSenderUrl('http://localhost.evil.com:5173/', 'http://localhost:5173')).toBe(false);
  });
});
