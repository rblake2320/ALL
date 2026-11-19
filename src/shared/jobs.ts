/**
 * W-124 (D-071) household jobs — the shared, PURE half: the category table, the honesty rule ("a category is offered
 * only when at least one of its routes is implemented"), assignment-spec parsing / validation (used by the sim command
 * and the save validator) and player-facing labels. The runtime lives in src/sim/systems/jobs; candidates come from
 * the W-123 core `resolveActivity` (src/shared/questAction.ts) over ACTIVITY_CATEGORIES.
 *
 * Categories are DATA. A category is `available` only when (a) it is not flagged `later` and (b) at least one of its
 * routes names an implemented interaction: present in the registry, visible to the player, free (jobs never spend
 * money), and hosted by at least one object def (or targeting agents). Everything else is shown as "coming later" and
 * disabled — never as available. tests/unit/shared/jobs.test.ts fails if a visible category has zero routes.
 */
import type { ContentRegistry, InteractionDef } from '../sim/contracts';
import type { JobMode, JobPriority, JobScope, NeedId } from '../sim/types';
import { ACTIVITY_CATEGORIES, type QuestRoute } from './questAction';

/** How a job's real progress is measured (completion = the measured state changed in the right direction). */
export type JobMetric = 'mess' | 'broken' | 'fun' | 'social' | 'skill';

export interface JobCategoryDef {
  id: string;
  label: string;
  /** "cleaning", "playing" — used in toasts ("Mort finished cleaning"). */
  verb: string;
  icon: string;
  metric: JobMetric;
  /** Open-ended work (skills): "until done" has no natural end, so only Once / Daily are offered. */
  openEnded: boolean;
  /** Needs the work itself restores (never a reason to take a break from it). */
  helps: readonly NeedId[];
  /** Agent targets allowed (social): scope is lot / room only. */
  agentTargets?: boolean;
  /** Content is pending: shown as "coming later" and disabled, whatever its routes say. */
  later?: string;
  /** Untilfull threshold for need metrics (play / social are "done" at this level). */
  full?: number;
}

/** Display order. */
export const JOB_CATEGORIES: readonly JobCategoryDef[] = [
  { id: 'clean', label: 'Cleaning', verb: 'cleaning', icon: 'soap', metric: 'mess', openEnded: false, helps: [] },
  { id: 'repairs', label: 'Repairs', verb: 'repairing', icon: 'wrench', metric: 'broken', openEnded: false, helps: [] },
  { id: 'play', label: 'Play', verb: 'playing', icon: 'game', metric: 'fun', openEnded: false, helps: ['fun'], full: 92 },
  { id: 'hobbies', label: 'Hobbies', verb: 'their hobby', icon: 'paint', metric: 'skill', openEnded: true, helps: ['fun'] },
  { id: 'study', label: 'Study', verb: 'studying', icon: 'book', metric: 'skill', openEnded: true, helps: [] },
  { id: 'exercise', label: 'Exercise', verb: 'exercising', icon: 'dumbbell', metric: 'skill', openEnded: true, helps: [] },
  { id: 'social', label: 'Socialize', verb: 'socializing', icon: 'chat', metric: 'social', openEnded: false, helps: ['social'], agentTargets: true, full: 92 },
  { id: 'yard', label: 'Yard work', verb: 'yard work', icon: 'plant', metric: 'mess', openEnded: false, helps: [], later: 'Garden plots and yard chores arrive with yard building' },
  { id: 'cooking', label: 'Cooking', verb: 'cooking', icon: 'fridge', metric: 'mess', openEnded: false, helps: [], later: 'Cooking buys groceries, and jobs never spend money' },
];

const BY_ID = new Map(JOB_CATEGORIES.map((c) => [c.id, c]));

export function jobCategory(id: unknown): JobCategoryDef | null {
  return typeof id === 'string' ? BY_ID.get(id) ?? null : null;
}

/** Routes of a category (the W-123 ACTIVITY_CATEGORIES table — one source for quest Go and jobs). */
export function jobRoutes(id: string): readonly QuestRoute[] {
  return Object.prototype.hasOwnProperty.call(ACTIVITY_CATEGORIES, id) ? ACTIVITY_CATEGORIES[id] : [];
}

/** A free, visible interaction a job may run. */
export function jobInteractionAllowed(def: InteractionDef | undefined): def is InteractionDef {
  if (!def || def.hidden || def.playerAllowed === false) return false;
  if (typeof def.cost === 'number' && def.cost > 0) return false;
  return def.targetKind === 'object' || def.targetKind === 'agent';
}

/** Interaction ids a category's routes can run: implemented, free, visible, hosted by an object def (or agent-targeted). */
export function implementedJobInteractions(content: Pick<ContentRegistry, 'interactions' | 'objects'>, id: string): string[] {
  const out: string[] = [];
  const all = content.interactions ?? {};
  const objs = Object.values(content.objects ?? {});
  for (const r of jobRoutes(id)) {
    const ids = r.ids && r.ids.length ? [...r.ids] : Object.keys(all).sort().filter((k) => Array.isArray(all[k]?.tags) && (r.tags ?? []).some((t) => all[k].tags!.includes(t)));
    for (const iid of ids) {
      const def = all[iid];
      if (!jobInteractionAllowed(def) || out.includes(iid)) continue;
      if (r.notTags && Array.isArray(def.tags) && r.notTags.some((t) => def.tags!.includes(t))) continue;
      const hosted = def.targetKind === 'agent' || objs.some((o) => !!o && Array.isArray(o.interactions) && o.interactions.includes(iid));
      if (hosted) out.push(iid);
    }
  }
  return out;
}

