/**
 * W-119 — the journal/save path under hostile storage, on the REAL simulation and the REAL SaveManager.
 *
 * Storage here is a memory backend whose writes can be slowed, reordered (random latency per write) and failed, and
 * which records a "kill point" after EVERY write/remove that lands: a copy of exactly what a page killed at that
 * instant would leave behind (each write is atomic, per the StorageBackend contract). Every kill point is then
 * relaunched — latest slot, load, journal recovery — and must give:
 *  - EXACTLY a world the live run passed through (never a divergent one), and
 *  - nothing older than what the journal had ACKNOWLEDGED as durable before that kill ("committed" = a flushNow()
 *    that resolved with every op up to its call durable in each epoch a save could have left in the slot). Only the
 *    batch in flight — the documented ≤ 1 s window — may be lost, plus whatever the injected failures kept unwritten.
 *
 * Targeted tests pin the three holes found while fixing W-119 (each fails on the pre-W-119 code):
 *  1. two-phase rebase: snapshot landed, journal not yet rebased → the commands flushed during the save were lost;
 *  2. idempotent anchors: a save coalesced into a newer queued one re-anchored the journal on the wrong ops;
 *  3. build history: an undo reaching back past a mid-build-session snapshot was not replayable and nothing
 *     re-anchored — every later action was lost on a kill.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Command, SimulationAPI } from "../../../src/sim/contracts";
import type { WorldState } from "../../../src/sim/types";
import type { StorageBackend } from "../../../src/persistence/contracts";
import {
  SaveManagerImpl,
  savePayloadSha256,
} from "../../../src/persistence/saveManager";
import {
  createMemoryBackend,
  type MemoryBackend,
} from "../../../src/persistence/backends/memory";
import { noLocks } from "../../../src/persistence/locks";
import { canonicalJson } from "../../../src/persistence/canonicalJson";
import { sha256HexSync } from "../../../src/persistence/sha256";
import { engineRepairHook } from "../../../src/persistence/semanticRepair";
import { StorageError } from "../../../src/persistence/errors";
import { decodeChunk } from "../../../src/persistence/journal";
import { SaveFlow, type SaveFlowHost } from "../../../src/game/saveFlow";
import { GameSession } from "../../../src/game/session";
import { DEFAULT_SETTINGS } from "../../../src/game/contracts";
import { SAVE_JOB_TIMEOUT_MS, buildSaveMeta } from "../../../src/game/saves";
import { buildCazCatalog } from "../../../src/game/gddCatalog";
import { randomHousehold } from "../../../src/game/randomZombie";
import { FakeEnv, FakeRenderer, flush } from "./fakes";
import { FakeLockManager } from "../persistence/fakeWebLocks";

type SimIndex = typeof import("../../../src/sim/index");
let real: SimIndex | null = null;
let loadError = "";
try {
  real = await import("../../../src/sim/index");
} catch (e) {
  loadError = e instanceof Error ? e.message : String(e);
}

const silent = { warn: () => undefined, error: () => undefined };
const CHAOS_SEED = Number(process.env.CHAOS_SEED ?? 0) || 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Per-test Web Locks; relaunching models the browser freeing a killed page's locks (see journal.test.ts).
const hostNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
function freshLocks(): void {
  Object.defineProperty(globalThis, "navigator", {
    value: { locks: new FakeLockManager() },
    configurable: true,
    writable: true,
  });
}
beforeEach(() => {
  freshLocks();
  // The journal logs every chunk it could not remove; with failures injected on purpose that is just noise.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (hostNavigator)
    Object.defineProperty(globalThis, "navigator", hostNavigator);
  else delete (globalThis as { navigator?: unknown }).navigator;
});

function prng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function newWorld(seed: number): WorldState {
  const m = real!;
  const catalog = buildCazCatalog(m.loadContent(), m.LOT_TEMPLATES);
  const h = randomHousehold(seed * 7919, catalog, 1);
  return m.createNewWorld({
    seed,
    householdName: h.householdName,
    members: h.members,
    lotTemplate: "starter",
    difficulty: "normal",
  });
}

function mkSaves(backend: StorageBackend): SaveManagerImpl {
  return new SaveManagerImpl({
    backend,
    compress: false,
    logger: silent,
    locks: noLocks,
    repair: engineRepairHook(),
  });
}

const stateHash = (sim: SimulationAPI) =>
  sha256HexSync(canonicalJson(sim.serialize()));

// ───────────────────────────── hostile storage ─────────────────────────────

type KeyKind = "primary" | "backup" | "meta" | "journal" | "other";
function kindOf(key: string): KeyKind {
  if (key.startsWith("journal:")) return "journal";
  const m = /^slot:[^:]+:(primary|backup|meta)$/.exec(key);
  return m ? (m[1] as KeyKind) : "other";
}

interface KillPoint {
  /** What landed last ("write journal:…", "write slot:…:primary", …). */
  label: string;
  store: Map<string, Uint8Array>;
  /** Live-state index (see Live) the journal had acknowledged as durable when this point was captured. */
  acked: number;
}

