/**
 * Functions evaluated INSIDE the page (page.evaluate(fn, arg)). They only read the game through the documented
 * debug handle window.__afterlife (src/main.tsx) and public renderer/sim APIs; every state change the suite makes
 * goes through real input (mouse/keyboard/DOM) except where a step says otherwise.
 * Each function must be self-contained (it is serialised into the page).
 */

/** Installed with context.addInitScript before any page script: unhandled rejections + a reload marker. */
export function initScript() {
  window.__e2e = { rejections: [], bootId: Math.random().toString(36).slice(2) };
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    window.__e2e.rejections.push(String((r && (r.stack || r.message)) || r));
  });
}

export function snapshotState() {
  const g = window.__afterlife && window.__afterlife.game;
  if (!g) return null;
  const sim = g.sim;
  let renderer = null;
  try {
    renderer = { progress: g.renderer.loadProgress(), fps: g.renderer.fps() };
  } catch {
    renderer = null;
  }
  return {
    screen: g.screen,
    fatal: g.fatalError,
    mode: g.mode,
    speed: g.speed,
    dialog: g.dialog,
    selected: g.selectedAgentId,
    saving: g.saving,
    lastSaveFailed: g.lastSaveFailed,
    renderer,
    world: sim
      ? {
          household: sim.state.household.name,
          funds: sim.state.household.funds,
          day: sim.time().day,
          tick: sim.state.tick,
          members: sim.state.household.memberIds.map((id) => {
            const a = sim.state.agents[id];
            return a ? `${a.firstName} ${a.lastName}` : id;
          }),
          objects: Object.keys(sim.state.objects).length,
          walls: Object.keys(sim.state.lot.walls).length,
        }
      : null,
  };
}

/**
 * Scan the visible canvas for placed objects the actor can interact with. Returns the object with the most
 * unobstructed sample points (robust against an agent walking across part of it) and the sample closest to the
 * centroid of its hits, plus the first available top-level menu entry.
 */
