/**
 * Structural schema for WorldState.jobs (W-124, D-071; src/sim/types.ts JobsState). Saved data is UNTRUSTED:
 *  - absent (a v1 save the migration did not touch, a hand-edited file) stays absent silently — the jobs system
 *    creates an empty list on init;
 *  - a broken block (wrong version, not an object) is dropped with a note ("job assignments reset");
 *  - a broken assignment is dropped on its own (reported), the others are kept; unknown keys on an assignment are
 *    removed (never carried into the sim), every number is range-checked and every string bounded.
 * Semantic checks (household membership, category availability, untilDone on open-ended work) are the jobs system's
 * job on load (src/sim/systems/jobs/state.ts healJobsState).
 */
import type { JobAssignment, JobMode, JobScope, JobsState } from '../../sim/types';
import { type Check, INVALID, arr, bool, lit, nullable, num, obj, str, tagged } from './core';

export const JOB_LIMITS = { maxJobs: 24, maxSkips: 8, maxText: 200, maxTick: 1e12 } as const;

const id = (re: RegExp, what: string): Check<string> => (v, ctx) => {
  const r = str({ nonEmpty: true, max: 24 })(v, ctx);
  if (r === INVALID) return r;
  return re.test(r) ? r : ctx.fail(`bad ${what} id`);
};
const tick = num({ int: true, min: 0, max: JOB_LIMITS.maxTick, strict: true });
const text = nullable(str({ max: JOB_LIMITS.maxText }));
const tile = num({ int: true, min: 0, max: 4095, strict: true });
const hour = num({ int: true, min: 0, max: 23, strict: true });

const scopeSchema: Check<JobScope> = tagged<JobScope>('kind', {
  lot: obj<{ kind: 'lot' }>({ kind: lit(['lot'] as const) }, { keepExtra: false }) as Check<JobScope>,
  room: obj<{ kind: 'room'; x: number; z: number }>({ kind: lit(['room'] as const), x: tile, z: tile }, { keepExtra: false }) as Check<JobScope>,
  object: obj<{ kind: 'object'; id: string }>({ kind: lit(['object'] as const), id: id(/^o\d{1,12}$/, 'object') }, { keepExtra: false }) as Check<JobScope>,
});

const modeSchema: Check<JobMode> = tagged<JobMode>('kind', {
  once: obj<{ kind: 'once' }>({ kind: lit(['once'] as const) }, { keepExtra: false }) as Check<JobMode>,
  untilDone: obj<{ kind: 'untilDone' }>({ kind: lit(['untilDone'] as const) }, { keepExtra: false }) as Check<JobMode>,
  recurring: obj<{ kind: 'recurring'; from: number; to: number }>(
    { kind: lit(['recurring'] as const), from: hour, to: hour },
    { keepExtra: false, post: (m, ctx) => (m.from === m.to ? ctx.fail('empty daily window') : m) },
  ) as Check<JobMode>,
});

const skipSchema = obj<JobAssignment['skips'][number]>({ key: str({ nonEmpty: true, max: 32 }), until: tick, reason: str({ max: JOB_LIMITS.maxText }) }, { keepExtra: false });

const assignmentSchema: Check<JobAssignment> = obj<JobAssignment>(
  {
    id: id(/^j\d{1,9}$/, 'job'),
    agentId: id(/^a\d{1,12}$/, 'agent'),
    category: str({ nonEmpty: true, max: 24 }),
    scope: scopeSchema,
    mode: modeSchema,
    priority: lit(['high', 'normal', 'low'] as const),
    paused: (v, ctx) => (typeof v === 'boolean' ? v : ctx.fail('bad paused flag')),
    lotId: nullable(str({ nonEmpty: true, max: 48 }), { strict: true }),
    createdTick: tick,
    status: lit(['waiting', 'working', 'break', 'blocked', 'resting', 'paused', 'away'] as const, 'waiting'),
    reason: text,
    runUid: nullable(num({ int: true, min: 0, max: Number.MAX_SAFE_INTEGER, strict: true }), { strict: true }),
    interactionId: nullable(str({ max: 64 })),
    targetKey: nullable(str({ max: 32 })),
    targetName: nullable(str({ max: 120 })),
    before: nullable(num({ min: -1e9, max: 1e9, strict: true })),
    reached: bool(false),
    done: num({ int: true, min: 0, max: 1e9, strict: true }),
    breakNeed: nullable(lit(['hunger', 'energy', 'preservation', 'social', 'fun', 'hygiene'] as const)),
    nextCheckTick: tick,
    skips: arr(skipSchema, { def: () => [], max: JOB_LIMITS.maxSkips, keep: 'last' }),
    restKey: num({ int: true, min: -1, max: 1e9, strict: true }),
  },
  { keepExtra: false },
);

const stateSchema: Check<JobsState> = obj<JobsState>(
  {
    version: lit([1] as const),
    nextId: num({ int: true, min: 1, max: 1e9, def: 1 }),
    list: arr(assignmentSchema, { def: () => [], max: JOB_LIMITS.maxJobs }),
  },
  {
    keepExtra: false,
    post: (s, ctx) => {
      // duplicate ids: keep the first
      const seen = new Set<string>();
      const list = s.list.filter((j) => {
        if (seen.has(j.id)) {
          ctx.report('dropped', `duplicate job id ${j.id} removed`);
          return false;
        }
        seen.add(j.id);
        return true;
      });
      const max = list.reduce((m, j) => Math.max(m, Number(j.id.slice(1))), 0);
      return { ...s, list, nextId: s.nextId > max ? s.nextId : max + 1 };
    },
  },
);

export const jobsSchema: Check<JobsState | undefined> = (v, ctx) => {
  if (v === undefined) return undefined;
  const r = stateSchema(v, ctx);
  if (r !== INVALID) return r;
  ctx.report('dropped', `${ctx.lastError.message}; job assignments reset`);
  return undefined;
};
