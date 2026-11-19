/**
 * InputController: binds canvas pointer events + window keyboard events and routes them to the current
 * mode handler (live / buy / build), the camera, and controller hotkey actions.
 *
 * Events that originate from UI elements never reach the world: pointer listeners live on the canvas only
 * (UI panels sit above it in #ui-root), and keyboard events from text fields / sliders / focused buttons
 * (Space/Enter) are left to the UI. While a dialog is open only Escape is routed.
 */
import type { Screen } from '../contracts';
import type { ViewMode } from '../../render/contracts';
import type { GameEnv } from '../env';
import { BuildInput } from './build';
import { BuyInput } from './buy';
import { CameraController } from './camera';
import type { ScreenDir } from './grid';
import {
  CONTINUOUS,
  KeyResolver,
  REPEATABLE,
  isActivationTarget,
  isBrowserHazard,
  isEditableTarget,
  isUiOwnedTarget,
  shouldPreventDefault,
  type KeyAction,
  type KeyEventLike,
} from './keyboard';
import { LiveInput } from './live';
import { PointerGestures, type PointerEventLike } from './pointer';
import type { InputHost, ModeHandler } from './types';

export interface InputControllerHost extends InputHost {
  readonly env: GameEnv;
  screen(): Screen;
  mode(): ViewMode;
  /** A dialog / fatal error / transition blocks world input (Escape still routes). */
  blocked(): boolean;
  runAction(action: KeyAction, e: KeyEventLike): boolean;
  /** Escape chain; returns true when the controller handled the key (only then is default prevented). */
  escape(): boolean;
  onError(where: string, err: unknown): void;
}

const ARROW_DIR: Readonly<Record<string, ScreenDir>> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

export interface KeyboardEventLike extends KeyEventLike {
  target: EventTarget | null;
  preventDefault(): void;
}

export class InputController {
  readonly camera: CameraController;
  readonly live: LiveInput;
  readonly buy: BuyInput;
  readonly build: BuildInput;
  readonly gestures: PointerGestures;
  readonly resolver = new KeyResolver();
  private readonly heldCodes = new Map<string, KeyAction>();
  private heldSet = new Set<KeyAction>();
  private space = { down: false, used: false };
  private focused = true;
  private canvas: HTMLCanvasElement | null = null;
  private detachers: (() => void)[] = [];
  private lastMode: ViewMode | null = null;
  private lastScreen: Screen | null = null;
  private readonly touchOrigins = new Map<number, boolean>();
  private mixedTouches = false;

  constructor(private readonly host: InputControllerHost) {
    this.camera = new CameraController(host.renderer, () => host.settings(), (w, e) => host.onError(w, e));
    this.live = new LiveInput(host);
    this.buy = new BuyInput(host);
    this.build = new BuildInput(host);
    this.gestures = new PointerGestures({
      handler: () => this.activeHandler(),
      now: () => host.env.now(),
      camera: this.camera,
      canvasOrigin: () => {
        const r = this.canvas?.getBoundingClientRect();
        return r ? { left: r.left, top: r.top } : { left: 0, top: 0 };
      },
      spaceHeld: () => this.space.down,
      spaceUsed: () => {
        this.space.used = true;
      },
      onError: (w, e) => host.onError(w, e),
    });
  }

  get held(): ReadonlySet<KeyAction> {
    return this.heldSet;
  }

  activeHandler(): ModeHandler | null {
    if (this.host.screen() !== 'game' || this.host.blocked() || !this.host.sim()) return null;
    switch (this.host.mode()) {
      case 'live':
        return this.live;
      case 'buy':
        return this.buy;
      case 'build':
        return this.build;
      default:
        return null;
    }
  }

  // ───────────────────────── DOM binding ─────────────────────────

