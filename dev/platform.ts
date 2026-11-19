/**
 * PLATFORM real-browser self-test (served by Vite, driven by dev/platform.e2e.cjs through Playwright).
 * Exercises what the unit suites can only fake: real IndexedDB transactions (durability 'strict'), real
 * Web Locks across two tabs, real CompressionStream gzip, real WebCrypto, persistence across a reload,
 * corruption recovery from the real store, and the desktop quit hook.
 */
import { QUIT_HOOK_GLOBAL, createProfileStore, createSaveManager, persistenceActivity } from '../src/persistence';
import { canonicalJson } from '../src/persistence/canonicalJson';
import type { SaveManager, SaveResult } from '../src/persistence/contracts';
import type { WorldState } from '../src/sim/types';
import { LOT_TEMPLATES, createNewWorld, createSimulation } from '../src/sim/index';
import { defaultAppearance } from '../src/shared/appearance';
import { makeMeta, makeWorld } from '../tests/unit/persistence/fixtures';

/**
 * A REAL engine world after some play (the engine's repairWorld must be a no-op on it — contract decision
 * #9 — so save -> load must be byte-identical). Synthetic fixtures are semantically repaired by the
 * engine on load, so they are only used where identity does not matter.
 */
function engineWorld(seed: number, ticks: number): WorldState {
  const world = createNewWorld({
    seed,
    householdName: `E2E ${seed}`,
    lotTemplate: (LOT_TEMPLATES[0]?.id ?? 'starter') as never,
    difficulty: 'normal',
    members: [
      { firstName: 'Ada', lastName: 'Bones', appearance: defaultAppearance(), traits: [], aspiration: null },
      { firstName: 'Bram', lastName: 'Bones', appearance: { ...defaultAppearance(), skinTone: 3 }, traits: [], aspiration: null },
    ],
  });
  const sim = createSimulation(world);
  for (let i = 0; i < ticks; i++) sim.step();
  return sim.serialize();
}

interface StepResult {
  name: string;
  ok: boolean;
  detail: string;
}

const logEl = document.getElementById('log');

