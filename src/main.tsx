/**
 * Bootstrap (web + Electron): build every module from its factory (docs/CONTRACTS.md), create the GameController,
 * mount the UI over the full-screen canvas, unlock audio on the first user gesture, then boot the controller.
 *
 * Degraded modes instead of a blank page: storage that cannot open (private mode, blocked IndexedDB, hung
 * open) falls back to an in-memory SaveManager/ProfileStore; any failure before the UI mounts is shown in the
 * boot splash with a copyable message. Never throws past this file.
 */
import { render } from 'preact';
import './ui/theme/index';
import { App } from './ui/App';
import { createModelLibrary } from './render/models/index';
import { createCharacterFactory } from './render/characters/index';
import { premiumDetailForQuality } from './shared/premiumBodies';
import { createPetLibrary } from './render/pets/index';
import { createWildlifeLibrary } from './render/wildlife/index';
import { createRenderer } from './render/index';
import { createAudio } from './audio/index';
import { createProfileStore, createSaveManager } from './persistence/index';
import type { AudioAPI } from './audio/contracts';
import type { ProfileStore, SaveManager } from './persistence/contracts';
import { createGameController, type GameControllerImpl } from './game/controller';
import { hudPanelRects } from './ui/hud/lib/storyFraming';
import { createEconomy } from './economy/index';
import { createMemoryProfileStore, createMemorySaveManager } from './game/fallbacks';
import { describeError } from './game/diagnostics';
import { GAME_TITLE, GAME_VERSION } from './game/version';

const SAVE_MANAGER_TIMEOUT_MS = 8000;

declare global {
  interface Window {
    /** Debug / e2e handle (read-only). */
    __afterlife?: { readonly game: GameControllerImpl; readonly version: string };
  }
}

function splash(): HTMLElement | null {
  return document.getElementById('boot-splash');
}

function hideSplash(): void {
  const el = splash();
  if (!el) return;
  el.classList.add('boot-splash--done');
  window.setTimeout(() => el.remove(), 400);
}

/** Last-resort error screen inside the splash (no Preact, no CSS dependencies beyond index.html). */
function showBootFailure(err: unknown): void {
  try {
    console.error(`[${GAME_TITLE}] boot failed`, err);
    let el = splash();
    if (!el) {
      el = document.createElement('div');
      el.id = 'boot-splash';
      document.body.appendChild(el);
    }
    el.classList.remove('boot-splash--done');
    el.classList.add('boot-splash--error');
    el.replaceChildren();
    const h = document.createElement('h1');
    h.textContent = `${GAME_TITLE} couldn't start`;
    const p = document.createElement('p');
    p.textContent = 'Something went wrong while waking the dead. Reloading usually helps; if it keeps happening, copy the details below into a bug report.';
    const pre = document.createElement('pre');
    pre.textContent = `${GAME_TITLE} ${GAME_VERSION}\n${describeError(err)}\n${navigator.userAgent}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Reload';
    btn.addEventListener('click', () => window.location.reload());
    el.append(h, p, pre, btn);
  } catch {
    /* nothing else we can do */
  }
}

function timeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function openSaves(): Promise<SaveManager> {
  try {
    return await timeout(createSaveManager(), SAVE_MANAGER_TIMEOUT_MS, 'Opening save storage');
  } catch (e) {
    console.warn(`[${GAME_TITLE}] save storage unavailable — saves will last for this session only`, e);
    return createMemorySaveManager();
  }
}

function openProfile(): ProfileStore {
  try {
    return createProfileStore();
  } catch (e) {
    console.warn(`[${GAME_TITLE}] profile storage unavailable — settings will not persist`, e);
    return createMemoryProfileStore();
  }
}

/**
 * Browsers only allow audio after a user gesture: unlock on the first pointer/key/touch, retrying until it works.
 * Returns the remover (HMR / a second bootstrap must not leave capture listeners on window).
 */
function installAudioUnlock(audio: AudioAPI): () => void {
  const events = ['pointerdown', 'keydown', 'touchend'] as const;
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  let pending = false;
  const remove = (): void => {
    for (const t of events) window.removeEventListener(t, onGesture, opts);
  };
  function onGesture(): void {
    if (pending) return;
    if (audio.unlocked) return remove();
    pending = true;
    audio
      .unlock()
      .then(() => {
        if (audio.unlocked) remove();
      })
      .catch((e: unknown) => console.warn(`[${GAME_TITLE}] audio unlock failed (will retry on next input)`, e))
      .finally(() => {
        pending = false;
      });
  }
  for (const t of events) window.addEventListener(t, onGesture, opts);
  return remove;
}

async function main(): Promise<void> {
  const canvas = document.getElementById('game-canvas');
  const uiRoot = document.getElementById('ui-root');
  if (!(canvas instanceof HTMLCanvasElement) || !uiRoot) throw new Error('index.html is missing #game-canvas or #ui-root');

  // Works from file:// (Electron), http(s), and sub-path hosting: Vite's base is './'.
  const baseUrl = `${import.meta.env.BASE_URL}assets/`;
  const models = createModelLibrary({ baseUrl });
  // premium bodies load the file that fits the graphics level in use when the body is first needed
  let liveRenderer: ReturnType<typeof createRenderer> | null = null;
  const characters = createCharacterFactory({
    baseUrl,
    premiumDetail: () => premiumDetailForQuality(liveRenderer?.graphicsInfo?.().level),
  });
  const pets = createPetLibrary({ baseUrl });
  const wildlife = createWildlifeLibrary({ baseUrl });
  const renderer = createRenderer({ models, characters, pets, wildlife, assetBaseUrl: baseUrl });
  liveRenderer = renderer;
  const audio = createAudio();
  const [saves, profile] = [await openSaves(), openProfile()];

  // Profile economy (Bones ledger, store, daily tasks): same storage backend + ProfileStore; never blocks boot.
  let economy: ReturnType<typeof createEconomy> | null = null;
  try {
    economy = createEconomy({ profile });
  } catch (e) {
    console.warn(`[${GAME_TITLE}] economy unavailable — the store is disabled for this session`, e);
  }
  const game = createGameController({ renderer, audio, saves, profile, economy });
  Object.defineProperty(window, '__afterlife', { value: Object.freeze({ game, version: GAME_VERSION }), configurable: true });

  render(<App game={game} />, uiRoot);
  // W-025 S5 (Sol P2): a followed / recentred zombie is framed clear of every HUD panel ([data-hud-region])
  renderer.setFrameAvoid?.(() => {
    const c = canvas.getBoundingClientRect();
    return hudPanelRects().map((r) => ({ x: r.x - c.left, y: r.y - c.top, w: r.w, h: r.h }));
  });
  hideSplash();
  const removeAudioUnlock = installAudioUnlock(audio);

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      removeAudioUnlock();
      game.dispose(); // listeners, loop, renderer
      render(null, uiRoot);
    });
  }

  await game.boot(canvas);
}

main().catch(showBootFailure);
