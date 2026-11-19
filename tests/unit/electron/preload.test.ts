/**
 * The sandboxed preload against a mocked `electron`: it must expose EXACTLY the NativeBridge
 * contract, speak only the declared IPC channels, and turn IpcResult failures into tagged errors.
 * Also proves (at compile time) that electron/bridgeTypes.ts is identical to the contract.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeBridge as ContractBridge } from '../../../src/persistence/contracts';
import type { NativeBridge as MirrorBridge } from '../../../electron/bridgeTypes';
import { INVOKE_CHANNELS, IPC } from '../../../electron/ipcChannels';
import { createElectronBackend } from '../../../src/persistence/backends/electron';
import { SaveManagerImpl } from '../../../src/persistence/saveManager';
import { makeMeta, makeWorld, silentLogger } from '../persistence/fixtures';

// ── compile-time proof that the mirror equals the contract (fails `tsc` on any drift) ──
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const bridgeTypesMatch: Equals<ContractBridge, MirrorBridge> = true;

const h = vi.hoisted(() => ({
  exposed: new Map<string, unknown>(),
  invoke: vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(),
  send: vi.fn<(channel: string, ...args: unknown[]) => void>(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (name: string, api: unknown) => h.exposed.set(name, api) },
  ipcRenderer: { invoke: (ch: string, ...a: unknown[]) => h.invoke(ch, ...a), send: (ch: string, ...a: unknown[]) => h.send(ch, ...a) },
}));

async function loadPreload(argv: string[] = ['--afterlife-version=1.2.3']): Promise<ContractBridge> {
  h.exposed.clear();
  vi.resetModules();
  const saved = process.argv;
  process.argv = [...saved, ...argv];
  try {
    await import('../../../electron/preload');
  } finally {
    process.argv = saved;
  }
  expect([...h.exposed.keys()]).toEqual(['afterlifeNative']);
  return h.exposed.get('afterlifeNative') as ContractBridge;
}

beforeEach(() => {
  h.invoke.mockReset();
  h.send.mockReset();
});

describe('preload bridge', () => {
  it('mirror type equals the contract', () => {
    expect(bridgeTypesMatch).toBe(true);
  });

  it('exposes exactly the contract surface', async () => {
    const b = await loadPreload();
    expect(Object.keys(b).sort()).toEqual(['isFullscreen', 'openSavesFolder', 'platform', 'quit', 'setFullscreen', 'storage', 'version']);
    expect(Object.keys(b.storage).sort()).toEqual(['list', 'quota', 'read', 'remove', 'write']);
    expect(b.platform).toBe(process.platform);
    expect(b.version).toBe('1.2.3');
  });

  it('a missing or hostile version argument falls back to 0.0.0', async () => {
    expect((await loadPreload([])).version).toBe('0.0.0');
    expect((await loadPreload(['--afterlife-version=<script>'])).version).toBe('0.0.0');
  });

  it('uses only declared channels, with the expected arguments', async () => {
    const b = await loadPreload();
    h.invoke.mockResolvedValue({ ok: true, value: null });
    await b.storage.read('slot:a:primary');
    await b.storage.write('slot:a:primary', new Uint8Array([1]));
    await b.storage.remove('slot:a:primary');
    h.invoke.mockResolvedValueOnce({ ok: true, value: ['a', 5, 'b'] });
    expect(await b.storage.list('slot:')).toEqual(['a', 'b']);
    h.invoke.mockResolvedValueOnce({ ok: true, value: 1234 });
    expect(await b.storage.quota()).toBe(1234);
    await b.setFullscreen(true);
    h.invoke.mockResolvedValueOnce({ ok: true, value: true });
    expect(await b.isFullscreen()).toBe(true);
    await b.openSavesFolder();
    b.quit();
    const used = new Set(h.invoke.mock.calls.map((c) => c[0]));
    expect([...used].sort()).toEqual([...INVOKE_CHANNELS].sort());
    expect(h.send.mock.calls).toEqual([[IPC.quit]]);
    expect(h.invoke.mock.calls.find((c) => c[0] === IPC.storageWrite)).toEqual([IPC.storageWrite, 'slot:a:primary', new Uint8Array([1])]);
    expect(h.invoke.mock.calls.find((c) => c[0] === IPC.setFullscreen)).toEqual([IPC.setFullscreen, true]);
  });

  it('turns IpcResult failures into "[code] message" errors', async () => {
    const b = await loadPreload();
    h.invoke.mockResolvedValueOnce({ ok: false, code: 'quota', message: 'Not enough disk space' });
    await expect(b.storage.write('k', new Uint8Array(1))).rejects.toThrow('[quota] Not enough disk space');
    h.invoke.mockRejectedValueOnce(new Error('channel closed'));
    await expect(b.storage.read('k')).rejects.toThrow(/^\[io\].*channel closed/);
    h.invoke.mockResolvedValueOnce('garbage');
    await expect(b.storage.read('k')).rejects.toThrow(/\[io\].*malformed/);
    h.invoke.mockResolvedValueOnce({ ok: true, value: 'not bytes' });
    await expect(b.storage.read('k')).rejects.toThrow(/\[io\].*non-binary/);
  });

  it('validates arguments before crossing IPC', async () => {
    const b = await loadPreload();
    await expect(b.storage.write('k', 'str' as unknown as Uint8Array)).rejects.toThrow(/^\[invalid\]/);
    await expect(b.storage.read(5 as unknown as string)).rejects.toThrow(/^\[invalid\]/);
    await expect(b.storage.list(null as unknown as string)).rejects.toThrow(/^\[invalid\]/);
    expect(h.invoke).not.toHaveBeenCalled();
    h.invoke.mockResolvedValue({ ok: true, value: null });
    await b.setFullscreen('yes' as unknown as boolean); // coerced to a strict boolean
    expect(h.invoke.mock.calls[0]).toEqual([IPC.setFullscreen, false]);
  });

  it('end to end: SaveManager -> Electron backend -> preload -> (fake main) round trip with error tags', async () => {
    const b = await loadPreload();
    const files = new Map<string, Uint8Array>();
    let fullDisk = false;
    h.invoke.mockImplementation(async (ch: string, ...a: unknown[]) => {
      if (ch === IPC.storageRead) return { ok: true, value: files.get(a[0] as string) ?? null };
      if (ch === IPC.storageWrite) {
        if (fullDisk) return { ok: false, code: 'quota', message: 'Not enough disk space to save' };
        files.set(a[0] as string, (a[1] as Uint8Array).slice());
        return { ok: true, value: null };
      }
      if (ch === IPC.storageRemove) return files.delete(a[0] as string), { ok: true, value: null };
      if (ch === IPC.storageList) return { ok: true, value: [...files.keys()].filter((k) => k.startsWith(a[0] as string)) };
      return { ok: true, value: null };
    });
    const m = new SaveManagerImpl({ backend: createElectronBackend(b), logger: silentLogger });
    expect((await m.save('a', 'a', makeWorld(1), makeMeta())).ok).toBe(true);
    fullDisk = true;
    const r = await m.save('a', 'a', makeWorld(2), makeMeta());
    expect(!r.ok && r.code).toBe('quota');
    const l = await m.load('a');
    expect(l.ok && l.world.seed).toBe(makeWorld(1).seed);
  });
});
