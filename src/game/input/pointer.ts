/**
 * Pointer gesture state machine (DOM-agnostic; input/index.ts feeds it real events).
 *
 *  left        → mode handler: 'tool' drag starts immediately, or 'deferred' = click if released in place,
 *                camera pan once dragged past the threshold
 *  right       → click (cancel/close) if released in place, orbit when dragged (shift+right-drag = pan)
 *  middle      → pan;   space + left → pan
 *  wheel       → zoom (invertZoom)
 *  touch       → one finger behaves like the left button; two fingers pinch-zoom + pan
 *
 * Exactly one mouse session at a time; a second button while dragging is ignored. pointercancel /
 * lostpointercapture cancel the active session (tool drags get toolCancel, never a half-applied toolEnd).
 *
 * A session belongs to the mode handler that was active when the button went down. If the active handler changes
 * mid-gesture (mode hotkey, a dialog opening, game over), the session is cancelled ON THAT ORIGINAL HANDLER and
 * the rest of the gesture is ignored — the new handler never receives a toolMove/toolEnd/click it did not start.
 * Click vs drag is decided with the release position too, so a release far from the press is never a click even
 * when the browser delivered no pointermove in between (coalesced events, synthetic input, a stalled frame).
 */
import type { CameraController } from './camera';
import type { ModeHandler, Mods, PointerPos } from './types';
import { classifyPointerGesture, TAP_MAX_MOVE_PX, type PointerSample } from '../../shared/world';

export interface PointerEventLike {
  pointerId: number;
  button: number;
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  pointerType?: string;
  timeStamp?: number;
}

export interface GestureSink {
  handler(): ModeHandler | null;
  readonly camera: CameraController;
  canvasOrigin(): { left: number; top: number };
  spaceHeld(): boolean;
  /** Space was used as a pan modifier (so releasing it must not toggle pause). */
  spaceUsed(): void;
  onError(where: string, err: unknown): void;
  now?(): number;
}

export const DRAG_THRESHOLD_PX = 4;
export const TOUCH_DRAG_THRESHOLD_PX = TAP_MAX_MOVE_PX;

type Kind = 'pending' | 'tool' | 'pan' | 'orbit' | 'rightPending';

interface Session {
  pointerId: number;
  kind: Kind;
  button: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  mods: Mods;
  touch: boolean;
  /** Right-button drags pan instead of orbiting when Shift was held at press time. */
  panOnDrag: boolean;
  /** Handler active at press time; the session is only valid while it is still the active one. */
  handler: ModeHandler;
  samples: PointerSample[];
  invalidTouch: boolean;
}

function mods(e: PointerEventLike): Mods {
  return { shift: !!e.shiftKey, ctrl: !!e.ctrlKey || !!e.metaKey, alt: !!e.altKey };
}

function finite(e: PointerEventLike): boolean {
  return Number.isFinite(e.clientX) && Number.isFinite(e.clientY);
}

