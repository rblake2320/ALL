/**
 * Facial animation controller (pure, deterministic, allocation-free per update).
 * Produces morph weights for FACE_MORPHS from: explicit expression, animation hints, procedural blinks
 * (every 2-6 s, seeded) and talk flaps.
 */
import type { AnyAnimState, Expression } from '../../shared/appearance';
import { FACE_MORPHS } from './names';
import type { FaceMorph } from './names';

export const FACE_INDEX: Record<FaceMorph, number> = FACE_MORPHS.reduce(
  (acc, n, i) => {
    acc[n] = i;
    return acc;
  },
  {} as Record<FaceMorph, number>,
);

/** How much each expression already closes the lids (blink adds only the remainder). */
export const DEFAULT_LID_CLOSURE: Partial<Record<FaceMorph, number>> = {
  sleepy: 0.5, focused: 0.25, disgusted: 0.3, angry: 0.2, happy: 0.3, flirty: 0.2,
};

interface Hint {
  expr: FaceMorph | null;
  weight: number;
  /** Mouth activity 0..1 (laugh/yawn/groan open the mouth). */
  mouth: number;
  /** Mouth flap frequency (Hz) when mouth > 0; 0 = held open. */
  flap: number;
  eyesClosed: boolean;
}

const NO_HINT: Hint = { expr: null, weight: 0, mouth: 0, flap: 0, eyesClosed: false };
const ANIM_HINTS: Partial<Record<AnyAnimState, Hint>> = {
  laugh: { expr: 'happy', weight: 1, mouth: 0.8, flap: 6, eyesClosed: false },
  cry: { expr: 'sad', weight: 1, mouth: 0.35, flap: 2.5, eyesClosed: false },
  angry: { expr: 'angry', weight: 1, mouth: 0.4, flap: 3, eyesClosed: false },
  flirt: { expr: 'flirty', weight: 0.9, mouth: 0, flap: 0, eyesClosed: false },
  kiss: { expr: 'flirty', weight: 0.6, mouth: 0, flap: 0, eyesClosed: true },
  cheer: { expr: 'happy', weight: 1, mouth: 0.7, flap: 0, eyesClosed: false },
  dance: { expr: 'happy', weight: 0.8, mouth: 0.3, flap: 2, eyesClosed: false },
  wave: { expr: 'happy', weight: 0.7, mouth: 0, flap: 0, eyesClosed: false },
  hug: { expr: 'happy', weight: 0.8, mouth: 0, flap: 0, eyesClosed: true },
  disgusted: { expr: 'disgusted', weight: 1, mouth: 0.25, flap: 0, eyesClosed: false },
  feral: { expr: 'angry', weight: 0.8, mouth: 0.6, flap: 4, eyesClosed: false },
  groan: { expr: 'sleepy', weight: 0.5, mouth: 0.9, flap: 0, eyesClosed: false },
  yawn: { expr: 'sleepy', weight: 0.8, mouth: 1, flap: 0, eyesClosed: true },
  sleep: { expr: 'sleepy', weight: 0.3, mouth: 0.15, flap: 0, eyesClosed: true },
  beEmbalmed: { expr: null, weight: 0, mouth: 0, flap: 0, eyesClosed: true },
  collapse: { expr: 'shocked', weight: 0.5, mouth: 0.4, flap: 0, eyesClosed: false },
  mourn: { expr: 'sad', weight: 1, mouth: 0.1, flap: 0, eyesClosed: false },
  sitTV: { expr: 'sleepy', weight: 0.4, mouth: 0.2, flap: 0, eyesClosed: false },
  sitComputer: { expr: 'focused', weight: 0.7, mouth: 0, flap: 0, eyesClosed: false },
  sitChess: { expr: 'focused', weight: 0.8, mouth: 0, flap: 0, eyesClosed: false },
  paint: { expr: 'focused', weight: 0.6, mouth: 0, flap: 0, eyesClosed: false },
  stitch: { expr: 'focused', weight: 0.7, mouth: 0, flap: 0, eyesClosed: false },
  embalm: { expr: 'focused', weight: 0.7, mouth: 0, flap: 0, eyesClosed: false },
  exercise: { expr: 'angry', weight: 0.4, mouth: 0.3, flap: 0, eyesClosed: false },
  admire: { expr: 'flirty', weight: 0.6, mouth: 0, flap: 0, eyesClosed: false },
  shower: { expr: 'happy', weight: 0.4, mouth: 0, flap: 0, eyesClosed: true },
  sitEat: { expr: 'happy', weight: 0.3, mouth: 0.3, flap: 3.3, eyesClosed: false },
  standEat: { expr: 'happy', weight: 0.3, mouth: 0.3, flap: 3.3, eyesClosed: false },
  // extra states (W-056), used only while their own clip plays (a missing clip plays its fallback's hint)
  applyMakeup: { expr: 'focused', weight: 0.5, mouth: 0, flap: 0, eyesClosed: false },
  adjustWig: { expr: 'focused', weight: 0.4, mouth: 0, flap: 0, eyesClosed: false },
  selfie: { expr: 'happy', weight: 0.9, mouth: 0.2, flap: 0, eyesClosed: false },
  pose: { expr: 'flirty', weight: 0.7, mouth: 0, flap: 0, eyesClosed: false },
  saw: { expr: 'focused', weight: 0.6, mouth: 0, flap: 0, eyesClosed: false },
  solder: { expr: 'focused', weight: 0.8, mouth: 0, flap: 0, eyesClosed: false },
  fixVehicle: { expr: 'focused', weight: 0.6, mouth: 0, flap: 0, eyesClosed: false },
  vows: { expr: 'flirty', weight: 0.6, mouth: 0, flap: 0, eyesClosed: false },
  officiate: { expr: 'focused', weight: 0.4, mouth: 0, flap: 0, eyesClosed: false },
  prank: { expr: 'happy', weight: 1, mouth: 0.7, flap: 6, eyesClosed: false },
  jump: { expr: 'happy', weight: 0.7, mouth: 0.3, flap: 0, eyesClosed: false },
  shiver: { expr: 'sad', weight: 0.5, mouth: 0.15, flap: 9, eyesClosed: false },
  crouchPet: { expr: 'happy', weight: 0.8, mouth: 0, flap: 0, eyesClosed: false },
  pray: { expr: 'sad', weight: 0.4, mouth: 0, flap: 0, eyesClosed: true },
  toast: { expr: 'happy', weight: 1, mouth: 0.5, flap: 0, eyesClosed: false },
  chase: { expr: 'angry', weight: 0.6, mouth: 0.5, flap: 0, eyesClosed: false },
  playGuitar: { expr: 'happy', weight: 0.7, mouth: 0.3, flap: 2, eyesClosed: false },
  playKeys: { expr: 'focused', weight: 0.6, mouth: 0, flap: 0, eyesClosed: false },
  cue: { expr: 'focused', weight: 0.8, mouth: 0, flap: 0, eyesClosed: false },
  swingMallet: { expr: 'focused', weight: 0.6, mouth: 0, flap: 0, eyesClosed: false },
  punch: { expr: 'angry', weight: 1, mouth: 0.4, flap: 0, eyesClosed: false },
  djScratch: { expr: 'happy', weight: 0.8, mouth: 0.3, flap: 2, eyesClosed: false },
};

