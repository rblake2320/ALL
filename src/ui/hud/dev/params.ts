/**
 * DEV ONLY — harness query parameters (dev/ui-hud.html?...):
 *   mode=live|buy|build   tab=needs|mood|skills|career|relationships|aspiration|info   select=a1|a2|a3|a4|none
 *   dialog=phone|careers|invite|rewards|household|pause   invite=party   menu=social|fridge   group=Friendly
 *   choice=1  party=1 partyScore=74  toasts=0..6  log=1 logFilter=money  hint=<anchor>|center  fps=1
 *   scale=0.8..1.4  rm=1 (reduce motion)  cb=1 (colourblind needs)  night=1  fullmoon=1  speed=0..4  ultra=1
 *   bills=overdue|ok|none  power=off  funds=6500  placing=<defId>  tint=#hex  moving=1  hoverobj=1  cat=<category>  q=<search>
 *   tool=select|wall|room|deleteWall|door|window|floor|paintWall|eyedropper  whole=1  label=<cursor label>
 *   saving=1  savefail=1  thumbs=slow|fail  collapsed=1  live=1 (animate)  bubbles=0  view=icons|portraits|compare
 *   stress=1  (8 household members with long names, $9,999,999, 30 moodlets, 24 relationships, 12 queued
 *              orders, long toasts / activity / career text — layout torture test)
 *   hotkeys=1 (controller-style hotkeys with the real KEYMAP ownership rule: Digit0–4 speed, Esc closes the
 *              interaction menu or opens the pause menu — for keyboard e2e checks; #world stands in for the canvas)
 */
import type { BuildTool, DialogId } from '../../../game/contracts';
import type { Speed } from '../../../sim/types';
import type { ViewMode } from '../../../render/contracts';
import type { AgentTab } from '../lib/store';

export interface HarnessParams {
  view: string;
  mode: ViewMode;
  tab: AgentTab;
  select: string | null;
  dialog: DialogId;
  inviteParty: boolean;
  menu: 'social' | 'fridge' | null;
  group: string | null;
  choice: boolean;
  party: boolean;
  partyScore: number;
  toasts: number;
  log: boolean;
  logFilter: string;
  hint: string | null;
  fps: boolean;
  scale: number;
  reduceMotion: boolean;
  colorblind: boolean;
  night: boolean;
  fullMoon: boolean;
  speed: Speed;
  allAsleep: boolean;
  bills: 'overdue' | 'ok' | 'none';
  powerOff: boolean;
  funds: number;
  placing: string | null;
  tint: string | null;
  moving: boolean;
  hoverObj: boolean;
  category: string;
  query: string;
  tool: BuildTool['kind'];
  wholeRoom: boolean;
  label: string | null;
  saving: boolean;
  saveFailed: boolean;
  thumbs: 'normal' | 'slow' | 'fail';
  collapsed: boolean;
  live: boolean;
  bubbles: boolean;
  stress: boolean;
  hotkeys: boolean;
}

function num(v: string | null, d: number): number {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}

export function readParams(search: string): HarnessParams {
  const q = new URLSearchParams(search);
  const on = (k: string) => q.get(k) === '1' || q.get(k) === 'true';
  const mode = (q.get('mode') ?? 'live') as ViewMode;
  const dialog = (q.get('dialog') ?? null) as DialogId;
  const menu = q.get('menu');
  const sel = q.get('select');
  const bills = q.get('bills');
  const thumbs = q.get('thumbs');
  return {
    view: q.get('view') ?? 'hud',
    mode: mode === 'buy' || mode === 'build' ? mode : 'live',
    tab: (q.get('tab') ?? 'needs') as AgentTab,
    select: sel === 'none' ? null : sel ?? 'a1',
    dialog,
    inviteParty: q.get('invite') === 'party',
    menu: menu === 'social' || menu === 'fridge' ? menu : null,
    group: q.get('group'),
    choice: on('choice'),
    party: on('party'),
    partyScore: num(q.get('partyScore'), 74),
    toasts: Math.max(0, Math.min(8, num(q.get('toasts'), 0))),
    log: on('log'),
    logFilter: q.get('logFilter') ?? 'all',
    hint: q.get('hint'),
    fps: on('fps'),
    scale: Math.max(0.8, Math.min(1.4, num(q.get('scale'), 1))),
    reduceMotion: on('rm'),
    colorblind: on('cb'),
    night: on('night'),
    fullMoon: on('fullmoon'),
    speed: Math.max(0, Math.min(4, Math.round(num(q.get('speed'), 1)))) as Speed,
    allAsleep: on('ultra'),
    bills: bills === 'ok' || bills === 'none' ? bills : 'overdue',
    powerOff: q.get('power') === 'off',
    funds: num(q.get('funds'), on('stress') ? 9_999_999 : 6420),
    placing: q.get('placing'),
    tint: q.get('tint'),
    moving: on('moving'),
    hoverObj: on('hoverobj'),
    category: q.get('cat') ?? 'seating',
    query: q.get('q') ?? '',
    tool: (q.get('tool') ?? 'wall') as BuildTool['kind'],
    wholeRoom: on('whole'),
    label: q.get('label'),
    saving: on('saving'),
    saveFailed: on('savefail'),
    thumbs: thumbs === 'slow' || thumbs === 'fail' ? thumbs : 'normal',
    collapsed: on('collapsed'),
    live: on('live'),
    bubbles: q.get('bubbles') !== '0',
    stress: on('stress'),
    hotkeys: on('hotkeys'),
  };
}