export class PointerGestures {
  private session: Session | null = null;
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; cx: number; cy: number } | null = null;
  private lastPos: PointerPos | null = null;
  private lastMods: Mods = { shift: false, ctrl: false, alt: false };
  private insideCanvas = false;
  private hoverDirty = false;
  private lastTouchGestureEndT: number | null = null;
  private pinchSequence = false;

  constructor(private readonly sink: GestureSink) {}

  get dragging(): boolean {
    return (this.session !== null && this.session.kind !== 'pending' && this.session.kind !== 'rightPending') || this.pinch !== null;
  }

  get pointer(): PointerPos | null {
    return this.lastPos;
  }

  get modifiers(): Mods {
    return this.lastMods;
  }

  get inside(): boolean {
    return this.insideCanvas;
  }

  /** True once after the pointer moved (hover picking is done at most once per frame). */
  takeHoverDirty(): boolean {
    const d = this.hoverDirty;
    this.hoverDirty = false;
    return d;
  }

  invalidateHover(): void {
    this.hoverDirty = true;
  }

  private pos(e: PointerEventLike): PointerPos {
    let o = { left: 0, top: 0 };
    try {
      o = this.sink.canvasOrigin();
    } catch {
      /* assume full-screen canvas */
    }
    return { cx: e.clientX - o.left, cy: e.clientY - o.top, vx: e.clientX, vy: e.clientY, ...(e.pointerType ? { pointerType: e.pointerType } : {}) };
  }

  private time(e?: PointerEventLike): number {
    return typeof e?.timeStamp === 'number' && Number.isFinite(e.timeStamp) ? e.timeStamp : (this.sink.now?.() ?? 0);
  }

  private sample(e: PointerEventLike, type: PointerSample['type']): PointerSample {
    return { id: e.pointerId, t: this.time(e), x: e.clientX, y: e.clientY, type };
  }

  private call(where: string, fn: (h: ModeHandler) => void): void {
    const h = this.sink.handler();
    if (!h) return;
    this.invoke(where, h, fn);
  }

  private invoke(where: string, h: ModeHandler, fn: (h: ModeHandler) => void): void {
    try {
      fn(h);
    } catch (err) {
      this.sink.onError(where, err);
    }
  }

  /**
   * The session's handler is no longer the active one (mode switched, dialog opened, game over): cancel the
   * gesture on the handler that started it. Returns true when the session is still valid.
   */
  private sessionValid(s: Session): boolean {
    if (this.sink.handler() === s.handler) return true;
    if (this.session === s) this.session = null;
    if (s.kind === 'tool') this.invoke('pointer.toolCancel', s.handler, (h) => h.toolCancel());
    return false;
  }

  /** Per-frame check (also while input is blocked): drop gestures whose handler went away; stop pinches when blocked. */
  validate(): void {
    const s = this.session;
    if (s) this.sessionValid(s);
    if (this.pinch && !this.sink.handler()) this.pinch = null;
  }

  private thresholdFor(s: Session): number {
    return s.touch ? TOUCH_DRAG_THRESHOLD_PX : DRAG_THRESHOLD_PX;
  }

  /** Returns true when the caller should capture the pointer. */
  down(e: PointerEventLike): boolean {
    if (!finite(e)) return false;
    const p = this.pos(e);
    this.lastPos = p;
    this.lastMods = mods(e);
    this.insideCanvas = true;
    const touch = e.pointerType === 'touch';
    const handler = this.sink.handler();
    if (touch) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        this.pinchSequence = true;
        this.cancelSession();
        if (handler) this.startPinch(); // no camera gestures while world input is blocked
        return handler !== null;
      }
      if (this.touches.size > 2) return false;
    }
    if (this.session && !this.sessionValid(this.session)) this.session = null;
    if (this.session) return false; // one session at a time
    if (!handler) return false;
    const m = mods(e);
    const base = { pointerId: e.pointerId, button: e.button, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, mods: m, touch, panOnDrag: false, handler, samples: touch ? [this.sample(e, 'down')] : [], invalidTouch: touch && e.timeStamp !== undefined && !Number.isFinite(e.timeStamp) };
    if (e.button === 1) {
      this.session = { ...base, kind: 'pan' };
      return true;
    }
    if (e.button === 2) {
      this.session = { ...base, kind: 'rightPending', panOnDrag: m.shift };
      return true;
    }
    if (e.button !== 0) return false;
    if (this.sink.spaceHeld()) {
      this.sink.spaceUsed();
      this.session = { ...base, kind: 'pan' };
      return true;
    }
    let kind: Kind = 'pending';
    this.invoke('pointer.primaryDown', handler, (h) => {
      if (h.primaryDown(p, m) === 'tool') kind = 'tool';
    });
    this.session = { ...base, kind };
    return true;
  }

  move(e: PointerEventLike): void {
    if (!finite(e)) {
      if (this.session?.touch && this.session.pointerId === e.pointerId) this.session.invalidTouch = true;
      return;
    }
    const p = this.pos(e);
    this.lastPos = p;
    this.lastMods = mods(e);
    this.insideCanvas = true;
    this.hoverDirty = true;
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch) {
        if (this.sink.handler()) this.updatePinch();
        else this.pinch = null;
        return;
      }
    }
    const s = this.session;
    if (!s || s.pointerId !== e.pointerId) return;
    if (!this.sessionValid(s)) return;
    // Keep bounded samples. Historical over-threshold movement is retained by s.moved / s.kind.
    if (s.touch) {
      const sample = this.sample(e, 'move');
      if (sample.t < s.samples[s.samples.length - 1].t || (e.timeStamp !== undefined && !Number.isFinite(e.timeStamp))) s.invalidTouch = true;
      s.samples[1] = sample;
    }
    const dx = e.clientX - s.lastX;
    const dy = e.clientY - s.lastY;
    s.lastX = e.clientX;
    s.lastY = e.clientY;
    if (!s.moved && Math.hypot(e.clientX - s.startX, e.clientY - s.startY) > this.thresholdFor(s)) {
      s.moved = true;
      if (s.kind === 'pending') s.kind = 'pan';
      else if (s.kind === 'rightPending') s.kind = s.panOnDrag ? 'pan' : 'orbit';
      // apply the whole movement since press so the drag doesn't "jump" by the threshold
      const tx = e.clientX - s.startX;
      const ty = e.clientY - s.startY;
      this.applyDrag(s, tx, ty, p);
      return;
    }
    if (s.moved) this.applyDrag(s, dx, dy, p);
    else if (s.kind === 'tool') this.invoke('pointer.toolMove', s.handler, (h) => h.toolMove(p, s.mods));
  }

  private applyDrag(s: Session, dx: number, dy: number, p: PointerPos): void {
    switch (s.kind) {
      case 'pan':
        this.sink.camera.panByPixels(dx, dy);
        break;
      case 'orbit':
        this.sink.camera.orbitByPixels(dx, dy);
        break;
      case 'tool':
        this.invoke('pointer.toolMove', s.handler, (h) => h.toolMove(p, { ...s.mods, shift: this.lastMods.shift }));
        break;
      default:
        break;
    }
  }

  up(e: PointerEventLike): void {
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      if (this.pinchSequence) {
        if (this.touches.size < 2) this.pinch = null;
        if (this.touches.size === 0) {
          this.pinchSequence = false;
          this.lastTouchGestureEndT = this.time(e);
        }
        return;
      }
    }
    const s = this.session;
    if (!s || s.pointerId !== e.pointerId) return;
    if (!this.sessionValid(s)) return;
    this.session = null;
    const p = finite(e) ? this.pos(e) : this.lastPos;
    if (!p) return;
    if (s.touch) p.pointerType = 'touch';
    // The release position counts too: a far release without intermediate moves is a drag, not a click.
    if (!s.moved && finite(e) && Math.hypot(e.clientX - s.startX, e.clientY - s.startY) > this.thresholdFor(s)) s.moved = true;
    const m = { ...s.mods, shift: !!e.shiftKey };
    let touchTap = true;
    if (s.touch) {
      s.samples.push(this.sample(e, 'up'));
      const gesture = classifyPointerGesture(s.samples, this.lastTouchGestureEndT);
      touchTap = gesture === 'tap' && !s.invalidTouch && (e.timeStamp === undefined || Number.isFinite(e.timeStamp));
      if (s.moved || s.kind === 'pan' || gesture === 'pan') this.lastTouchGestureEndT = this.time(e);
    }
    switch (s.kind) {
      case 'tool':
        this.invoke('pointer.toolEnd', s.handler, (h) => h.toolEnd(p, m, s.moved));
        break;
      case 'pending':
        if (!s.moved && touchTap) this.invoke('pointer.click', s.handler, (h) => h.click(p, m));
        break;
      case 'rightPending':
        if (!s.moved) this.invoke('pointer.secondaryClick', s.handler, (h) => h.secondaryClick(p, m));
        break;
      default:
        break;
    }
    this.hoverDirty = true;
  }

  /** pointercancel / lostpointercapture / window blur. */
  cancel(pointerId?: number): void {
    if (pointerId !== undefined) this.touches.delete(pointerId);
    else this.touches.clear();
    if (this.session?.touch || this.pinchSequence) this.lastTouchGestureEndT = this.time();
    if (this.touches.size === 0) this.pinchSequence = false;
    if (this.pinch && this.touches.size < 2) this.pinch = null;
    const s = this.session;
    if (!s) return;
    if (pointerId !== undefined && s.pointerId !== pointerId) return;
    this.cancelSession();
  }

  /** A second finger crossed onto the HUD: cancel world input without consuming the HUD event. */
  guardTouch(): void {
    this.cancel();
    this.lastTouchGestureEndT = this.time();
  }

  private cancelSession(): void {
    const s = this.session;
    this.session = null;
    if (s && s.kind === 'tool') this.invoke('pointer.toolCancel', s.handler, (h) => h.toolCancel());
  }

  wheel(deltaY: number, deltaMode: number): void {
    this.sink.camera.wheel(deltaY, deltaMode);
  }

  doubleClick(e: PointerEventLike): void {
    if (!finite(e)) return;
    const p = this.pos(e);
    this.call('pointer.doubleClick', (h) => h.doubleClick(p, mods(e)));
  }

  leave(): void {
    this.insideCanvas = false;
  }

  /** Mode changed / screen changed: abandon any gesture. */
  reset(): void {
    this.cancelSession();
    this.touches.clear();
    this.pinch = null;
    this.pinchSequence = false;
    this.lastTouchGestureEndT = null;
    this.hoverDirty = true;
  }

  private startPinch(): void {
    const pts = Array.from(this.touches.values());
    if (pts.length < 2) return;
    const [a, b] = pts;
    this.pinch = { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  private updatePinch(): void {
    const pts = Array.from(this.touches.values());
    if (!this.pinch || pts.length < 2) return;
    const [a, b] = pts;
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const ratio = dist / this.pinch.dist;
    if (Number.isFinite(ratio) && Math.abs(ratio - 1) > 0.002) {
      // A pinch from 100 px to 200 px apart ≈ 2.5 zoom units (two wheel notches and a bit).
      this.sink.camera.wheel(-Math.log(ratio) * 360, 0);
    }
    this.sink.camera.panByPixels(cx - this.pinch.cx, cy - this.pinch.cy);
    this.pinch = { dist, cx, cy };
  }
}
