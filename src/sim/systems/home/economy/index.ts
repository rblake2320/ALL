/**
 * `economy` system — bills, power cuts, the Repo Ghoul, mailbox, painting sales (GDD §6).
 * api: EconomyApi { bills(), lotValue(), payAll(agentId) } + owed(), addMail(n), issueBill(), dispatchRepo().
 */
import type { BillsView, EconomyApi, InteractionBehavior, SimContext, SimSystem } from '../../../contracts';
import { BEH, COND, DATA, EFF, FLAG, HOME_SYS, MOOD, REQ, STAT } from '../../../content/home/ids';
import { apiMethod, instrument } from '../ctxRegistry';
import { TICKS_PER_HOUR } from '../../../types';
import { NEVER } from '../autonomy';
import { dataNum, dataStr, every, firstName, flagNum, isMember, moneyLabel, num, queuedObject, runData, setFlag, targetObject } from '../util';
import { advanceBills, billsView, issueBill, lotValue, owed, payAll, sanitizeBills, syncBillMoodlets, unpaidBills } from './bills';
import { addMail, checkMailBehavior, syncMailboxes } from './mail';
import { guardClear } from '../../pets/guard';
import { dispatchRepo, repossessBehavior, tickRepo } from './repo';

const BILL_HOUR = 9;
const BILL_WEEKDAYS = [0, 3]; // Monday, Thursday

/** Pay everything and immediately mirror the result on the mailbox (flag down). */
function payAndSync(ctx: SimContext, agentId: unknown): true | string {
  const res = payAll(ctx, agentId);
  syncMailboxes(ctx);
  return res;
}

const payBillsBehavior: InteractionBehavior = {
  startStage(ctx) {
    const unpaid = unpaidBills(ctx);
    if (unpaid.length === 0) return 'No bills to pay';
    const first = Math.max(0, Math.round(num(unpaid[0].amount, 0)));
    if (num(ctx.state.household?.funds, 0) < first) return `Not enough money (${moneyLabel(first)} needed)`;
    return null;
  },
  completeStage(ctx, actor, run) {
    const res = payAndSync(ctx, actor.id);
    if (res !== true) runData(run).payFail = res;
  },
  /**
   * Responsible zombies settle a bill once it is due within AUTO_PAY_HOURS (the "due tomorrow" reminder) (or already overdue) and the household
   * can cover the oldest one — so an unattended household keeps the lights on instead of drifting into power cuts
   * and the Repo Ghoul while sitting on thousands. Broke households still go through every bill stage.
   */
  adjustScore(ctx, actor, _def, _target, score) {
    if (!isMember(ctx, actor)) return NEVER;
    const unpaid = unpaidBills(ctx);
    if (unpaid.length === 0) return NEVER;
    const first = unpaid[0];
    const hoursLeft = (num(first.dueTick, ctx.state.tick) - ctx.state.tick) / TICKS_PER_HOUR;
    if (hoursLeft > AUTO_PAY_HOURS) return NEVER;
    if (num(ctx.state.household?.funds, 0) < Math.max(0, Math.round(num(first.amount, 0)))) return NEVER;
    const overdueDays = Math.min(6, Math.max(0, -hoursLeft / 24));
    return score + AUTO_PAY_BONUS + overdueDays * 3;
  },
};

/** Autonomy pays a bill this many game hours before it falls due (or any time after). */
export const AUTO_PAY_HOURS = 24;
const AUTO_PAY_BONUS = 10;

