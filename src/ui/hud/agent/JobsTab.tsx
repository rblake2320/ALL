/**
 * W-124 (D-071) agent panel "Jobs" tab: this zombie's household jobs (current target, progress, blocked reason,
 * priority, pause / resume / cancel / move up / move down) and a small form to assign a new one (category, where,
 * how often). Every change is ONE `GameController.job` command (journaled, validated by the sim). Categories whose
 * content is pending are listed as "Coming later" and disabled — never offered as available.
 *
 * Accessibility: real <button>/<select> controls with visible or aria labels, the category picker is a labelled
 * radiogroup (arrow keys move), status lines are a polite live region, and phone mode (.hud[data-phone]) gives every
 * control a 44 px target (phone.css + jobs.css). Styles are self-contained in jobs.css.
 */
import { useState } from 'preact/hooks';
import type { GameController } from '../../../game/contracts';
import type { AgentSummary, JobView, JobsView } from '../../../sim/contracts';
import type { JobMode, JobPriority } from '../../../sim/types';
import { hourLabel } from '../../../shared/jobs';
import { safe } from '../lib/safe';
import { Button, IconButton, ProgressBar, Segmented } from '../parts/controls';
import { Icon } from '../parts/icons';
import { ht } from '../strings';
import { TabHead } from './AgentPanel';
import './jobs.css';

