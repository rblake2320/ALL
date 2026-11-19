/**
 * Electron main process for Afterlife Lease (Windows-first; also runs on macOS/Linux).
 *
 * Security: contextIsolation + sandbox + no Node in the renderer, app:// custom protocol (no
 * file://), strict CSP on every document, navigation / window.open / <webview> blocked, permission
 * requests denied except clipboard-write (device/HID/serial/USB/Bluetooth/screen capture denied too), IPC only
 * from our own top frame
 * with strict argument validation (ipcHandlers.ts).
 * Robustness: single-instance lock (protects the saves folder across processes), atomic file store,
 * renderer crash / hang recovery with crash-loop protection, rotating log in userData/logs.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, screen, session, shell } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent, Session, WebContents } from 'electron';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { APP_ENTRY_URL, APP_SCHEME, resolveAppRequest, responseHeaders } from './appProtocol';
import { buildCsp } from './csp';
import { DEFAULT_MAX_VALUE_BYTES, FileStore } from './fileStore';
import { createIpcHandlers, isTrustedSenderUrl } from './ipcHandlers';
import { INVOKE_CHANNELS, IPC, VERSION_ARG } from './ipcChannels';
import { createFileLogger, createLogBudget, type Logger } from './logger';
import { computePlacement, MIN_HEIGHT, MIN_WIDTH, readWindowState, writeWindowStateSync, type WindowState } from './windowState';

export const APP_NAME = 'Afterlife Lease';
export const APP_ID = 'com.afterlifelease.game';
const BACKGROUND = '#0d0b10';
/**
 * The ONLY web permission the page gets: writing text to the clipboard (Diagnostics / crash screen "Copy").
 * DOM fullscreen and pointer lock are denied on purpose: fullscreen goes through the bridge
 * (afterlifeNative.setFullscreen -> BrowserWindow.setFullScreen, F11), which needs no web permission.
 */
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write']);

/** Quit flush timing: the page's persistence must be quiet this long (it measures CPU work too)... */
export const PAGE_QUIET_MS = 500;
/** ...within this budget (the page answers 'timeout' after it)... */
export const PAGE_IDLE_TIMEOUT_MS = 5_000;
/** ...and closing never takes longer than this, even with a hung renderer. */
export const CLOSE_DEADLINE_MS = 7_000;

/**
 * Runs in the page on window close: fire the game's `beforeunload` handlers (it autosaves there), then
 * await the persistence layer's OWN idle signal (src/persistence/activity.ts) — every save is counted from
 * call to settle, CPU work included, so long hashing/gzip/verification gaps between storage calls cannot
 * be mistaken for "done". Resolves 'idle' | 'timeout' | 'no-hook' (page without the hook) | 'error'.
 */
export const PAGE_FLUSH_SCRIPT =
  "(async () => { try { window.dispatchEvent(new Event('beforeunload', { cancelable: true })); } catch (e) { /* page handler threw */ }" +
  ' const hook = globalThis.__afterlifeLeasePersistence;' +
  " if (!hook || typeof hook.whenIdle !== 'function') return 'no-hook';" +
  ` try { return (await hook.whenIdle({ quietMs: ${PAGE_QUIET_MS}, timeoutMs: ${PAGE_IDLE_TIMEOUT_MS} })) ? 'idle' : 'timeout'; }` +
  " catch (e) { return 'error'; } })()";

/** Dev server URL (only honoured for unpackaged runs, only loopback http). */
export function devServerUrl(raw: string | undefined, packaged: boolean): string | null {
  if (packaged || !raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return null;
    return u.origin + '/';
  } catch {
    return null;
  }
}

/** A download file name that is safe on every OS (no separators, reserved names or control chars). */
export function safeDownloadName(raw: string): string {
  const last = raw.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  let name = last.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  if (/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i.test(name)) name = `_${name}`;
  return name.slice(0, 120) || 'afterlife.alsave';
}