interface ChaosPolicy {
  /** Real ms before the op runs (0 = next macrotask). */
  delay(op: "write" | "remove", kind: KeyKind, n: number): number;
  /** Throw (after the delay) instead of writing. */
  fail?(op: "write" | "remove", kind: KeyKind, n: number): boolean;
  /** Block the op until the returned promise resolves (deterministic orderings). */
  gate?(op: "write" | "remove", key: string): Promise<void> | null;
}

class ChaosBackend implements StorageBackend {
  readonly id = "memory" as const;
  readonly durable = false;
  readonly inner: MemoryBackend = createMemoryBackend();
  readonly kills: KillPoint[] = [];
  acked = -1;
  failures = 0;
  private n = 0;
  constructor(public policy: ChaosPolicy) {}

  private point(label: string): void {
    // Stored values are never mutated in place (every write stores a fresh copy): a shallow copy is a true snapshot.
    this.kills.push({
      label,
      store: new Map(this.inner.store),
      acked: this.acked,
    });
  }
  private async op(
    op: "write" | "remove",
    key: string,
    run: () => Promise<void>,
  ): Promise<void> {
    const n = this.n++;
    const kind = kindOf(key);
    const g = this.policy.gate?.(op, key);
    if (g) await g;
    const d = this.policy.delay(op, kind, n);
    await sleep(d);
    if (this.policy.fail?.(op, kind, n)) {
      this.failures++;
      throw new StorageError("io", `chaos: ${op} ${key} failed`);
    }
    await run();
    this.point(`${op} ${key}`);
  }
  available(): Promise<boolean> {
    return this.inner.available();
  }
  read(key: string): Promise<Uint8Array | null> {
    return this.inner.read(key);
  }
  list(prefix: string): Promise<string[]> {
    return this.inner.list(prefix);
  }
  quota(): Promise<number | null> {
    return this.inner.quota();
  }
  write(key: string, data: Uint8Array): Promise<void> {
    return this.op("write", key, () => this.inner.write(key, data));
  }
  remove(key: string): Promise<void> {
    return this.op("remove", key, () => this.inner.remove(key));
  }
  /** The state right now, as a kill point (e.g. "before anything"). */
  snapshotNow(label: string): void {
    this.point(label);
  }
}

// ───────────────────────────── the live game ─────────────────────────────

/**
 * One live session: real sim + GameSession + SaveFlow over `backend`, driven by hand. Every world the run passes
 * through is indexed: index 2t = tick t before its command, 2t+1 = after it (at most one command per tick).
 */
class Live {
  readonly env = new FakeEnv();
  readonly sim: SimulationAPI;
  readonly session: GameSession;
  readonly flow: SaveFlow;
  readonly reports: string[] = [];
  /** World hash → state index (the world holds its tick, so one hash can only repeat within a tick). */
  readonly seen = new Map<string, number>();
  index = 0;
  block = false;