const sellPaintingBehavior: InteractionBehavior = {
  label(ctx, _actor, def, target) {
    const p = targetObject(ctx, target);
    return p ? `${def.label} (${moneyLabel(dataNum(p, DATA.value, 40))})` : def.label;
  },
  startStage(ctx, _actor, run) {
    return queuedObject(ctx, run) ? null : 'The painting is gone';
  },
  completeStage(ctx, actor, run) {
    const p = queuedObject(ctx, run);
    if (!p) return;
    const value = Math.max(1, Math.round(dataNum(p, DATA.value, 40)));
    ctx.earn(value, 'Painting sold', `painting:${p.id}`);
    runData(run).sold = true;
    ctx.addMoodlet(actor, MOOD.paintingSold);
    ctx.stat(STAT.paintingsSold, 1);
    ctx.stat(STAT.paintingsSold, 1, actor.id);
    ctx.emit({ type: 'fx', kind: 'money', agentId: actor.id });
    ctx.emit({ type: 'sfx', id: 'cash', agentId: actor.id });
    ctx.notify({
      kind: 'money',
      title: 'Sold!',
      text: `${firstName(actor)} sold “${dataStr(p, DATA.title, 'Untitled')}” for ${moneyLabel(value)}. The buyer described it as “haunting, literally”.`,
      agentId: actor.id,
    });
  },
  end(ctx, _actor, run) {
    if (!runData(run).sold) return;
    const p = queuedObject(ctx, run);
    if (p) ctx.removeObject(p.id, 'Sold');
  },
};

function hourly(ctx: SimContext, hour: number): void {
  sanitizeBills(ctx);
  const t = ctx.time;
  if (hour === BILL_HOUR && BILL_WEEKDAYS.includes(t.weekday) && flagNum(ctx, FLAG.lastBillDay, -1) !== t.day) {
    setFlag(ctx, FLAG.lastBillDay, t.day);
    issueBill(ctx);
  }
  // no unpaid bill left (paid, or settled by the ghoul): a Guard pet's holds start over for the next debt (W-013)
  if (unpaidBills(ctx).length === 0) guardClear(ctx);
  if (advanceBills(ctx)) dispatchRepo(ctx);
  syncMailboxes(ctx);
  syncBillMoodlets(ctx);
}

export function createEconomySystem(): SimSystem {
  const api: EconomyApi & Record<string, (...args: any[]) => any> = {
    bills: apiMethod<BillsView>({ outstanding: 0, overdue: 0, nextDueLabel: null, utilitiesOn: true, bills: [] }, (ctx) => billsView(ctx)),
    lotValue: apiMethod(0, (ctx) => lotValue(ctx)),
    payAll: apiMethod<true | string>('Not ready', (ctx, agentId: unknown) => payAndSync(ctx, agentId)),
    owed: apiMethod(0, (ctx) => owed(ctx)),
    addMail: apiMethod(0, (ctx, n?: unknown) => addMail(ctx, num(n, 1))),
    issueBill: apiMethod<string | null>(null, (ctx) => issueBill(ctx)?.id ?? null),
    dispatchRepo: apiMethod(false, (ctx) => dispatchRepo(ctx)),
  };
  const sys: SimSystem = {
    id: HOME_SYS.economy,
    init(ctx) {
      sanitizeBills(ctx);
      syncMailboxes(ctx);
      syncBillMoodlets(ctx);
    },
    tick(ctx) {
      tickRepo(ctx);
      if (every(ctx, 10)) syncMailboxes(ctx);
    },
    hour(ctx, hour) {
      hourly(ctx, num(hour, ctx.time.hour));
    },
    behaviors: {
      [BEH.payBills]: payBillsBehavior,
      [BEH.checkMail]: checkMailBehavior,
      [BEH.repossess]: repossessBehavior,
      [BEH.sellPainting]: sellPaintingBehavior,
    },
    effects: {
      [EFF.payBills]: (ctx, ec) => {
        payAndSync(ctx, ec.actor ? ec.actor.id : null);
      },
      [EFF.addMail]: (ctx, _ec, params) => {
        addMail(ctx, num(params?.count, 1));
      },
    },
    requirements: {
      [REQ.billsDue]: (ctx, _rc, p) => (unpaidBills(ctx).length > 0 ? true : typeof p?.reason === 'string' ? p.reason : 'No bills to pay'),
    },
    conditions: {
      [COND.billsOverdue]: (ctx) => unpaidBills(ctx).some((b) => b.dueTick < ctx.state.tick),
      [COND.powerOff]: (ctx) => !ctx.state.household?.utilitiesOn,
    },
    api,
  };
  return instrument(sys);
}
