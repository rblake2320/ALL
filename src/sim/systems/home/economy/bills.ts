/**
 * Bills (GDD §6). Issued Monday & Thursday 09:00: 40 + round(0.005 × lotValue) + 10 × living household size (balance pass, docs/BALANCE.md),
 * due 3 days later. Stages (Bill.stage): 1 reminder (due tomorrow), 2 final notice (3 days overdue),
 * 3 power cut (4 days overdue → utilitiesOn = false), 4 repo dispatched (6 days overdue).
 * Paying is idempotent per bill (spend key `bill:<id>`); paying everything restores power immediately.
 */
import type { BillsView, SimContext } from '../../../contracts';
import type { Bill } from '../../../types';
import { TICKS_PER_DAY } from '../../../types';
import { FLOOR_STYLE_BY_ID, WALL_SEGMENT_PRICE } from '../../../../shared/styles';
import { relativeLabel } from '../../../time';
import { MOOD, STAT } from '../../../content/home/ids';
import { guardClear } from '../../pets/guard';
import { defOf, getAgent, isNum, livingMembers, moneyLabel, num, syncMoodlet } from '../util';
import { homeRegionIdOf } from '../../../../shared/town';

export const BILL_BASE = 40;
export const BILL_LOT_RATE = 0.005;
export const BILL_PER_MEMBER = 10;
export const BILL_DUE_DAYS = 3;
export const REMINDER_BEFORE_DAYS = 1;
export const FINAL_NOTICE_DAYS = 3;
export const POWER_CUT_DAYS = 4;
export const REPO_DAYS = 6;
export const MAX_PAID_BILLS_KEPT = 12;

export const BILL_STAGE = { none: 0, reminder: 1, finalNotice: 2, powerCut: 3, repo: 4 } as const;

/** Structural value of the lot: placed objects + wall segments + floor tiles (spawned items are worth 0). */
export function lotValue(ctx: SimContext): number {
  let total = 0;
  for (const o of Object.values(ctx.state.objects ?? {})) {
    if (!o) continue;
    if ((o.regionId ?? homeRegionIdOf(ctx.state)) !== homeRegionIdOf(ctx.state)) continue;
    const def = defOf(ctx, o);
    if (!def || def.category === 'item') continue;
    if (o.placement.kind === 'loose' || o.placement.kind === 'held') continue;
    total += Math.max(0, num(o.value, 0));
  }
  const walls = ctx.state.lot?.walls;
  if (walls && typeof walls === 'object') total += Object.keys(walls).length * WALL_SEGMENT_PRICE;
  const floors = ctx.state.lot?.floors;
  if (Array.isArray(floors)) for (const f of floors) if (typeof f === 'string') total += num(FLOOR_STYLE_BY_ID[f]?.price, 0);
  return Math.max(0, Math.round(total));
}

export function billAmount(ctx: SimContext): number {
  const size = livingMembers(ctx).length;
  return Math.max(0, Math.round(BILL_BASE + BILL_LOT_RATE * lotValue(ctx) + BILL_PER_MEMBER * size));
}

function validBill(b: unknown): b is Bill {
  if (!b || typeof b !== 'object') return false;
  const x = b as Bill;
  return typeof x.id === 'string' && x.id.length > 0 && isNum(x.issuedTick) && isNum(x.dueTick);
}

/** Drop malformed bills (corrupted saves), sanitise amounts/stages, trim old paid ones. */
export function sanitizeBills(ctx: SimContext): Bill[] {
  const hh = ctx.state.household;
  if (!hh) return [];
  const raw = Array.isArray(hh.bills) ? hh.bills : [];
  const seen = new Set<string>();
  const bills: Bill[] = [];
  for (const b of raw) {
    if (!validBill(b) || seen.has(b.id)) continue;
    seen.add(b.id);
    b.amount = Math.max(0, Math.round(num(b.amount, 0)));
    b.stage = Math.max(0, Math.min(4, Math.floor(num(b.stage, 0))));
    if (b.paidTick !== null && !isNum(b.paidTick)) b.paidTick = null;
    bills.push(b);
  }
  const paid = bills.filter((b) => b.paidTick !== null);
  const drop = new Set(paid.slice(0, Math.max(0, paid.length - MAX_PAID_BILLS_KEPT)).map((b) => b.id));
  hh.bills = bills.filter((b) => !drop.has(b.id));
  return hh.bills;
}