async function steps(list: [string, () => Promise<string | void>][]): Promise<StepResult[]> {
  const out: StepResult[] = [];
  for (const [name, fn] of list) {
    try {
      const d = await fn();
      out.push({ name, ok: true, detail: d ?? '' });
    } catch (e) {
      out.push({ name, ok: false, detail: e instanceof Error ? (e.stack ?? e.message) : String(e) });
    }
    if (logEl) logEl.textContent += `${out[out.length - 1].ok ? 'PASS' : 'FAIL'} ${name} ${out[out.length - 1].detail}\n`;
  }
  return out;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

let saves: SaveManager | null = null;
async function manager(): Promise<SaveManager> {
  saves ??= await createSaveManager();
  return saves;
}

let W1 = '';
let world1: WorldState | null = null;
function firstWorld(): WorldState {
  if (!world1) {
    world1 = engineWorld(4242, 600);
    W1 = canonicalJson(world1);
  }
  return world1;
}

async function phaseWrite(): Promise<StepResult[]> {
  return steps([
    [
      'environment: secure context with IndexedDB, Web Locks, CompressionStream, crypto.subtle',
      async () => {
        assert(isSecureContext, 'not a secure context');
        assert(typeof indexedDB !== 'undefined', 'no IndexedDB');
        assert(!!navigator.locks, 'no Web Locks');
        assert(typeof CompressionStream === 'function', 'no CompressionStream');
        assert(!!crypto.subtle, 'no crypto.subtle');
        return navigator.userAgent;
      },
    ],
    [
      'backend selection picks durable IndexedDB',
      async () => {
        const m = await manager();
        assert(m.backend.id === 'indexeddb', `backend is ${m.backend.id}`);
        assert(m.backend.durable, 'not durable');
        const q = await m.backend.quota();
        return `quota free ≈ ${q === null ? 'unknown' : Math.round(q / 1e6) + ' MB'}`;
      },
    ],
    [
      'save → load round trip (gzip on disk, checksums verified)',
      async () => {
        const m = await manager();
        const r = await m.save('e2e', 'E2E', firstWorld(), makeMeta());
        assert(r.ok, `save failed: ${JSON.stringify(r)}`);
        const raw = await m.backend.read('slot:e2e:primary');
        assert(raw && raw[0] === 0x1f && raw[1] === 0x8b, 'primary is not gzip');
        const l = await m.load('e2e');
        assert(l.ok, `load failed: ${JSON.stringify(l)}`);
        assert(canonicalJson(l.world) === W1, `loaded world differs; warnings: ${l.warnings.join(' | ')}`);
        assert(l.warnings.length === 0, `healthy engine world produced warnings: ${l.warnings.join(' | ')}`);
        localStorage.setItem('platform-e2e-w1', W1); // for the post-reload comparison
        return `${W1.length} chars of world -> ${raw.byteLength} bytes on disk`;
      },
    ],
    [
      'second save rotates a good backup; export → import lands in a NEW slot',
      async () => {
        const m = await manager();
        assert((await m.save('e2e', 'E2E', firstWorld(), makeMeta())).ok, 'second save failed');
        assert((await m.backend.read('slot:e2e:backup')) !== null, 'no backup after second save');
        const ex = await m.exportSlot('e2e');
        assert(ex && ex.filename.endsWith('.alsave'), 'export failed');
        const im = await m.importFile(ex.data);
        assert(im.ok && im.slotId && im.slotId !== 'e2e', `import failed: ${JSON.stringify(im)}`);
        return im.slotId;
      },
    ],
    [
      'profile store round trip (same backend family)',
      async () => {
        const p = createProfileStore();
        await p.save('e2e-settings', { volume: 0.25, keys: { jump: 'Space' } });
        const v = await p.load('e2e-settings', { volume: 1, keys: { jump: 'J' }, added: true });
        assert(v.volume === 0.25 && v.keys.jump === 'Space' && v.added === true, `profile mismatch ${JSON.stringify(v)}`);
      },
    ],
    [
      'desktop quit hook is installed and reports idle',
      async () => {
        const hook = (globalThis as Record<string, unknown>)[QUIT_HOOK_GLOBAL] as { whenIdle(o: unknown): Promise<boolean> } | undefined;
        assert(hook && typeof hook.whenIdle === 'function', 'hook missing');
        assert(await hook.whenIdle({ quietMs: 50, timeoutMs: 3000 }), 'not idle');
        assert(persistenceActivity.busy === 0, 'tracker busy');
      },
    ],
  ]);
}

async function phaseVerify(): Promise<StepResult[]> {
  return steps([
    [
      'after a full page reload the save is still there (real durability)',
      async () => {
        const m = await manager();
        W1 = localStorage.getItem('platform-e2e-w1') ?? '';
        const l = await m.load('e2e');
        assert(l.ok && canonicalJson(l.world) === W1, `reload lost the save: ${JSON.stringify(l.ok ? 'differs' : l)}`);
        const slots = await m.listSlots();
        assert(slots.some((s) => s.slotId === 'e2e') && slots.some((s) => s.slotId.startsWith('import-')), 'listing incomplete');
        const latest = await m.latest();
        assert(latest !== null, 'latest() is null');
        const p = await createProfileStore().load('e2e-settings', { volume: 1 });
        assert(p.volume === 0.25, 'profile lost');
        return slots.map((s) => s.slotId).join(', ');
      },
    ],
    [
      'a corrupted primary in the REAL store falls back to the backup',
      async () => {
        const m = await manager();
        const raw = await m.backend.read('slot:e2e:primary');
        assert(raw, 'no primary');
        const bad = raw.slice();
        bad[Math.floor(bad.length / 2)] ^= 0x10;
        await m.backend.write('slot:e2e:primary', bad);
        const l = await m.load('e2e');
        assert(l.ok && l.info.recoveredFromBackup && canonicalJson(l.world) === W1, `no recovery: ${JSON.stringify(l.ok ? l.info : l)}`);
        assert((await m.save('e2e', 'E2E', l.world, makeMeta())).ok, 'save after recovery failed');
      },
    ],
  ]);
}

/** Run by two tabs at once: manual saves must all succeed (they wait for the lock), autosaves may say 'busy'. */
async function phaseContend(tab: number): Promise<StepResult[]> {
  return steps([
    [
      `tab ${tab}: 12 interleaved manual saves + 12 autosaves across tabs`,
      async () => {
        const m = await manager();
        const manual: SaveResult[] = [];
        const auto: SaveResult[] = [];
        const jobs: Promise<void>[] = [];
        for (let i = 0; i < 12; i++) {
          jobs.push(m.save('shared', `tab${tab}-${i}`, makeWorld(tab * 100 + i), makeMeta()).then((r) => void manual.push(r)));
          jobs.push(m.save('autosave', `auto${tab}-${i}`, makeWorld(tab * 100 + i), makeMeta(), { autosave: true }).then((r) => void auto.push(r)));
          await new Promise((r) => setTimeout(r, 5));
        }
        await Promise.all(jobs);
        const manualFailed = manual.filter((r) => !r.ok);
        assert(manualFailed.length === 0, `manual saves must wait for the other tab, never fail: ${JSON.stringify(manualFailed)}`);
        const autoBad = auto.filter((r) => !r.ok && r.code !== 'busy');
        assert(autoBad.length === 0, `autosaves may only fail with busy: ${JSON.stringify(autoBad)}`);
        return `${manual.length} manual ok, ${auto.length} autosaves (${auto.filter((r) => !r.ok).length} busy = failed fast while the other tab saved)`;
      },
    ],
  ]);
}

async function phaseFinal(): Promise<StepResult[]> {
  return steps([
    [
      'after the cross-tab storm both slots load and hold one of the written worlds',
      async () => {
        const m = await manager();
        for (const id of ['shared', 'autosave']) {
          const l = await m.load(id);
          assert(l.ok, `${id} does not load: ${JSON.stringify(l)}`);
          assert(!l.info.recoveredFromBackup, `${id} needed its backup`);
        }
        await m.remove('shared');
        assert((await m.load('shared')).ok === false, 'remove did not remove');
      },
    ],
  ]);
}

declare global {
  interface Window {
    __platform?: { run(phase: string, tab?: number): Promise<StepResult[]> };
  }
}

window.__platform = {
  run(phase: string, tab = 1): Promise<StepResult[]> {
    if (phase === 'write') return phaseWrite();
    if (phase === 'verify') return phaseVerify();
    if (phase === 'contend') return phaseContend(tab);
    if (phase === 'final') return phaseFinal();
    return Promise.resolve([{ name: phase, ok: false, detail: 'unknown phase' }]);
  },
};
