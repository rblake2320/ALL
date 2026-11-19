/**
 * summarizeSession (W-117): a compact, human-readable text report of one playtest session log — pure (no DOM, no
 * storage), deterministic for a given log, built ONLY from the log's closed-vocabulary ids and numbers (it never sees a
 * name). Layout (docs/systems/session-log.md §4):
 *
 *   header (session id, date, build, platform segment, duration, world) → Act 1 funnel table → other quest steps →
 *   time to first action → stalls → non-productive clicks → purchases (player vs sim-side) → autonomous interactions →
 *   notable events → hourly funds / lowest need → fps + quality → errors → counters → raw events, one per line.
 */
import { timeInfo } from '../sim/time';
import type { FunnelStep, SessionEvent, SessionLog, SpendTotals } from './sessionLog';

/** m:ss (h:mm:ss past an hour) from ms. */
export function clock(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Raw-line time: m:ss.mmm. */
function stamp(ms: number): string {
  const frac = String(Math.max(0, Math.round(ms)) % 1000).padStart(3, '0');
  return `${clock(ms)}.${frac}`;
}

/** "D2 08:15" from a sim tick. */
export function simClock(tick: number | null | undefined): string {
  if (tick === null || tick === undefined || !Number.isFinite(tick)) return '';
  try {
    const ti = timeInfo(tick);
    return `D${ti.day} ${String(ti.hour).padStart(2, '0')}:${String(ti.minute).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pad = (s: string, w: number) => (s.length >= w ? `${s} ` : s + ' '.repeat(w - s.length));

function topEntries(map: Record<string, number>, max = 12): string {
  const e = Object.entries(map).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  if (e.length === 0) return 'none';
  const shown = e.slice(0, max).map(([k, n]) => `${k} ${n}`);
  if (e.length > max) shown.push(`+${e.length - max} more`);
  return shown.join(', ');
}

function spendLine(label: string, t: SpendTotals, max = 10): string[] {
  const out = [`${label}: ${t.n} · ${money(t.total)}`];
  const e = Object.entries(t.by).sort((a, b) => b[1].total - a[1].total || (a[0] < b[0] ? -1 : 1));
  for (const [k, v] of e.slice(0, max)) out.push(`  ${pad(k, 34)} ×${v.n}  ${money(v.total)}`);
  if (e.length > max) out.push(`  +${e.length - max} more`);
  return out;
}

function funnelTable(steps: FunnelStep[]): string[] {
  const out = [`  #  ${pad('step', 28)}${pad('reached', 10)}${pad('in step', 10)}${pad('done at', 10)}sim`];
  steps.forEach((f, i) => {
    const inStep = f.done !== null ? clock(f.done - f.on) : `${clock(null)} (open)`;
    out.push(`  ${pad(String(i + 1), 3)}${pad(f.step, 28)}${pad(clock(f.on), 10)}${pad(inStep, 10)}${pad(f.done !== null ? clock(f.done) : '—', 10)}${simClock(f.g)}`);
  });
  return out;
}

export function eventLine(e: SessionEvent): string {
  const parts = [pad(stamp(e.t), 11), e.k];
  if (e.a !== undefined) parts.push(e.a);
  if (e.n !== undefined) parts.push(`n=${e.n}`);
  if (e.m !== undefined) parts.push(`m=${e.m}`);
  if (e.g !== undefined) parts.push(`@${simClock(e.g).replace(' ', '/')}`);
  if (e.c !== undefined && e.c > 1) parts.push(`×${e.c}`);
  return parts.join(' ');
}

export interface SummaryOptions {
  /** Raw events printed at the end (default all, newest last). */
  rawMax?: number;
}

export function summarizeSession(log: SessionLog, opts: SummaryOptions = {}): string {
  const h = log.header;
  const p = h.platform;
  const g = h.graphics;
  const L: string[] = [];
  const duration = log.endedMs ?? log.lastT;
  L.push('AFTERLIFE LEASE — PLAYTEST SESSION LOG');
  L.push(`session ${h.id} · ${h.date} · build ${h.build} · v${h.version}`);
  L.push(`platform: ${p.segment} · ${p.orient} · ${p.viewport} @${p.dpr}x · ${p.shell}${p.touch ? ' · touch' : ''}`);
  L.push(`graphics: quality ${g.setting} → ${g.level} · gpu ${g.gpuKind} (ceiling ${g.ceiling})`);
  L.push(`player: ${h.bracket === '13plus' ? 'non-child profile' : 'child profile'} · duration ${clock(duration)} · ${log.endedMs !== null ? `ended (${log.endReason ?? 'unknown'})` : 'not ended (still running or interrupted)'}`);
  L.push(log.world ? `world: ${log.world.kind} · lot ${log.world.lot} · difficulty ${log.world.difficulty} · arc ${log.world.arc} · entered at ${clock(log.world.at)}` : 'world: none entered');
  L.push('');

  const act1 = log.funnel.filter((f) => f.arc === 'act1');
  const other = log.funnel.filter((f) => f.arc !== 'act1');
  L.push(`ACT 1 FUNNEL (${act1.filter((f) => f.done !== null).length}/${act1.length} steps done)`);
  if (act1.length) L.push(...funnelTable(act1));
  else L.push('  no Act 1 step reached');
  const act1Quests = log.quests.filter((q) => q.arc === 'act1');
  if (act1Quests.length) {
    const bones = act1Quests.reduce((s, q) => s + q.bones, 0);
    L.push(`  beats completed: ${act1Quests.filter((q) => q.done !== null).length}/${act1Quests.length} · Bones awarded ${bones}`);
    for (const q of act1Quests) L.push(`  ${pad(q.quest, 18)} started ${pad(clock(q.on), 8)} ${q.done !== null ? `done ${pad(clock(q.done), 8)} +${q.bones} Bones` : 'open'}`);
  }
  if (other.length) {
    L.push('OTHER QUEST STEPS');
    L.push(...funnelTable(other));
  }
  L.push('');

  L.push(log.firstAction ? `time to first action: ${clock(log.firstAction.ms)} (${log.firstAction.ms} ms) — ${log.firstAction.type}` : 'time to first action: none (no interaction queued, nothing bought)');
  const st = log.agg.stalls;
  L.push(`stalls (≥ 60 s no input, in game, unpaused): ${st.length}`);
  for (const s of st) L.push(`  idle from ${clock(s.from)} · flagged ${clock(s.at)} · ${s.to !== null ? `input again ${clock(s.to)}` : 'never resumed'} · ${Math.round(s.idle / 1000)} s unpaused idle`);
  const cn = log.agg.clicksNone;
  L.push(`non-productive clicks: ${cn.n}${cn.n ? ` (${topEntries(cn.by)})` : ''}`);
  if (cn.at.length) L.push(`  at ${cn.at.slice(0, 30).map(clock).join(', ')}${cn.at.length > 30 ? ' …' : ''}`);
  L.push('');

  L.push('PURCHASES');
  L.push(...spendLine('  player (Buy/Build)', log.agg.player).map((s, i) => (i ? `  ${s}` : s)));
  L.push(...spendLine('  household, sim-side (autonomy, interaction costs, bills, theft)', log.agg.sim).map((s, i) => (i ? `  ${s}` : s)));
  if (log.agg.refunds.n) L.push(...spendLine('  refunds (sell / undo)', log.agg.refunds).map((s, i) => (i ? `  ${s}` : s)));
  L.push(`autonomous interactions completed: ${Object.values(log.agg.autoIx).reduce((a, b) => a + b, 0)} (${topEntries(log.agg.autoIx)})`);
  L.push(`notable events: ${topEntries(log.agg.notable)}`);
  const hours = log.events.filter((e) => e.k === 'hour');
  if (hours.length) {
    L.push(`hourly funds / lowest need (${hours.length} samples${hours.length > 12 ? ', last 12' : ''}):`);
    for (const e of hours.slice(-12)) L.push(`  ${pad(simClock(e.g), 10)} funds ${pad(money(e.n ?? 0), 9)} lowest ${e.a ?? 'none'} ${e.m ?? '—'}`);
  }
  L.push('');

  const f = log.agg.fps;
  L.push(f.n ? `fps: min ${f.min} · avg ${Math.round(f.sum / f.n)} · max ${f.max} (${f.n} samples)` : 'fps: no samples');
  const q = log.events.filter((e) => e.k === 'quality').map((e) => `${clock(e.t)} ${e.a}`);
  L.push(`quality levels: ${q.length ? q.join(', ') : g.level}`);
  L.push(`errors: ${topEntries(log.agg.errors)}`);
  L.push(`counts: ${topEntries(log.agg.counts, 40)}`);
  L.push('');

  const raw = opts.rawMax !== undefined ? log.events.slice(-Math.max(0, opts.rawMax)) : log.events;
  L.push(`RAW EVENTS (${raw.length} shown${log.dropped ? `, ${log.dropped} older evicted` : ''}${raw.length < log.events.length ? `, ${log.events.length - raw.length} older not shown` : ''})`);
  for (const e of raw) L.push(eventLine(e));
  return L.join('\n');
}
