/**
 * electron/main.ts against a mocked `electron` module: security configuration of the window,
 * single-instance behaviour, the app:// protocol (serving + traversal refusal + CSP), IPC sender
 * validation, navigation/window.open/permission blocking, F11, crash-loop handling and quit.
 * (The real Electron binary cannot run in this container; this pins down every decision main.ts
 * makes about Electron's APIs.)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { IPC, INVOKE_CHANNELS } from '../../../electron/ipcChannels';

type Fn = (...a: any[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any

const h = vi.hoisted(() => {
  const tmp = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'afterlife-main-')) as string;
  const state = {
    tmp,
    appData: require('node:path').join(tmp, 'AppData', 'Roaming') as string,
    appPath: require('node:path').join(tmp, 'app') as string,
    paths: new Map<string, string>(),
    lock: true,
    packaged: true,
    appEvents: new Map<string, Fn[]>(),
    ipcHandle: new Map<string, Fn>(),
    ipcOn: new Map<string, Fn>(),
    protocolHandler: null as Fn | null,
    privileged: [] as unknown[],
    windows: [] as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
    permissionRequest: null as Fn | null,
    permissionCheck: null as Fn | null,
    devicePermission: null as Fn | null,
    displayMedia: null as Fn | null,
    headersReceived: null as Fn | null,
    willDownload: null as Fn | null,
    menu: [] as unknown[],
    quit: 0,
    relaunch: 0,
    exit: [] as number[],
    messageBoxes: [] as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
    errorBoxes: [] as string[],
    messageBoxResponse: 0,
    readyResolve: null as null | (() => void),
  };
  return state;
});

vi.mock('electron', () => {
  class FakeEmitter {
    events = new Map<string, Fn[]>();
    on(ev: string, fn: Fn) {
      const l = this.events.get(ev) ?? [];
      l.push(fn);
      this.events.set(ev, l);
      return this;
    }
    once(ev: string, fn: Fn) {
      return this.on(ev, fn);
    }
    emit(ev: string, ...a: unknown[]) {
      for (const fn of this.events.get(ev) ?? []) fn(...a);
    }
  }
  class FakeWebContents extends FakeEmitter {
    mainFrame = { parent: null, url: 'app://game/index.html' };
    openHandler: Fn | null = null;
    reload = vi.fn();
    executeJavaScript = vi.fn(async () => undefined);
    toggleDevTools = vi.fn();
    forcefullyCrashRenderer = vi.fn();
    setWindowOpenHandler(fn: Fn) {
      this.openHandler = fn;
    }
    getURL() {
      return 'app://game/index.html';
    }
  }
  class FakeWindow extends FakeEmitter {
    opts: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    webContents = new FakeWebContents();
    fullscreen = false;
    minimized = false;
    show = vi.fn();
    focus = vi.fn();
    maximize = vi.fn();
    restore = vi.fn();
    hide = vi.fn();
    close = vi.fn();
    loadURL = vi.fn(async () => undefined);
    constructor(opts: Record<string, unknown>) {
      super();
      this.opts = opts;
      h.windows.push(this);
    }
    setFullScreen(v: boolean) {
      this.fullscreen = v;
    }
    isFullScreen() {
      return this.fullscreen;
    }
    isDestroyed() {
      return false;
    }
    isMinimized() {
      return this.minimized;
    }
    isMaximized() {
      return false;
    }
    getNormalBounds() {
      return { x: 10, y: 20, width: 1600, height: 900 };
    }
  }
  const app = {
    setName: vi.fn(),
    setPath: (k: string, v: string) => void h.paths.set(k, v),
    getPath: (k: string) => (k === 'appData' ? h.appData : (h.paths.get(k) ?? path.join(h.tmp, k))),
    requestSingleInstanceLock: () => h.lock,
    quit: () => void h.quit++,
    relaunch: () => void h.relaunch++,
    exit: (c: number) => void h.exit.push(c),
    enableSandbox: vi.fn(),
    setAppUserModelId: vi.fn(),
    get isPackaged() {
      return h.packaged;
    },
    getVersion: () => '1.0.0',
    getAppPath: () => h.appPath,
    on: (ev: string, fn: Fn) => {
      const l = h.appEvents.get(ev) ?? [];
      l.push(fn);
      h.appEvents.set(ev, l);
    },
    whenReady: () => new Promise<void>((r) => (h.readyResolve = r)),
  };
  return {
    app,
    BrowserWindow: FakeWindow,
    dialog: {
      showMessageBox: vi.fn(async (_w: unknown, opts: unknown) => {
        h.messageBoxes.push(opts);
        return { response: h.messageBoxResponse };
      }),
      showErrorBox: (_t: string, m: string) => void h.errorBoxes.push(m),
    },
    ipcMain: {
      handle: (ch: string, fn: Fn) => void h.ipcHandle.set(ch, fn),
      on: (ch: string, fn: Fn) => void h.ipcOn.set(ch, fn),
    },
    Menu: { setApplicationMenu: (m: unknown) => void h.menu.push(m) },
    protocol: {
      registerSchemesAsPrivileged: (s: unknown[]) => void h.privileged.push(...s),
      handle: (_scheme: string, fn: Fn) => void (h.protocolHandler = fn),
    },
    screen: {
      getPrimaryDisplay: () => ({ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
      getAllDisplays: () => [{ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
    },
    session: {
      defaultSession: {
        setPermissionRequestHandler: (fn: Fn) => void (h.permissionRequest = fn),
        setPermissionCheckHandler: (fn: Fn) => void (h.permissionCheck = fn),
        setDevicePermissionHandler: (fn: Fn) => void (h.devicePermission = fn),
        setDisplayMediaRequestHandler: (fn: Fn) => void (h.displayMedia = fn),
        webRequest: { onHeadersReceived: (fn: Fn) => void (h.headersReceived = fn) },
        on: (ev: string, fn: Fn) => void (ev === 'will-download' ? (h.willDownload = fn) : undefined),
      },
    },
    shell: { openPath: vi.fn(async () => '') },
  };
});

async function boot() {
  fs.mkdirSync(path.join(h.appPath, 'dist', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(h.appPath, 'dist', 'index.html'), '<!doctype html><title>t</title>');
  fs.writeFileSync(path.join(h.appPath, 'dist', 'assets', 'chair.glb'), Buffer.from([1, 2, 3]));
  await import('../../../electron/main');
  h.readyResolve?.();
  for (let i = 0; i < 50 && h.windows.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 20));
}

const win = () => h.windows[0];
const trustedEvent = () => ({ sender: win().webContents, senderFrame: { parent: null, url: 'app://game/index.html' } });

beforeAll(async () => {
  await boot();
});
afterAll(() => {
  fs.rmSync(h.tmp, { recursive: true, force: true });
});

describe('main process — startup', () => {
  it('pins userData to %APPDATA%/Afterlife Lease and registers app:// as a privileged secure scheme', () => {
    expect(h.paths.get('userData')).toBe(path.join(h.appData, 'Afterlife Lease'));
    expect(h.privileged).toEqual([
      { scheme: 'app', privileges: expect.objectContaining({ standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }) },
    ]);
    expect(fs.existsSync(path.join(h.appData, 'Afterlife Lease', 'saves'))).toBe(true);
  });

  it('creates ONE hardened 1600x900 window (min 1280x720, dark, hidden until ready)', () => {
    expect(h.windows).toHaveLength(1);
    const o = win().opts;
    expect(o).toMatchObject({ width: 1600, height: 900, minWidth: 1280, minHeight: 720, show: false, backgroundColor: '#0d0b10' });
    expect(o.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: false,
      backgroundThrottling: false,
    });
    expect(o.webPreferences.preload).toMatch(/preload\.js$/);
    expect(o.webPreferences.additionalArguments).toEqual(['--afterlife-version=1.0.0']);
    expect(win().loadURL).toHaveBeenCalledWith('app://game/index.html');
    expect(win().show).not.toHaveBeenCalled();
    win().emit('ready-to-show');
    expect(win().show).toHaveBeenCalled();
  });

  it('removes the application menu in packaged builds', () => {
    expect(h.menu).toEqual([null]);
  });
});

describe('main process — app:// protocol', () => {
  const req = (url: string) => (h.protocolHandler as Fn)({ url }) as Promise<Response>;
  it('serves build files with CSP on the document', async () => {
    const r = await req('app://game/index.html');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-security-policy')).toMatch(/default-src 'self'/);
    expect(await r.text()).toContain('<title>t</title>');
    const g = await req('app://game/assets/chair.glb');
    expect(g.headers.get('content-type')).toBe('model/gltf-binary');
    expect(new Uint8Array(await g.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
  it('refuses traversal and returns 404 for missing files', async () => {
    fs.writeFileSync(path.join(h.appPath, 'secret.txt'), 'top secret');
    expect((await req('app://game/..%5csecret.txt')).status).toBe(403);
    expect((await req('app://game/%2e%2e/secret.txt')).status).toBe(404); // normalized INSIDE dist
    expect((await req('app://other/index.html')).status).toBe(403);
    expect((await req('app://game/nope.js')).status).toBe(404);
    expect((await req('app://game/assets')).status).toBe(404);
  });
  it('injects the CSP into http(s) documents (dev server) and replaces any existing policy', () => {
    let out: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    (h.headersReceived as Fn)({ resourceType: 'mainFrame', responseHeaders: { 'content-security-policy': ['default-src *'], 'X-Other': ['1'] } }, (r: unknown) => (out = r));
    expect(out.responseHeaders['content-security-policy']).toBeUndefined();
    expect(out.responseHeaders['Content-Security-Policy'][0]).toMatch(/default-src 'self'/);
    expect(out.responseHeaders['X-Other']).toEqual(['1']);
    (h.headersReceived as Fn)({ resourceType: 'image', responseHeaders: {} }, (r: unknown) => (out = r));
    expect(out.responseHeaders['Content-Security-Policy']).toBeUndefined();
  });
});

describe('main process — IPC', () => {
  it('registers a handler for every invoke channel plus quit', () => {
    expect([...h.ipcHandle.keys()].sort()).toEqual([...INVOKE_CHANNELS].sort());
    expect([...h.ipcOn.keys()]).toEqual([IPC.quit]);
  });

  it('trusted top frame can save/load through the real file store', async () => {
    const write = h.ipcHandle.get(IPC.storageWrite)!;
    const read = h.ipcHandle.get(IPC.storageRead)!;
    expect(await write(trustedEvent(), 'slot:a:primary', new Uint8Array([7, 8]))).toEqual({ ok: true, value: null });
    const r = await read(trustedEvent(), 'slot:a:primary');
    expect(Array.from(r.value)).toEqual([7, 8]);
    expect(fs.existsSync(path.join(h.appData, 'Afterlife Lease', 'saves', 'slot.a.primary.dat'))).toBe(true);
  });

  it('rejects untrusted senders: foreign origin, sub-frames, other webContents, missing frame', async () => {
    const read = h.ipcHandle.get(IPC.storageRead)!;
    const forbidden = { ok: false, code: 'forbidden', message: 'not allowed' };
    expect(await read({ sender: win().webContents, senderFrame: { parent: null, url: 'https://evil.example/' } }, 'k')).toEqual(forbidden);
    expect(await read({ sender: win().webContents, senderFrame: { parent: {}, url: 'app://game/index.html' } }, 'k')).toEqual(forbidden);
    expect(await read({ sender: {}, senderFrame: { parent: null, url: 'app://game/index.html' } }, 'k')).toEqual(forbidden);
    expect(await read({ sender: win().webContents, senderFrame: null }, 'k')).toEqual(forbidden);
  });

  it('fullscreen IPC and F11 toggle the window; F11 is consumed', async () => {
    await h.ipcHandle.get(IPC.setFullscreen)!(trustedEvent(), true);
    expect(win().fullscreen).toBe(true);
    const e = { preventDefault: vi.fn() };
    win().webContents.emit('before-input-event', e, { type: 'keyDown', key: 'F11', alt: false, control: false, meta: false });
    expect(win().fullscreen).toBe(false);
    expect(e.preventDefault).toHaveBeenCalled();
    const other = { preventDefault: vi.fn() };
    win().webContents.emit('before-input-event', other, { type: 'keyDown', key: 'F5', alt: false, control: false, meta: false });
    expect(other.preventDefault).not.toHaveBeenCalled();
  });
});

describe('main process — content hardening', () => {
  it('blocks foreign navigation, redirects, window.open and <webview>', () => {
    const [created] = h.appEvents.get('web-contents-created')!;
    const wc = win().webContents;
    created({}, wc);
    expect(wc.openHandler!({ url: 'https://evil.example' })).toEqual({ action: 'deny' });
    const nav = (url: string) => {
      const e = { preventDefault: vi.fn() };
      wc.emit('will-navigate', e, url);
      return e.preventDefault.mock.calls.length > 0;
    };
    expect(nav('https://evil.example/')).toBe(true);
    expect(nav('file:///C:/Windows/')).toBe(true);
    expect(nav('app://game/index.html')).toBe(false);
    const red = { preventDefault: vi.fn() };
    wc.emit('will-redirect', red, 'http://phish.example');
    expect(red.preventDefault).toHaveBeenCalled();
    const wv = { preventDefault: vi.fn() };
    wc.emit('will-attach-webview', wv);
    expect(wv.preventDefault).toHaveBeenCalled();
  });

  it('allows only downloads our page generated (save exports), with an .alsave dialog in Documents', () => {
    const dl = (url: string, filename: string) => {
      const e = { preventDefault: vi.fn() };
      const item = { getURL: () => url, getFilename: () => filename, setSaveDialogOptions: vi.fn() };
      (h.willDownload as Fn)(e, item);
      return { blocked: e.preventDefault.mock.calls.length > 0, opts: item.setSaveDialogOptions.mock.calls[0]?.[0] };
    };
    const ok = dl('blob:app://game/3f1c-uuid', 'afterlife-rotworths-day3.alsave');
    expect(ok.blocked).toBe(false);
    expect(ok.opts.defaultPath).toMatch(/afterlife-rotworths-day3\.alsave$/);
    expect(ok.opts.filters).toEqual([{ name: 'Afterlife Lease save', extensions: ['alsave'] }]);
    expect(dl('data:application/json,{}', 'x.json').blocked).toBe(false);
    expect(dl('https://evil.example/payload.exe', 'payload.exe').blocked).toBe(true);
    expect(dl('blob:https://evil.example/uuid', 'x.alsave').blocked).toBe(true);
    expect(dl('file:///C:/Windows/system32/calc.exe', 'calc.exe').blocked).toBe(true);
    expect(dl('blob:app://game/uuid', '..\\..\\evil.alsave').opts.defaultPath).not.toMatch(/\.\.[\\/]/);
  });

  it('denies every permission except clipboard-write for our page (DOM fullscreen / pointer lock too)', () => {
    const ask = (permission: string, url = 'app://game/index.html') => {
      let granted: boolean | null = null;
      (h.permissionRequest as Fn)({ getURL: () => url }, permission, (g: boolean) => (granted = g), { requestingUrl: url });
      return granted;
    };
    expect(ask('clipboard-sanitized-write')).toBe(true);
    for (const p of ['fullscreen', 'pointerLock', 'keyboardLock', 'media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'openExternal', 'hid', 'serial', 'usb', 'clipboard-read', 'display-capture', 'window-management', 'idle-detection', 'storage-access', 'unknown']) {
      expect(ask(p), p).toBe(false);
    }
    expect(ask('clipboard-sanitized-write', 'https://evil.example/')).toBe(false);
    expect(ask('clipboard-sanitized-write', 'app://game.evil.example/')).toBe(false);
    expect((h.permissionCheck as Fn)({}, 'media', 'app://game')).toBe(false);
    expect((h.permissionCheck as Fn)({}, 'clipboard-sanitized-write', 'app://game')).toBe(true);
    expect((h.permissionCheck as Fn)({}, 'clipboard-sanitized-write', 'https://evil.example')).toBe(false);
  });

  it('never grants a HID/serial/USB device or a screen capture; Bluetooth device pickers are cancelled', () => {
    for (const deviceType of ['hid', 'serial', 'usb']) {
      expect((h.devicePermission as Fn)({ deviceType, origin: 'app://game', device: {} })).toBe(false);
    }
    const capture = vi.fn();
    (h.displayMedia as Fn)({ frame: null, securityOrigin: 'app://game', videoRequested: true, audioRequested: true, userGesture: true }, capture);
    expect(capture).toHaveBeenCalledWith(null);
    // Any webContents (not just the main window) is hardened when it is created.
    const listeners = new Map<string, Fn>();
    const wc = { on: (ev: string, fn: Fn) => void listeners.set(ev, fn), setWindowOpenHandler: vi.fn() };
    const [created] = h.appEvents.get('web-contents-created')!;
    created({}, wc);
    const e = { preventDefault: vi.fn() };
    const pick = vi.fn();
    listeners.get('select-bluetooth-device')!(e, [{ deviceId: 'aa:bb', deviceName: 'Headset' }], pick);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(pick).toHaveBeenCalledWith('');
  });
});

describe('main process — lifecycle', () => {
  it('a second launch focuses (and restores) the existing window', () => {
    win().minimized = true;
    for (const fn of h.appEvents.get('second-instance')!) fn();
    expect(win().restore).toHaveBeenCalled();
    expect(win().focus).toHaveBeenCalled();
  });

  it('renderer crash offers reload; a crash loop quits with an explanation', async () => {
    h.messageBoxResponse = 0;
    win().webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(h.messageBoxes.length).toBe(1);
    expect(win().webContents.reload).toHaveBeenCalledTimes(1);
    win().webContents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 });
    expect(h.messageBoxes.length).toBe(1); // clean exits are not crashes
    const quitsBefore = h.quit;
    for (let i = 0; i < 3; i++) win().webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: 9 });
    await new Promise((r) => setTimeout(r, 10));
    expect(h.errorBoxes.some((m) => /crashed repeatedly/.test(m))).toBe(true);
    expect(h.quit).toBeGreaterThan(quitsBefore);
  });

  it('an explicit quit() overrides a beforeunload veto; untrusted quit is ignored', () => {
    const quits = h.quit;
    h.ipcOn.get(IPC.quit)!({ sender: {}, senderFrame: { parent: null, url: 'https://evil.example' } });
    expect(h.quit).toBe(quits);
    h.ipcOn.get(IPC.quit)!(trustedEvent());
    expect(h.quit).toBe(quits + 1);
    const e = { preventDefault: vi.fn() };
    win().webContents.emit('will-prevent-unload', e);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('a renderer stuck in an error loop cannot flood the log (bounded lines + one "suppressed" note)', async () => {
    for (let i = 0; i < 5000; i++) win().webContents.emit('console-message', { level: 'error', message: `boom ${i}` });
    win().webContents.emit('console-message', { level: 'info', message: 'info is never copied' });
    await new Promise((r) => setTimeout(r, 300));
    const log = fs.readFileSync(path.join(h.appData, 'Afterlife Lease', 'logs', 'main.log'), 'utf8');
    const lines = log.split('\n').filter((l) => l.includes('[renderer] boom'));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(200);
    expect(log).not.toContain('info is never copied');
  });

  it('will-quit persists the window placement atomically and flushes the log', async () => {
    win().emit('close', { preventDefault: vi.fn() });
    const e = { preventDefault: vi.fn() };
    for (const fn of h.appEvents.get('will-quit')!) fn(e);
    const stateFile = path.join(h.appData, 'Afterlife Lease', 'window-state.json');
    expect(JSON.parse(fs.readFileSync(stateFile, 'utf8')).bounds).toEqual({ x: 10, y: 20, width: 1600, height: 900 });
    expect(e.preventDefault).toHaveBeenCalled(); // waits for the log flush once
    // The deferred app.quit() after the flush (or its 1 s cap) must land HERE: left in flight it fired
    // inside the next test under CI load and broke the single-instance quit count.
    const quitsBefore = h.quit;
    for (let i = 0; i < 150 && h.quit === quitsBefore; i++) await new Promise((r) => setTimeout(r, 10));
    expect(h.quit).toBe(quitsBefore + 1);
    const log = fs.readFileSync(path.join(h.appData, 'Afterlife Lease', 'logs', 'main.log'), 'utf8');
    expect(log).toMatch(/starting Afterlife Lease 1\.0\.0/);
    expect(log).toMatch(/renderer process gone: crashed/);
    expect(log).toMatch(/rejected IPC/);
  });
});

describe('main process — single instance', () => {
  it('a second process exits immediately without touching anything', async () => {
    const handlersBefore = h.ipcHandle.size;
    const windowsBefore = h.windows.length;
    const quitsBefore = h.quit;
    h.lock = false;
    vi.resetModules();
    await import('../../../electron/main');
    h.readyResolve?.();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.quit).toBe(quitsBefore + 1);
    expect(h.windows.length).toBe(windowsBefore);
    expect(h.ipcHandle.size).toBe(handlersBefore);
  });
});

describe('safeDownloadName', () => {
  it('strips paths, illegal characters and device names', async () => {
    const { safeDownloadName } = await import('../../../electron/main');
    expect(safeDownloadName('afterlife-x-day3.alsave')).toBe('afterlife-x-day3.alsave');
    expect(safeDownloadName('..\\..\\evil.alsave')).toBe('evil.alsave');
    expect(safeDownloadName('../../etc/passwd')).toBe('passwd');
    expect(safeDownloadName('a<b>c:d"e|f?g*h.alsave')).toBe('a_b_c_d_e_f_g_h.alsave');
    expect(safeDownloadName('CON.alsave')).toBe('_CON.alsave');
    expect(safeDownloadName(' ..hidden. ')).toBe('hidden');
    expect(safeDownloadName('')).toBe('afterlife.alsave');
    expect(safeDownloadName('\u0000\u0001')).toBe('__');
  });
});

describe('devServerUrl', () => {
  it('honours only loopback http, only when unpackaged', async () => {
    const { devServerUrl } = await import('../../../electron/main');
    expect(devServerUrl('http://localhost:5173', false)).toBe('http://localhost:5173/');
    expect(devServerUrl('http://127.0.0.1:5180/x', false)).toBe('http://127.0.0.1:5180/');
    expect(devServerUrl('http://localhost:5173', true)).toBeNull();
    expect(devServerUrl('https://evil.example', false)).toBeNull();
    expect(devServerUrl('http://localhost.evil.example:5173', false)).toBeNull();
    expect(devServerUrl('file:///C:/x', false)).toBeNull();
    expect(devServerUrl(undefined, false)).toBeNull();
    expect(devServerUrl('::nonsense', false)).toBeNull();
  });
});

describe('main process — graceful window close (save on quit)', () => {
  it('hides at once, runs the page unload handlers, waits for storage to go quiet, then closes', async () => {
    h.lock = true;
    vi.resetModules();
    const before = h.windows.length;
    await import('../../../electron/main');
    h.readyResolve?.();
    for (let i = 0; i < 100 && h.windows.length === before; i++) await new Promise((r) => setTimeout(r, 10));
    const w = h.windows[h.windows.length - 1];
    const ev = () => ({ sender: w.webContents, senderFrame: { parent: null, url: 'app://game/index.html' } });
    const e = { preventDefault: vi.fn() };
    const t0 = Date.now();
    w.emit('close', e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(w.hide).toHaveBeenCalled();
    expect(w.webContents.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining("new Event('beforeunload'"), true);
    // The game's final autosave arrives during the grace period...
    await new Promise((r) => setTimeout(r, 150));
    expect(await h.ipcHandle.get(IPC.storageWrite)!(ev(), 'slot:autosave:primary', new Uint8Array([1, 2]))).toEqual({ ok: true, value: null });
    // ...a second close click while closing is swallowed...
    const e2 = { preventDefault: vi.fn() };
    w.emit('close', e2);
    expect(e2.preventDefault).toHaveBeenCalled();
    expect(w.close).not.toHaveBeenCalled();
    // ...and the real close happens only after >= 400 ms of storage silence.
    for (let i = 0; i < 300 && w.close.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(w.close).toHaveBeenCalledTimes(1);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(150 + 400);
    expect(fs.existsSync(path.join(h.appData, 'Afterlife Lease', 'saves', 'slot.autosave.primary.dat'))).toBe(true);
    // Once closing has been granted, close events pass straight through.
    const e3 = { preventDefault: vi.fn() };
    w.emit('close', e3);
    expect(e3.preventDefault).not.toHaveBeenCalled();
  });

  it('a hung page cannot block closing: executeJavaScript never resolving is bounded', async () => {
    vi.resetModules();
    const before = h.windows.length;
    await import('../../../electron/main');
    h.readyResolve?.();
    for (let i = 0; i < 100 && h.windows.length === before; i++) await new Promise((r) => setTimeout(r, 10));
    const w = h.windows[h.windows.length - 1];
    w.webContents.executeJavaScript = vi.fn(() => new Promise(() => undefined));
    const t0 = Date.now();
    w.emit('close', { preventDefault: vi.fn() });
    for (let i = 0; i < 900 && w.close.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(w.close).toHaveBeenCalledTimes(1);
    expect(Date.now() - t0).toBeLessThan(8000); // hard upper bound on a hung renderer
  }, 15_000);

  it("waits for the page's own persistence idle signal — even across long gaps WITHOUT storage IPC", async () => {
    // A big save is mostly CPU work between storage calls. Here the page's final write arrives 1.8 s after
    // the close (no IPC at all before it) and the page reports idle at 2.3 s. Inferring "done" from IPC
    // silence would have exited at ~0.4-1.4 s and dropped that write.
    vi.resetModules();
    const before = h.windows.length;
    await import('../../../electron/main');
    h.readyResolve?.();
    for (let i = 0; i < 100 && h.windows.length === before; i++) await new Promise((r) => setTimeout(r, 10));
    const w = h.windows[h.windows.length - 1];
    const ev = () => ({ sender: w.webContents, senderFrame: { parent: null, url: 'app://game/index.html' } });
    const scripts: string[] = [];
    let wroteAt = 0;
    w.webContents.executeJavaScript = vi.fn(async (code: string) => {
      scripts.push(code);
      if (!code.includes('__afterlifeLeasePersistence') || !code.includes('whenIdle')) return undefined;
      await new Promise((r) => setTimeout(r, 2300));
      return 'idle';
    });
    const t0 = Date.now();
    setTimeout(() => {
      void h.ipcHandle.get(IPC.storageWrite)!(ev(), 'slot:quit:primary', new Uint8Array([9])).then(() => (wroteAt = Date.now()));
    }, 1800);
    w.emit('close', { preventDefault: vi.fn() });
    for (let i = 0; i < 600 && w.close.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(w.close).toHaveBeenCalledTimes(1);
    const closedAt = Date.now();
    expect(wroteAt).toBeGreaterThan(0);
    expect(closedAt).toBeGreaterThanOrEqual(wroteAt);
    // The idle signal comes from a 2300 ms timer and the bound is read with Date.now(): a Node timer can fire a
    // millisecond early against the wall clock (2299 on the Spark runner, 2026-11-12). The point of the bound is
    // "not at the 0.4-1.4 s an IPC-silence guess would give", so 5 ms of slack changes nothing it protects.
    expect(closedAt - t0).toBeGreaterThanOrEqual(2295);
    expect(scripts[0]).toContain("new Event('beforeunload'"); // unload handlers still run first
    expect(fs.existsSync(path.join(h.appData, 'Afterlife Lease', 'saves', 'slot.quit.primary.dat'))).toBe(true);
  }, 15_000);

  it('PAGE_FLUSH_SCRIPT is valid page JavaScript: unload handlers first, then the hook; every outcome covered', async () => {
    const vm = await import('node:vm');
    const { PAGE_FLUSH_SCRIPT, PAGE_QUIET_MS, PAGE_IDLE_TIMEOUT_MS } = await import('../../../electron/main');
    class FakeEvent {
      constructor(
        readonly type: string,
        readonly init: unknown,
      ) {}
    }
    const run = (hook: unknown, dispatchThrows = false) => {
      const events: string[] = [];
      const ctx: Record<string, unknown> = {
        Event: FakeEvent,
        window: {
          dispatchEvent: (e: FakeEvent) => {
            events.push(e.type);
            if (dispatchThrows) throw new Error('handler exploded');
            return true;
          },
        },
      };
      if (hook !== undefined) ctx.__afterlifeLeasePersistence = hook;
      const p = vm.runInNewContext(PAGE_FLUSH_SCRIPT, ctx) as Promise<string>;
      return p.then((r) => ({ r, events }));
    };
    expect(await run(undefined)).toEqual({ r: 'no-hook', events: ['beforeunload'] });
    let seen: unknown = null;
    const idle = await run({ whenIdle: async (o: unknown) => ((seen = o), true) });
    expect(idle).toEqual({ r: 'idle', events: ['beforeunload'] });
    expect(seen).toEqual({ quietMs: PAGE_QUIET_MS, timeoutMs: PAGE_IDLE_TIMEOUT_MS });
    expect((await run({ whenIdle: async () => false })).r).toBe('timeout');
    expect((await run({ whenIdle: async () => Promise.reject(new Error('x')) })).r).toBe('error');
    expect((await run({ whenIdle: 'not a function' })).r).toBe('no-hook');
    expect((await run({ whenIdle: async () => true }, true)).r).toBe('idle'); // a throwing unload handler cannot skip the flush
  });

  it("a page that reports 'timeout' (still busy after its own deadline) is closed promptly, not waited on twice", async () => {
    vi.resetModules();
    const before = h.windows.length;
    await import('../../../electron/main');
    h.readyResolve?.();
    for (let i = 0; i < 100 && h.windows.length === before; i++) await new Promise((r) => setTimeout(r, 10));
    const w = h.windows[h.windows.length - 1];
    w.webContents.executeJavaScript = vi.fn(async () => 'timeout');
    const t0 = Date.now();
    w.emit('close', { preventDefault: vi.fn() });
    for (let i = 0; i < 300 && w.close.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(w.close).toHaveBeenCalledTimes(1);
    expect(Date.now() - t0).toBeLessThan(1500);
  }, 15_000);

  it('a second launch while the closing window flushes saves does not bring that window back; the game starts again after exit', async () => {
    vi.resetModules();
    const before = h.windows.length;
    await import('../../../electron/main');
    h.readyResolve?.();
    for (let i = 0; i < 100 && h.windows.length === before; i++) await new Promise((r) => setTimeout(r, 10));
    const w = h.windows[h.windows.length - 1];
    // Only THIS process's handler: the list also holds the handlers of the earlier imports (other windows).
    const handlers = h.appEvents.get('second-instance')!;
    const secondLaunch = handlers[handlers.length - 1];
    const relaunches = h.relaunch;
    secondLaunch(); // while the game is running: focus it, nothing else
    expect(w.show).toHaveBeenCalledTimes(1);
    expect(h.relaunch).toBe(relaunches);
    w.show.mockClear();
    w.focus.mockClear();
    // The player closes the window (hidden, saves flushing) and starts the game again — twice, impatiently.
    w.emit('close', { preventDefault: vi.fn() });
    expect(w.hide).toHaveBeenCalledTimes(1);
    secondLaunch();
    secondLaunch();
    expect({ shown: w.show.mock.calls.length, focused: w.focus.mock.calls.length, relaunches: h.relaunch - relaunches }).toEqual({
      shown: 0,
      focused: 0,
      relaunches: 1,
    });
    // The close still completes; a launch after that neither shows the window nor queues another start.
    for (let i = 0; i < 300 && w.close.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(w.close).toHaveBeenCalledTimes(1);
    secondLaunch();
    expect(w.show).not.toHaveBeenCalled();
    expect(h.relaunch).toBe(relaunches + 1);
  });

  it('a second launch after the window is gone (final log flush) also starts the game again after exit', async () => {
    vi.resetModules();
    const before = h.windows.length;
    await import('../../../electron/main');
    h.readyResolve?.();
    for (let i = 0; i < 100 && h.windows.length === before; i++) await new Promise((r) => setTimeout(r, 10));
    const w = h.windows[h.windows.length - 1];
    const handlers = h.appEvents.get('second-instance')!;
    const secondLaunch = handlers[handlers.length - 1];
    const relaunches = h.relaunch;
    w.emit('close', { preventDefault: vi.fn() });
    for (let i = 0; i < 300 && w.close.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(w.close).toHaveBeenCalledTimes(1);
    w.emit('closed'); // the window is destroyed; the process is still alive while the log flushes
    secondLaunch();
    expect(w.show).not.toHaveBeenCalled();
    expect(h.relaunch).toBe(relaunches + 1);
  });
});

describe('main process — hung renderer ("not responding" dialog)', () => {
  // A fresh main process per test: the first one has been through a crash loop and is quitting.
  const freshWindow = async () => {
    h.lock = true;
    vi.resetModules();
    const before = h.windows.length;
    await import('../../../electron/main');
    h.readyResolve?.();
    for (let i = 0; i < 100 && h.windows.length === before; i++) await new Promise((r) => setTimeout(r, 10));
    return h.windows[h.windows.length - 1];
  };
  const tick = () => new Promise((r) => setTimeout(r, 10));

  it('choosing Reload for a hung renderer is not reported (or counted) as a crash', async () => {
    const w = await freshWindow();
    const boxes = h.messageBoxes.length;
    const errorBoxes = h.errorBoxes.length;
    const quits = h.quit;
    try {
      h.messageBoxResponse = 1; // "Reload" in the not-responding dialog (the same index is "Quit" in the crash dialog)
      w.emit('unresponsive');
      await tick();
      expect(h.messageBoxes[boxes].message).toMatch(/not responding/);
      expect(w.webContents.forcefullyCrashRenderer).toHaveBeenCalledTimes(1);
      expect(w.webContents.reload).toHaveBeenCalledTimes(1);
      // Electron then reports the renderer we just killed (forcefullyCrashRenderer: reason 'killed' or 'crashed').
      w.webContents.emit('render-process-gone', {}, { reason: 'killed', exitCode: 2 });
      await tick();
      // No "The game stopped unexpectedly" dialog over the reloading page, whose Quit/Esc would exit the game.
      expect({ dialogs: h.messageBoxes.length - boxes, quits: h.quit - quits, reloads: w.webContents.reload.mock.calls.length }).toEqual({
        dialogs: 1,
        quits: 0,
        reloads: 1,
      });
      // One-shot, and it used none of the three crashes allowed per minute: three real crashes afterwards
      // each still get the crash dialog, and none of them trips "crashed repeatedly".
      h.messageBoxResponse = 0;
      for (let i = 0; i < 3; i++) w.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
      await tick();
      expect(h.messageBoxes.slice(boxes + 1).map((b) => b.message)).toEqual(Array(3).fill('The game stopped unexpectedly.'));
      expect(h.errorBoxes.length).toBe(errorBoxes);
      expect(h.quit).toBe(quits);
    } finally {
      h.messageBoxResponse = 0;
    }
  });

  it('a hang reload that Electron reports nothing for does not hide the next real crash', async () => {
    const w = await freshWindow();
    const boxes = h.messageBoxes.length;
    try {
      h.messageBoxResponse = 1;
      w.emit('unresponsive');
      await tick();
      expect(w.webContents.reload).toHaveBeenCalledTimes(1);
      // No render-process-gone arrives; the reloaded page finishes loading. Later the renderer really crashes.
      w.webContents.emit('did-finish-load');
      h.messageBoxResponse = 0;
      w.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
      await tick();
      expect(h.messageBoxes.slice(boxes).map((b) => b.message)).toEqual(['Afterlife Lease is not responding.', 'The game stopped unexpectedly.']);
      expect(w.webContents.reload).toHaveBeenCalledTimes(2);
    } finally {
      h.messageBoxResponse = 0;
    }
  });
});
