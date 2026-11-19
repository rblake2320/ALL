/**
 * Phone actions (pure). Availability comes from the simulation's self-menu when it exposes phone interactions
 * (ids `phone_*` / group "Phone"); otherwise we derive a sensible local answer so the dialog still works.
 * Actions are passed to `game.phone(action, params)`; GAME resolves them to SIM-PEOPLE's phone_* interactions via
 * `params.action` (invite | party | pizza | findJob | quitJob | callInSick). Child params per SIM-PEOPLE C4:
 * invite { townieId }, party { guests?: 'a1,a2' }, findJob { careerId }. See docs/contract-requests/ui-hud.md.
 */
import type { MenuEntry } from '../../../sim/contracts';
import { num } from './format';

export const PHONE_ACTIONS = ['invite', 'party', 'pizza', 'findJob', 'quitJob', 'callInSick'] as const;
export type PhoneAction = (typeof PHONE_ACTIONS)[number];

/** Brain Pizza price (GDD §5) — used only when the sim does not report a cost. */
export const PIZZA_COST = 35;
export const SICK_DAYS_PER_WEEK = 3;
export const PARTY_HOST_MIN_FUN = 30;

export interface PhoneOption {
  action: PhoneAction;
  available: boolean;
  /** Player-facing reason from the sim (already localised by content). */
  reason: string | null;
  /** HUD string key for a locally-derived reason (translate in the component). */
  reasonKey: string | null;
  cost: number | null;
  /** Matching sim interaction id, when the sim menu exposed one. */
  interactionId: string | null;
}

export interface PhoneContext {
  hasCareer: boolean;
  funds: number;
  partyActive: boolean;
  /** Some household zombie on the lot has Amusement ≥ 30 (GDD §11). */
  canHost: boolean;
  townieCount: number;
  sickDaysUsed: number;
  /** Selected zombie is physically home (not at work / crumbled). */
  atHome: boolean;
}

const MATCHERS: Record<PhoneAction, (s: string) => boolean> = {
  invite: (s) => /invite/.test(s) && !/party/.test(s),
  party: (s) => /party/.test(s),
  pizza: (s) => /pizza/.test(s),
  findJob: (s) => /(job|career|work)/.test(s) && !/(quit|sick)/.test(s),
  quitJob: (s) => /quit/.test(s),
  callInSick: (s) => /sick/.test(s),
};

/** Flatten groups/children and keep phone entries only. */
export function phoneEntries(entries: readonly MenuEntry[] | null | undefined): MenuEntry[] {
  const out: MenuEntry[] = [];
  const visit = (e: MenuEntry) => {
    if (!e || typeof e.interactionId !== 'string') return;
    const isPhone = e.interactionId.startsWith('phone_') || String(e.group ?? '').toLowerCase() === 'phone';
    if (isPhone) out.push(e);
  };
  for (const e of entries ?? []) visit(e);
  return out;
}

export function matchPhoneEntry(entries: readonly MenuEntry[], action: PhoneAction): MenuEntry | null {
  for (const e of entries) {
    const hay = `${e.interactionId} ${e.label}`.toLowerCase();
    if (MATCHERS[action](hay)) return e;
  }
  return null;
}

function local(action: PhoneAction, ctx: PhoneContext): Omit<PhoneOption, 'action' | 'interactionId'> {
  const no = (reasonKey: string, cost: number | null = null) => ({ available: false, reason: null, reasonKey, cost });
  const yes = (cost: number | null = null) => ({ available: true, reason: null, reasonKey: null, cost });
  if (!ctx.atHome) return no('phone.reason.away', action === 'pizza' ? PIZZA_COST : null);
  switch (action) {
    case 'invite':
      return ctx.townieCount > 0 ? yes() : no('phone.reason.noTownies');
    case 'party':
      if (ctx.partyActive) return no('phone.reason.partyActive');
      if (!ctx.canHost) return no('phone.reason.noHost');
      return yes();
    case 'pizza':
      return num(ctx.funds) >= PIZZA_COST ? yes(PIZZA_COST) : no('phone.reason.cantAfford', PIZZA_COST);
    case 'findJob':
      return yes();
    case 'quitJob':
      return ctx.hasCareer ? yes() : no('phone.reason.noJob');
    case 'callInSick':
      if (!ctx.hasCareer) return no('phone.reason.noJob');
      if (num(ctx.sickDaysUsed) >= SICK_DAYS_PER_WEEK) return no('phone.reason.noSickDays');
      return yes();
  }
}

/** Availability for every phone action. Sim-provided entries win over local derivation. */
export function phoneOptions(entries: readonly MenuEntry[] | null | undefined, ctx: PhoneContext): Record<PhoneAction, PhoneOption> {
  const phone = phoneEntries(entries);
  const out = {} as Record<PhoneAction, PhoneOption>;
  for (const action of PHONE_ACTIONS) {
    const e = matchPhoneEntry(phone, action);
    if (e) {
      out[action] = {
        action,
        available: !!e.available,
        reason: e.available ? null : e.reason ?? null,
        reasonKey: e.available || e.reason ? null : 'phone.reason.unavailable',
        cost: typeof e.cost === 'number' && Number.isFinite(e.cost) ? e.cost : null,
        interactionId: e.interactionId,
      };
    } else {
      out[action] = { action, interactionId: null, ...local(action, ctx) };
    }
  }
  return out;
}
