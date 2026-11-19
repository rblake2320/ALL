/**
 * Fatal errors the player can do something about get their own words (W-149, docs/DESIGN_OPEN_WORLD.md §5.1).
 *
 * `GameController.fatalError` is one string. The controller raises a known case with the constant below; the fatal
 * screen recognises it and shows what is wrong and what to try instead of the generic crash text. Pure, no imports.
 */

/**
 * The 3D renderer could not start: no WebGL context. Since Chrome 137–139 a machine without a usable GPU gets no
 * WebGL at all on macOS / Linux (the automatic software fallback was removed), so this is an ordinary situation,
 * not a crash.
 */
export const NO_3D_FATAL =
  'Could not start the 3D renderer. WebGL may be disabled or unsupported on this device — try updating your graphics driver or browser.';

export type FatalKind = 'no3d' | 'generic';

/** Which screen a fatal message gets. Anything that is not exactly a known message is `generic`. */
export function fatalKind(message: unknown): FatalKind {
  return message === NO_3D_FATAL ? 'no3d' : 'generic';
}
