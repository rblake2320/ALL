/**
 * Stereo music loops. Audio state is not saved and the event layer never stops a loop on its own (not even when the
 * object is removed), so the audible set is reconciled against the world every tick: a stereo that is switched on
 * (`data.playing`), powered, not broken and not burning loops `stereoMusic` under key `stereo:<id>`. The ids that
 * are currently looping are remembered in flags (`home.stereo.loops`) so a stereo that was sold, repossessed, burned
 * to ash, broke or lost power while playing gets its loop switched off.
 */
import type { SimContext } from '../../../contracts';
import type { ObjectState } from '../../../types';
import { DATA, FLAG } from '../../../content/home/ids';
import { safePowered } from '../decay/rates';
import { centerOf, dataBool, flagStr, objectsWithTag, setFlag } from '../util';
import { homeRegionIdOf } from '../../../../shared/town';

export function stereoAudible(ctx: SimContext, o: ObjectState): boolean {
  return dataBool(o, DATA.playing, false) && !o.condition?.broken && !o.condition?.burning && o.placement?.kind !== 'held' && safePowered(ctx, o);
}

function emitLoop(ctx: SimContext, id: string, on: boolean, obj?: ObjectState | null): void {
  ctx.emit({
    type: 'sfxLoop',
    id: 'stereoMusic',
    key: `stereo:${id}`,
    on,
    objectId: id,
    ...(obj ? { pos: centerOf(ctx, obj) } : {}),
  });
}

/** Bring the audible stereo loops in line with the world. `replay` re-emits every audible loop (after a load). */
export function syncStereoLoops(ctx: SimContext, replay = false): void {
  const home = homeRegionIdOf(ctx.state), region = ctx.currentRegionId?.() ?? home;
  // A frozen region no longer runs its local tick. Stop its loops from the home reconciliation exactly once.
  if (region === home && ctx.activeRegionIds) {
    const active = new Set(ctx.activeRegionIds()), prefix = `${FLAG.stereoLoops}:`;
    for (const k of Object.keys(ctx.state.flags).sort()) {
      if (!k.startsWith(prefix) || active.has(k.slice(prefix.length))) continue;
      const previous = flagStr(ctx, k, '');
      if (!previous) continue;
      for (const id of previous.split(',').filter(Boolean)) emitLoop(ctx, id, false, ctx.state.objects[id]);
      setFlag(ctx, k, '');
    }
  }
  const key = region === home ? FLAG.stereoLoops : `${FLAG.stereoLoops}:${region}`;
  const prev = flagStr(ctx, key, '')
    .split(',')
    .filter((s) => s.length > 0);
  const audible = objectsWithTag(ctx, 'stereo').filter((o) => stereoAudible(ctx, o));
  const now = audible.map((o) => o.id);
  for (const id of prev) if (!now.includes(id)) emitLoop(ctx, id, false, ctx.state.objects[id] ?? null);
  for (const o of audible) if (replay || !prev.includes(o.id)) emitLoop(ctx, o.id, true, o);
  const next = now.join(',');
  if (next !== flagStr(ctx, key, '')) setFlag(ctx, key, next);
}