  constructor(
    readonly backend: ChaosBackend,
    seed: number,
  ) {
    this.sim = real!.createSimulation(newWorld(seed));
    this.session = new GameSession(
      this.sim,
      { loadedFrom: null, playMinutesBase: 0 },
      () => undefined,
    );
    const session = this.session;
    const host: SaveFlowHost = {
      env: this.env,
      renderer: new FakeRenderer(),
      saves: mkSaves(backend),
      session: () => session,
      screen: () => "game",
      settings: () => ({ ...DEFAULT_SETTINGS, autosaveMinutes: 0 }), // the test decides when to save
      choicePending: () => this.block,
      toast: () => undefined,
      sfx: () => undefined,
      report: (w) => this.reports.push(w),
      changed: () => undefined,
    };
    this.flow = new SaveFlow(host);
    this.flow.beginSession(null);
    this.note(0);
  }

  private note(sub: 0 | 1): void {
    this.index = 2 * this.sim.state.tick + sub;
    const h = stateHash(this.sim);
    this.seen.set(h, this.index); // the latest: a command with no effect (nothing to mark read, same setting) leaves 2t and 2t+1 one world
  }

  dispatch(c: Command): void {
    this.session.dispatch(c);
    this.note(1);
  }

  step(): void {
    this.sim.step();
    this.sim.drainEvents();
    this.note(0);
  }

  /** Frame-loop work: advance the fake clock and pump (journal cadence, event saves). */
  pump(ms = 250): void {
    this.env.advance(ms);
    this.flow.tick();
  }

  /** flushNow(); once it resolves with every op up to the call durable, that state is ACKNOWLEDGED. */
  ack(): Promise<void> {
    const w = this.flow.journal.active;
    const at = this.index;
    const p = this.flow.flushJournal();
    const g = w ? w.mark() : -1;
    return p.then(() => {
      if (w && w === this.flow.journal.active && w.isDurableThrough(g))
        this.backend.acked = Math.max(this.backend.acked, at);
    });
  }

  /** Wait until no save job, autosave follow-up or journal write is in flight (deterministic, not a time budget). */
  async settle(): Promise<void> {
    let quiet = 0;
    const t0 = performance.now();
    while (quiet < 3) {
      await flush(4);
      await sleep(0);
      const w = this.flow.journal.active;
      quiet =
        this.flow.saving || this.flow.autosave.busy || (!!w && w.busy)
          ? 0
          : quiet + 1;
      if (performance.now() - t0 > 60_000)
        throw new Error("settle: storage never drained");
    }
  }
}

/** A legal-ish command that never touches the build undo history (see the build-history test for that). */
function safeCommand(
  sim: SimulationAPI,
  rnd: () => number,
  k: number,
): Command | null {
  const ids = sim.state.household.memberIds;
  const r = rnd();
  if (r < 0.3) return { type: "renameHousehold", name: `House ${k}` };
  if (r < 0.45)
    return {
      type: "setSettings",
      settings: {
        autonomy: (["full", "limited", "off"] as const)[Math.floor(rnd() * 3)],
      },
    };
  if (r < 0.55) return { type: "markNotificationsRead" };
  if (r < 0.85 && ids.length) {
    const entries = sim
      .menu(ids[0], { kind: "self" })
      .flatMap((e) => (e.children && e.children.length ? e.children : [e]))
      .filter((e) => e.available);
    if (entries.length === 0) return null;
    const e = entries[Math.floor(rnd() * entries.length)];
    return {
      type: "queue",
      actorId: ids[0],
      interactionId: e.interactionId,
      target: { kind: "self" },
      params: e.params,
    };
  }
  const q = ids.length ? sim.queueView(ids[0]) : [];
  return q.length
    ? {
        type: "cancel",
        actorId: ids[0],
        uid: q[Math.floor(rnd() * q.length)].uid,
      }
    : null;
}

interface Relaunch {
  /** State index of the recovered world (-1: nothing to load). */
  index: number;
  /** The snapshot that was in the slot: its tick and the first 8 hex of its payload hash (diagnostics). */
  snapshot?: string;
  recovered: boolean;
  stopped: string | null;
}

