/**
 * Degraded-mode stand-ins used by the bootstrap / controller when a dependency fails, so the game still starts:
 *  - memory SaveManager (storage blocked, e.g. private mode with IndexedDB disabled) — saves last for the session
 *  - memory ProfileStore
 *  - no-op PreviewStage (CAZ preview could not get a WebGL context)
 * These are adapters inside GAME's own files, not replacements for PLATFORM's implementations.
 */
import type { LoadResult, ProfileStore, SaveManager, SaveMeta, SaveResult, SaveSlotInfo, StorageBackend } from '../persistence/contracts';
import type { PreviewStage } from '../render/contracts';
import type { WorldState } from '../sim/types';

export function noopPreviewStage(): PreviewStage {
  return {
    setAppearance: () => undefined,
    setLimbs: () => undefined,
    setAnim: () => undefined,
    setExpression: () => undefined,
    setYaw: () => undefined,
    resize: () => undefined,
    dispose: () => undefined,
  };
}

function deepCopy<T>(v: T): T {
  return typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);
}

export function createMemoryProfileStore(): ProfileStore {
  const data = new Map<string, unknown>();
  return {
    async load<T>(key: string, fallback: T): Promise<T> {
      return data.has(key) ? deepCopy(data.get(key) as T) : fallback;
    },
    async save<T>(key: string, value: T): Promise<void> {
      data.set(key, deepCopy(value));
    },
  };
}

interface MemSlot {
  world: WorldState;
  info: SaveSlotInfo;
}

export function createMemorySaveManager(now: () => number = () => Date.now()): SaveManager {
  const slots = new Map<string, MemSlot>();
  const blobs = new Map<string, Uint8Array>();
  const backend: StorageBackend = {
    id: 'memory',
    durable: false,
    available: async () => true,
    read: async (k) => blobs.get(k) ?? null,
    write: async (k, d) => {
      blobs.set(k, new Uint8Array(d));
    },
    remove: async (k) => {
      blobs.delete(k);
    },
    list: async (prefix) => Array.from(blobs.keys()).filter((k) => k.startsWith(prefix)),
    quota: async () => null,
  };
  const iso = (): string => new Date(now()).toISOString();
  const mgr: SaveManager = {
    backend,
    async listSlots() {
      return Array.from(slots.values())
        .map((s) => ({ ...s.info, meta: { ...s.info.meta, memberNames: s.info.meta.memberNames.slice() } }))
        .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
    },
    // `waitForLock` (contract) needs no handling here: an in-memory store has no cross-window lock to wait for.
    async save(slotId: string, name: string, world: WorldState, meta: SaveMeta, opts?: { autosave?: boolean; playMinutes?: number; waitForLock?: boolean }): Promise<SaveResult> {
      try {
        const copy = deepCopy(world);
        const prev = slots.get(slotId);
        const json = JSON.stringify(copy);
        const info: SaveSlotInfo = {
          slotId,
          name,
          savedAt: iso(),
          createdAt: prev?.info.createdAt ?? iso(),
          playMinutes: opts?.playMinutes ?? 0,
          meta: { ...meta, memberNames: meta.memberNames.slice() },
          isAutosave: opts?.autosave === true,
          recoveredFromBackup: false,
          bytes: json.length,
        };
        slots.set(slotId, { world: copy, info });
        return { ok: true, info };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e), code: 'invalid' };
      }
    },
    async load(slotId: string): Promise<LoadResult> {
      const s = slots.get(slotId);
      if (!s) return { ok: false, error: 'Save not found', code: 'not_found' };
      return { ok: true, world: deepCopy(s.world), info: { ...s.info }, warnings: ['Saves are kept in memory only this session (storage is unavailable).'] };
    },
    async remove(slotId: string) {
      slots.delete(slotId);
    },
    async exportSlot(slotId: string) {
      const s = slots.get(slotId);
      if (!s) return null;
      const text = JSON.stringify({ format: 'afterlife-lease-save', formatVersion: 1, slotId, name: s.info.name, payload: s.world });
      return { filename: `${s.info.name}.json`, data: new TextEncoder().encode(text) };
    },
    async importFile(data: Uint8Array, slotId?: string) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(data)) as { payload?: WorldState; name?: string };
        if (!parsed || typeof parsed !== 'object' || !parsed.payload || typeof parsed.payload !== 'object') {
          return { ok: false as const, error: 'Not an Afterlife Lease save file', code: 'invalid' as const };
        }
        const id = slotId ?? `import-${now().toString(36)}`;
        const meta: SaveMeta = { householdName: String(parsed.name ?? 'Imported'), memberNames: [], day: 1, timeLabel: '', funds: 0, lotValue: 0, thumbnail: null };
        const res = await mgr.save(id, String(parsed.name ?? 'Imported save'), parsed.payload, meta);
        if (!res.ok) return { ok: false as const, error: res.error, code: 'invalid' as const };
        return { ok: true as const, world: deepCopy(parsed.payload), info: res.info, warnings: [], slotId: id };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : 'Corrupt file', code: 'corrupt' as const };
      }
    },
    async latest() {
      const list = await mgr.listSlots();
      return list[0] ?? null;
    },
  };
  return mgr;
}
