/**
 * createBuildService(ctx): BuildService — build/buy mode commands with exact undo/redo.
 *
 * apply(cmd):   plan (pure validation, see plan.ts) -> charge (ctx.spend, all-or-nothing: on "Not enough money"
 *               nothing changes) -> run inside a Tx -> refund (ctx.earn) for sells/demolition -> commit:
 *               lot.version++ for object / wall-structure changes, lot.wallVersion++ for any wall change (paint too),
 *               lot.floorVersion++ for floors, ctx.spatial.invalidate(), agents left standing on NEWLY blocked tiles are
 *               moved to the nearest walkable tile (pos = prevPos = tile centre, path cleared; a running interaction
 *               is interrupted), then { type: 'lot', what } events per category. Exceptions roll the Tx back and
 *               return the charge; the result is { ok: false, reason: "Couldn't build that" }.
 * preview(cmd): the same plan without mutation; also fails with "Not enough money" when cost > funds.
 * undo():       reverts the newest entry: undo refunds exactly what was paid (or re-charges exactly what was refunded;
 *               insufficient funds -> false, history kept). redo() re-applies it and re-charges/refunds the same amount.
 *               If the world diverged (a primary entity no longer matches, or a restored object would now overlap
 *               furniture / fire / straddle a wall — see verify.ts) the step is reverted, the history cleared and false
 *               returned; dependent items (plates on a moved/sold table) that diverged are simply left alone.
 *               Undo/redo restore objects under their ORIGINAL ids (snapshots), never new ones. After a successful
 *               undo/redo every object it MOVED (present on both sides, placement changed) carries along any item
 *               resting on it that the entry did not track (a diverged plate, one set down later) and has its users
 *               interrupted (carry.ts) — no item is ever left floating where its surface used to be.
 * relocation:   agents on NEWLY blocked tiles move to nearestWalkable; a posed ('run' / 'wait') interaction there is
 *               interrupted (the engine walks it out).
 * re-entrancy: apply / undo / redo called while one of them is running (an engine hook dispatching a build mid-command)
 *               is refused ({ ok: false, reason: 'Still building — try again' } / false) — a nested transaction could
 *               otherwise interleave with the outer one's snapshots. preview() is pure and always allowed.
 * clearHistory(): leave build/buy mode. A new apply() clears the redo stack. History holds the last 200 entries and is
 *               also dropped if ctx.state is replaced (load).
 * cost sign: > 0 charge, < 0 refund (sell / delete walls).
 */
import { FREE_PLACEMENT_AT, registerPlacement } from '../../../shared/homeBuild';
import type { BuildCommand, BuildPreview, BuildService } from '../../contracts';
import type { AgentId, ObjectId, WorldState } from '../../types';
import type { BuildContext } from './context';
import { BUILD_REASONS, planCommand } from './plan';
import { applyChanges, jsonEq, selectApplicable, Tx, type Change } from './tx';
import { restoredConflicts } from './verify';
import { carriedPlacement, childrenOf, releaseWithChildren, surfaceFrame } from './carry';
import { agentAtBuildHome } from './region';

interface Entry {
  label: string;
  /** Net money: > 0 the player paid, < 0 the player was refunded. */
  charged: number;
  changes: Change[];
  state: WorldState;
}

const HISTORY_LIMIT = 200;

function bump(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v + 1 : 1;
}

