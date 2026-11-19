/**
 * Create-a-Zombie operations on the controller (state ops live in cazState.ts, generation in randomZombie.ts):
 * patches, member add/remove/randomize, validation, and the guarded turntable preview.
 */
import type { CazState } from './contracts';
import type { NewMemberSpec } from '../sim/contracts';
import type { PreviewStage } from '../render/contracts';
import type { Core } from './core';
import { addMember, cazIssues, patchCaz, removeMember, replaceMember, updateMember, type CazIssue } from './cazState';
import { randomZombie, randomizeMember, rngFromSeed, type RandomizeWhat } from './randomZombie';
import { noopPreviewStage } from './fallbacks';
import { canUseBody } from './premiumAccess';

function allowedPatch(c: Core, before: CazState, after: CazState): boolean {
  // Keep unrelated edits possible if an entitlement disappears mid-edit, so
  // the player can replace several now-locked bodies one at a time. Starting
  // the household remains blocked until every body is owned or replaced.
  return after.members.every((m, i) => canUseBody(m.appearance?.body, c.economy) || m.appearance?.body === before.members[i]?.appearance?.body);
}

export function updateCaz(c: Core, patch: Partial<CazState>): void {
  if (!c.caz) return;
  const next = patchCaz(c.caz, patch, c.catalog);
  if (!allowedPatch(c, c.caz, next)) return;
  c.caz = next;
  c.notifier.notifyNow();
}

export function updateCazMember(c: Core, index: number, patch: Partial<NewMemberSpec>): void {
  if (!c.caz) return;
  const next = updateMember(c.caz, index, patch);
  if (!allowedPatch(c, c.caz, next)) return;
  if (next === c.caz) return;
  c.caz = next;
  c.notifier.notifyNow();
}

export function addCazMember(c: Core): void {
  const caz = c.caz;
  if (!caz) return;
  const lastName = caz.members[0]?.lastName?.trim() || caz.householdName.trim();
  const m = randomZombie(rngFromSeed(c.env.randomU32()), c.catalog, { lastName, takenFirstNames: caz.members.map((x) => x.firstName) });
  const next = addMember(caz, m);
  if (next === caz) {
    c.sfx('uiError');
    return;
  }
  c.caz = next;
  c.sfx('uiConfirm');
  c.notifier.notifyNow();
}

export function removeCazMember(c: Core, index: number): void {
  if (!c.caz) return;
  const next = removeMember(c.caz, index);
  if (next === c.caz) {
    c.sfx('uiError');
    return;
  }
  c.caz = next;
  c.sfx('uiClose');
  c.notifier.notifyNow();
}

export function randomizeCazMember(c: Core, index: number, what: unknown): void {
  const caz = c.caz;
  if (!caz || !Number.isInteger(index) || index < 0 || index >= caz.members.length) return;
  const kind: RandomizeWhat = what === 'look' || what === 'traits' || what === 'name' ? what : 'all';
  const others = caz.members.filter((_, i) => i !== index).map((m) => m.firstName);
  const m = randomizeMember(caz.members[index], kind, rngFromSeed(c.env.randomU32()), c.catalog, others);
  c.caz = replaceMember(caz, index, m);
  c.sfx('uiToggle');
  c.notifier.notifyNow();
}

export function validateCaz(c: Core): string[] {
  return validateCazDetailed(c).map((i) => i.message);
}

export function validateCazDetailed(c: Core): CazIssue[] {
  const issues = cazIssues(c.caz, c.catalog);
  c.caz?.members.forEach((m, i) => {
    if (!canUseBody(m.appearance?.body, c.economy)) issues.push({ memberIndex: i, field: 'appearance', message: 'This premium body is not owned by this profile.' });
  });
  return issues;
}

/** Wrap a PreviewStage in a fault barrier; methods become no-ops after dispose (idempotent). */
export function guardedPreview(stage: PreviewStage, report: (w: string, e: unknown) => void, onDispose: () => void): PreviewStage {
  let alive = true;
  const call = (name: string, fn: () => void): void => {
    if (!alive) return;
    try {
      fn();
    } catch (e) {
      report(`preview.${name}`, e);
    }
  };
  return {
    setAppearance: (a) => call('setAppearance', () => stage.setAppearance(a)),
    setLimbs: (l) => call('setLimbs', () => stage.setLimbs(l)),
    setAnim: (a) => call('setAnim', () => stage.setAnim(a)),
    setExpression: (x) => call('setExpression', () => stage.setExpression(x)),
    setYaw: (y) => call('setYaw', () => stage.setYaw(y)),
    resize: (w, h) => call('resize', () => stage.resize(w, h)),
    bodyStatus: () => {
      if (!alive || typeof stage.bodyStatus !== 'function') return 'ready';
      try {
        return stage.bodyStatus();
      } catch (e) {
        report('preview.bodyStatus', e);
        return 'ready';
      }
    },
    dispose: () => {
      if (!alive) return;
      call('dispose', () => stage.dispose());
      alive = false;
      onDispose();
    },
  };
}

export function createCazPreview(c: Core, canvas: HTMLCanvasElement): PreviewStage {
  let stage: PreviewStage;
  try {
    stage = c.renderer.createPreview(canvas);
    if (!stage) return noopPreviewStage();
  } catch (e) {
    c.report('renderer.createPreview', e);
    return noopPreviewStage();
  }
  const wrapped = guardedPreview(stage, (w, e) => c.report(w, e), () => c.previews.delete(wrapped));
  c.previews.add(wrapped);
  const caz = c.caz;
  const m = caz?.members[caz.activeIndex];
  if (m) wrapped.setAppearance(m.appearance);
  return wrapped;
}

/** Release previews the UI forgot to dispose (leaving CAZ). */
export function disposePreviews(c: Core): void {
  for (const p of Array.from(c.previews)) p.dispose();
  c.previews.clear();
}
