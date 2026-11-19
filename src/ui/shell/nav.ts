/**
 * Shell dialog navigation. Uses the controller's `openDialog(d, { returnTo, mode })` / `dialogOptions` so closing a
 * child (Pause → Settings) returns to its parent and Save/Load opens on the right tab. A local mirror keeps this
 * working against controllers that predate dialog options.
 */
import type { DialogId, GameController } from '../../game/contracts';

export type SaveLoadMode = 'save' | 'load';
type NavGame = Pick<GameController, 'dialog' | 'openDialog' | 'closeDialog'> & { readonly dialogOptions?: GameController['dialogOptions'] };

interface NavState {
  parent: DialogId;
  child: DialogId;
  saveLoadMode: SaveLoadMode | null;
}

const nav: NavState = { parent: null, child: null, saveLoadMode: null };

/**
 * W-064 focus restore across a child dialog: the parent (Pause) unmounts while its child (Settings) is open, so the
 * button that opened the child no longer exists when the child closes. The parent asks `takeReturnFocus(parent)` on
 * mount and focuses the control with that key instead of its default. Keyed by child + Save/Load tab.
 */
let returnFocus: { parent: Exclude<DialogId, null>; child: DialogId; key: string } | null = null;

/** The focus key of the control that opens `d` (Save and Load both open saveLoad: the tab tells them apart). */
export function childKey(d: DialogId, saveLoadMode?: SaveLoadMode | null): string {
  return saveLoadMode ? `${String(d)}:${saveLoadMode}` : String(d);
}

/** Key of the control a returning parent should focus (once), or null when this mount is not a return. */
export function takeReturnFocus(parent: DialogId): string | null {
  if (!returnFocus || parent === null || returnFocus.parent !== parent) return null;
  const k = returnFocus.key;
  returnFocus = null;
  return k;
}

function opts(returnTo: DialogId, mode: SaveLoadMode | null | undefined) {
  const o: { returnTo?: DialogId; mode?: SaveLoadMode } = {};
  if (returnTo) o.returnTo = returnTo;
  if (mode) o.mode = mode;
  return Object.keys(o).length ? o : undefined;
}

/** Open `d` as a child of the currently open dialog. */
export function openChildDialog(game: NavGame, d: DialogId, o?: { saveLoadMode?: SaveLoadMode }): void {
  const parent = game.dialog;
  nav.parent = parent;
  nav.child = d;
  nav.saveLoadMode = o?.saveLoadMode ?? null;
  returnFocus = parent !== null ? { parent, child: d, key: childKey(d, o?.saveLoadMode) } : null;
  game.openDialog(d, opts(parent, o?.saveLoadMode));
}

/** Open `d` from a screen (no parent). */
export function openRootDialog(game: NavGame, d: DialogId, o?: { saveLoadMode?: SaveLoadMode }): void {
  nav.parent = null;
  nav.child = d;
  nav.saveLoadMode = o?.saveLoadMode ?? null;
  returnFocus = null;
  game.openDialog(d, opts(null, o?.saveLoadMode));
}

/** Close the current shell dialog, returning to its parent if it has one. */
export function closeShellDialog(game: NavGame): void {
  const current = game.dialog;
  const fromController = game.dialogOptions?.returnTo ?? null;
  const fromLocal = nav.child !== null && nav.child === current ? nav.parent : null;
  const ret = fromController ?? fromLocal;
  nav.parent = null;
  nav.child = null;
  nav.saveLoadMode = null;
  if (ret && ret !== current) game.openDialog(ret);
  else game.closeDialog();
}

/** Forget local navigation when the controller changed the dialog on its own. */
export function syncNav(current: DialogId): void {
  // the dialog went somewhere other than the child or back to its parent: that opener is gone for good
  if (returnFocus && current !== returnFocus.child && current !== returnFocus.parent) returnFocus = null;
  if (current !== nav.child) {
    nav.parent = null;
    nav.child = current;
    nav.saveLoadMode = null;
  }
}

/** Which Save/Load tab was requested for the open dialog (controller options first). */
export function requestedSaveLoadMode(game?: Pick<NavGame, 'dialogOptions'>): SaveLoadMode | null {
  return game?.dialogOptions?.mode ?? nav.saveLoadMode;
}

/** Close every shell dialog without returning to a parent (after loading a save, quitting, …). */
export function closeAllShellDialogs(game: NavGame): void {
  returnFocus = null;
  nav.parent = null;
  nav.child = null;
  nav.saveLoadMode = null;
  if (game.dialog !== null) game.closeDialog();
}

/** For tests. */
export function _navState(): Readonly<NavState> {
  return { ...nav };
}

export function _resetNav(): void {
  returnFocus = null;
  nav.parent = null;
  nav.child = null;
  nav.saveLoadMode = null;
}
