/**
 * Seated placement (pure): where the rig root goes when a zombie plays a sit* clip on a catalog 'sit' slot.
 *
 * The sim puts the root at the slot pose. The sit* clips rest the seat contact at DIM.SEAT_HEIGHT above the root, but
 * bodies differ in how far their lumbar back sits behind the root (classic 0.17 m, slim cast bodies 0.05 m, the boss
 * 0.31 m), so one root per seat cannot put every back on the backrest. Each seat declares its modelled geometry
 * (`SlotSpec.seat`, src/shared/seating.ts) and each body/clip its lumbar back (seatFit.ts, generated from the rigs by
 * tests/unit/seating/seatFit.test.ts); the renderer then
 *   - slides the root along the sitter's facing so the lumbar back rests on the backrest face (sinking SEAT_BACK_SINK
 *     into the padding), clamped to [SEAT_SHIFT_MIN, SEAT_SHIFT_MAX] and so that the seat contact (hip mass) stays
 *     SEAT_LIP_MARGIN behind the lip (slouching / cartoon-proportioned bodies whose hips sit far ahead of the root);
 *   - lifts the root by `seat.height - DIM.SEAT_HEIGHT` so the seat contact lands on the modelled cushion top.
 * Backless seats (stools) get the lift and, if needed, the lip cap.
 */
import type { SeatGeometry } from '../../shared/seating';
import { SEAT_LUMBAR } from '../../shared/seating';
import { DIM } from '../../shared/dimensions';
import { PHYSICAL_BY_ID } from '../../shared/catalog';
import { SEAT_FIT, SEAT_FIT_DEFAULT } from './seatFit';

/** How far the lumbar back presses into the backrest padding (m). */
export const SEAT_BACK_SINK = 0.015;
/** Forward slide limits (m, + = toward the sitter's front). */
export const SEAT_SHIFT_MIN = -0.08;
export const SEAT_SHIFT_MAX = 0.12;
/** Cushion-height correction limit (m). */
export const SEAT_LIFT_MAX = 0.08;

export { SEAT_LUMBAR };

export interface SeatOffset {
  /** Along the sitter's facing (m). */
  forward: number;
  /** Root lift (m). */
  lift: number;
}

/** Seat contact margin kept behind the lip (m). */
export const SEAT_LIP_MARGIN = 0.05;

/**
 * [lumbar back z, seat-contact z] (rig-root space, metres, scale 1) of a body in a sit clip (seatFit.ts); unknown
 * bodies / clips fall back to the classic 'sit'.
 */
export function bodySeatFit(body: string | undefined, clip: string): readonly [number, number] {
  const key = typeof body === 'string' && Object.prototype.hasOwnProperty.call(SEAT_FIT, body) ? body : 'classic';
  const row = SEAT_FIT[key];
  const v = row && Object.prototype.hasOwnProperty.call(row, clip) ? row[clip] : undefined;
  return v && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? v : SEAT_FIT_DEFAULT;
}

/**
 * Root offset for a body (height scale `scale`) playing `clip` on `seat`. Allocation free when `out` is passed.
 */
export function seatOffset(seat: SeatGeometry | undefined | null, body: string | undefined, clip: string, scale: number, out: SeatOffset = { forward: 0, lift: 0 }): SeatOffset {
  out.forward = 0;
  out.lift = 0;
  if (!seat || !Number.isFinite(seat.height)) return out;
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  out.lift = Math.max(-SEAT_LIFT_MAX, Math.min(SEAT_LIFT_MAX, seat.height - DIM.SEAT_HEIGHT));
  const [back, contact] = bodySeatFit(body, clip);
  // the seat contact never slides past (lip - margin); deep-backed bodies (capes, suits) press into the padding instead
  const lipCap = Number.isFinite(seat.front) ? seat.front - SEAT_LIP_MARGIN - contact * s : SEAT_SHIFT_MAX;
  if (seat.back !== null && Number.isFinite(seat.back)) {
    const want = -seat.back + SEAT_BACK_SINK - back * s;
    out.forward = Math.max(SEAT_SHIFT_MIN, Math.min(SEAT_SHIFT_MAX, want, lipCap));
  } else out.forward = Math.max(SEAT_SHIFT_MIN, Math.min(0, lipCap));
  return out;
}

/** Seat geometry of slot `slot` on catalog object `defId` (null when it is not a 'sit' slot with geometry). */
export function slotSeat(defId: unknown, slot: unknown): SeatGeometry | null {
  if (typeof defId !== 'string' || typeof slot !== 'number' || !Number.isInteger(slot)) return null;
  const spec = Object.prototype.hasOwnProperty.call(PHYSICAL_BY_ID, defId) ? PHYSICAL_BY_ID[defId] : undefined;
  const s = spec?.slots[slot];
  return s && s.kind === 'sit' && s.seat ? s.seat : null;
}

/** sit* clips (the seated pose family). */
export function isSeatedClip(anim: string): boolean {
  return anim === 'sit' || anim.startsWith('sit');
}