const PRIORITIES: JobPriority[] = ['high', 'normal', 'low'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
type ModeKind = JobMode['kind'];

export function JobsTab({ game, summary }: { game: GameController; summary: AgentSummary }) {
  const view = safe('jobs.view', () => game.sim?.jobs?.() ?? null, null);
  if (!view) return <p class="hud-jobs__empty">{ht('jobs.unavailable')}</p>;
  const mine = view.list.filter((j) => j.agentId === summary.id);
  return (
    <div class="hud-jobs" data-hint-anchor="jobs-tab">
      <TabHead title={ht('jobs.title')}>{mine.length > 0 && <span class="hud-jobs__count">{ht('jobs.count', { count: mine.length })}</span>}</TabHead>
      {mine.length === 0 ? (
        <p class="hud-jobs__empty">{ht('jobs.none', { name: summary.firstName })}</p>
      ) : (
        <ul class="hud-jobs__list" aria-label={ht('jobs.list', { name: summary.firstName })}>
          {mine.map((j) => (
            <JobRow key={j.id} game={game} job={j} />
          ))}
        </ul>
      )}
      <AssignForm game={game} view={view} summary={summary} />
    </div>
  );
}

function JobRow({ game, job }: { game: GameController; job: JobView }) {
  const name = `${job.label} · ${job.scopeLabel}`;
  const detail = job.targetName ? ht('jobs.target', { target: job.targetName }) : job.reason;
  const nextPriority = PRIORITIES[(PRIORITIES.indexOf(job.priority) + 1) % PRIORITIES.length];
  return (
    <li class={`hud-job is-${job.status}`} data-job-id={job.id} data-job-status={job.status}>
      <div class="hud-job__head">
        <Icon name={job.icon} size="1.1rem" />
        <span class="hud-job__name">{name}</span>
        <span class="hud-job__mode">{job.modeLabel}</span>
      </div>
      <div class="hud-job__status" role="status" aria-live="polite">
        <span class="hud-job__state">{job.statusLabel}</span>
        {detail && <span class="hud-job__detail"> — {detail}</span>}
      </div>
      <div class="hud-job__progress">
        {job.progress !== null && <ProgressBar value={job.progress} size="sm" label={job.progressLabel} />}
        <span class="hud-job__plabel">{job.progressLabel}</span>
      </div>
      <div class="hud-job__actions">
        <Button
          size="sm"
          variant="ghost"
          class={`hud-job__prio is-${job.priority}`}
          label={`${ht('jobs.priority')}: ${ht(`jobs.priority.${job.priority}`)}`}
          aria-label={ht('jobs.priority.change', { value: ht(`jobs.priority.${job.priority}`) })}
          onClick={() => game.job({ action: 'priority', jobId: job.id, priority: nextPriority })}
        />
        <IconButton icon="chevronUp" size="sm" label={ht('jobs.up', { job: name })} disabled={job.index === 0} onClick={() => game.job({ action: 'move', jobId: job.id, dir: -1 })} />
        <IconButton icon="chevronDown" size="sm" label={ht('jobs.down', { job: name })} disabled={job.index >= job.count - 1} onClick={() => game.job({ action: 'move', jobId: job.id, dir: 1 })} />
        <IconButton
          icon={job.paused ? 'speed1' : 'pause'}
          size="sm"
          label={job.paused ? ht('jobs.resume', { job: name }) : ht('jobs.pause', { job: name })}
          pressed={job.paused}
          onClick={() => game.job({ action: job.paused ? 'resume' : 'pause', jobId: job.id })}
        />
        <IconButton icon="close" size="sm" variant="danger" label={ht('jobs.cancel', { job: name })} onClick={() => game.job({ action: 'cancel', jobId: job.id })} />
      </div>
    </li>
  );
}

function AssignForm({ game, view, summary }: { game: GameController; view: JobsView; summary: AgentSummary }) {
  const firstAvailable = view.categories.find((c) => c.available)?.id ?? '';
  const [cat, setCat] = useState<string>(firstAvailable);
  const [scopeIdx, setScopeIdx] = useState(0);
  const [mode, setMode] = useState<ModeKind>('untilDone');
  const [from, setFrom] = useState(18);
  const [to, setTo] = useState(21);
  const [priority, setPriority] = useState<JobPriority>('normal');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const current = view.categories.find((c) => c.id === cat && c.available) ?? view.categories.find((c) => c.available) ?? null;
  const scopes = current ? view.scopes[current.id] ?? [] : [];
  const scope = scopes[Math.min(scopeIdx, Math.max(0, scopes.length - 1))];
  const effMode: ModeKind = current?.openEnded && mode === 'untilDone' ? 'once' : mode;
  const ids = `hud-jobs-${summary.id}`;
  const pickCat = (id: string) => {
    setCat(id);
    setScopeIdx(0);
    setMsg(null);
  };
  const avail = view.categories.filter((c) => c.available);
  const onCatKey = (e: KeyboardEvent) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir || avail.length === 0 || !current) return;
    e.preventDefault();
    e.stopPropagation();
    const i = avail.findIndex((c) => c.id === current.id);
    const next = avail[(i + dir + avail.length) % avail.length];
    pickCat(next.id);
    const root = e.currentTarget as HTMLElement | null;
    requestAnimationFrame(() => root?.querySelector<HTMLElement>(`[data-cat="${next.id}"]`)?.focus());
  };
  const submit = () => {
    if (!current || !scope) return;
    const m: JobMode = effMode === 'recurring' ? { kind: 'recurring', from, to: to === from ? (from + 1) % 24 : to } : { kind: effMode };
    const r = game.job({ action: 'assign', agentId: summary.id, category: current.id, scope: scope.scope, mode: m, priority });
    setMsg(r.ok ? { ok: true, text: ht('jobs.assigned', { job: current.label, name: summary.firstName }) } : { ok: false, text: r.reason ?? "Couldn't assign that" });
  };
  return (
    <section class="hud-jobs__form" aria-labelledby={`${ids}-new`}>
      <h4 class="hud-jobs__formtitle" id={`${ids}-new`}>
        {ht('jobs.new')}
      </h4>
      <div class="hud-jobs__cats" role="radiogroup" aria-label={ht('jobs.category')} onKeyDown={onCatKey}>
        {view.categories.map((c) => {
          const on = !!current && c.available && c.id === current.id;
          return (
            <button
              type="button"
              key={c.id}
              role="radio"
              data-cat={c.id}
              aria-checked={on ? 'true' : 'false'}
              aria-disabled={c.available ? undefined : 'true'}
              aria-label={c.available ? c.label : `${c.label} — ${ht('jobs.later')}: ${c.reason ?? ''}`}
              tabIndex={on ? 0 : -1}
              class={`hud-jobs__cat${on ? ' is-on' : ''}${c.available ? '' : ' is-later'}`}
              title={c.available ? c.label : c.reason ?? ht('jobs.later')}
              onClick={() => (c.available ? pickCat(c.id) : setMsg({ ok: false, text: `${c.label}: ${ht('jobs.later')} — ${c.reason ?? ''}` }))}
            >
              <Icon name={c.icon} size="1rem" />
              <span class="hud-jobs__catlabel">{c.label}</span>
              {!c.available && <span class="hud-jobs__later">{ht('jobs.later')}</span>}
            </button>
          );
        })}
      </div>
      <div class="hud-jobs__row">
        <label class="hud-jobs__field" for={`${ids}-where`}>
          <span>{ht('jobs.where')}</span>
          <select id={`${ids}-where`} class="hud-jobs__select" value={String(Math.min(scopeIdx, Math.max(0, scopes.length - 1)))} onChange={(e) => setScopeIdx(Number((e.currentTarget as HTMLSelectElement).value) || 0)}>
            {scopes.map((s, i) => (
              <option key={i} value={String(i)}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label class="hud-jobs__field" for={`${ids}-prio`}>
          <span>{ht('jobs.priority')}</span>
          <select id={`${ids}-prio`} class="hud-jobs__select" value={priority} onChange={(e) => setPriority((e.currentTarget as HTMLSelectElement).value as JobPriority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {ht(`jobs.priority.${p}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Segmented<ModeKind>
        label={ht('jobs.how')}
        size="sm"
        block
        class="hud-jobs__mode"
        value={effMode}
        onChange={setMode}
        options={[
          { value: 'once', label: ht('jobs.mode.once') },
          { value: 'untilDone', label: ht('jobs.mode.untilDone'), disabled: !!current?.openEnded, tipSpec: current?.openEnded ? { title: ht('jobs.mode.untilDone'), body: ht('jobs.mode.openEnded') } : undefined },
          { value: 'recurring', label: ht('jobs.mode.recurring') },
        ]}
      />
      {effMode === 'recurring' && (
        <div class="hud-jobs__row">
          <label class="hud-jobs__field" for={`${ids}-from`}>
            <span>{ht('jobs.from')}</span>
            <select id={`${ids}-from`} class="hud-jobs__select" value={String(from)} onChange={(e) => setFrom(Number((e.currentTarget as HTMLSelectElement).value))}>
              {HOURS.map((h) => (
                <option key={h} value={String(h)}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </label>
          <label class="hud-jobs__field" for={`${ids}-to`}>
            <span>{ht('jobs.to')}</span>
            <select id={`${ids}-to`} class="hud-jobs__select" value={String(to)} onChange={(e) => setTo(Number((e.currentTarget as HTMLSelectElement).value))}>
              {HOURS.filter((h) => h !== from).map((h) => (
                <option key={h} value={String(h)}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <Button variant="primary" size="sm" block icon="plus" class="hud-jobs__assign" label={ht('jobs.assign')} disabled={!current || !scope} onClick={submit} />
      <p class={`hud-jobs__msg${msg && !msg.ok ? ' is-bad' : ''}`} role="status" aria-live="polite">
        {msg ? msg.text : ht('jobs.rule')}
      </p>
    </section>
  );
}
