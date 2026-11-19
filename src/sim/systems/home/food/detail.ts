/**
 * FoodApi.objectDetail — the engine routes ObjectView.detail here, so this covers every home object with live state
 * (meals, fridges, easels, mailbox, limbs, bone piles, urns, paintings, trash, plants, stereo, lights, fire, stove grime).
 */
import type { SimContext } from '../../../contracts';
import type { ObjectState } from '../../../types';
import { DATA, ITEM } from '../../../content/home/ids';
import { reanimateHoursLeft } from '../decay/death';
import { limbData, LIMB_ROT_MINUTES, limbName } from '../decay/limbs';
import { unpaidBills } from '../economy/bills';
import { mailCount } from '../economy/mail';
import { dataBool, dataNum, dataStr, defOf, getAgent, getObj, hasTag, minutesSince, moneyLabel, num, objParam, objParamBool } from '../util';
import { LEFTOVER_SPOIL_MIN, MEAL_OUT_SPOIL_MIN, mealSpoiled, readLeftovers } from './leftovers';

function hours(min: number): string {
  const h = Math.max(0, min / 60);
  return h < 1 ? `${Math.max(1, Math.round(min))} min` : `${Math.round(h)} h`;
}

function stars(q: number): string {
  const n = Math.max(1, Math.min(6, Math.round(q)));
  return `${n}/6`;
}

export function objectDetail(ctx: SimContext, objectId: unknown): string | null {
  const obj = getObj(ctx, objectId);
  if (!obj) return null;
  const def = defOf(ctx, obj);
  if (!def) return null;
  const parts: string[] = [];

  if (obj.defId === ITEM.meal || obj.defId === ITEM.pizza) {
    const s = Math.max(0, Math.floor(dataNum(obj, DATA.servings, 0)));
    parts.push(s > 0 ? `Servings: ${s}` : 'All eaten');
    parts.push(`Quality ${stars(dataNum(obj, DATA.quality, 2))}`);
    const name = dataStr(obj, DATA.mealName, '');
    if (name) parts.push(name);
    if (mealSpoiled(obj)) parts.push('Spoiled!');
    else if (dataNum(obj, DATA.ageMin, 0) >= MEAL_OUT_SPOIL_MIN * 0.75) parts.push('Getting funky');
    return parts.join(' · ');
  }
  if (hasTag(ctx, obj, 'fridge')) {
    const list = readLeftovers(obj);
    const total = list.reduce((n, e) => n + e.s, 0);
    const spoiled = list.filter((e) => e.a >= LEFTOVER_SPOIL_MIN).reduce((n, e) => n + e.s, 0);
    parts.push(total > 0 ? `Leftovers: ${total} serving${total === 1 ? '' : 's'}${spoiled > 0 ? ` (${spoiled} spoiled)` : ''}` : 'No leftovers');
    if (obj.condition?.broken) parts.push('Broken — food spoils twice as fast');
    return parts.join(' · ');
  }
  if (obj.defId === ITEM.dish) {
    parts.push(`Dirty for ${hours(minutesSince(ctx, obj.data?.[DATA.createdTick]))}`);
    if (dataBool(obj, DATA.flies, false)) parts.push('Attracting flies');
    return parts.join(' · ');
  }
  if (obj.defId === ITEM.limbArm || obj.defId === ITEM.limbLeg) {
    const info = limbData(ctx, obj);
    if (!info) return null;
    const owner = getAgent(ctx, info.ownerId);
    parts.push(`${owner ? owner.firstName : dataStr(obj, DATA.ownerName, 'Somebody')}’s ${limbName(info.limbId)}`);
    if (info.rotten) parts.push('Rotten — beyond stitching');
    else parts.push(`Fresh for another ${hours(LIMB_ROT_MINUTES - minutesSince(ctx, info.createdTick))}`);
    return parts.join(' · ');
  }
  if (obj.defId === ITEM.bonePile) {
    const owner = getAgent(ctx, obj.data?.[DATA.ownerId]);
    const left = reanimateHoursLeft(ctx, owner);
    parts.push(`${owner ? owner.firstName : dataStr(obj, DATA.name, 'Someone')}`);
    parts.push(left > 0 ? `Reanimate within ${Math.ceil(left)} h` : 'Turning to dust');
    return parts.join(' · ');
  }
  if (obj.defId === ITEM.urn) {
    return `In loving memory of ${dataStr(obj, DATA.name, 'a dear housemate')}`;
  }
  if (obj.defId === ITEM.painting) {
    const artist = getAgent(ctx, obj.data?.[DATA.artistId]);
    const title = dataStr(obj, DATA.title, 'Untitled');
    return `“${title}”${artist ? ` by ${artist.firstName}` : ''} · Worth about ${moneyLabel(dataNum(obj, DATA.value, 40))}`;
  }
  if (obj.defId === ITEM.fire) {
    return `Burning for ${hours(dataNum(obj, DATA.burnMin, 0))}`;
  }
  if (hasTag(ctx, obj, 'easel')) {
    const p = Math.round(Math.max(0, Math.min(1, dataNum(obj, DATA.progress, 0))) * 100);
    return p > 0 ? `Painting in progress: ${p}%` : 'Blank canvas';
  }
  if (hasTag(ctx, obj, 'mailbox')) {
    const bills = unpaidBills(ctx);
    const owed = bills.reduce((n, b) => n + num(b.amount, 0), 0);
    const mail = mailCount(ctx);
    if (bills.length === 0 && mail === 0) return 'Nothing waiting';
    if (bills.length > 0) parts.push(`${bills.length} unpaid bill${bills.length === 1 ? '' : 's'} (${moneyLabel(owed)})`);
    if (mail > 0) parts.push(`${mail} letter${mail === 1 ? '' : 's'}`);
    return parts.join(' · ');
  }
  if (hasTag(ctx, obj, 'trash')) {
    const cap = Math.max(1, Math.floor(objParam(ctx, obj, 'capacity', 8)));
    const fill = Math.max(0, Math.floor(dataNum(obj, DATA.fill, 0)));
    return fill >= cap ? `Overflowing (${fill}/${cap})` : `Fill: ${fill}/${cap}`;
  }
  if (hasTag(ctx, obj, 'carnivorous')) {
    const fed = obj.data?.[DATA.lastFedTick];
    if (fed === undefined || fed === null) return 'Has never been fed. It is watching you.';
    const h = minutesSince(ctx, fed) / 60;
    return h >= 48 ? 'Peckish. Very peckish.' : `Fed ${Math.round(h)} h ago`;
  }
  if (hasTag(ctx, obj, 'stereo')) {
    return dataBool(obj, DATA.playing, false) ? 'Playing' : 'Off';
  }
  if (hasTag(ctx, obj, 'light')) {
    const on = dataBool(obj, DATA.on, true);
    const candle = objParamBool(ctx, obj, 'candle');
    return candle ? (on ? 'Lit' : 'Snuffed out') : on ? 'On' : 'Off';
  }
  if (hasTag(ctx, obj, 'stove')) {
    const dirt = num(obj.condition?.dirt, 0);
    if (dirt >= 0.6) return `Greasy (${Math.round(dirt * 100)}% grime) — fire risk up`;
    if (dirt >= 0.2) return `Grime: ${Math.round(dirt * 100)}%`;
    return null;
  }
  return null;
}
