/**
 * The per-frame driver body: fixed-timestep stepping of the active world (game or menu demo), event draining
 * (renderer.consumeEvents + EventRouter), input/camera, periodic upkeep (ultra gate, selection, menu validity,
 * choice holds, loops, music/ambience, hints, save label), autosave scheduling, rendering and UI notification.
 */
import type { SimEvent, SimulationAPI } from '../sim/contracts';
import type { Speed } from '../sim/types';
import type { Core } from './core';
import type { HintFacts } from './hints';
import { TICK_BUDGET_MS, advanceAccumulator, runTicks, sanitizeDt } from './loop';
import { DEMO_MAX_AGE_MS } from './demoWorld';
import { STORY_INTRO_MS } from './storyIntro';
import { pollAssets, raiseFatal, startDemo, stopDemo, syncAutoQuality } from './lifecycle';
import { updateAmbience, updateMusic } from './media';

export const RENDER_FAILURES_FATAL = 120;
export const STEP_FAILURE_FRAMES_FATAL = 10;
export const SLOW_TICK_MS = 500;
/**
 * Behind the (opaque) loading screen we render at ~4 fps instead of 60: GLB parsing and texture decoding share the
 * main thread with rendering, so full-rate frames there only make loading slower on weak machines.
 */
export const LOADING_RENDER_INTERVAL_MS = 250;

/** Simulation speed for a world: the game runs at the effective player speed; the demo at 1× unless hidden. */
export function simSpeed(c: Core, sim: SimulationAPI): Speed {
  if (c.fatal !== null) return 0;
  if (c.session && sim === c.session.sim) return c.screen === 'game' && !c.session.gameOver ? c.play.effectiveSpeed : 0;
  return c.hidden ? 0 : 1;
}

export function frame(c: Core, dtSec: number, now: number, background: boolean): void {
  if (c.disposed) return;
  const dt = sanitizeDt(dtSec);
  c.stats.frames++;
  if (c.assetsWaiter) pollAssets(c);
  const session = c.session;
  // Ultra is only legal while everyone at home sleeps: re-check BEFORE stepping, every frame (a woken zombie must
  // not get up to 15 game minutes of 30× time before the 500 ms upkeep notices). Cheap: ≤ 8 household members.
  if (session && c.screen === 'game') c.play.enforceUltra();
  const sim = session?.sim ?? c.demo;
  if (sim) stepAndRoute(c, sim, dt, sim === session?.sim);
  c.input.frame(dt);
  const demoScreen = c.screen === 'menu' || c.screen === 'newGame' || c.screen === 'caz';
  if (!session && c.demo && demoScreen && !c.settings.reduceMotion) c.input.camera.demoOrbit(dt);
  if (now >= c.nextSlowAt) {
    c.nextSlowAt = now + SLOW_TICK_MS;
    slowTick(c, now);
  }
  c.saveFlow.tick(); // autosave interval + journal batching + event-driven saves
  if (c.economy && session && c.screen === 'game') c.guard('economy.frame', () => c.economy?.onFrame(session.sim));
  if (session && c.screen === 'game' && !c.hidden) session.addPlayTime(dt * 1000);
  const behindLoading = c.screen === 'boot' || c.screen === 'loading';
  if (!background && !c.hidden && c.rendererReady && (!behindLoading || now - c.lastRenderAt >= LOADING_RENDER_INTERVAL_MS)) {
    c.lastRenderAt = now;
    try {
      // throttled loading-screen frames are not frame times (Auto quality must not judge them, W-039)
      c.renderer.setAutoQualitySampling?.(!behindLoading);
      c.renderer.frame(c.alpha, dt);
      c.renderFailures = 0;
      const f = c.renderer.fps();
      c.fps = Number.isFinite(f) ? Math.round(f) : 0;
      if (c.screen === 'game') c.trail.sampleFps(c.fps);
    } catch (e) {
      onRenderError(c, e);
    }
  }
  if (c.sessionLog) c.guard('sessionLog.frame', () => c.sessionLog?.frame(now));
  if (c.toastCenter.prune(now) || c.bubbleBoard.prune(now)) c.notifier.markDirty();
  c.notifier.pump(now);
}

