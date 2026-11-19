/**
 * IPC request handling, PURE (no electron import): main.ts adapts ipcMain events onto these.
 * The renderer is treated as untrusted: every argument is type/size/shape checked here (keys are
 * validated again inside FileStore), handlers never throw across IPC (they return IpcResult), and
 * error messages carry no stack traces or absolute paths.
 */
import { FileStoreError } from './fileStore';
import { IPC, type InvokeChannel, type IpcResult } from './ipcChannels';
import { validateKey, validatePrefix } from './storageKeys';

export interface StorageLike {
  read(key: string): Promise<Uint8Array | null>;
  write(key: string, data: Uint8Array): Promise<void>;
  remove(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  quota(): Promise<number | null>;
}

export interface WindowControls {
  setFullscreen(on: boolean): void;
  isFullscreen(): boolean;
}

export interface AppControls {
  openSavesFolder(): Promise<void>;
  quit(): void;
}

export interface HandlerDeps {
  store: StorageLike;
  window: () => WindowControls | null;
  app: AppControls;
  maxValueBytes: number;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

export type InvokeHandler = (args: readonly unknown[]) => Promise<IpcResult<unknown>>;

class InvalidArg extends Error {}

function argc(args: readonly unknown[], n: number): void {
  if (!Array.isArray(args) || args.length !== n) throw new InvalidArg(`expected ${n} argument(s), got ${Array.isArray(args) ? args.length : 'none'}`);
}

/** Accept bytes in the shapes structured clone can deliver; anything else (strings, plain arrays) is refused. */
export function toBytes(v: unknown, max: number): Uint8Array {
  let bytes: Uint8Array | null = null;
  if (v instanceof Uint8Array) bytes = v;
  else if (v instanceof ArrayBuffer) bytes = new Uint8Array(v);
  else if (ArrayBuffer.isView(v) && !(v instanceof DataView)) bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (!bytes) throw new InvalidArg('data must be a Uint8Array');
  if (bytes.byteLength > max) throw new InvalidArg(`data is too large (${bytes.byteLength} bytes, limit ${max})`);
  return bytes;
}

function key(v: unknown): string {
  const r = validateKey(v);
  if (!r.ok) throw new InvalidArg(`invalid storage key: ${r.reason}`);
  return r.key;
}

function scrub(message: string): string {
  // Never leak absolute paths (user names live in them) back to web content. Folder names may hold spaces
  // ("C:\Users\Jane Doe"): a quoted path runs to its closing quote; elsewhere a folder name may hold spaces when a
  // separator follows it, and the last segment ends at whitespace.
  return message
    .replace(/(?<=['"])[A-Za-z]:[\\/][^'"\r\n]*|(?<![A-Za-z])[A-Za-z]:[\\/]+(?:[^\\/:'"\r\n]*[^\\/:\s'"][\\/]+)*[^\\/\s'"]*/g, '<path>')
    .replace(/(?<=['"])\/[^'"\r\n]*|\/[^\s/'"]+\/+(?:[^/'"\r\n]*[^/\s'"]\/+)*[^/\s'"]*/g, '<path>')
    .slice(0, 300);
}

function toResult(e: unknown): IpcResult<never> {
  if (e instanceof InvalidArg) return { ok: false, code: 'invalid', message: e.message };
  if (e instanceof FileStoreError) return { ok: false, code: e.code, message: scrub(e.message) };
  return { ok: false, code: 'io', message: scrub(e instanceof Error ? e.message : String(e)) };
}

export function createIpcHandlers(deps: HandlerDeps): { invoke: Record<InvokeChannel, InvokeHandler>; quit: (args: readonly unknown[]) => void } {
  const log = deps.log ?? (() => undefined);
  const wrap =
    <T>(name: string, fn: (args: readonly unknown[]) => Promise<T> | T): InvokeHandler =>
    async (args) => {
      try {
        return { ok: true, value: await fn(args) };
      } catch (e) {
        const r = toResult(e);
        if (!r.ok) log(r.code === 'invalid' ? 'warn' : 'error', `IPC ${name} failed: [${r.code}] ${r.message}`);
        return r;
      }
    };
  const invoke: Record<InvokeChannel, InvokeHandler> = {
    [IPC.storageRead]: wrap(IPC.storageRead, async (args) => {
      argc(args, 1);
      return deps.store.read(key(args[0]));
    }),
    [IPC.storageWrite]: wrap(IPC.storageWrite, async (args) => {
      argc(args, 2);
      const k = key(args[0]);
      await deps.store.write(k, toBytes(args[1], deps.maxValueBytes));
      return null;
    }),
    [IPC.storageRemove]: wrap(IPC.storageRemove, async (args) => {
      argc(args, 1);
      await deps.store.remove(key(args[0]));
      return null;
    }),
    [IPC.storageList]: wrap(IPC.storageList, async (args) => {
      argc(args, 1);
      const p = validatePrefix(args[0]);
      if (!p.ok) throw new InvalidArg(`invalid prefix: ${p.reason}`);
      return deps.store.list(p.key);
    }),
    [IPC.storageQuota]: wrap(IPC.storageQuota, async (args) => {
      argc(args, 0);
      return deps.store.quota();
    }),
    [IPC.setFullscreen]: wrap(IPC.setFullscreen, (args) => {
      argc(args, 1);
      if (typeof args[0] !== 'boolean') throw new InvalidArg('fullscreen flag must be a boolean');
      deps.window()?.setFullscreen(args[0]);
      return null;
    }),
    [IPC.isFullscreen]: wrap(IPC.isFullscreen, (args) => {
      argc(args, 0);
      return deps.window()?.isFullscreen() ?? false;
    }),
    [IPC.openSavesFolder]: wrap(IPC.openSavesFolder, async (args) => {
      argc(args, 0);
      await deps.app.openSavesFolder();
      return null;
    }),
  };
  return {
    invoke,
    quit: (args) => {
      if (Array.isArray(args) && args.length === 0) deps.app.quit();
      else log('warn', 'IPC quit called with unexpected arguments; ignored');
    },
  };
}

/** Only our own top-level page may use the bridge: app://game/... in production, the dev server origin in dev. */
export function isTrustedSenderUrl(url: string | undefined | null, devOrigin: string | null): boolean {
  if (typeof url !== 'string' || url.length === 0) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'app:' && u.host === 'game' && !u.username && !u.password && !u.port) return true;
  return devOrigin !== null && u.origin === devOrigin;
}