export function createBuildService(ctx: BuildContext): BuildService {
  let undoStack: Entry[] = [];
  let redoStack: Entry[] = [];
  /** A command (apply / undo / redo) is running: nested ones are refused (see header). */
  let busy = false;

  function guarded<T>(refused: T, fn: () => T): T {
    if (busy) return refused;
    busy = true;
    try {
      return fn();
    } finally {
      busy = false;
    }
  }

  function funds(): number {
    const f = ctx.state.household ? ctx.state.household.funds : 0;
    return typeof f === 'number' && Number.isFinite(f) ? f : 0;
  }

  function onLotWalkability(): Map<AgentId, boolean> {
    const m = new Map<AgentId, boolean>();
    const agents = ctx.state.agents || {};
    for (const id in agents) {
      const a = agents[id];
      if (!a || a.presence !== 'onLot' || !agentAtBuildHome(ctx.state, a) || !a.pos || !Number.isFinite(a.pos.x) || !Number.isFinite(a.pos.z)) continue;
      m.set(id, ctx.spatial.isWalkable(a.pos.x, a.pos.z));
    }
    return m;
  }

  function relocate(before: Map<AgentId, boolean>): void {
    const agents = ctx.state.agents || {};
    for (const [id, was] of before) {
      if (!was) continue;
      const a = agents[id];
      if (!a || a.presence !== 'onLot' || !agentAtBuildHome(ctx.state, a)) continue;
      if (ctx.spatial.isWalkable(a.pos.x, a.pos.z)) continue;
      const dest = ctx.spatial.nearestWalkable(a.pos);
      if (!dest) continue;
      a.pos = { x: dest.x + 0.5, z: dest.z + 0.5 };
      a.prevPos = { x: dest.x + 0.5, z: dest.z + 0.5 };
      a.posY = 0;
      a.path = null;
      a.pathIndex = 0;
      if (a.active && (a.active.phase === 'run' || a.active.phase === 'wait')) ctx.interrupt(a, 'Something was built where they stood');
    }
  }

  /**
   * After an undo/redo drove `applied` to `to`: for every object that MOVED, carry along the items resting on it that
   * the entry did not track (mapped from its old frame to its new one), then interrupt the users of the moved objects
   * and of everything on them. Carrying happens BEFORE the interrupts, so an item an end() hook sets down during an
   * interrupt (already in the new frame) is not carried twice.
   */
  function settleMoved(applied: Change[], to: 'before' | 'after'): void {
    const objs = ctx.state.objects || {};
    const tracked = new Set<string>();
    for (const c of applied) if (c.kind === 'obj') tracked.add(c.id);
    const moved: ObjectId[] = [];
    for (const c of applied) {
      if (c.kind !== 'obj') continue;
      const from = to === 'before' ? c.after : c.before;
      const dest = c[to];
      const obj = objs[c.id];
      if (!from || !dest || !obj || jsonEq(from.placement, dest.placement)) continue;
      moved.push(c.id);
      const oldFrame = surfaceFrame(ctx.content, from);
      const newFrame = surfaceFrame(ctx.content, obj);
      if (!oldFrame || !newFrame) continue;
      for (const child of childrenOf(ctx.state, c.id)) {
        if (tracked.has(child.id)) continue;
        const np = carriedPlacement(ctx.content, obj, oldFrame, newFrame, child);
        if (!np) continue;
        child.placement = np;
        ctx.markChanged(child);
      }
    }
    if (moved.length === 0) return;
    // Interrupted runs may finish synchronously and query geometry (standUp -> nearestWalkable): show them the
    // restored lot, not the cached pre-undo grid.
    ctx.spatial.invalidate();
    for (const id of moved) {
      const obj = objs[id];
      if (obj) releaseWithChildren(ctx, obj, 'Moved in build mode');
    }
  }

  function commit(changes: Change[], before: Map<AgentId, boolean>): void {
    const lot = ctx.state.lot;
    let walls = false;
    let structural = false;
    let floors = false;
    let objects = false;
    for (const c of changes) {
      if (c.kind === 'wall') {
        walls = true;
        if (!c.before || !c.after || c.before.openingId !== c.after.openingId) structural = true;
      } else if (c.kind === 'floor') floors = true;
      else objects = true;
    }
    if (walls) lot.wallVersion = bump(lot.wallVersion);
    if (structural || objects) lot.version = bump(lot.version);
    if (floors) lot.floorVersion = bump(lot.floorVersion);
    ctx.spatial.invalidate();
    relocate(before);
    if (walls) ctx.emit({ type: 'lot', what: 'walls' });
    if (floors) ctx.emit({ type: 'lot', what: 'floors' });
    if (objects) ctx.emit({ type: 'lot', what: 'objects' });
  }

  /** commit() that never throws: the mutation and the money already happened, so history must record them. */
  function safeCommit(changes: Change[], before: Map<AgentId, boolean>): void {
    try {
      commit(changes, before);
    } catch {
      try {
        ctx.spatial.invalidate();
      } catch {
        /* caches resync on the next version bump */
      }
    }
  }

  /** restoredConflicts() where an unexpected throw counts as a conflict (the step is reverted, never half-kept). */
  function conflicts(applied: Change[], to: 'before' | 'after'): boolean {
    try {
      return restoredConflicts(ctx, applied, to);
    } catch {
      return true;
    }
  }

  /** Best-effort revert of a half-done undo/redo (the money is returned by the caller either way). */
  function revert(applied: Change[], to: 'before' | 'after'): void {
    try {
      applyChanges(ctx, applied, to);
    } catch {
      /* best effort */
    }
  }

  /** After a rolled-back failure: make sure every cache sees the (restored) state. */
  function touchAll(): void {
    const lot = ctx.state.lot;
    if (lot) {
      lot.version = bump(lot.version);
      lot.wallVersion = bump(lot.wallVersion);
    }
    try {
      ctx.spatial.invalidate();
      ctx.emit({ type: 'lot', what: 'all' });
    } catch {
      /* the version bumps above already force every cache to resync */
    }
  }

  function clearHistory(): void {
    undoStack = [];
    redoStack = [];
  }

  const service: BuildService = {
    preview(cmd: BuildCommand): BuildPreview {
      try {
        const plan = planCommand(ctx, cmd);
        const out: BuildPreview = { ok: plan.ok, cost: plan.cost };
        if (plan.edges) out.edges = plan.edges;
        if (plan.tiles) out.tiles = plan.tiles;
        if (plan.blockedSlots) out.blockedSlots = plan.blockedSlots;
        if (!plan.ok) {
          out.reason = plan.reason;
          return out;
        }
        if (plan.cost > 0 && plan.cost > funds()) {
          out.ok = false;
          out.reason = BUILD_REASONS.notEnoughMoney;
        }
        return out;
      } catch {
        return { ok: false, reason: BUILD_REASONS.failed, cost: 0 };
      }
    },

    apply(cmd: BuildCommand): { ok: boolean; reason?: string; cost: number; objectId?: ObjectId } {
      return guarded<{ ok: boolean; reason?: string; cost: number; objectId?: ObjectId }>({ ok: false, reason: BUILD_REASONS.busy, cost: 0 }, () => applyNow(cmd));
    },

    undo(): boolean {
      return guarded(false, undoNow);
    },

    redo(): boolean {
      return guarded(false, redoNow);
    },

    canUndo(): boolean {
      return undoStack.length > 0;
    },

    canRedo(): boolean {
      return redoStack.length > 0;
    },

    clearHistory,
  };

  function applyNow(cmd: BuildCommand): { ok: boolean; reason?: string; cost: number; objectId?: ObjectId } {
    let plan;
    try {
      plan = planCommand(ctx, cmd);
    } catch {
      return { ok: false, reason: BUILD_REASONS.failed, cost: 0 };
    }
    if (!plan.ok) return { ok: false, reason: plan.reason, cost: plan.cost };
    if (plan.noop || !plan.run) return { ok: true, cost: 0 };
    const before = onLotWalkability();
    const label = plan.label;
    if (plan.cost > 0 && !ctx.spend(plan.cost, `Build: ${label}`)) {
      return { ok: false, reason: BUILD_REASONS.notEnoughMoney, cost: plan.cost };
    }
    const tx = new Tx(ctx);
    let objectId: ObjectId | undefined;
    let changes: Change[];
    try {
      objectId = plan.run(tx);
      changes = tx.finalize();
    } catch {
      try {
        tx.rollback();
      } catch {
        /* best effort */
      }
      if (plan.cost > 0) ctx.earn(plan.cost, `Build refund: ${label}`);
      touchAll();
      return { ok: false, reason: BUILD_REASONS.failed, cost: plan.cost };
    }
    if (plan.cost < 0) ctx.earn(-plan.cost, `Build: ${label}`);
    safeCommit(changes, before);
    if (changes.length > 0 || plan.cost !== 0) {
      undoStack.push({ label, charged: plan.cost, changes, state: ctx.state });
      if (undoStack.length > HISTORY_LIMIT) undoStack.splice(0, undoStack.length - HISTORY_LIMIT);
      redoStack = [];
    }
    // Home build rules: count the placement; the 20th unlocks Free Placement (a milestone, announced once)
    if (ctx.state.homeBuild && (cmd.type === 'buy' || cmd.type === 'buyWallItem')) {
      const r = registerPlacement(ctx.state.homeBuild);
      ctx.state.homeBuild = r.state;
      if (r.unlockedNow) {
        ctx.emit({ type: 'sfx', id: 'milestone' });
        (ctx as { notify?: (n: { kind: 'good'; title: string; text: string }) => void }).notify?.({ kind: 'good', title: 'Free Placement unlocked', text: `You placed ${FREE_PLACEMENT_AT} items. Put things wherever you like now.` });
      }
    }
    const result: { ok: boolean; reason?: string; cost: number; objectId?: ObjectId } = { ok: true, cost: plan.cost };
    if (objectId !== undefined) result.objectId = objectId;
    return result;
  }

  function undoNow(): boolean {
    try {
      const entry = undoStack[undoStack.length - 1];
      if (!entry) return false;
      if (entry.state !== ctx.state) {
        clearHistory();
        return false;
      }
      const applicable = selectApplicable(ctx, entry.changes, 'after');
      if (!applicable) {
        clearHistory();
        return false;
      }
      const before = onLotWalkability();
      if (entry.charged < 0 && !ctx.spend(-entry.charged, `Undo: ${entry.label}`)) return false;
      try {
        applyChanges(ctx, applicable, 'before');
      } catch {
        revert(applicable, 'after');
        if (entry.charged < 0) ctx.earn(-entry.charged, `Undo failed: ${entry.label}`);
        touchAll();
        clearHistory();
        return false;
      }
      if (conflicts(applicable, 'before')) {
        // The lot changed under us (e.g. something now stands where the object would return): put it back.
        revert(applicable, 'after');
        if (entry.charged < 0) ctx.earn(-entry.charged, `Undo cancelled: ${entry.label}`);
        touchAll();
        clearHistory();
        return false;
      }
      if (entry.charged > 0) ctx.earn(entry.charged, `Undo: ${entry.label}`);
      try {
        settleMoved(applicable, 'before');
      } catch {
        /* best effort: the restore itself is complete */
      }
      safeCommit(applicable, before);
      undoStack.pop();
      redoStack.push(entry);
      return true;
    } catch {
      return false;
    }
  }

  function redoNow(): boolean {
    try {
      const entry = redoStack[redoStack.length - 1];
      if (!entry) return false;
      if (entry.state !== ctx.state) {
        clearHistory();
        return false;
      }
      const applicable = selectApplicable(ctx, entry.changes, 'before');
      if (!applicable) {
        clearHistory();
        return false;
      }
      const before = onLotWalkability();
      if (entry.charged > 0 && !ctx.spend(entry.charged, `Redo: ${entry.label}`)) return false;
      try {
        applyChanges(ctx, applicable, 'after');
      } catch {
        revert(applicable, 'before');
        if (entry.charged > 0) ctx.earn(entry.charged, `Redo failed: ${entry.label}`);
        touchAll();
        clearHistory();
        return false;
      }
      if (conflicts(applicable, 'after')) {
        revert(applicable, 'before');
        if (entry.charged > 0) ctx.earn(entry.charged, `Redo cancelled: ${entry.label}`);
        touchAll();
        clearHistory();
        return false;
      }
      if (entry.charged < 0) ctx.earn(-entry.charged, `Redo: ${entry.label}`);
      try {
        settleMoved(applicable, 'after');
      } catch {
        /* best effort: the restore itself is complete */
      }
      safeCommit(applicable, before);
      redoStack.pop();
      undoStack.push(entry);
      return true;
    } catch {
      return false;
    }
  }

  return service;
}