export class FaceController {
  /** Current morph weights, indexed like FACE_MORPHS. */
  readonly weights = new Float32Array(FACE_MORPHS.length);
  private readonly target = new Float32Array(FACE_MORPHS.length);
  private expr: Expression = 'neutral';
  private hint: Hint = NO_HINT;
  private talking = false;
  private talkPhase = 0;
  private blinkTimer: number;
  private blinkT = -1;
  private eyesClosedW = 0;
  private time = 0;
  private rng: number;
  private closure: Partial<Record<FaceMorph, number>>;

  constructor(seed = 1, closure: Partial<Record<FaceMorph, number>> = DEFAULT_LID_CLOSURE) {
    this.rng = (seed >>> 0) || 0x9e3779b9;
    this.closure = closure;
    this.blinkTimer = this.nextInterval();
  }

  /**
   * Re-seed the blink rhythm (the GLB rig of a zombie created before the asset loaded starts with the default
   * appearance's seed; without this a household loaded together blinks in lockstep). A running blink finishes.
   */
  reseed(seed: number): void {
    this.rng = (seed >>> 0) || 0x9e3779b9;
    // restart the countdown only before the controller has run (the upgrade case: re-seeded right after
    // construction); later re-seeds (a colour slider dragged in Create-a-Zombie) keep the running countdown so
    // blinking never stalls
    if (this.time === 0 && this.blinkT < 0) this.blinkTimer = this.nextInterval();
  }