export function findInteractableObject({ actorId, step = 22, margin = 70 }) {
  const g = window.__afterlife.game;
  const r = g.renderer;
  const sim = g.sim;
  const canvas = document.getElementById('game-canvas');
  const rect = canvas.getBoundingClientRect();
  const hits = new Map();
  for (let y = rect.top + margin; y < rect.bottom - margin; y += step) {
    for (let x = rect.left + margin; x < rect.right - margin; x += step) {
      if (document.elementFromPoint(x, y) !== canvas) continue;
      const p = r.pick(x, y, { agents: true, objects: true, walls: true, tiles: true });
      if (!p || p.kind !== 'object') continue;
      const h = hits.get(p.objectId) || [];
      h.push([x, y]);
      hits.set(p.objectId, h);
    }
  }
  const candidates = [];
  for (const [id, pts] of hits) {
    if (pts.length < 3) continue;
    let entries = [];
    try {
      entries = sim.menu(actorId, { kind: 'object', id });
    } catch {
      entries = [];
    }
    const entry = entries.find((e) => e.available && e.group === null && !(e.children && e.children.length) && !e.interactionId.startsWith('engine_'));
    if (!entry) continue;
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    let best = pts[0];
    let bd = Infinity;
    for (const p of pts) {
      const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    const obj = sim.state.objects[id];
    candidates.push({ id, defId: obj ? obj.defId : '?', hits: pts.length, x: best[0], y: best[1], entry: { label: entry.label, interactionId: entry.interactionId } });
  }
  candidates.sort((a, b) => b.hits - a.hits);
  return { scanned: hits.size, candidates: candidates.slice(0, 5) };
}

/** Records, every 50 ms, whether queue item `uid` of `agentId` was seen queued / active, and the DOM label shown. */
export function watchQueue({ agentId, uid, label }) {
  const g = window.__afterlife.game;
  const w = { sawQueued: false, sawActive: false, sawDomActive: false, sawDomQueued: false, maxProgress: 0, gone: false };
  window.__e2e.queueWatch = w;
  const timer = setInterval(() => {
    try {
      const items = g.sim ? g.sim.queueView(agentId) : [];
      const it = items.find((i) => i.uid === uid);
      if (it) {
        if (it.active) {
          w.sawActive = true;
          w.maxProgress = Math.max(w.maxProgress, it.progress || 0);
        } else w.sawQueued = true;
      } else if (w.sawQueued || w.sawActive) w.gone = true;
      const act = document.querySelector('.hud-qactive__label');
      if (act && act.textContent && act.textContent.trim() === label) w.sawDomActive = true;
      const tiles = Array.from(document.querySelectorAll('.hud-qitem [aria-label], .hud-qitem'));
      if (tiles.some((el) => (el.getAttribute('aria-label') || el.textContent || '').includes(label))) w.sawDomQueued = true;
    } catch {
      /* keep watching */
    }
  }, 50);
  w.stop = () => clearInterval(timer);
  return true;
}

/** A visible floor tile where defId can be placed (rot 0), whose centre pickGrid maps back to the same tile. */
export function findPlaceTile({ defId, avoid = [] }) {
  const g = window.__afterlife.game;
  const sim = g.sim;
  const r = g.renderer;
  const canvas = document.getElementById('game-canvas');
  const b = sim.state.lot.buildable;
  const out = [];
  for (let z = b.z0; z < b.z1; z++) {
    for (let x = b.x0; x < b.x1; x++) {
      if (avoid.some((a) => a.x === x && a.z === z)) continue;
      let res;
      try {
        res = sim.spatial.checkPlace(defId, x, z, 0, null);
      } catch {
        continue;
      }
      if (!res.ok || res.blockedSlots.length) continue;
      const s = r.worldToScreen(x + 0.5, 0, z + 0.5);
      if (!s.visible) continue;
      if (document.elementFromPoint(s.x, s.y) !== canvas) continue;
      const pg = r.pickGrid(s.x, s.y);
      if (!pg || pg.x !== x || pg.z !== z) continue;
      // keep away from the screen edges (HUD panels, edge scroll)
      if (s.x < 120 || s.y < 120 || s.x > innerWidth - 120 || s.y > innerHeight - 160) continue;
      out.push({ x, z, sx: s.x, sy: s.y, cost: res.cost });
    }
  }
  // most central first: stable choice between runs
  out.sort((a, c) => Math.hypot(a.sx - innerWidth / 2, a.sy - innerHeight / 2) - Math.hypot(c.sx - innerWidth / 2, c.sy - innerHeight / 2));
  return out.slice(0, 5);
}

/** A visible straight 3-segment wall run (vertex A → B along X) the build service accepts. */
export function findWallRun({ style, len = 3 }) {
  const g = window.__afterlife.game;
  const sim = g.sim;
  const r = g.renderer;
  const canvas = document.getElementById('game-canvas');
  const b = sim.state.lot.buildable;
  const out = [];
  const onCanvas = (s) => s.visible && s.x > 140 && s.y > 140 && s.x < innerWidth - 140 && s.y < innerHeight - 200 && document.elementFromPoint(s.x, s.y) === canvas;
  for (let z = b.z0 + 1; z < b.z1; z++) {
    for (let x = b.x0 + 1; x + len < b.x1; x++) {
      const edges = [];
      for (let i = 0; i < len; i++) edges.push(`h:${x + i}:${z}`);
      let p;
      try {
        p = sim.build.preview({ type: 'addWalls', edges, style });
      } catch {
        continue;
      }
      if (!p.ok || !(p.cost > 0)) continue;
      const a = r.worldToScreen(x, 0, z);
      const c = r.worldToScreen(x + len, 0, z);
      if (!onCanvas(a) || !onCanvas(c)) continue;
      const ga = r.pickGrid(a.x, a.y);
      const gc = r.pickGrid(c.x, c.y);
      if (!ga || !gc || Math.abs(ga.fx - x) > 0.2 || Math.abs(ga.fz - z) > 0.2 || Math.abs(gc.fx - (x + len)) > 0.2 || Math.abs(gc.fz - z) > 0.2) continue;
      out.push({ x, z, ax: a.x, ay: a.y, bx: c.x, by: c.y, cost: p.cost, edges });
    }
  }
  out.sort((p, q) => Math.hypot((p.ax + p.bx) / 2 - innerWidth / 2, p.ay - innerHeight / 2) - Math.hypot((q.ax + q.bx) / 2 - innerWidth / 2, q.ay - innerHeight / 2));
  return out.slice(0, 3);
}

/** Flip one byte of a stored key in the game's IndexedDB ('afterlife-lease' / 'kv'). */
export async function corruptIdbKey({ key, offsetFrac = 0.5 }) {
  const db = await new Promise((res, rej) => {
    const req = indexedDB.open('afterlife-lease');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  try {
    const store = 'kv';
    const value = await new Promise((res, rej) => {
      const tx = db.transaction(store, 'readonly');
      const q = tx.objectStore(store).get(key);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    if (value == null) return { ok: false, why: `no value at ${key}` };
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value.slice(0)) : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)) : null;
    if (!bytes) return { ok: false, why: `unexpected value type ${Object.prototype.toString.call(value)}` };
    const at = Math.min(bytes.length - 1, Math.max(0, Math.floor(bytes.length * offsetFrac)));
    const before = bytes[at];
    bytes[at] = before ^ 0x5a;
    await new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(bytes.buffer, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    return { ok: true, at, length: bytes.length, before, after: bytes[at] };
  } finally {
    db.close();
  }
}

export async function listIdbKeys() {
  const db = await new Promise((res, rej) => {
    const req = indexedDB.open('afterlife-lease');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  try {
    return await new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readonly');
      const q = tx.objectStore('kv').getAllKeys();
      q.onsuccess = () => res(q.result.map(String));
      q.onerror = () => rej(q.error);
    });
  } finally {
    db.close();
  }
}

/** Wait for every SaveManager/ProfileStore write to land (the desktop quit hook, src/persistence/activity.ts). */
export async function persistenceIdle() {
  const hook = window.__afterlifeLeasePersistence;
  if (!hook || typeof hook.whenIdle !== 'function') return 'no-hook';
  return hook.whenIdle({ quietMs: 300, timeoutMs: 20000 });
}