export function unpaidBills(ctx: SimContext): Bill[] {
  const bills = Array.isArray(ctx.state.household?.bills) ? ctx.state.household.bills : [];
  return bills.filter((b) => validBill(b) && b.paidTick === null).sort((a, b) => a.dueTick - b.dueTick || (a.id < b.id ? -1 : 1));
}

export function owed(ctx: SimContext): number {
  return unpaidBills(ctx).reduce((n, b) => n + Math.max(0, Math.round(num(b.amount, 0))), 0);
}

export function daysOverdue(ctx: SimContext, b: Bill): number {
  return (ctx.state.tick - b.dueTick) / TICKS_PER_DAY;
}

export function issueBill(ctx: SimContext): Bill | null {
  const hh = ctx.state.household;
  if (!hh || livingMembers(ctx).length === 0 || ctx.state.gameOver) return null;
  const amount = billAmount(ctx);
  if (amount <= 0) return null;
  if (!Array.isArray(hh.bills)) hh.bills = [];
  const bill: Bill = {
    id: `bill${ctx.newUid()}`,
    issuedTick: ctx.state.tick,
    dueTick: ctx.state.tick + BILL_DUE_DAYS * TICKS_PER_DAY,
    amount,
    paidTick: null,
    stage: BILL_STAGE.none,
  };
  hh.bills.push(bill);
  ctx.stat(STAT.billsIssued, 1);
  ctx.emit({ type: 'sfx', id: 'mailbox' });
  ctx.notify({
    kind: 'money',
    title: 'New bill',
    text: `The utility company wants ${moneyLabel(amount)} by ${relativeLabel(ctx.state.tick, bill.dueTick)}. Pay at the mailbox or online.`,
  });
  return bill;
}

export function cutPower(ctx: SimContext): void {
  const hh = ctx.state.household;
  if (!hh || !hh.utilitiesOn) return;
  hh.utilitiesOn = false;
  ctx.stat(STAT.powerCuts, 1);
  ctx.emit({ type: 'sfx', id: 'powerOff' });
  ctx.emit({ type: 'music', mood: 'tense' });
  ctx.notify({
    kind: 'bad',
    title: 'Power cut',
    text: 'The utility company cut the power. No fridge, no stove, no TV, no chilled coffins — and the leftovers are sweating. Pay the bills to turn it back on.',
  });
  for (const m of livingMembers(ctx)) if (m.presence === 'onLot' || m.presence === 'atWork') syncMoodlet(ctx, m, MOOD.powerOut, true);
}

export function restorePower(ctx: SimContext): void {
  const hh = ctx.state.household;
  if (!hh || hh.utilitiesOn) return;
  hh.utilitiesOn = true;
  ctx.emit({ type: 'sfx', id: 'powerOn' });
  ctx.emit({ type: 'music', mood: 'normal' });
  ctx.notify({ kind: 'good', title: 'Power restored', text: 'The lights flicker back on. The fridge hums a little hymn of gratitude.' });
  for (const m of livingMembers(ctx)) syncMoodlet(ctx, m, MOOD.powerOut, false);
}

/** Is any unpaid bill past the power-cut threshold? */
export function powerShouldBeOff(ctx: SimContext): boolean {
  return unpaidBills(ctx).some((b) => daysOverdue(ctx, b) >= POWER_CUT_DAYS || b.stage >= BILL_STAGE.powerCut);
}

/**
 * Advance bill stages (call hourly; idempotent). Returns true when a repo should be dispatched.
 */
export function advanceBills(ctx: SimContext): boolean {
  let repo = false;
  for (const b of unpaidBills(ctx)) {
    const over = daysOverdue(ctx, b);
    if (b.stage < BILL_STAGE.reminder && over >= -REMINDER_BEFORE_DAYS) {
      b.stage = BILL_STAGE.reminder;
      ctx.notify({
        kind: 'warning',
        title: over >= 0 ? 'Bill overdue' : 'Bill due tomorrow',
        text: `A ${moneyLabel(b.amount)} bill is due ${relativeLabel(ctx.state.tick, b.dueTick)}. The utility company has started drafting strongly-worded letters.`,
      });
    }
    if (b.stage < BILL_STAGE.finalNotice && over >= FINAL_NOTICE_DAYS) {
      b.stage = BILL_STAGE.finalNotice;
      ctx.emit({ type: 'sfx', id: 'notifyBad' });
      ctx.notify({
        kind: 'bad',
        title: 'FINAL NOTICE',
        text: `${moneyLabel(b.amount)} is three days overdue. Tomorrow the power goes off. In three days, the Repo Ghoul comes for your nicest things.`,
      });
    }
    if (b.stage < BILL_STAGE.powerCut && over >= POWER_CUT_DAYS) {
      b.stage = BILL_STAGE.powerCut;
      cutPower(ctx);
    }
    if (b.stage < BILL_STAGE.repo && over >= REPO_DAYS) repo = true;
  }
  if (powerShouldBeOff(ctx)) cutPower(ctx);
  else restorePower(ctx);
  return repo;
}

