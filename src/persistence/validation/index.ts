/**
 * validateWorld — structural validation + conservative repair of a (migrated) save payload.
 *
 * Result: { ok: true, world, warnings } when the payload is usable (possibly after repairs), or
 * { ok: false, errors } when a top-level structure without a safe default is broken (the caller
 * reports LoadResult code 'invalid' and tries the backup).
 *
 * After the schema pass, a cross-field pass fixes integrity problems that would otherwise corrupt
 * future state: record keys that disagree with ids, mis-keyed relationships, household members that
 * do not exist, and an id counter (nextId) that would hand out ids already in use.
 */
import type { AgentState, ObjectState, Relationship, WorldState } from '../../sim/types';
import { seedRngState } from '../../sim/rng';
import { isPlainObject } from '../sanitize';
import { RESERVED_KEYS } from '../sanitize';
import { INVALID, type Issue, VCtx, hasOwn } from './core';
import { FATAL_FIELDS, worldShape } from './worldSchema';

export type { Issue } from './core';

export type WorldValidation =
  | { ok: true; world: WorldState; warnings: string[]; issues: Issue[] }
  | { ok: false; errors: string[]; issues: Issue[] };

const FATAL = new Set<string>(FATAL_FIELDS);
const MAX_WARNINGS = 25;

export function summarizeIssues(issues: readonly Issue[], suppressed = 0, max = MAX_WARNINGS): string[] {
  const out = issues.slice(0, max).map((i) => `${i.kind === 'dropped' ? 'Removed' : i.kind === 'fatal' ? 'Fatal' : 'Repaired'} ${i.path}: ${i.message}`);
  const more = issues.length - out.length + suppressed;
  if (more > 0) out.push(`...and ${more} more repair(s)`);
  return out;
}

function idNumber(s: string): number {
  const m = /^[a-z]+(\d{1,15})$/i.exec(s);
  return m ? Number(m[1]) : -1;
}

function crossFieldPass(w: WorldState, ctx: VCtx): void {
  // 1. Record keys are authoritative for identity.
  for (const [key, a] of Object.entries(w.agents) as [string, AgentState][]) {
    if (a.id !== key) {
      ctx.report('repaired', `agent id ${JSON.stringify(a.id)} disagrees with its key; set to key`, `agents.${key}.id`);
      a.id = key;
    }
  }
  for (const [key, o] of Object.entries(w.objects) as [string, ObjectState][]) {
    if (o.id !== key) {
      ctx.report('repaired', `object id ${JSON.stringify(o.id)} disagrees with its key; set to key`, `objects.${key}.id`);
      o.id = key;
    }
  }

  // 2. Relationships: key = `${a}|${b}` with a < b; self-relationships removed; first key wins.
  const rels: Record<string, Relationship> = {};
  for (const [key, r] of Object.entries(w.relationships)) {
    if (r.a === r.b) {
      ctx.report('dropped', 'relationship with itself removed', `relationships.${key}`);
      continue;
    }
    let rel = r;
    if (rel.a > rel.b) {
      ctx.report('repaired', 'relationship ids out of order; swapped', `relationships.${key}`);
      rel = { ...rel, a: rel.b, b: rel.a };
    }
    const want = `${rel.a}|${rel.b}`;
    if (want !== key) ctx.report('repaired', `relationship re-keyed to ${want}`, `relationships.${key}`);
    if (rels[want]) {
      ctx.report('dropped', `duplicate relationship ${want} removed`, `relationships.${key}`);
      continue;
    }
    rels[want] = rel;
  }
  w.relationships = rels;

  // 3. Household members must exist and be household-role agents.
  const before = w.household.memberIds.length;
  w.household.memberIds = w.household.memberIds.filter((id) => Object.prototype.hasOwnProperty.call(w.agents, id));
  if (w.household.memberIds.length !== before) {
    ctx.report('repaired', `${before - w.household.memberIds.length} household member id(s) referenced missing agents; removed`, 'household.memberIds');
  }
  if (w.household.memberIds.length === 0) {
    const derived = Object.values(w.agents)
      .filter((a) => a.role === 'household')
      .map((a) => a.id)
      .slice(0, 16);
    if (derived.length > 0) {
      ctx.report('repaired', 'household member list empty; rebuilt from household-role agents', 'household.memberIds');
      w.household.memberIds = derived;
    }
  }
  for (const id of w.household.memberIds) {
    const a = w.agents[id];
    if (a.role !== 'household') {
      ctx.report('repaired', `member has role ${a.role}; set to household`, `agents.${id}.role`);
      a.role = 'household';
    }
  }

  // 4. nextId must exceed every id already handed out (agents, objects, queue uids, notifications).
  let maxUsed = 0;
  const bump = (n: number) => {
    if (Number.isFinite(n) && n > maxUsed) maxUsed = n;
  };
  for (const key of Object.keys(w.agents)) bump(idNumber(key));
  for (const key of Object.keys(w.objects)) bump(idNumber(key));
  for (const a of Object.values(w.agents)) {
    for (const q of a.queue) bump(q.uid);
    if (a.active) bump(a.active.uid);
  }
  for (const n of w.notifications) bump(n.id);
  if (w.nextId <= maxUsed) {
    ctx.report('repaired', `nextId ${w.nextId} would reuse existing ids; set to ${maxUsed + 1}`, 'nextId');
    w.nextId = maxUsed + 1;
  }
}

export function validateWorld(raw: unknown, opts: { maxIssues?: number } = {}): WorldValidation {
  const ctx = new VCtx(opts.maxIssues ?? 500);
  if (!isPlainObject(raw)) {
    return { ok: false, errors: ['save payload is not an object'], issues: [] };
  }
  const out: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const key of Object.keys(worldShape) as (keyof typeof worldShape)[]) {
    ctx.enter(key);
    const check = worldShape[key] as (v: unknown, c: VCtx) => unknown;
    const r = check(raw[key], ctx);
    ctx.leave();
    if (r !== INVALID) {
      // optional fields (WorldState.quests) stay ABSENT rather than `key: undefined` (canonical JSON rejects undefined)
      if (r !== undefined) out[key] = r;
      continue;
    }
    if (key === 'rng') {
      const seed = typeof raw.seed === 'number' && Number.isFinite(raw.seed) ? raw.seed : 0;
      ctx.report('repaired', `${ctx.lastError.message}; RNG re-seeded from world seed`, 'rng');
      out.rng = seedRngState(seed);
      continue;
    }
    const msg = `${ctx.lastError.path}: ${ctx.lastError.message}`;
    ctx.report('fatal', ctx.lastError.message, ctx.lastError.path);
    errors.push(FATAL.has(key) ? msg : `${msg} (no safe default)`);
  }
  // Unknown top-level keys are kept: data written by a newer minor revision is not destroyed. (Own-property
  // checks, not `in`: an extra named like an Object.prototype member must survive; reserved keys must not.)
  for (const k of Object.keys(raw)) {
    if (hasOwn(out, k) || hasOwn(worldShape, k)) continue;
    if (RESERVED_KEYS.has(k)) {
      ctx.report('dropped', 'reserved key removed', k);
      continue;
    }
    out[k] = raw[k];
  }
  if (errors.length > 0) return { ok: false, errors, issues: ctx.issues };
  const world = out as unknown as WorldState;
  crossFieldPass(world, ctx);
  return { ok: true, world, warnings: summarizeIssues(ctx.issues, ctx.suppressed), issues: ctx.issues };
}