  /** xorshift32 in [0,1) */
  private rand(): number {
    let x = this.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng / 4294967296;
  }

  private nextInterval(): number {
    return 2 + this.rand() * 4;
  }

  setExpression(e: Expression): void {
    this.expr = e;
  }

  setTalking(on: boolean): void {
    this.talking = !!on;
  }

  setAnimHint(state: AnyAnimState): void {
    this.hint = ANIM_HINTS[state] ?? NO_HINT;
  }

  /** Seconds until the next procedural blink starts (for tests). */
  get nextBlinkIn(): number {
    return this.blinkTimer;
  }

  update(dtIn: number): Float32Array {
    const dt = Number.isFinite(dtIn) && dtIn > 0 ? Math.min(dtIn, 0.5) : 0;
    this.time += dt;
    const t = this.target;
    t.fill(0);
    // expression vs animation hint: an explicit (non-neutral) expression wins, the hint fills in otherwise
    if (this.expr !== 'neutral') {
      t[FACE_INDEX[this.expr as FaceMorph]] = 1;
      if (this.hint.expr && this.hint.expr !== this.expr) t[FACE_INDEX[this.hint.expr]] += this.hint.weight * 0.25;
    } else if (this.hint.expr) {
      t[FACE_INDEX[this.hint.expr]] = this.hint.weight;
    }
    // mouth: talk flaps / anim mouth activity
    let mouth = 0;
    if (this.talking) {
      this.talkPhase += dt;
      const p = this.talkPhase;
      const f = 0.5 + 0.5 * Math.sin(p * 2 * Math.PI * 7.3) * Math.sin(p * 2 * Math.PI * 1.9 + 0.7);
      mouth = 0.15 + 0.7 * Math.abs(f);
    } else if (this.hint.mouth > 0) {
      const flap = this.hint.flap > 0 ? 0.55 + 0.45 * Math.sin(this.time * 2 * Math.PI * this.hint.flap) : 1;
      mouth = this.hint.mouth * flap;
    }
    t[FACE_INDEX.talk] = Math.max(t[FACE_INDEX.talk], mouth);
    // smoothing toward targets (fast enough for flaps, smooth for expression changes)
    const k = 1 - Math.exp(-dt * 12);
    const kTalk = 1 - Math.exp(-dt * 30);
    let closure = 0;
    for (let i = 0; i < this.weights.length; i++) {
      const kk = i === FACE_INDEX.talk ? kTalk : k;
      this.weights[i] += (t[i] - this.weights[i]) * kk;
      const name = FACE_MORPHS[i];
      const c = this.closure[name];
      if (c) closure = Math.max(closure, c * this.weights[i]);
    }
    // procedural blink (0.18 s), eyes held closed for sleeping-type anims
    this.blinkTimer -= dt;
    if (this.blinkT < 0 && this.blinkTimer <= 0) {
      this.blinkT = 0;
      this.blinkTimer = this.nextInterval();
    }
    let blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const u = this.blinkT / 0.18;
      blink = u >= 1 ? 0 : Math.sin(Math.PI * u);
      if (u >= 1) this.blinkT = -1;
    }
    const closedTarget = this.hint.eyesClosed ? 1 : 0;
    this.eyesClosedW += (closedTarget - this.eyesClosedW) * (1 - Math.exp(-dt * 6));
    const b = Math.max(blink, this.eyesClosedW);
    this.weights[FACE_INDEX.blink] = Math.min(1, b * (1 - closure));
    return this.weights;
  }
}