/** Renderer console lines copied into main.log: at most this many per window... */
export const RENDERER_LOG_LINES_PER_WINDOW = 200;
export const RENDERER_LOG_WINDOW_MS = 10_000;

function errno(e: unknown): string | undefined {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : undefined;
}

function describeError(e: unknown): string {
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}

function main(): void {
  // Deterministic data location for dev and packaged builds: %APPDATA%\Afterlife Lease (Windows),
  // ~/Library/Application Support/Afterlife Lease (macOS), ~/.config/Afterlife Lease (Linux).
  app.setName(APP_NAME);
  app.setPath('userData', path.join(app.getPath('appData'), APP_NAME));

  // One process owns the saves folder. A second launch just focuses the running game.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
  ]);
  app.enableSandbox();
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

  const packaged = app.isPackaged;
  const devUrl = devServerUrl(process.env.ELECTRON_RENDERER_URL, packaged);
  const devOrigin = devUrl ? new URL(devUrl).origin : null;
  const userData = app.getPath('userData');
  const savesDir = path.join(userData, 'saves');
  const windowStateFile = path.join(userData, 'window-state.json');
  const distDir = path.join(app.getAppPath(), 'dist');
  // No WebAssembly today (no Draco/meshopt/KTX2 decoders): the CSP stays without 'wasm-unsafe-eval'
  // (tests/unit/electron/protocol.test.ts fails if a shipped GLB starts needing one).
  const csp = buildCsp({ devOrigin, allowWasm: false });
  const log: Logger = createFileLogger({ dir: path.join(userData, 'logs'), echo: packaged ? undefined : (l) => console.log(l) });
  log.info(`starting ${APP_NAME} ${app.getVersion()} (electron ${process.versions.electron}, ${process.platform}-${process.arch}, packaged=${packaged})`);

  process.on('uncaughtException', (e) => log.error(`uncaught exception in main: ${describeError(e)}`));
  process.on('unhandledRejection', (e) => log.error(`unhandled rejection in main: ${describeError(e)}`));

  const store = new FileStore({ dir: savesDir, log: (level, msg) => log.log(level, `[saves] ${msg}`) });
  let mainWindow: BrowserWindow | null = null;
  let forceQuit = false;
  // Storage IPC activity, observed so a closing window can wait for the game's final save to land.
  let storageInFlight = 0;
  let lastStorageActivity = 0;
  let lastWindowState: WindowState | null = null;
  const crashTimes: number[] = [];
  const rendererLogBudget = createLogBudget(RENDERER_LOG_LINES_PER_WINDOW, RENDERER_LOG_WINDOW_MS);

  const requestQuit = () => {
    forceQuit = true;
    app.quit();
  };

  const isTrustedEvent = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
    const frame = event.senderFrame;
    if (!frame || frame.parent !== null) return false;
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return false;
    return isTrustedSenderUrl(frame.url, devOrigin);
  };

  const hardenContents = (contents: WebContents) => {
    contents.setWindowOpenHandler(({ url }) => {
      log.warn(`blocked window.open(${url.slice(0, 200)})`);
      return { action: 'deny' };
    });
    const guard = (event: { preventDefault(): void }, url: string, what: string) => {
      if (!isTrustedSenderUrl(url, devOrigin)) {
        event.preventDefault();
        log.warn(`blocked ${what} to ${url.slice(0, 200)}`);
      }
    };
    contents.on('will-navigate', (e, url) => guard(e, url, 'navigation'));
    contents.on('will-redirect', (e, url) => guard(e, url, 'redirect'));
    contents.on('will-frame-navigate', (e) => {
      if (!e.isMainFrame) guard(e, e.url, 'sub-frame navigation');
    });
    contents.on('will-attach-webview', (e) => {
      e.preventDefault();
      log.warn('blocked <webview>');
    });
    // Web Bluetooth: without a handler Electron picks the FIRST device found. Always cancel.
    contents.on('select-bluetooth-device', (e, _devices, callback) => {
      e.preventDefault();
      callback('');
      log.warn('blocked a Bluetooth device request');
    });
  };

  const installSessionSecurity = (ses: Session) => {
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      const ok = ALLOWED_PERMISSIONS.has(permission) && isTrustedSenderUrl(details.requestingUrl || wc.getURL(), devOrigin);
      if (!ok) log.warn(`denied permission request: ${permission}`);
      callback(ok);
    });
    ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => ALLOWED_PERMISSIONS.has(permission) && isTrustedSenderUrl(requestingOrigin, devOrigin));
    // WebHID / WebSerial / WebUSB device grants and screen capture (getDisplayMedia): never.
    ses.setDevicePermissionHandler(() => false);
    ses.setDisplayMediaRequestHandler((_request, callback) => {
      log.warn('denied a screen-capture request');
      callback(null);
    });
    // Downloads: only files our own page generated (save exports via blob:/data: URLs). The Save
    // dialog starts in Documents with an .alsave filter; anything else is cancelled.
    ses.on('will-download', (event, item) => {
      const url = item.getURL();
      const inner = url.startsWith('blob:') ? url.slice(5) : null;
      if (!url.startsWith('data:') && !(inner !== null && isTrustedSenderUrl(inner, devOrigin))) {
        event.preventDefault();
        log.warn(`blocked download of ${url.slice(0, 120)}`);
        return;
      }
      const name = safeDownloadName(item.getFilename() || '');
      item.setSaveDialogOptions({
        title: 'Export save',
        defaultPath: path.join(app.getPath('documents'), name),
        filters: name.toLowerCase().endsWith('.alsave') ? [{ name: 'Afterlife Lease save', extensions: ['alsave'] }] : [],
      });
    });
    // CSP for documents served over http(s) (the Vite dev server). app:// responses carry it already.
    ses.webRequest.onHeadersReceived((details, callback) => {
      const headers: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(details.responseHeaders ?? {})) {
        if (k.toLowerCase() !== 'content-security-policy') headers[k] = Array.isArray(v) ? v : [String(v)];
      }
      if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') headers['Content-Security-Policy'] = [csp];
      callback({ responseHeaders: headers });
    });
  };

  const registerAppProtocol = () => {
    protocol.handle(APP_SCHEME, async (request) => {
      const r = resolveAppRequest(distDir, request.url);
      if (!r.ok) return new Response(null, { status: r.status });
      try {
        const data = await fsp.readFile(r.filePath);
        return new Response(new Uint8Array(data.buffer, data.byteOffset, data.byteLength) as Uint8Array<ArrayBuffer>, {
          status: 200,
          headers: responseHeaders(r.filePath, csp),
        });
      } catch (e) {
        const code = errno(e);
        if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR') return new Response(null, { status: 404 });
        log.error(`app:// failed to serve ${r.relPath}: ${describeError(e)}`);
        return new Response(null, { status: 500 });
      }
    });
  };

  const registerIpc = () => {
    const handlers = createIpcHandlers({
      store,
      window: () =>
        mainWindow && !mainWindow.isDestroyed()
          ? { setFullscreen: (on) => mainWindow?.setFullScreen(on), isFullscreen: () => mainWindow?.isFullScreen() ?? false }
          : null,
      app: {
        openSavesFolder: async () => {
          await store.init();
          const err = await shell.openPath(store.dir);
          if (err) throw new Error(`could not open the saves folder: ${err}`);
        },
        quit: requestQuit,
      },
      maxValueBytes: DEFAULT_MAX_VALUE_BYTES,
      log: (level, msg) => log.log(level, msg),
    });
    for (const channel of INVOKE_CHANNELS) {
      const isStorage = channel.startsWith('afterlife:storage:');
      ipcMain.handle(channel, async (event, ...args: unknown[]) => {
        if (!isTrustedEvent(event)) {
          log.warn(`rejected IPC ${channel} from an untrusted sender`);
          return { ok: false, code: 'forbidden', message: 'not allowed' };
        }
        if (!isStorage) return handlers.invoke[channel](args);
        storageInFlight++;
        lastStorageActivity = Date.now();
        try {
          return await handlers.invoke[channel](args);
        } finally {
          storageInFlight--;
          lastStorageActivity = Date.now();
        }
      });
    }
    ipcMain.on(IPC.quit, (event, ...args: unknown[]) => {
      if (isTrustedEvent(event)) handlers.quit(args);
      else log.warn('rejected IPC quit from an untrusted sender');
    });
  };

  /** Resolve once no storage IPC has been active for `quietMs` (or after `maxMs`). */
  const waitForStorageIdle = async (quietMs: number, maxMs: number): Promise<boolean> => {
    const start = Date.now();
    for (;;) {
      const now = Date.now();
      if (storageInFlight === 0 && now - Math.max(lastStorageActivity, start) >= quietMs) return true;
      if (now - start >= maxMs) return false;
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  /**
   * Closing the window (X button, Alt+F4, taskbar): hide it at once, run the page's beforeunload
   * handlers (the game autosaves there) and keep the process alive until the page's persistence layer
   * reports idle (PAGE_FLUSH_SCRIPT), so "save on quit" actually reaches the disk. Pages without the hook
   * fall back to "storage IPC quiet for 400 ms". Bounded by CLOSE_DEADLINE_MS: a hung page never blocks
   * closing for long. An explicit quit() from the game skips all of this (it saved first).
   */
  const gracefulClose = async (win: BrowserWindow) => {
    log.info('window closing: letting the game flush its saves');
    const deadline = Date.now() + CLOSE_DEADLINE_MS;
    const remaining = (cap: number) => Math.max(0, Math.min(cap, deadline - Date.now()));
    let outcome = 'error';
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const hung = new Promise<string>((r) => {
        timer = setTimeout(() => r('hung'), PAGE_IDLE_TIMEOUT_MS + 1000);
      });
      const r: unknown = await Promise.race([win.webContents.executeJavaScript(PAGE_FLUSH_SCRIPT, true), hung]);
      outcome = r === 'idle' || r === 'timeout' || r === 'hung' || r === 'error' ? r : 'no-hook';
    } catch (e) {
      log.warn(`could not run unload handlers: ${describeError(e)}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (outcome === 'idle') {
      // Every save settled in the page; let in-flight storage replies finish (normally instant).
      await waitForStorageIdle(0, remaining(1000));
      return;
    }
    if (outcome === 'timeout' || outcome === 'hung') {
      log.warn(`closing while the game is still saving (${outcome}); saves remain old-or-new consistent`);
      await waitForStorageIdle(0, remaining(1000));
      return;
    }
    // No hook (older page, dev harness) or the script failed: infer from storage IPC silence.
    const idle = await waitForStorageIdle(400, remaining(CLOSE_DEADLINE_MS));
    if (!idle) log.warn('closing with storage still busy (saves remain old-or-new consistent)');
  };

  const rememberWindowState = (win: BrowserWindow) => {
    if (win.isDestroyed()) return;
    lastWindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized(), fullscreen: win.isFullScreen() };
  };

  const onRendererGone = (win: BrowserWindow, reason: string, exitCode: number) => {
    log.error(`renderer process gone: ${reason} (exit code ${exitCode})`);
    if (reason === 'clean-exit' || win.isDestroyed() || forceQuit) return;
    const now = Date.now();
    while (crashTimes.length > 0 && now - crashTimes[0] > 60_000) crashTimes.shift();
    crashTimes.push(now);
    if (crashTimes.length > 3) {
      dialog.showErrorBox(APP_NAME, `The game crashed repeatedly and will close. Your saves are safe.\n\nA log was written to:\n${log.file}`);
      requestQuit();
      return;
    }
    void dialog
      .showMessageBox(win, {
        type: 'error',
        title: APP_NAME,
        message: 'The game stopped unexpectedly.',
        detail: 'Your saves are safe. Reload to return to the main menu and continue from your last save.',
        buttons: ['Reload', 'Quit'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      .then((r) => {
        if (r.response === 0 && !win.isDestroyed()) win.webContents.reload();
        else requestQuit();
      })
      .catch((e) => log.error(`crash dialog failed: ${describeError(e)}`));
  };

  // True from the first close request on: the window is hidden while saves flush, then the process exits.
  let closing = false;
  const createWindow = async () => {
    const state = await readWindowState(windowStateFile);
    const primary = screen.getPrimaryDisplay();
    const areas = [primary.workArea, ...screen.getAllDisplays().filter((d) => d.id !== primary.id).map((d) => d.workArea)];
    const p = computePlacement(state, areas);
    const win = new BrowserWindow({
      width: p.width,
      height: p.height,
      x: p.x,
      y: p.y,
      minWidth: Math.min(MIN_WIDTH, primary.workArea.width),
      minHeight: Math.min(MIN_HEIGHT, primary.workArea.height),
      show: false,
      backgroundColor: BACKGROUND,
      title: APP_NAME,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
        webviewTag: false,
        navigateOnDragDrop: false,
        safeDialogs: true,
        spellcheck: false,
        devTools: !packaged,
        // The game keeps simulating from a timer while unfocused (setting "pause when unfocused" off).
        backgroundThrottling: false,
        additionalArguments: [`${VERSION_ARG}${app.getVersion()}`],
      },
    });
    mainWindow = win;
    win.once('ready-to-show', () => {
      if (p.maximized) win.maximize();
      if (p.fullscreen) win.setFullScreen(true);
      win.show();
      win.focus();
    });
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'F11' && !input.alt && !input.control && !input.meta) {
        event.preventDefault();
        win.setFullScreen(!win.isFullScreen());
      } else if (!packaged && input.key === 'F12') {
        event.preventDefault();
        win.webContents.toggleDevTools();
      }
    });
    // Set when the player chose "Reload" for a hung renderer: the renderer we kill for that is not a crash.
    let reloadingHung = false;
    win.webContents.on('render-process-gone', (_e, details) => {
      if (reloadingHung) {
        reloadingHung = false;
        log.info(`hung renderer ended for the reload: ${details.reason} (exit code ${details.exitCode})`);
        return;
      }
      onRendererGone(win, details.reason, details.exitCode);
    });
    // If Electron reported nothing for that kill, the next real crash must still be reported.
    win.webContents.on('did-finish-load', () => {
      reloadingHung = false;
    });
    let hang: AbortController | null = null;
    win.on('unresponsive', () => {
      log.warn('renderer became unresponsive');
      if (hang) return;
      hang = new AbortController();
      dialog
        .showMessageBox(win, {
          type: 'warning',
          title: APP_NAME,
          message: 'Afterlife Lease is not responding.',
          detail: 'You can keep waiting, or reload the game (progress since your last save will be lost).',
          buttons: ['Keep waiting', 'Reload'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
          signal: hang.signal,
        })
        .then((r) => {
          hang = null;
          if (r.response === 1 && !win.isDestroyed()) {
            log.warn('user chose to reload the hung renderer');
            reloadingHung = true;
            win.webContents.forcefullyCrashRenderer();
            win.webContents.reload();
          }
        })
        .catch(() => {
          hang = null;
        });
    });
    win.on('responsive', () => {
      log.info('renderer responsive again');
      hang?.abort();
      hang = null;
    });
    win.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3 /* ERR_ABORTED (navigation replaced) */) return;
      log.error(`failed to load ${url}: ${description} (${code})`);
      dialog.showErrorBox(APP_NAME, `The game files could not be loaded (${description}).\nPlease reinstall the game.\n\nLog: ${log.file}`);
    });
    win.webContents.on('console-message', (e) => {
      const level = (e as unknown as { level?: unknown }).level;
      const message = (e as unknown as { message?: unknown }).message;
      const lvl = typeof level === 'number' ? level : level === 'warning' ? 2 : level === 'error' ? 3 : 0;
      if (lvl < 2 || typeof message !== 'string') return;
      // A page stuck in an error loop (every frame) must not flood the log queue / disk: bounded rate.
      const verdict = rendererLogBudget.take(Date.now());
      if (verdict === 'drop') return;
      if (verdict === 'resume') log.warn(`[renderer] ${rendererLogBudget.suppressedSinceLast()} message(s) suppressed (flood)`);
      log.log(lvl >= 3 ? 'error' : 'warn', `[renderer] ${message.slice(0, 2000)}`);
    });
    win.webContents.on('will-prevent-unload', (e) => {
      // A beforeunload handler may veto closing (e.g. to autosave first); an explicit quit() wins.
      if (forceQuit) e.preventDefault();
    });
    win.on('resize', () => rememberWindowState(win));
    win.on('move', () => rememberWindowState(win));
    win.on('close', (event) => {
      rememberWindowState(win);
      if (forceQuit) return;
      event.preventDefault();
      if (closing) return;
      closing = true;
      win.hide();
      void gracefulClose(win).finally(() => {
        forceQuit = true;
        if (!win.isDestroyed()) win.close();
      });
    });
    win.on('closed', () => {
      if (mainWindow === win) mainWindow = null;
    });
    await win.loadURL(devUrl ?? APP_ENTRY_URL);
  };

  let relaunchQueued = false;
  app.on('second-instance', () => {
    // This process is on its way out (window hidden while saves flush, or already gone) and the second
    // process has exited: showing the window again would only flash it before it is destroyed. Start the
    // game again once this process has exited and released the single-instance lock.
    if (closing || forceQuit) {
      if (!relaunchQueued) {
        relaunchQueued = true;
        log.info('second launch during shutdown: the game will start again after this exit');
        app.relaunch();
      }
      return;
    }
    const win = mainWindow;
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.on('web-contents-created', (_e, contents) => hardenContents(contents));
  app.on('child-process-gone', (_e, details) => log.warn(`${details.type} process gone: ${details.reason} (exit ${details.exitCode})`));
  app.on('window-all-closed', () => app.quit());

  let flushed = false;
  app.on('will-quit', (event) => {
    if (lastWindowState) {
      try {
        writeWindowStateSync(windowStateFile, lastWindowState);
      } catch (e) {
        log.warn(`could not save window placement: ${describeError(e)}`);
      }
      lastWindowState = null;
    }
    if (flushed) return;
    event.preventDefault();
    log.info('quitting');
    const timeout = new Promise<void>((r) => setTimeout(r, 1000));
    void Promise.race([log.flush(), timeout]).finally(() => {
      flushed = true;
      app.quit();
    });
  });

  app
    .whenReady()
    .then(async () => {
      try {
        const { removedTemps } = await store.init();
        log.info(`saves folder: ${store.dir}${removedTemps.length ? ` (cleaned ${removedTemps.length} stale temp file(s))` : ''}`);
      } catch (e) {
        // The game still starts; every save attempt will report the problem in-game.
        log.error(`saves folder unavailable: ${describeError(e)}`);
      }
      if (packaged) Menu.setApplicationMenu(null);
      installSessionSecurity(session.defaultSession);
      registerAppProtocol();
      registerIpc();
      await createWindow();
    })
    .catch((e) => {
      log.error(`startup failed: ${describeError(e)}`);
      dialog.showErrorBox(APP_NAME, `The game could not start:\n${e instanceof Error ? e.message : String(e)}\n\nLog: ${log.file}`);
      app.exit(1);
    });
}

main();
