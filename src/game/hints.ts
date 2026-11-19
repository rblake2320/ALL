/**
 * Tutorial hints: contextual first-time tips shown one at a time while playing.
 *
 * Each hint has `when` (eligible now) and optional `done` (the player already did it → mark seen silently).
 * A visible hint disappears when dismissed, when its `done` becomes true, after `autoHideMs` (info-only hints),
 * or temporarily when `when` stops holding (e.g. leaving buy mode) — only the first three mark it seen.
 * "Never show again" disables the whole tutorial (Settings.tutorialEnabled = false; the controller owns that).
 * Progress persists in the profile under 'tutorial' as { v: 1, seen: string[] } (corrupt data → empty progress).
 *
 * `anchor` names a UI element the HUD may point at (see HINT_ANCHORS; contract request filed for UI-HUD).
 */
import type { ViewMode } from '../render/contracts';
import { readOwnData } from './settings';

export const TUTORIAL_PROFILE_KEY = 'tutorial';

export const HINT_ANCHORS = {
  portraits: 'household-portraits',
  needs: 'needs-panel',
  speed: 'speed-controls',
  funds: 'funds',
  modeBuy: 'mode-buy',
  modeBuild: 'mode-build',
  phone: 'phone',
  catalog: 'buy-catalog',
  buildTools: 'build-tools',
} as const;

export interface HintFacts {
  inGame: boolean;
  mode: ViewMode;
  /** Real seconds spent in the current game session. */
  sessionSeconds: number;
  playerSelected: boolean;
  menuOpened: boolean;
  queuedAction: boolean;
  speedChanged: boolean;
  enteredBuy: boolean;
  enteredBuild: boolean;
  billsOutstanding: number;
  lowestFreshness: number | null;
  anyCareer: boolean;
  choicePending: boolean;
}

export interface HintDef {
  id: string;
  title: string;
  text: string;
  anchor: string | null;
  when(f: HintFacts, seen: ReadonlySet<string>): boolean;
  /**
   * The player has DEMONSTRATED this (selected a zombie, changed speed, ...). Must never be true merely because the
   * hint's situation hasn't happened yet — that would retire the hint before it is ever shown.
   */
  done?(f: HintFacts): boolean;
  autoHideMs?: number;
}

export interface VisibleHint {
  id: string;
  title: string;
  text: string;
  anchor: string | null;
}

const live = (f: HintFacts): boolean => f.inGame && f.mode === 'live' && !f.choicePending;

export const HINTS: readonly HintDef[] = [
  {
    id: 'select',
    title: 'Your household',
    text: 'Click a zombie (or their portrait) to take control. Tab cycles through the household; F brings the camera to them.',
    anchor: HINT_ANCHORS.portraits,
    when: (f) => live(f),
    done: (f) => f.playerSelected,
  },
  {
    id: 'fridge',
    title: 'Everything is clickable',
    // W-113: generic on purpose — the story-start shack has no fridge yet (its first clickables are the mailbox and the coffin).
    text: 'With a zombie selected, click any object — the mailbox, a coffin, the fridge — to see what they can do. Click the ground to walk there.',
    anchor: null,
    when: (f, seen) => live(f) && seen.has('select'),
    done: (f) => f.menuOpened || f.queuedAction,
  },
  {
    id: 'needs',
    title: 'Needs',
    text: 'The bars in the zombie panel are needs. Keep them out of the orange: a starving zombie goes feral and an exhausted one collapses.',
    anchor: HINT_ANCHORS.needs,
    when: (f, seen) => live(f) && seen.has('fridge'),
    autoHideMs: 22_000,
  },
  {
    id: 'speed',
    title: 'Time',
    text: 'Space pauses; 1, 2 and 3 change speed. Ultra speed (4) only works while everyone is asleep or at work.',
    anchor: HINT_ANCHORS.speed,
    when: (f, seen) => live(f) && seen.has('needs'),
    done: (f) => f.speedChanged,
  },
  {
    id: 'freshness',
    title: 'Freshness',
    text: 'Freshness never fully comes back. Chilled coffins, ice baths and embalming slow the rot — let it hit zero and your zombie falls apart. Literally.',
    anchor: HINT_ANCHORS.needs,
    when: (f) => live(f) && f.lowestFreshness !== null && f.lowestFreshness < 65,
    autoHideMs: 25_000,
  },
  {
    id: 'bills',
    title: 'Bills',
    text: 'Bills arrive in the mailbox on Mondays and Thursdays. Click the mailbox to pay them — unpaid bills cut the power, then the Repo Ghoul visits.',
    anchor: HINT_ANCHORS.funds,
    // No `done`: "no bills outstanding" is also true before the first bill ever arrives, which would retire the hint
    // unseen. It hides while nothing is owed and is marked seen once it has been read (auto-hide) or dismissed.
    when: (f) => live(f) && f.billsOutstanding > 0,
    autoHideMs: 30_000,
  },
  {
    id: 'buy',
    title: 'Buy mode',
    text: 'Press B (or the Buy tab) to furnish your home with coffins, fridges and questionable art.',
    anchor: HINT_ANCHORS.modeBuy,
    when: (f, seen) => live(f) && seen.has('speed') && f.sessionSeconds > 120,
    done: (f) => f.enteredBuy,
  },
  {
    id: 'buyHowTo',
    title: 'Placing things',
    text: 'Pick an item, R rotates, click to place one — Shift+click keeps placing, Done or Esc stops. Click a placed item to move it; Delete sells it. Ctrl+Z undoes.',
    anchor: HINT_ANCHORS.catalog,
    when: (f) => f.inGame && f.mode === 'buy',
    autoHideMs: 30_000,
  },
  {
    id: 'build',
    title: 'Build mode',
    text: 'Press U for Build mode: drag walls along the grid, drag out whole rooms, lay floors, add doors and windows, and paint.',
    anchor: HINT_ANCHORS.modeBuild,
    when: (f, seen) => live(f) && seen.has('buy'),
    done: (f) => f.enteredBuild,
  },
  {
    id: 'buildHowTo',
    title: 'Building',
    text: 'Drag to draw. Doors and windows snap to walls; paint a single wall side or a whole room. C cycles walls up / cutaway / down.',
    anchor: HINT_ANCHORS.buildTools,
    when: (f) => f.inGame && f.mode === 'build',
    autoHideMs: 30_000,
  },
  {
    id: 'careers',
    title: 'Get a job',
    text: "Rent doesn't pay itself. Open the phone in the zombie panel and look for a career — a carpool hearse picks your zombie up.",
    anchor: HINT_ANCHORS.phone,
    when: (f, seen) => live(f) && !f.anyCareer && (seen.has('bills') || f.sessionSeconds > 420),
    done: (f) => f.anyCareer,
  },
];