/** Relaunch from one kill point: latest slot → load → journal recovery. */
async function relaunch(kill: KillPoint, live: Live): Promise<Relaunch> {
  freshLocks(); // the killed page's locks are gone
  const backend = createMemoryBackend();
  for (const [k, v] of kill.store) backend.store.set(k, v);
  const saves = mkSaves(backend);
  const latest = await saves.latest();
  if (!latest) return { index: -1, recovered: false, stopped: null };
  const res = await saves.load(latest.slotId);
  if (!res.ok)
    throw new Error(
      `kill point "${kill.label}": the save does not load (${res.error})`,
    );
  const sim0 = real!.createSimulation(res.world);
  const session = new GameSession(
    sim0,
    { loadedFrom: latest.slotId, playMinutesBase: 0 },
    () => undefined,
  );
  const flow = new SaveFlow({
    env: new FakeEnv(),
    renderer: new FakeRenderer(),
    saves,
    session: () => session,
    screen: () => "game",
    settings: () => ({ ...DEFAULT_SETTINGS, autosaveMinutes: 0 }),
    choicePending: () => true,
    toast: () => undefined,
    sfx: () => undefined,
    report: () => undefined,
    changed: () => undefined,
  });
  const out = await flow.recoverJournal(res, sim0, (w) =>
    real!.createSimulation(w),
  );
  flow.journal.end();
  const h = stateHash(out.sim);
  const index = live.seen.get(h);
  if (index === undefined)
    throw new Error(
      `kill point "${kill.label}": recovery produced a world the live run never had (tick ${out.sim.state.tick}; ${out.recovered?.stopped ?? "no stop"})`,
    );
  return {
    index,
    recovered: out.recovered !== null,
    stopped: out.recovered?.stopped ?? null,
    snapshot: `tick ${res.world.tick} sha ${savePayloadSha256(res.world).slice(0, 8)}`,
  };
}

/**
 * Everything needed to explain a durability violation from the CI log alone (the interleaving depends on real timer
 * latency, so a failure on one machine may not reproduce on another): what was in storage at the kill point — each
 * journal chunk's epoch, seq, first index, entry count and base — and the writes that landed just before it.
 */
function describeKill(kill: KillPoint, live: Live, r: Relaunch): string {
  try {
    return describeKillUnsafe(kill, live, r);
  } catch (e) {
    return `(diagnostics failed: ${e instanceof Error ? e.message : String(e)})`;
  }
}
function describeKillUnsafe(kill: KillPoint, live: Live, r: Relaunch): string {
  const lines: string[] = [`loaded snapshot: ${r.snapshot ?? "?"}; journal replay: ${r.recovered ? "yes" : "none"}`];
  for (const [k, v] of [...kill.store].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (kindOf(k) !== "journal") {
      lines.push(`  ${k} (${v.byteLength} bytes)`);
      continue;
    }
    const d = decodeChunk(v, k);
    lines.push(
      d.ok
        ? `  ${k}: first ${d.chunk.first}, ${d.chunk.entries.length} entries, base tick ${d.chunk.base.tick} sha ${d.chunk.base.payloadSha256.slice(0, 8)}`
        : `  ${k}: UNREADABLE (${d.error})`,
    );
  }
  const at = live.backend.kills.indexOf(kill);
  lines.push("last writes before it (label, acked):");
  for (const p of live.backend.kills.slice(Math.max(0, at - 12), at + 1)) lines.push(`  ${p.label} (acked ${p.acked})`);
  lines.push(`save/journal reports: ${JSON.stringify(live.reports).slice(0, 600)}`);
  return lines.join("\n");
}