function stepAndRoute(c: Core, sim: SimulationAPI, dt: number, isGame: boolean): void {
  const adv = advanceAccumulator(c.accumulator, dt, simSpeed(c, sim));
  c.accumulator = adv.accumulator;
  c.alpha = adv.alpha;
  c.stats.dropped += adv.dropped;
  if (adv.ticks > 0) {
    const r = runTicks(() => sim.step(), adv.ticks, TICK_BUDGET_MS, () => c.env.now());
    c.stats.ticks += r.ran;
    if (r.overBudget) {
      c.stats.overBudget++;
      c.stats.dropped += Math.max(0, adv.ticks - r.ran); // cut by the CPU budget: time runs slower, never spirals
    }
    for (const e of r.errors) c.report(isGame ? 'sim.step' : 'demo.step', e);
    if (r.errors.length > 0) {
      c.stepFailFrames++;
      if (c.stepFailFrames >= STEP_FAILURE_FRAMES_FATAL) {
        c.stepFailFrames = 0;
        if (isGame) raiseFatal(c, r.errors[0], 'The simulation keeps failing and had to stop. Your game was saved to the emergency slot.');
        else stopDemo(c, true);
        return;
      }
    } else {
      c.stepFailFrames = 0;
    }
    c.notifier.markDirty();
  }
  let events: SimEvent[] = [];
  try {
    const e = sim.drainEvents();
    events = Array.isArray(e) ? e : [];
  } catch (e) {
    c.report('sim.drainEvents', e);
  }
  if (events.length === 0) return;
  c.guard('renderer.consumeEvents', () => c.renderer.consumeEvents(events));
  c.router.route(sim, events, isGame ? c.gameRouterHost : c.demoRouterHost);
  // Feedback trail (W-110): event TYPES only, read-only.
  if (isGame) c.guard('feedback.trail', () => c.trail.simEvents(events));
  // Playtest session log (W-117): quest steps, autonomous spend, notable event types — read-only.
  if (isGame && c.sessionLog) c.guard('sessionLog.events', () => c.sessionLog?.simEvents(sim, events));
  // Profile economy: grants + daily tasks from the PLAYED world only (never the menu demo). Reads; never mutates the sim.
  if (isGame && c.economy) c.guard('economy.events', () => c.economy?.onSimEvents(sim, events));
  c.notifier.markDirty();
}

export function onRenderError(c: Core, e: unknown): void {
  c.renderFailures++;
  if (c.renderFailures === 1 || c.renderFailures % 60 === 0) c.report('renderer.frame', e);
  if (c.renderFailures >= RENDER_FAILURES_FATAL) {
    raiseFatal(c, e, 'The renderer stopped working (the graphics driver may have reset). Your game was saved — reload to continue.');
  }
}

function slowTick(c: Core, now: number): void {
  const s = c.session;
  if (s && c.screen === 'game') {
    c.play.maintainSelection();
    c.play.syncPerspective();
    c.play.validateMenu();
    c.play.maintainChoiceHold();
    c.router.refreshLoops(s.sim, c.gameRouterHost);
    updateAmbience(c, s.sim);
  }
  if (!s && c.demo && (c.demoRebuildPending || now - c.demoStartedAt > DEMO_MAX_AGE_MS)) {
    stopDemo(c, true);
    startDemo(c);
  }
  updateMusic(c);
  updateHints(c, now);
  syncAutoQuality(c);
  const label = c.saveFlow.label();
  if (label !== c.lastSaveLabelSeen) {
    c.lastSaveLabelSeen = label;
    c.notifier.markDirty();
  }
}

export function hintFacts(c: Core): HintFacts {
  const s = c.session;
  const base: HintFacts = {
    inGame: false,
    mode: c.play.mode,
    sessionSeconds: 0,
    playerSelected: false,
    menuOpened: false,
    queuedAction: false,
    speedChanged: false,
    enteredBuy: false,
    enteredBuild: false,
    billsOutstanding: 0,
    lowestFreshness: null,
    anyCareer: false,
    choicePending: false,
  };
  if (!s || c.screen !== 'game' || s.gameOver) return base;
  const f: HintFacts = { ...base, ...s.facts, inGame: true, sessionSeconds: s.sessionSeconds, choicePending: c.play.pendingChoices() > 0 };
  try {
    const out = s.sim.bills().outstanding;
    f.billsOutstanding = Number.isFinite(out) ? out : 0;
  } catch {
    /* keep 0 */
  }
  for (const a of c.play.householdMembers(s.sim)) {
    if (!a) continue;
    if (a.career) f.anyCareer = true;
    const p = a.needs?.preservation;
    if (a.presence === 'onLot' && Number.isFinite(p)) f.lowestFreshness = f.lowestFreshness === null ? p : Math.min(f.lowestFreshness, p);
  }
  return f;
}

function updateHints(c: Core, now: number): void {
  // W-113 story intro: hides on its own after STORY_INTRO_MS (it never blocks input; Esc / the button skip it sooner).
  if (c.storyIntro && (now - c.storyIntro.shownAt >= STORY_INTRO_MS || !c.session)) {
    c.storyIntro = null;
    c.notifier.notifyNow();
  }
  const enabled = c.settings.tutorialEnabled && c.fatal === null;
  if (c.hints.update(hintFacts(c), now, enabled)) c.notifier.notifyNow();
}