export function syncBillMoodlets(ctx: SimContext): void {
  const unpaid = unpaidBills(ctx);
  const final = unpaid.some((b) => b.stage >= BILL_STAGE.finalNotice);
  const overdue = unpaid.some((b) => daysOverdue(ctx, b) > 0);
  const powerOut = !ctx.state.household?.utilitiesOn;
  for (const m of livingMembers(ctx)) {
    syncMoodlet(ctx, m, MOOD.finalNotice, final);
    syncMoodlet(ctx, m, MOOD.billsOverdue, overdue && !final);
    syncMoodlet(ctx, m, MOOD.powerOut, powerOut);
  }
}

/**
 * Pay outstanding bills oldest-first. Each bill is charged at most once (key `bill:<id>`). Stops at the first bill
 * the household can't afford (bills already paid stay paid). Returns true when nothing is left owing.
 */
export function payAll(ctx: SimContext, agentId: unknown, opts?: { quiet?: boolean }): true | string {
  const hh = ctx.state.household;
  if (!hh) return 'No household';
  sanitizeBills(ctx);
  const unpaid = unpaidBills(ctx);
  if (unpaid.length === 0) return true;
  let paidAmount = 0;
  let paidCount = 0;
  let failure: string | null = null;
  for (const b of unpaid) {
    const amt = Math.max(0, Math.round(num(b.amount, 0)));
    if (amt > 0 && !ctx.spend(amt, `Utility bill (${moneyLabel(amt)})`, `bill:${b.id}`)) {
      failure = `Not enough money (${moneyLabel(amt)} needed)`;
      break;
    }
    b.paidTick = ctx.state.tick;
    paidAmount += amt;
    paidCount++;
    ctx.stat(STAT.billsPaid, 1);
  }
  if (!powerShouldBeOff(ctx)) restorePower(ctx);
  syncBillMoodlets(ctx);
  // the whole debt is settled: a Guard pet's allowance of holds (W-013) starts over for the next one; a partial payment keeps it
  if (unpaidBills(ctx).length === 0) guardClear(ctx);
  const payer = getAgent(ctx, agentId);
  if (paidCount > 0 && !opts?.quiet) {
    ctx.emit({ type: 'sfx', id: 'cash' });
    ctx.notify({
      kind: 'money',
      title: failure ? 'Some bills paid' : 'Bills paid',
      text: failure
        ? `Paid ${paidCount} bill${paidCount === 1 ? '' : 's'} (${moneyLabel(paidAmount)}). ${failure} for the rest.`
        : `Paid ${moneyLabel(paidAmount)}. The mailbox flag droops with relief.`,
      agentId: payer ? payer.id : null,
    });
  }
  if (!failure && payer) ctx.addMoodlet(payer, MOOD.billsPaid);
  return failure ?? true;
}

export function billsView(ctx: SimContext): BillsView {
  const bills = Array.isArray(ctx.state.household?.bills) ? ctx.state.household.bills.filter(validBill) : [];
  const unpaid = unpaidBills(ctx);
  const now = ctx.state.tick;
  const recentPaid = bills.filter((b) => b.paidTick !== null).slice(-5);
  const shown = [...unpaid, ...recentPaid];
  return {
    outstanding: unpaid.reduce((n, b) => n + Math.max(0, num(b.amount, 0)), 0),
    overdue: unpaid.filter((b) => b.dueTick < now).reduce((n, b) => n + Math.max(0, num(b.amount, 0)), 0),
    nextDueLabel: unpaid.length > 0 ? relativeLabel(now, unpaid[0].dueTick) : null,
    utilitiesOn: !!ctx.state.household?.utilitiesOn,
    bills: shown.map((b) => ({
      id: b.id,
      amount: Math.max(0, num(b.amount, 0)),
      dueLabel: relativeLabel(now, b.dueTick),
      overdue: b.paidTick === null && b.dueTick < now,
      paid: b.paidTick !== null,
    })),
  };
}