/** Tolerant parse of persisted progress. */
export function parseTutorialProgress(raw: unknown, known: readonly HintDef[] = HINTS): Set<string> {
  const seen = new Set<string>();
  const r = readOwnData(raw, 'seen');
  if (!r.ok || !Array.isArray(r.value)) return seen;
  const ids = new Set(known.map((h) => h.id));
  for (const v of r.value.slice(0, 256)) if (typeof v === 'string' && ids.has(v)) seen.add(v);
  return seen;
}

export const MIN_GAP_MS = 4000;
/** W-129: after a quest Go, no NEW tip starts for this long, so the target the camera just framed stays in view. */
export const GO_HINT_HOLD_MS = 4000;

export class HintEngine {
  private readonly seen: Set<string>;
  private currentDef: HintDef | null = null;
  private shownAt = 0;
  private lastHiddenAt = Number.NEGATIVE_INFINITY;
  private holdUntil = Number.NEGATIVE_INFINITY;

  constructor(
    seen: Iterable<string>,
    private readonly persist: (seen: string[]) => void,
    private readonly defs: readonly HintDef[] = HINTS,
  ) {
    this.seen = new Set(seen);
  }

  private view: { def: HintDef; hint: VisibleHint } | null = null;

  /** Stable object identity while the same hint stays visible (cheap UI memoisation). */
  get current(): VisibleHint | null {
    const d = this.currentDef;
    if (!d) return null;
    if (this.view?.def !== d) this.view = { def: d, hint: { id: d.id, title: d.title, text: d.text, anchor: d.anchor } };
    return this.view.hint;
  }

  get seenIds(): string[] {
    return Array.from(this.seen);
  }

  hasSeen(id: string): boolean {
    return this.seen.has(id);
  }

  /** Re-evaluate; returns true when the visible hint changed. */
  update(f: HintFacts, now: number, enabled: boolean): boolean {
    const before = this.currentDef;
    if (!enabled || !f.inGame) {
      this.hide(now);
      return before !== this.currentDef;
    }
    // Silently retire hints the player has already mastered (even before they are shown).
    let changedSeen = false;
    for (const d of this.defs) {
      if (!this.seen.has(d.id) && d.done && safe(() => d.done!(f))) {
        this.seen.add(d.id);
        changedSeen = true;
      }
    }
    const cur = this.currentDef;
    if (cur) {
      if (this.seen.has(cur.id)) this.hide(now);
      else if (cur.autoHideMs !== undefined && now - this.shownAt >= cur.autoHideMs) this.markSeen(cur.id, now);
      else if (!safe(() => cur.when(f, this.seen))) this.hide(now);
    }
    if (!this.currentDef && now - this.lastHiddenAt >= MIN_GAP_MS && now >= this.holdUntil) {
      for (const d of this.defs) {
        if (this.seen.has(d.id)) continue;
        if (safe(() => d.when(f, this.seen))) {
          this.currentDef = d;
          this.shownAt = now;
          break;
        }
      }
    }
    if (changedSeen) this.persist(this.seenIds);
    return before !== this.currentDef;
  }

  /**
   * W-129: start no NEW hint before `until` (a hint already showing stays). Only ever extends the hold; a NaN or past
   * time is ignored.
   */
  hold(until: number): void {
    if (Number.isFinite(until) && until > this.holdUntil) this.holdUntil = until;
  }

  /** Player dismissed the hint ("Got it"). Returns true if it was known. */
  dismiss(id: string, now: number): boolean {
    if (!this.defs.some((d) => d.id === id)) return false;
    this.markSeen(id, now);
    return true;
  }

  /** Session ended (quit to menu): hide without marking seen. */
  hide(now: number): void {
    if (this.currentDef) {
      this.currentDef = null;
      this.lastHiddenAt = now;
    }
  }

  private markSeen(id: string, now: number): void {
    const had = this.seen.has(id);
    this.seen.add(id);
    if (this.currentDef?.id === id) this.hide(now);
    if (!had) this.persist(this.seenIds);
  }
}

function safe(fn: () => boolean): boolean {
  try {
    return fn() === true;
  } catch {
    return false;
  }
}
