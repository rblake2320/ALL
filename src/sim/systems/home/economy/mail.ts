/**
 * Mailbox: data.bills (unpaid count), data.mail (letters waiting) and data.flag (renderer flag up) mirror the
 * household's state on every mailbox object. Letters are counted in flags['home.mail'] (any system may add mail via
 * the economy api addMail / the home_addMail effect); Check Mail reads them out (flavour) and empties the box.
 */
import type { InteractionBehavior, SimContext } from '../../../contracts';
import { DATA, FLAG } from '../../../content/home/ids';
import { EMPTY_MAILBOX, LETTERS } from '../../../content/home/flavour';
import { bubble, dataBool, dataNum, firstName, flagNum, moneyLabel, objectsWithTag, pickLine, setData, setFlag } from '../util';
import { leisureScore, NEVER } from '../autonomy';
import { owed, unpaidBills } from './bills';
import { en } from '../../../../i18n/en';
import { homeRegionIdOf } from '../../../../shared/town';

/**
 * W-116 (D-065): what the mailbox says in an Act 1 story world (flags.storyArc = 'act1'), else null. While the claim beat
 * (act1_claim) is not complete the box holds the CONDEMNED letter the quest promises; until the lease beat is paid,
 * an otherwise empty box still holds more notices — it is never "empty" while the shack is condemned. Classic worlds,
 * old saves and Act 1 worlds past the lease keep the ordinary letters. Reads world data only (no RNG, no writes).
 */
export function storyMailLine(ctx: SimContext, letters: number): string | null {
  const flags = ctx.state.flags;
  if (!flags || flags.storyArc !== 'act1') return null;
  const done = ctx.state.quests?.completions ?? {};
  if (!((done.act1_claim ?? 0) > 0)) return en['story.act1.claim.letter'];
  if (letters === 0 && !((done.act1_lease ?? 0) > 0)) return en['story.act1.claim.letterAgain'];
  return null;
}

export const MAX_MAIL = 20;

export function mailCount(ctx: SimContext): number {
  return Math.max(0, Math.floor(flagNum(ctx, FLAG.mail, 0)));
}

export function addMail(ctx: SimContext, n = 1): number {
  const add = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  const next = Math.min(MAX_MAIL, mailCount(ctx) + add);
  setFlag(ctx, FLAG.mail, next);
  syncMailboxes(ctx);
  return next;
}

export function syncMailboxes(ctx: SimContext): void {
  const bills = unpaidBills(ctx).length;
  const mail = mailCount(ctx);
  const flag = bills > 0 || mail > 0;
  for (const box of objectsWithTag(ctx, 'mailbox')) {
    if ((box.regionId ?? homeRegionIdOf(ctx.state)) !== homeRegionIdOf(ctx.state)) continue;
    if (dataNum(box, DATA.bills, -1) !== bills) setData(ctx, box, DATA.bills, bills);
    if (dataNum(box, DATA.mail, -1) !== mail) setData(ctx, box, DATA.mail, mail);
    if (dataBool(box, DATA.flag, !flag) !== flag) setData(ctx, box, DATA.flag, flag);
  }
}

export const checkMailBehavior: InteractionBehavior = {
  completeStage(ctx, actor) {
    const n = mailCount(ctx);
    const bills = unpaidBills(ctx);
    const lines: string[] = [];
    const story = storyMailLine(ctx, n);
    if (story !== null) {
      // the same RNG draws as the ordinary letters (the story line replaces the text, never the random stream)
      if (n === 0) pickLine(ctx, EMPTY_MAILBOX, '');
      else for (let i = 0; i < Math.min(n, 3); i++) pickLine(ctx, LETTERS, '');
      lines.push(story);
    } else if (n === 0) lines.push(pickLine(ctx, EMPTY_MAILBOX, 'Nothing today.'));
    else {
      const shown = Math.min(n, 3);
      for (let i = 0; i < shown; i++) lines.push(pickLine(ctx, LETTERS, 'A letter.'));
      if (n > shown) lines.push(`…and ${n - shown} more.`);
    }
    if (bills.length > 0) lines.push(`Unpaid bills: ${bills.length} (${moneyLabel(owed(ctx))}).`);
    setFlag(ctx, FLAG.mail, 0);
    syncMailboxes(ctx);
    bubble(ctx, actor, 'mail', 'thought', n > 0 || story !== null);
    ctx.notify({ kind: 'info', title: `${firstName(actor)} checked the mail`, text: lines.join(' '), agentId: actor.id });
  },
  adjustScore(ctx, actor, def, _target, score) {
    return mailCount(ctx) > 0 ? leisureScore(ctx, actor, def, score + 6) : NEVER;
  },
};
