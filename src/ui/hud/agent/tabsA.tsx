/** Agent panel tabs: Needs, Mood, Skills. */
import { useState } from 'preact/hooks';
import type { GameController } from '../../../game/contracts';
import type { AgentSummary, MoodletView, SkillView } from '../../../sim/contracts';
import { SKILL_MAX_LEVEL } from '../../../sim/types';
import { clamp, formatDuration, formatPercent, formatSigned, num } from '../lib/format';
import { safe } from '../lib/safe';
import { hudStore } from '../lib/store';
import { NeedBar, Segmented } from '../parts/controls';
import { Icon } from '../parts/icons';
import { ROVING_LIST } from '../parts/roving';
import { tip } from '../parts/tooltip';
import { ht } from '../strings';
import { TabHead } from './AgentPanel';

// ───────────────────────────── Needs ─────────────────────────────

export function NeedsTab({ game, summary }: { game: GameController; summary: AgentSummary }) {
  const needs = safe('needs', () => game.sim?.needs(summary.id) ?? [], []);
  const moodlets = safe('needs.moodlets', () => game.sim?.moodlets(summary.id) ?? [], []);
  const strongest = strongestMoodlets(moodlets, 2);
  return (
    <>
      <div class="hud-needs" role="group" aria-label={ht('tab.needs')} data-hint-anchor="needs-panel needs need-bars" {...ROVING_LIST}>
        {needs.map((n, i) => (
          <NeedBar key={n.id} need={n} tabIndex={i === 0 ? 0 : -1} />
        ))}
      </div>
      {strongest.length > 0 && (
        <div class="hud-feelings">
          <span class="u-caps hud-feelings__label">{ht('needs.feelings')}</span>
          <ul class="hud-feelings__list">
            {strongest.map((m) => {
              const total = moodletTotal(m);
              const kind = total > 0 ? 'good' : total < 0 ? 'bad' : 'neutral';
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    class={`hud-feeling is-${kind}`}
                    onClick={() => {
                      hudStore.set({ agentTab: 'mood' });
                      game.playUi('uiTab');
                    }}
                    {...tip({ title: `${m.label} (${formatSigned(total)})`, body: `${m.description}\n${ht('needs.feelings.open')}`, tone: kind === 'good' ? 'good' : kind === 'bad' ? 'bad' : null })}
                  >
                    <Icon name={m.icon} size="0.875rem" />
                    <span class="hud-feeling__label u-ellipsis">{m.label}</span>
                    <span class="hud-feeling__value u-num">{formatSigned(total)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}

/**
 * A moodlet's whole effect on mood. `MoodletView.mood` is ALREADY the total for all stacks (the engine's views.ts
 * reports def.mood × stacks; `stacks` is informational) — multiplying again double-counted stacked moodlets.
 */
export function moodletTotal(m: Pick<MoodletView, 'mood'> | null | undefined): number {
  return m ? num(m.mood) : 0;
}

/** Stack count to show (×N), 1 for junk. */
export function moodletStacks(m: Pick<MoodletView, 'stacks'> | null | undefined): number {
  const n = m ? Math.floor(num(m.stacks, 1)) : 1;
  return n > 1 ? n : 1;
}

/** The `max` moodlets with the largest total effect (|mood|), strongest first; ties keep input order. */
export function strongestMoodlets(list: readonly MoodletView[] | null | undefined, max = 3): MoodletView[] {
  const items = (list ?? []).filter((m): m is MoodletView => !!m && typeof m.id === 'string');
  const weight = (m: MoodletView) => Math.abs(moodletTotal(m));
  return items
    .map((m, i) => ({ m, i, w: weight(m) }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .slice(0, Math.max(0, Math.floor(num(max))))
    .map((x) => x.m);
}

// ───────────────────────────── Mood ─────────────────────────────

export function MoodTab({ game, summary }: { game: GameController; summary: AgentSummary }) {
  const sim = game.sim;
  const mood = safe('mood', () => sim?.mood(summary.id) ?? null, null);
  const moodlets = safe('moodlets', () => sim?.moodlets(summary.id) ?? [], []);
  const [view, setView] = useState<'moodlets' | 'breakdown'>('moodlets');
  const value = clamp(num(mood?.value ?? summary.mood), -100, 100);
  const band = mood?.band ?? summary.moodBand ?? 'fine';
  const sorted = moodlets.filter((m) => !!m && typeof m.id === 'string').sort((a, b) => Math.abs(moodletTotal(b)) - Math.abs(moodletTotal(a)));
  const contributors = (mood?.contributors ?? []).filter((c) => c && num(c.value) !== 0).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return (
    <div class="hud-mood">
      <TabHead title={ht('mood.overall')}>
        <Segmented<'moodlets' | 'breakdown'>
          label={ht('tab.mood')}
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: 'moodlets', label: ht('mood.moodlets') },
            { value: 'breakdown', label: ht('mood.contributors') },
          ]}
        />
      </TabHead>
      <div class={`hud-moodmeter is-${band}`} role="meter" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={Math.round(value)} aria-label={`${ht('mood.overall')} ${formatSigned(value)}`}>
        <div class="hud-moodmeter__track">
          <div
            class="hud-moodmeter__fill"
            style={{ left: value >= 0 ? '50%' : `${50 + value / 2}%`, width: `${Math.abs(value) / 2}%` }}
          />
          <div class="hud-moodmeter__mid" />
        </div>
        <span class="hud-moodmeter__value u-num">{formatSigned(value)}</span>
      </div>
      {view === 'moodlets' ? (
        sorted.length === 0 ? (
          <p class="hud-empty-line">{ht('mood.none')}</p>
        ) : (
          <ul class="hud-moodlets" aria-label={ht('mood.moodlets')} {...ROVING_LIST}>
            {sorted.map((m, i) => (
              <MoodletCard key={m.id} m={m} game={game} first={i === 0} />
            ))}
          </ul>
        )
      ) : contributors.length === 0 ? (
        <p class="hud-empty-line">{ht('mood.none')}</p>
      ) : (
        <ul class="hud-contribs">
          {contributors.map((c, i) => {
            const v = clamp(num(c.value), -100, 100);
            return (
              <li key={`${c.label}-${i}`} class={`hud-contrib ${v >= 0 ? 'is-pos' : 'is-neg'}`}>
                <span class="hud-contrib__label u-ellipsis">{c.label}</span>
                <span class="hud-contrib__bar" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, Math.abs(v) * 2.5)}%` }} />
                </span>
                <span class="hud-contrib__value u-num">{formatSigned(v)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MoodletCard({ m, game, first }: { m: MoodletView; game: GameController; first: boolean }) {
  const total = moodletTotal(m);
  const stacks = moodletStacks(m);
  const def = safe('moodlet.def', () => game.sim?.content.moodlets[m.id], undefined);
  const dur = def?.durationMin ?? null;
  const remaining = m.remaining === null || m.remaining === undefined ? null : Math.max(0, num(m.remaining));
  const frac = remaining !== null && dur && dur > 0 ? clamp(remaining / dur, 0, 1) : null;
  const time = remaining === null ? ht('mood.indefinite') : ht('mood.remaining', { time: formatDuration(remaining) });
  const kind = m.kind === 'good' || m.kind === 'bad' ? m.kind : total > 0 ? 'good' : total < 0 ? 'bad' : 'neutral';
  return (
    <li
      class={`hud-moodlet is-${kind}`}
      data-roving=""
      tabIndex={first ? 0 : -1}
      aria-label={`${m.label}, ${formatSigned(total)}. ${m.description} ${time}`}
      {...tip({ title: `${m.label} (${formatSigned(total)})`, body: `${m.description}\n${time}`, tone: kind === 'good' ? 'good' : kind === 'bad' ? 'bad' : null })}
    >
      <span class="hud-moodlet__icon" aria-hidden="true">
        <Icon name={m.icon} size="1.0625rem" />
      </span>
      <span class="hud-moodlet__text">
        <span class="hud-moodlet__label u-ellipsis">{m.label}</span>
        <span class="hud-moodlet__time u-ellipsis">
          {remaining === null ? <Icon name="hourglass" size="0.75rem" /> : null}
          {remaining === null ? ht('mood.ongoing') : formatDuration(remaining)}
        </span>
      </span>
      <span class="hud-moodlet__value u-num">
        {formatSigned(total)}
        {stacks > 1 && <span class="hud-moodlet__stacks">{ht('mood.stacks', { n: stacks })}</span>}
      </span>
      {frac !== null && (
        <span class="hud-moodlet__timer" aria-hidden="true">
          <span style={{ width: `${(frac * 100).toFixed(1)}%` }} />
        </span>
      )}
    </li>
  );
}

// ───────────────────────────── Skills ─────────────────────────────

export function SkillsTab({ game, summary }: { game: GameController; summary: AgentSummary }) {
  const skills = safe('skills', () => game.sim?.skills(summary.id) ?? [], []);
  const total = skills.reduce((s, x) => s + clamp(num(x.level), 0, SKILL_MAX_LEVEL), 0);
  return (
    <div class="hud-skills">
      <TabHead title={ht('tab.skills')}>
        <span class="hud-tabhead__note">{ht('skills.total', { n: total })}</span>
      </TabHead>
      <ul class="hud-skills__list" aria-label={ht('tab.skills')} {...ROVING_LIST}>
        {skills.map((s, i) => (
          <SkillRow key={s.id} s={s} game={game} first={i === 0} />
        ))}
      </ul>
    </div>
  );
}

function SkillRow({ s, game, first }: { s: SkillView; game: GameController; first: boolean }) {
  const level = clamp(Math.floor(num(s.level)), 0, SKILL_MAX_LEVEL);
  const progress = clamp(num(s.progress), 0, 1);
  const maxed = level >= SKILL_MAX_LEVEL;
  const name = s.name || ht(`skill.${s.id}`);
  const desc = safe('skill.def', () => game.sim?.content.skills[s.id]?.description ?? '', '');
  const body = [maxed ? ht('skills.max') : ht('skills.progress', { pct: formatPercent(progress), next: level + 1 }), desc].filter(Boolean).join('\n');
  return (
    <li class={`hud-skill${maxed ? ' is-max' : ''}`} data-roving="" tabIndex={first ? 0 : -1} aria-label={`${name}: ${ht('skills.level', { level })}`} {...tip({ title: `${name} · ${ht('skills.level', { level })}`, body })}>
      <span class="hud-skill__icon" aria-hidden="true">
        <Icon name={s.icon} size="1rem" />
      </span>
      <span class="hud-skill__name u-ellipsis">{name}</span>
      <span class="hud-pips" aria-hidden="true">
        {Array.from({ length: SKILL_MAX_LEVEL }, (_, i) => (
          <span
            key={i}
            class={`hud-pip${i < level ? ' is-full' : ''}${i === level && !maxed ? ' is-next' : ''}`}
            style={i === level && !maxed ? { '--p': `${(progress * 100).toFixed(1)}%` } : undefined}
          />
        ))}
      </span>
      <span class="hud-skill__lvl u-num">{level}</span>
    </li>
  );
}
