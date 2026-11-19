/**
 * Structural schema for WorldState.homeServices (src/shared/homeServices.ts HomeServicesState). OPTIONAL: a save without
 * it validates with NO issue and stays without the key; the homeServices system creates it on init. A present-but-broken
 * block is dropped (reported) and recreated empty. A broken saved build is dropped on its own; numbers are range-checked,
 * strings and payloads bounded. Semantic healing (members that are gone, duplicate ids) is the system's job
 * (src/sim/systems/homeServices/state.ts).
 */
import { HEARTH_UPGRADES } from '../../shared/homeBuild';
import { BUILD_ID_RE, MAX_BUILD_ID, BUILD_NAME_MAX, BUILD_PAYLOAD_MAX_CHARS, MATERIAL_IDS, MAX_SAVED_BUILDS, STASH_CAPS, payloadSize, type HomeServicesState, type MaterialId, type SavedBuildRecord, type StashState, type WardrobeState } from '../../shared/homeServices';
import { type Check, INVALID, arr, fixedRec, lit, nullable, num, obj, rec, str } from './core';

const tick = num({ int: true, min: 0, max: 1e12, strict: true });
const day = num({ int: true, min: -1, max: 1e9, def: -1 });

/** A saved build's payload is owned by the build data; here it only has to be JSON-safe and bounded. */
const payload: Check<unknown> = (v, ctx) => {
  const size = payloadSize(v);
  if (size === null) return ctx.fail('a saved build payload must be JSON');
  if (size > BUILD_PAYLOAD_MAX_CHARS) return ctx.fail('a saved build payload is too large');
  return v;
};

/** A canonical id only (`b` + 1..999999999): anything else, including b1e309 or a 12-digit number, is dropped with a note. */
const buildId: Check<string> = (v, ctx) => {
  const r = str({ nonEmpty: true, max: 12 })(v, ctx);
  if (r === INVALID) return r;
  return BUILD_ID_RE.test(r) ? r : ctx.fail('not a canonical saved-build id');
};

const record = obj<SavedBuildRecord>(
  { id: buildId, name: str({ nonEmpty: true, max: BUILD_NAME_MAX }), payload },
  { keepExtra: false },
);

const wardrobe = obj<WardrobeState>(
  {
    slots: arr(record, { def: () => [], max: MAX_SAVED_BUILDS }),
    activeId: nullable(buildId),
    lastSwapTick: nullable(tick),
    nextId: num({ int: true, min: 1, max: MAX_BUILD_ID + 1, def: 1 }),
  },
  { keepExtra: false },
);

const stash: Check<StashState> = fixedRec<MaterialId, number>(MATERIAL_IDS, (v, ctx) => num({ int: true, min: 0, max: 1e6, def: 0 })(v, ctx), () => 0) as Check<StashState>;

const owned = arr(lit(HEARTH_UPGRADES.map((u) => u.id)), { def: () => [], max: HEARTH_UPGRADES.length, unique: true });

const stateSchema: Check<HomeServicesState> = obj<HomeServicesState>(
  {
    version: lit([1] as const),
    hearth: obj({ essence: num({ min: 0, max: 1e9, def: 0 }), owned }, { keepExtra: false }),
    essenceDay: day,
    wardrobe: rec(wardrobe, { def: () => ({}), maxKeys: 16, dropInvalid: true }),
    respecDay: rec(num({ int: true, min: -1, max: 1e9, strict: true }), { def: () => ({}), maxKeys: 16, dropInvalid: true }),
    stash,
  },
  { keepExtra: false },
);

/** The cap per material is enforced when read: a number above the cap is clamped, not refused. */
const clamped: Check<HomeServicesState> = (v, ctx) => {
  const r = stateSchema(v, ctx);
  if (r === INVALID) return r;
  const s = { ...r.stash } as Record<MaterialId, number>;
  for (const id of MATERIAL_IDS) if (s[id] > STASH_CAPS[id]) s[id] = STASH_CAPS[id];
  return { ...r, stash: s };
};

/** OPTIONAL: absent stays absent silently; a broken block is dropped with a note (the system recreates it). */
export const homeServicesSchema: Check<HomeServicesState | undefined> = (v, ctx) => {
  if (v === undefined) return undefined;
  const r = clamped(v, ctx);
  if (r !== INVALID) return r;
  ctx.report('dropped', `${ctx.lastError.message}; home services reset`);
  return undefined;
};