export interface JobCategoryStatus {
  id: string;
  label: string;
  icon: string;
  available: boolean;
  /** Why it is not available ("coming later" text), null when available. */
  reason: string | null;
  openEnded: boolean;
  agentTargets: boolean;
  /** Implemented interactions (for the honesty test and the scope picker). */
  interactions: string[];
}

const statusCache = new WeakMap<object, JobCategoryStatus[]>();

/** The honesty rule: available ⇔ not `later` AND ≥ 1 implemented route interaction. (Cached per registry object.) */
export function jobCategoryStatuses(content: Pick<ContentRegistry, 'interactions' | 'objects'>): JobCategoryStatus[] {
  const hit = content && typeof content === 'object' ? statusCache.get(content) : undefined;
  if (hit) return hit;
  const out = computeStatuses(content);
  if (content && typeof content === 'object') statusCache.set(content, out);
  return out;
}

function computeStatuses(content: Pick<ContentRegistry, 'interactions' | 'objects'>): JobCategoryStatus[] {
  return JOB_CATEGORIES.map((c) => {
    const interactions = c.later ? [] : implementedJobInteractions(content, c.id);
    const available = !c.later && interactions.length > 0;
    return {
      id: c.id,
      label: c.label,
      icon: c.icon,
      available,
      reason: available ? null : c.later ?? 'Nothing in the game does this yet',
      openEnded: c.openEnded,
      agentTargets: !!c.agentTargets,
      interactions,
    };
  });
}

// ───────────────────────────── specs (commands + saves) ─────────────────────────────

export const JOB_PRIORITIES: readonly JobPriority[] = ['high', 'normal', 'low'];
export const PRIORITY_RANK: Readonly<Record<JobPriority, number>> = { high: 0, normal: 1, low: 2 };
export const MAX_JOBS_PER_AGENT = 6;
export const MAX_JOBS = 24;
export const MAX_JOB_SKIPS = 8;
const OBJ_ID = /^o\d{1,12}$/;
export const JOB_ID = /^j\d{1,9}$/;
export const AGENT_ID = /^a\d{1,12}$/;
/** Lot ids (W-025 seam): null today; a future town lot id must look like this. */
export const LOT_ID = /^[A-Za-z0-9_-]{1,48}$/;

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** A structurally valid scope (bounds are checked against the lot by the sim), or null. */
export function parseScope(v: unknown, maxX = 4096, maxZ = 4096): JobScope | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const s = v as Record<string, unknown>;
  if (s.kind === 'lot') return { kind: 'lot' };
  if (s.kind === 'room') return isInt(s.x, 0, maxX - 1) && isInt(s.z, 0, maxZ - 1) ? { kind: 'room', x: s.x, z: s.z } : null;
  if (s.kind === 'object') return typeof s.id === 'string' && OBJ_ID.test(s.id) ? { kind: 'object', id: s.id } : null;
  return null;
}

export function parseMode(v: unknown): JobMode | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const m = v as Record<string, unknown>;
  if (m.kind === 'once') return { kind: 'once' };
  if (m.kind === 'untilDone') return { kind: 'untilDone' };
  if (m.kind === 'recurring') return isInt(m.from, 0, 23) && isInt(m.to, 0, 23) && m.from !== m.to ? { kind: 'recurring', from: m.from, to: m.to } : null;
  return null;
}

export function parsePriority(v: unknown, def: JobPriority = 'normal'): JobPriority | null {
  if (v === undefined) return def;
  return typeof v === 'string' && (JOB_PRIORITIES as readonly string[]).includes(v) ? (v as JobPriority) : null;
}

/** Inside a daily window [from, to) (wraps past midnight when from > to). */
export function inWindow(hour: number, from: number, to: number): boolean {
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** The day the window instance containing (day, hour) opened (a 22→2 window opened yesterday at 1 AM). */
export function windowKey(day: number, hour: number, from: number, to: number): number {
  return from < to || hour >= from ? day : day - 1;
}

// ───────────────────────────── labels ─────────────────────────────

export function hourLabel(h: number): string {
  const hh = ((Math.floor(h) % 24) + 24) % 24;
  const ampm = hh < 12 ? 'AM' : 'PM';
  const twelve = hh % 12 === 0 ? 12 : hh % 12;
  return `${twelve} ${ampm}`;
}

export function modeLabel(m: JobMode): string {
  if (m.kind === 'once') return 'Once';
  if (m.kind === 'untilDone') return 'Until done';
  return `Daily ${hourLabel(m.from)}–${hourLabel(m.to)}`;
}

export const PRIORITY_LABEL: Readonly<Record<JobPriority, string>> = { high: 'High', normal: 'Normal', low: 'Low' };