/** Relaunch every kill point; each must be a world of the live run, no older than what was acknowledged. */
async function verifyAllKills(
  live: Live,
): Promise<{ points: number; recovered: number; maxLoss: number }> {
  let recovered = 0;
  let maxLoss = 0;
  for (const kill of live.backend.kills) {
    const r = await relaunch(kill, live);
    if (r.index < 0) {
      expect(
        kill.acked,
        `kill point "${kill.label}": nothing loadable although state ${kill.acked} was acknowledged`,
      ).toBe(-1);
      continue;
    }
    if (r.recovered) recovered++;
    expect(
      r.index,
      `kill point "${kill.label}": recovered state ${r.index} is older than the acknowledged ${kill.acked} (${r.stopped ?? "no stop"})${r.index < kill.acked ? `\n${describeKill(kill, live, r)}` : ""}`,
    ).toBeGreaterThanOrEqual(kill.acked);
    maxLoss = Math.max(maxLoss, kill.acked - r.index);
  }
  return { points: live.backend.kills.length, recovered, maxLoss };
}

/** A few game-minutes of play with saves, flushes and acknowledgements all racing each other. */
async function play(
  live: Live,
  rnd: () => number,
  ticks: number,
  opts: { saveEvery: number; ackEvery: number },
): Promise<void> {
  const pending: Promise<unknown>[] = [];
  let k = 0;
  for (let i = 0; i < ticks; i++) {
    if (rnd() < 0.35) {
      const c = safeCommand(live.sim, rnd, k++);
      if (c) live.dispatch(c);
    }
    if (i % opts.saveEvery === 0)
      pending.push(live.flow.autosaveNow(`chaos${i}`)); // serialized now, lands whenever
    if (i % opts.ackEvery === 0) pending.push(live.ack());
    live.step();
    if (i % 4 === 0) live.pump();
    await sleep(Math.floor(rnd() * 3)); // play goes on while writes are in flight
  }
  await Promise.all(pending);
  live.pump(1000);
  await live.ack();
  await live.settle();
}

