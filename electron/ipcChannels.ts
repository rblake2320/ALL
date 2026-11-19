/**
 * IPC channel names shared by main.ts (runtime values) and preload.ts (type-only import: the
 * sandboxed preload cannot require local files, so it repeats the literals and the compiler checks
 * them against IpcChannel).
 */
export const IPC = {
  storageRead: 'afterlife:storage:read',
  storageWrite: 'afterlife:storage:write',
  storageRemove: 'afterlife:storage:remove',
  storageList: 'afterlife:storage:list',
  storageQuota: 'afterlife:storage:quota',
  setFullscreen: 'afterlife:window:set-fullscreen',
  isFullscreen: 'afterlife:window:is-fullscreen',
  openSavesFolder: 'afterlife:app:open-saves-folder',
  quit: 'afterlife:app:quit',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
export type InvokeChannel = Exclude<IpcChannel, typeof IPC.quit>;
export type SendChannel = typeof IPC.quit;

export const INVOKE_CHANNELS: readonly InvokeChannel[] = [
  IPC.storageRead,
  IPC.storageWrite,
  IPC.storageRemove,
  IPC.storageList,
  IPC.storageQuota,
  IPC.setFullscreen,
  IPC.isFullscreen,
  IPC.openSavesFolder,
];

/** Wire format of every invoke reply (handlers never throw across IPC). */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; code: 'invalid' | 'quota' | 'busy' | 'io' | 'forbidden'; message: string };

/** Command-line switch carrying the app version into the sandboxed preload (process.argv). */
export const VERSION_ARG = '--afterlife-version=';
