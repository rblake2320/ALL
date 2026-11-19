/**
 * Sandboxed preload: exposes EXACTLY the NativeBridge contract as window.afterlifeNative.
 *
 * Constraints of a sandboxed preload: it may only require('electron') (no local modules), so this
 * file is self-contained; the only local imports are TYPE imports (erased at compile time — checked
 * by scripts/build-electron-main.mjs). Errors from main arrive as IpcResult and are re-thrown as
 * Error('[code] message') because the context bridge drops custom error properties; the renderer's
 * Electron backend maps the tag back to a StorageError code.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { NativeBridge } from './bridgeTypes';
import type { InvokeChannel, IpcChannel, SendChannel } from './ipcChannels';

const CH = {
  read: 'afterlife:storage:read',
  write: 'afterlife:storage:write',
  remove: 'afterlife:storage:remove',
  list: 'afterlife:storage:list',
  quota: 'afterlife:storage:quota',
  setFullscreen: 'afterlife:window:set-fullscreen',
  isFullscreen: 'afterlife:window:is-fullscreen',
  openSavesFolder: 'afterlife:app:open-saves-folder',
} as const satisfies Record<string, InvokeChannel>;
const QUIT: SendChannel = 'afterlife:app:quit';
const VERSION_ARG = '--afterlife-version=';

type Reply = { ok: true; value: unknown } | { ok: false; code: string; message: string };

function isReply(v: unknown): v is Reply {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return r.ok === true ? 'value' in r : r.ok === false && typeof r.code === 'string' && typeof r.message === 'string';
}

async function call(channel: IpcChannel, ...args: unknown[]): Promise<unknown> {
  let reply: unknown;
  try {
    reply = await ipcRenderer.invoke(channel, ...args);
  } catch (e) {
    throw new Error(`[io] ${channel} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!isReply(reply)) throw new Error(`[io] ${channel}: malformed reply from the main process`);
  if (!reply.ok) throw new Error(`[${reply.code}] ${reply.message}`);
  return reply.value;
}

function requireKey(key: unknown): string {
  if (typeof key !== 'string') throw new Error('[invalid] storage key must be a string');
  return key;
}

function toBytes(v: unknown): Uint8Array | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  throw new Error('[io] storage returned a non-binary value');
}

function versionFromArgv(argv: readonly string[]): string {
  const arg = argv.find((a) => typeof a === 'string' && a.startsWith(VERSION_ARG));
  const v = arg ? arg.slice(VERSION_ARG.length) : '';
  return /^[0-9A-Za-z.+-]{1,64}$/.test(v) ? v : '0.0.0';
}

const bridge: NativeBridge = {
  platform: process.platform,
  version: versionFromArgv(process.argv),
  storage: {
    read: async (key) => toBytes(await call(CH.read, requireKey(key))),
    write: async (key, data) => {
      if (!(data instanceof Uint8Array)) throw new Error('[invalid] data must be a Uint8Array');
      await call(CH.write, requireKey(key), data);
    },
    remove: async (key) => {
      await call(CH.remove, requireKey(key));
    },
    list: async (prefix) => {
      if (typeof prefix !== 'string') throw new Error('[invalid] prefix must be a string');
      const v = await call(CH.list, prefix);
      if (!Array.isArray(v)) throw new Error('[io] list: malformed reply');
      return v.filter((k): k is string => typeof k === 'string');
    },
    quota: async () => {
      const v = await call(CH.quota);
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    },
  },
  setFullscreen: async (on) => {
    await call(CH.setFullscreen, on === true);
  },
  isFullscreen: async () => (await call(CH.isFullscreen)) === true,
  quit: () => {
    ipcRenderer.send(QUIT);
  },
  openSavesFolder: async () => {
    await call(CH.openSavesFolder);
  },
};

contextBridge.exposeInMainWorld('afterlifeNative', bridge);