describe.skipIf(real === null)(
  `W-119 journal × hostile storage${loadError ? ` (skipped: ${loadError})` : ""}`,
  () => {
    const scenarios: {
      name: string;
      policy: (rnd: () => number) => ChaosPolicy;
    }[] = [
      {
        name: "slow snapshot writes (the journal lands first)",
        policy: (rnd) => ({
          delay: (_op, kind) =>
            kind === "journal"
              ? Math.floor(rnd() * 2)
              : 15 + Math.floor(rnd() * 25),
        }),
      },
      {
        name: "slow journal writes (the snapshot lands first)",
        policy: (rnd) => ({
          delay: (_op, kind) =>
            kind === "journal"
              ? 15 + Math.floor(rnd() * 25)
              : Math.floor(rnd() * 2),
        }),
      },
      {
        name: "random latency on every write (reordered)",
        policy: (rnd) => ({ delay: () => Math.floor(rnd() * 20) }),
      },
      {
        name: "random latency + 15 % of all writes and removes failing",
        policy: (rnd) => ({
          delay: () => Math.floor(rnd() * 12),
          fail: () => rnd() < 0.15,
        }),
      },
    ];

    for (const sc of scenarios) {
      it(`${sc.name}: a kill after ANY write recovers an exact live world, never older than the acknowledged one`, async () => {
        const rnd = prng(0x119 + sc.name.length + CHAOS_SEED * 7919); // CHAOS_SEED=n: soak other interleavings
        const backend = new ChaosBackend(sc.policy(rnd));
        backend.snapshotNow("before anything");
        const live = new Live(backend, 31);
        await play(live, rnd, 360, { saveEvery: 45, ackEvery: 9 });
        const res = await verifyAllKills(live);
        expect(res.points).toBeGreaterThan(40);
        expect(res.recovered).toBeGreaterThan(0); // journal replay really happened at some kill points
        if (!sc.name.includes("failing")) {
          // With healthy storage the journal must have kept up: the very last state is durable and recovered.
          const last = await relaunch(
            backend.kills[backend.kills.length - 1],
            live,
          );
          expect(last.index).toBe(live.index);
          expect(live.reports).toEqual([]);
        } else expect(backend.failures).toBeGreaterThan(0);
        console.info(
          `[chaos] ${sc.name}: ${res.points} kill points, ${res.recovered} via journal replay, worst loss past the ack: ${res.maxLoss}`,
        );
      }, 180_000);
    }

    it("the staged anchor is the exact payloadSha256 the SaveManager reports (else every save would fall back to one-phase)", async () => {
      const backend = createMemoryBackend();
      const sim = real!.createSimulation(newWorld(35));
      for (let i = 0; i < 50; i++) sim.step();
      const world = sim.serialize();
      const res = await mkSaves(backend).save(
        "auto-00000023",
        "x",
        world,
        buildSaveMeta(sim, null),
        { autosave: true },
      );
      expect(res.ok).toBe(true);
      expect(res.ok && res.payloadSha256).toBe(savePayloadSha256(world));
    });

    it("two-phase rebase: snapshot landed, journal not yet rebased → every command flushed during the save survives the kill", async () => {
      // Hold the snapshot's primary write; meanwhile play on and flush (acknowledged). Then let the snapshot land and
      // also hold the first journal write after it, so the page dies in exactly the old window.
      const held: {
        primary: (() => void) | null;
        journal: (() => void) | null;
        holdJournal: boolean;
      } = { primary: null, journal: null, holdJournal: false };
      let primaries = 0;
      const backend = new ChaosBackend({
        delay: () => 0,
        gate: (op, key) => {
          if (op === "write" && kindOf(key) === "primary" && ++primaries === 2)
            return new Promise<void>((r) => (held.primary = r));
          if (held.holdJournal && kindOf(key) === "journal") {
            held.holdJournal = false;
            return new Promise<void>((r) => (held.journal = r));
          }
          return null;
        },
      });
      const live = new Live(backend, 32);
      expect(await live.flow.autosaveNow("newGame")).toBe("saved");
      await live.settle();
      const rnd = prng(7);
      for (let i = 0; i < 20; i++) {
        live.dispatch(
          safeCommand(live.sim, rnd, i) ?? { type: "markNotificationsRead" },
        );
        live.step();
      }
      const save = live.flow.autosaveNow("slow");
      for (let i = 0; held.primary === null && i < 200; i++) await sleep(1);
      expect(held.primary).not.toBeNull(); // the snapshot write is now stuck in storage
      for (let i = 0; i < 30; i++) {
        live.dispatch({
          type: "renameHousehold",
          name: `During the save ${i}`,
        });
        live.step();
        if (i % 5 === 4) await live.ack();
      }
      const acked = backend.acked;
      expect(acked).toBeGreaterThan(0);
      held.holdJournal = true;
      held.primary!();
      for (let i = 0; i < 200 && held.journal === null; i++) await sleep(1);
      // ── the page dies here: snapshot durable, the rebase's journal write not ──
      expect(held.journal).not.toBeNull();
      const kill = backend.kills
        .filter((k) => /:primary$/.test(k.label))
        .at(-1)!;
      expect(kill.acked).toBe(acked);
      const r = await relaunch(kill, live);
      expect(r.recovered).toBe(true);
      expect(r.index).toBeGreaterThanOrEqual(acked); // pre-W-119: the snapshot only — 30 commands lost
      held.journal!();
      expect(await save).toBe("saved");
      await live.settle();
    }, 60_000);

    it("idempotent anchors: a save coalesced into a newer queued one never re-anchors the journal on the wrong ops", async () => {
      // Save A hangs in storage; the watchdog gives up on it, so B and then C are queued behind it in the SaveManager
      // and C is coalesced INTO B: both resolve with C's snapshot. Time is paused (no ticks), so B and C have the same
      // tick: anchoring "B's ops" on C's snapshot would replay the commands between B and C a second time.
      const held: { a: (() => void) | null } = { a: null };
      let primaries = 0;
      const backend = new ChaosBackend({
        delay: () => 0,
        gate: (op, key) =>
          op === "write" && kindOf(key) === "primary" && ++primaries === 2
            ? new Promise<void>((r) => (held.a = r))
            : null,
      });
      const live = new Live(backend, 33);
      expect(await live.flow.autosaveNow("newGame")).toBe("saved");
      await live.settle();
      const ids = live.sim.state.household.memberIds;
      const queueCmd = (): Command => {
        const e = live.sim
          .menu(ids[0], { kind: "self" })
          .flatMap((x) => (x.children && x.children.length ? x.children : [x]))
          .find((x) => x.available)!;
        return {
          type: "queue",
          actorId: ids[0],
          interactionId: e.interactionId,
          target: { kind: "self" },
          params: e.params,
        };
      };
      live.dispatch({ type: "renameHousehold", name: "A" });
      const a = live.flow.autosaveNow("A");
      for (let i = 0; held.a === null && i < 200; i++) await sleep(1);
      expect(held.a).not.toBeNull();
      live.env.advance(SAVE_JOB_TIMEOUT_MS + 1); // A's watchdog fires; the queue moves on
      expect(await a).toBe("failed");
      live.dispatch({ type: "renameHousehold", name: "B" });
      const b = live.flow.autosaveNow("B"); // queued in the SaveManager behind the stuck A
      await flush(20);
      live.dispatch(queueCmd()); // queued TWICE if replayed twice (no tick → no fingerprint marker would catch it)
      live.dispatch(queueCmd());
      live.env.advance(SAVE_JOB_TIMEOUT_MS + 1); // B's watchdog too
      expect(await b).toBe("failed");
      live.dispatch({ type: "renameHousehold", name: "C" });
      const c = live.flow.autosaveNow("C"); // coalesced into B (not started yet)
      await flush(20);
      live.dispatch({ type: "renameHousehold", name: "After C" });
      held.a!();
      expect(await c).toBe("saved");
      await live.settle();
      await live.ack();
      await live.settle();
      // Every kill point (incl. the ones between "B's" and C's rebase) is an exact live world.
      const res = await verifyAllKills(live);
      expect(res.points).toBeGreaterThan(5);
      const last = await relaunch(
        backend.kills[backend.kills.length - 1],
        live,
      );
      expect(last.index).toBe(live.index);
    }, 60_000);

    it("build history: an undo reaching back past a mid-build-session snapshot re-anchors at once; a kill before that keeps the prefix", async () => {
      const backend = new ChaosBackend({ delay: () => 0 });
      const live = new Live(backend, 34);
      expect(await live.flow.autosaveNow("newGame")).toBe("saved");
      await live.settle();
      // Build mode: a wall, then a save WHILE the undo history holds that wall (e.g. the tab was hidden).
      live.dispatch({
        type: "build",
        cmd: {
          type: "addWalls",
          edges: ["h:6:6", "h:7:6"],
          style: "wall_plaster_bone",
        },
      });
      expect(live.sim.build.canUndo()).toBe(true);
      live.step();
      expect(await live.flow.autosaveNow("hidden")).toBe("saved");
      await live.settle();
      const writesBefore = live.flow.autosave.writeCount;
      const killsBefore = backend.kills.length;
      // Undo the wall: the snapshot already has it, a replay could not undo it (its history is not saved).
      live.dispatch({ type: "undo" });
      const afterUndo = live.index;
      await flush(4);
      expect(live.flow.saving).toBe(true); // re-anchoring at once, not after the 1.5 s / 10 s event-save spacing
      for (let i = 0; i < 20; i++) {
        live.dispatch({ type: "renameHousehold", name: `After undo ${i}` });
        live.step();
        live.pump();
      }
      await live.settle(); // (no acknowledgement before the re-anchoring save landed: see the header)
      await live.ack();
      await live.settle();
      expect(live.flow.autosave.writeCount).toBe(writesBefore + 1);
      const res = await verifyAllKills(live);
      expect(res.points).toBeGreaterThan(killsBefore);
      // Killed before the re-anchoring save landed: the verified prefix (everything before the undo), never a world
      // with the wall undone twice or kept by mistake.
      const early = await relaunch(backend.kills[killsBefore], live);
      expect(early.index).toBeLessThan(afterUndo);
      // Killed at the end: everything, the undo included.
      const last = await relaunch(
        backend.kills[backend.kills.length - 1],
        live,
      );
      expect(last.index).toBe(live.index);
    }, 60_000);
  },
);