  attach(canvas: HTMLCanvasElement, win: Window): void {
    this.detach();
    this.canvas = canvas;
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      const wrapped = (e: HTMLElementEventMap[K]): void => {
        try {
          fn(e);
        } catch (err) {
          this.host.onError(`input.${type}`, err);
        }
      };
      el.addEventListener(type, wrapped, opts);
      this.detachers.push(() => el.removeEventListener(type, wrapped, opts));
    };
    const onWin = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void => {
      const wrapped = (e: WindowEventMap[K]): void => {
        try {
          fn(e);
        } catch (err) {
          this.host.onError(`input.${type}`, err);
        }
      };
      win.addEventListener(type, wrapped, opts);
      this.detachers.push(() => win.removeEventListener(type, wrapped, opts));
    };
    // Canvas-only listeners cannot see a second finger over a toast/HUD panel. Cancel that mixed sequence in
    // capture, including when the UI stops propagation; the HUD retains its own normal event behavior.
    onWin('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.touchOrigins.set(e.pointerId, e.target === canvas);
      const origins = [...this.touchOrigins.values()];
      if (this.mixedTouches || (origins.length > 1 && origins.some(Boolean) && origins.some(v => !v))) {
        this.mixedTouches = true;
        this.gestures.guardTouch();
      }
    }, { capture: true, passive: true });
    const endTouch = (e: PointerEvent): void => {
      if (e.pointerType !== 'touch') return;
      if (this.mixedTouches) this.gestures.guardTouch();
      this.touchOrigins.delete(e.pointerId);
      if (this.touchOrigins.size === 0) this.mixedTouches = false;
    };
    onWin('pointerup', endTouch, { capture: true, passive: true });
    onWin('pointercancel', endTouch, { capture: true, passive: true });
    on(canvas, 'pointerdown', (e) => {
      if (this.mixedTouches) return;
      // Clicking the world returns keyboard focus to the game (blur a focused text field / button).
      const active = this.host.env.document?.activeElement as HTMLElement | null | undefined;
      if (active && active !== canvas && typeof active.blur === 'function') active.blur();
      if (e.button === 1 || e.button === 2 || e.button === 0) e.preventDefault(); // no text selection / autoscroll
      if (this.gestures.down(e as PointerEventLike)) {
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic events */
        }
      }
    });
    on(canvas, 'pointermove', (e) => {
      // the mouse takes the placement ghost back from the keyboard cursor (only a real move, not a re-pick)
      if (e.movementX !== 0 || e.movementY !== 0) this.buy.pointerMoved();
      this.gestures.move(e as PointerEventLike);
    });
    on(canvas, 'pointerup', (e) => {
      this.gestures.up(e as PointerEventLike);
      try {
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    });
    on(canvas, 'pointercancel', (e) => this.gestures.cancel(e.pointerId));
    on(canvas, 'lostpointercapture', (e) => this.gestures.cancel(e.pointerId));
    on(canvas, 'pointerleave', () => this.gestures.leave());
    on(canvas, 'dblclick', (e) => this.gestures.doubleClick(e as unknown as PointerEventLike));
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(
      canvas,
      'wheel',
      (e) => {
        e.preventDefault();
        if (this.activeHandler()) {
          this.gestures.wheel(e.deltaY, e.deltaMode);
          this.gestures.invalidateHover();
        }
      },
      { passive: false },
    );
    onWin('keydown', (e) => this.keyDown(e));
    onWin('keyup', (e) => this.keyUp(e));
    onWin('blur', () => {
      this.touchOrigins.clear();
      this.mixedTouches = false;
      this.focused = false;
      this.clearHeld();
      this.gestures.cancel();
    });
    onWin('focus', () => {
      this.focused = true;
    });
  }

  detach(): void {
    for (const d of this.detachers.splice(0)) {
      try {
        d();
      } catch {
        /* ignore */
      }
    }
    this.canvas = null;
    this.touchOrigins.clear();
    this.mixedTouches = false;
  }

  // ───────────────────────── keyboard ─────────────────────────

  keyDown(e: KeyboardEventLike): void {
    if (this.host.screen() !== 'game') return;
    // KEYMAP ownership (contract): never act on keys a UI widget handled or that belong to a focused UI layer.
    if (e.defaultPrevented) return;
    if (isEditableTarget(e.target) || isUiOwnedTarget(e.target) || isActivationTarget(e.target, e.code)) return;
    const action = this.resolver.resolve(e);
    if (action === 'menu') {
      // Only claim Escape when we used it: an un-prevented Escape still reaches the UI's own fallback handlers.
      if (!e.repeat && this.host.escape()) e.preventDefault();
      return;
    }
    if (this.host.blocked()) {
      // A dialog / transition owns the screen: keep browser behaviour (Tab moves focus INTO the dialog, arrows and
      // Space stay with the page) and only suppress hazards like F5 reload or ctrl+S "save page".
      if (isBrowserHazard(e)) e.preventDefault();
      return;
    }
    if (this.placementKey(e)) {
      e.preventDefault();
      return;
    }
    if (action === null) {
      if (shouldPreventDefault(null, e.code) || isBrowserHazard(e)) e.preventDefault();
      return;
    }
    e.preventDefault();
    if (CONTINUOUS.has(action)) {
      this.heldCodes.set(e.code, action);
      this.recomputeHeld();
      return;
    }
    if (action === 'pause' && e.code === 'Space') {
      // Space doubles as the pan modifier: toggle pause on release unless it was used to drag.
      if (!e.repeat && !this.space.down) this.space = { down: true, used: false };
      return;
    }
    if (e.repeat && !REPEATABLE.has(action)) return;
    this.host.runAction(action, e);
  }

  /**
   * Keyboard placement in Buy mode (W-064, WCAG 2.1.1): while an item or a carried object is being placed, the arrow
   * keys move the ghost a tile (Shift: four) instead of panning — W/A/S/D still pan — and Enter places. Space places
   * too once the keyboard cursor is out (otherwise it keeps its pause / pan-modifier meaning for mouse players).
   * R rotates and Esc cancels through the normal KEYMAP actions. Returns true when the key was used.
   */
  private placementKey(e: KeyboardEventLike): boolean {
    if (this.activeHandler() !== this.buy || !this.buy.isPlacing()) return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const dir = ARROW_DIR[e.code];
    if (dir) {
      this.buy.keyNudge(dir, !!e.shiftKey);
      return true;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || (e.code === 'Space' && this.buy.keyboardActive())) {
      // W-116: Enter places one and returns to the catalog; Shift+Enter places and keeps placing
      if (!e.repeat) this.buy.keyPlace(!!e.shiftKey);
      return true;
    }
    return false;
  }

  keyUp(e: KeyboardEventLike): void {
    if (this.heldCodes.delete(e.code)) this.recomputeHeld();
    if (e.code === 'Space' && this.space.down) {
      const used = this.space.used;
      this.space = { down: false, used: false };
      if (!used && !e.defaultPrevented && this.host.screen() === 'game' && !this.host.blocked() && !isEditableTarget(e.target) && !isUiOwnedTarget(e.target)) {
        e.preventDefault();
        this.host.runAction('pause', e);
      }
    }
  }

  private recomputeHeld(): void {
    this.heldSet = new Set(this.heldCodes.values());
  }

  clearHeld(): void {
    this.heldCodes.clear();
    this.heldSet = new Set();
    this.space = { down: false, used: false };
  }

  // ───────────────────────── per frame ─────────────────────────

  /** Call when mode or screen may have changed (also checked every frame). */
  sync(): void {
    const mode = this.host.mode();
    const screen = this.host.screen();
    if (mode === this.lastMode && screen === this.lastScreen) return;
    this.lastMode = mode;
    this.lastScreen = screen;
    const inGame = screen === 'game';
    const handlers: [ViewMode, ModeHandler][] = [
      ['live', this.live],
      ['buy', this.buy],
      ['build', this.build],
    ];
    for (const [m, h] of handlers) {
      if (inGame && m === mode) continue;
      try {
        h.reset();
      } catch (err) {
        this.host.onError('input.reset', err);
      }
    }
    this.gestures.reset();
    if (!inGame) this.clearHeld();
    this.host.setHoverLabel(null);
    this.host.setGridHover(null);
  }

  frame(dt: number): void {
    this.sync();
    // Before the blocked check: a gesture whose handler went away (dialog opened, mode hotkey) is cancelled on
    // the handler that started it, so no preview overlay / label is left stuck behind the dialog.
    this.gestures.validate();
    if (this.host.screen() !== 'game') return;
    if (this.host.blocked()) return;
    const p = this.gestures.pointer;
    const moving = this.heldSet.size > 0;
    this.camera.frame({
      dt,
      held: this.heldSet,
      fast: this.gestures.modifiers.shift,
      pointer: p ? { x: p.vx, y: p.vy } : null,
      pointerInside: this.gestures.inside,
      dragging: this.gestures.dragging,
      focused: this.focused,
      viewport: this.host.env.viewport(),
    });
    if (moving || this.gestures.dragging) this.gestures.invalidateHover();
    const h = this.activeHandler();
    if (h && p && !this.gestures.dragging && this.gestures.takeHoverDirty()) {
      try {
        h.hover(p, this.gestures.modifiers);
      } catch (err) {
        this.host.onError('input.hover', err);
      }
    }
  }

  /** The world under the cursor changed (lot edit, object removed): re-pick next frame. */
  invalidateHover(): void {
    this.gestures.invalidateHover();
  }

  resetAll(): void {
    this.gestures.reset();
    this.clearHeld();
    for (const h of [this.live, this.buy, this.build]) {
      try {
        h.reset();
      } catch (err) {
        this.host.onError('input.reset', err);
      }
    }
    this.lastMode = null;
    this.lastScreen = null;
  }
}
