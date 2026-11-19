/**
 * The shared-town test page (town.html): walk Mildew Lane's street with everybody else who has the page open.
 *
 * Step 1 of ROADMAP.md section 4. No account, nothing typed, nothing stored: the page picks a preset name and a
 * random look, and forgets both when it is closed. Which server it talks to is fixed when the page is built
 * (VITE_TOWN_SERVER); the development server also accepts ?server=ws://...
 */
import { createModelLibrary } from '../render/models/index';
import { createCharacterFactory } from '../render/characters/index';
import { createPetLibrary } from '../render/pets/index';
import { createWildlifeLibrary } from '../render/wildlife/index';
import { createRenderer } from '../render/index';
import { ACCESSORIES, BOTTOM_STYLES, EYE_STYLES, HAIR_STYLES, SKIN_TONES, TOP_STYLES } from '../shared/appearance';
import { CAST_BODY_IDS } from '../shared/cast';
import { TOWN_NAMES, type TownLook } from '../shared/townNet/protocol';
import { TOWN_TICK_HZ } from '../shared/townNet/room';
import { createTownScene, type TownActor } from './scene';
import { connectToTown, isTownServerUrl, type TownConnection, type TownStatus } from './connection';

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
const colour = (): string => `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;

/** A random look made of the game's own options. Half the time one of the standard cast bodies. */
function randomLook(): TownLook {
  const look: TownLook = {
    height: Math.random(), build: Math.random(), skinTone: Math.floor(Math.random() * SKIN_TONES.length),
    hairStyle: pick(HAIR_STYLES), hairColor: colour(), topStyle: pick(TOP_STYLES), topColor: colour(),
    bottomStyle: pick(BOTTOM_STYLES), bottomColor: colour(), shoeColor: colour(), eyeStyle: pick(EYE_STYLES),
    eyeColor: colour(), accessory: pick(ACCESSORIES), stitches: Math.random() < 0.5,
  };
  if (Math.random() < 0.5) look.body = pick(CAST_BODY_IDS);
  return look;
}

function serverUrl(): string | null {
  const built: unknown = import.meta.env.VITE_TOWN_SERVER;
  if (isTownServerUrl(built)) return built;
  if (import.meta.env.DEV) {
    const q = new URLSearchParams(location.search).get('server');
    if (isTownServerUrl(q)) return q;
  }
  return null;
}

const clockText = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

function statusText(s: TownStatus, players: number): string {
  switch (s.kind) {
    case 'connecting':
      return 'Finding the town...';
    case 'inTown':
      return players <= 1 ? 'You are the only one on the street right now.' : `${players} zombies on the street.`;
    case 'retrying':
      return `Lost the town. Trying again in ${s.inSeconds} s.`;
    case 'stopped':
      return s.reason === 'version' ? 'This page is out of date. Reload it.' : 'Could not join the town.';
  }
}

async function main(): Promise<void> {
  const canvas = document.getElementById('town-canvas');
  const statusEl = document.getElementById('town-status');
  const labels = document.getElementById('town-labels');
  if (!(canvas instanceof HTMLCanvasElement) || !statusEl || !labels) throw new Error('town.html is missing its elements');

  const url = serverUrl();
  if (!url) {
    statusEl.textContent = 'The shared town is not switched on for this copy of the game.';
    return;
  }
  statusEl.textContent = 'Loading the street...';

  const baseUrl = `${import.meta.env.BASE_URL}assets/`;
  const renderer = createRenderer({
    models: createModelLibrary({ baseUrl }),
    characters: createCharacterFactory({ baseUrl }),
    pets: createPetLibrary({ baseUrl }),
    wildlife: createWildlifeLibrary({ baseUrl }),
    assetBaseUrl: baseUrl,
  });
  await renderer.init(canvas, { quality: 'auto', pixelRatio: Math.min(window.devicePixelRatio || 1, 2) });
  const resize = (): void => renderer.resize(canvas.clientWidth, canvas.clientHeight);
  resize();
  addEventListener('resize', resize);

  const scene = createTownScene();
  renderer.attach(scene.sim);
  renderer.setWallMode('up');

  const me = { name: Math.floor(Math.random() * TOWN_NAMES.length), look: randomLook() };
  let dirty = true;
  const conn: TownConnection = connectToTown(url, scene.area, me, () => (dirty = true));

  // ── input: keys, or press and drag anywhere (mouse or touch) ──
  const keys = new Set<string>();
  const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];
  addEventListener('keydown', (e) => {
    if (MOVE_KEYS.includes(e.code)) {
      keys.add(e.code);
      e.preventDefault();
    } else if (e.code === 'KeyQ') renderer.rotateCamera(-1);
    else if (e.code === 'KeyE') renderer.rotateCamera(1);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  let drag: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag && e.pointerId === drag.id) {
      drag.x = e.clientX;
      drag.y = e.clientY;
    }
  });
  const endDrag = (e: PointerEvent): void => {
    if (drag && e.pointerId === drag.id) drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => renderer.zoom(e.deltaY < 0 ? 1 : -1), { passive: true });

  /** The direction the player is asking for, in world axes, turned so "up" is away from the camera. */
  const wantedDirection = (): { mx: number; mz: number } => {
    let sx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    let sy = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    if (drag) {
      const dx = drag.x - drag.x0;
      const dy = drag.y0 - drag.y;
      const len = Math.hypot(dx, dy);
      if (len > 12) {
        const k = Math.min(1, len / 80) / len;
        sx = dx * k;
        sy = dy * k;
      }
    }
    const len = Math.hypot(sx, sy);
    if (len < 0.05) return { mx: 0, mz: 0 };
    if (len > 1) {
      sx /= len;
      sy /= len;
    }
    const yaw = renderer.getCamera().yaw;
    // camera sits at (sin yaw, cos yaw) from its target: screen-right is (cos yaw, -sin yaw), away is (-sin yaw, -cos yaw)
    return { mx: sx * Math.cos(yaw) - sy * Math.sin(yaw), mz: -sx * Math.sin(yaw) - sy * Math.cos(yaw) };
  };

  const labelEls = new Map<string, HTMLElement>();
  let following: string | null = null;
  let stopsToSend = 0;
  let last = performance.now();
  let acc = 0;
  const stepMs = 1000 / TOWN_TICK_HZ;

  const frame = (now: number): void => {
    const dt = Math.min(250, now - last);
    last = now;
    acc += dt;
    // fixed steps: one input per server tick, however fast this screen draws
    while (acc >= stepMs) {
      acc -= stepMs;
      if (!conn.core.joined) continue;
      const d = wantedDirection();
      if (d.mx !== 0 || d.mz !== 0) {
        conn.step(d.mx, d.mz);
        stopsToSend = 3;
      } else if (stopsToSend > 0) {
        conn.step(0, 0);
        stopsToSend -= 1;
      }
    }

    const self = conn.core.self(now);
    const actors: TownActor[] = [];
    if (self) actors.push({ id: self.id, name: me.name, look: me.look, x: self.x, z: self.z, facing: self.facing, moving: self.moving });
    for (const o of conn.core.others(now)) actors.push(o);
    scene.show(actors, conn.core.day, conn.core.minute);

    const selfAgent = self ? scene.agentId(self.id) : null;
    if (selfAgent !== following) {
      renderer.follow(selfAgent);
      if (selfAgent) renderer.setCamera({ distance: 16, pitch: 0.75 }, true);
      following = selfAgent;
    }
    renderer.frame(1, dt / 1000);

    // name tags from the preset list, placed over each head
    const seen = new Set<string>();
    for (const a of actors) {
      const id = scene.agentId(a.id);
      const at = scene.toScene(a.x, a.z);
      const p = renderer.worldToScreen(at.x, 2.1, at.z);
      let el = labelEls.get(id);
      if (!el) {
        el = document.createElement('div');
        el.className = a.id === self?.id ? 'town-label town-label--me' : 'town-label';
        el.textContent = a.id === self?.id ? `${TOWN_NAMES[a.name]} (you)` : TOWN_NAMES[a.name];
        labels.appendChild(el);
        labelEls.set(id, el);
      }
      seen.add(id);
      el.style.display = p.visible ? '' : 'none';
      el.style.transform = `translate(-50%, -100%) translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    }
    for (const [id, el] of labelEls) {
      if (!seen.has(id)) {
        el.remove();
        labelEls.delete(id);
      }
    }

    if (dirty || Math.floor(now / 1000) !== Math.floor((now - dt) / 1000)) {
      dirty = false;
      const s = conn.status();
      const clock = s.kind === 'inTown' ? `  Town time ${clockText(conn.core.minute)}.` : '';
      statusEl.textContent = statusText(s, conn.core.playerCount) + clock;
      document.body.dataset.town = s.kind;
      document.body.dataset.players = String(conn.core.playerCount);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  addEventListener('pagehide', () => conn.close());
  // for the browser test: read-only facts about what this page shows
  Object.defineProperty(window, '__town', {
    value: Object.freeze({
      self: () => conn.core.self(performance.now()),
      others: () => conn.core.others(performance.now()),
      drawn: () => Object.keys(scene.sim.state.agents),
      corrections: () => conn.core.corrections,
    }),
  });
}

main().catch((e: unknown) => {
  console.error('[town]', e);
  const el = document.getElementById('town-status');
  if (el) el.textContent = 'The town could not be shown on this device.';
});
