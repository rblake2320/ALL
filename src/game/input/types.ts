/**
 * Shared input types: pointer positions, modifier state, the per-mode handler interface and the host interface
 * through which input handlers reach the controller (they never touch controller internals directly).
 */
import type { RendererAPI } from '../../render/contracts';
import type { BuildCommand, SimulationAPI } from '../../sim/contracts';
import type { AgentId, EdgeKey, NotificationKind, TargetRef } from '../../sim/types';
import type { SfxId } from '../../shared/audioIds';
import type { Settings } from '../contracts';
import type { WorldRouteResult, WorldRouteTarget } from '../../shared/world';

/** cx/cy: relative to the canvas (renderer picking); vx/vy: viewport CSS px (menu placement). */
export interface PointerPos {
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  /** Original device kind, retained through the click observer. */
  pointerType?: string;
}

export interface Mods {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export const NO_MODS: Mods = { shift: false, ctrl: false, alt: false };

/** 'tool': a drag tool starts immediately; 'deferred': click if released in place, camera pan if dragged. */
export type PrimaryDownResult = 'tool' | 'deferred';

export interface ModeHandler {
  hover(pos: PointerPos, mods: Mods): void;
  primaryDown(pos: PointerPos, mods: Mods): PrimaryDownResult;
  toolMove(pos: PointerPos, mods: Mods): void;
  toolEnd(pos: PointerPos, mods: Mods, moved: boolean): void;
  toolCancel(): void;
  click(pos: PointerPos, mods: Mods): void;
  secondaryClick(pos: PointerPos, mods: Mods): void;
  doubleClick(pos: PointerPos, mods: Mods): void;
  /** Esc: return true when something was cancelled (stops the Esc chain). */
  escape(): boolean;
  /** Leaving the mode / world swapped: drop transient state and overlays. */
  reset(): void;
}

export interface InputHost {
  readonly renderer: RendererAPI;
  sim(): SimulationAPI | null;
  settings(): Settings;
  /** UI feedback */
  setHoverLabel(label: string | null): void;
  setGridHover(h: { x: number; z: number; edge: EdgeKey | null } | null): void;
  setBuildPreviewLabel(label: string | null): void;
  toast(kind: NotificationKind, title: string, text: string): void;
  sfx(id: SfxId): void;
  changed(discrete: boolean): void;
  /** live mode */
  selectedAgentId(): AgentId | null;
  walkTo?(actorId: AgentId, target: WorldRouteTarget): WorldRouteResult;
  selectAgent(id: AgentId | null, focusCamera?: boolean, byPlayer?: boolean): void;
  openMenuFor(target: TargetRef, x: number, y: number): void;
  /** Click menu of a stray or household pet (W-013, src/game/petMenu.ts). */
  openPetMenu(kind: 'stray' | 'pet', id: string, x: number, y: number): void;
  closeMenu(): boolean;
  isMenuOpen(): boolean;
  /** build / buy */
  applyBuild(cmd: BuildCommand): boolean;
  /** Eyedropper on an object: switch to buy mode placing a copy. */
  placeCopy(defId: string, tint: string | null): void;
}
