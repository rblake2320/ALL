/**
 * Seat geometry of 'sit' slots (catalog `SlotSpec.seat`). The modelled seat, measured from the slot root (the
 * sitter's rig root, i.e. the slot pose) in the seat frame (+Z = the way the sitter faces):
 *
 *   height  cushion top under the hips, object-local y (metres). The sit* clips rest the seat contact (pelvis bone
 *           origin) at DIM.SEAT_HEIGHT; the renderer lifts the rig by `height - SEAT_HEIGHT` while seated.
 *   back    backrest face at lumbar height (height + SEAT_LUMBAR) behind the root; null = backless (stools).
 *           The renderer slides each body along its facing so its lumbar back rests on this face
 *           (src/render/agents/seat.ts, per-body fit table src/render/agents/seatFit.ts).
 *   front   front lip of the seat ahead of the root. Upholstered seats keep their base recessed behind
 *           front - 0.06 so shins and feet have room (tools/blender/objects/seating.py SEAT_LIP / SEAT_KICK).
 *
 * Numbers are measured from the GLBs and kept honest by tests/unit/seating (raycasts, ±1.5 cm).
 * See docs/contract-requests/seating.md.
 */
export interface SeatGeometry {
  height: number;
  back: number | null;
  front: number;
}

/** Height above the cushion top where `back` is measured (lumbar). */
export const SEAT_LUMBAR = 0.22;
