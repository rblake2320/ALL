/** Agent panel tabs: Career, Relationships, Aspiration, Info (+ limb diagram). */
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { GameController } from '../../../game/contracts';
import type { AgentSummary, CareerView, RelationshipView } from '../../../sim/contracts';
import { LIMB_IDS, type LimbCondition, type LimbId, type LimbState } from '../../../shared/appearance';
import { clamp, formatMoney, formatSigned, num, performanceFraction } from '../lib/format';
import { SICK_DAYS_PER_WEEK } from '../lib/phone';
import { phoneOptionsFor, runPhone } from '../lib/phoneData';
import { REL_FILTERS, REL_SORTS, filterRelationships, relationTone, sortRelationships, type RelFilter } from '../lib/relationships';
import { safe } from '../lib/safe';
import { hudStore, useHudStore } from '../lib/store';
import { Button, ProgressBar } from '../parts/controls';
import { ChipRail } from '../parts/ChipRail';
import { Icon } from '../parts/icons';
import { Portrait } from '../parts/Portrait';
import { ROVING_LIST } from '../parts/roving';
import { tip } from '../parts/tooltip';
import { ht } from '../strings';
import { TabHead } from './AgentPanel';

function Empty({ icon, title, text, action }: { icon: string; title: string; text: string; action?: ComponentChildren }) {
  return (
    <div class="ui-empty hud-empty">
      <div class="ui-empty__icon">
        <Icon name={icon} size="1.5rem" />
      </div>
      <div class="ui-empty__title">{title}</div>
      <p class="ui-empty__text">{text}</p>
      {action && <div class="ui-empty__action">{action}</div>}
    </div>
  );
}

// ───────────────────────────── Career ─────────────────────────────

export function CareerTab({ game, summary }: { game: GameController; summary: AgentSummary }) {
  const career = safe('career', () => game.sim?.career(summary.id) ?? null, null);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const opts = phoneOptionsFor(game, summary.id);
  if (!career) {
    return (
      <Empty
        icon="work"
        title={ht('career.none.title')}
        text={ht('career.none.body')}
        action={
          <Button
            variant="primary"
            size="sm"
            icon="search"
            label={ht('career.find')}
            data-hint-anchor="find-job"
            onClick={() => {
              game.playUi('uiOpen');
              game.openDialog('careers');
            }}
          />
        }
      />
    );
  }
  return (
    <div class="hud-career">
      <CareerSummary career={career} game={game} agentId={summary.id} />
      <div class="hud-career__actions">
        <Button
          size="sm"
          icon="thermometer"
          label={ht('career.sick')}
          aria-disabled={opts.callInSick.available ? undefined : 'true'}
          onClick={() => (opts.callInSick.available ? runPhone(game, 'callInSick') : game.playUi('uiError'))}
          tipSpec={{ title: ht('career.sick'), body: opts.callInSick.available ? ht('phone.callInSick.desc', { left: Math.max(0, SICK_DAYS_PER_WEEK - num(safe('career.sickDays', () => game.sim?.agent(summary.id)?.career?.sickDaysUsed, 0))) }) : opts.callInSick.reason ?? ht(opts.callInSick.reasonKey ?? 'phone.reason.unavailable') }}
        />
        {opts.findJob.available && (
          <Button
            size="sm"
            icon="search"
            label={ht('phone.changeJob')}
            onClick={() => {
              game.playUi('uiOpen');
              game.openDialog('careers');
            }}
          />
        )}
        <Button
          size="sm"
          variant={confirmQuit ? 'danger' : 'ghost'}
          icon="exit"
          label={confirmQuit ? ht('career.quit.confirm') : ht('career.quit')}
          aria-disabled={opts.quitJob.available ? undefined : 'true'}
          onBlur={() => setConfirmQuit(false)}
          onClick={() => {
            if (!opts.quitJob.available) {
              game.playUi('uiError');
              return;
            }
            if (!confirmQuit) {
              setConfirmQuit(true);
              game.playUi('uiClick');
              return;
            }
            setConfirmQuit(false);
            runPhone(game, 'quitJob');
          }}
          tipSpec={{ title: ht('phone.quitJob'), body: confirmQuit ? ht('phone.quitJob.confirm') : ht('phone.quitJob.desc', { title: career.title }) }}
        />
      </div>
    </div>
  );
}

export function CareerSummary({ career, game, agentId }: { career: CareerView; game: GameController; agentId: string }) {
  const perf = clamp(num(career.performance), -100, 100);
  const frac = performanceFraction(perf);
  const skills = safe('career.skills', () => game.sim?.skills(agentId) ?? [], []);
  const lvlOf = (id: string) => num(skills.find((s) => s.id === id)?.level);
  // track length from content (every career has 5 levels today; never hard-code it)
  const trackLen = Math.floor(num(safe('career.levels', () => game.sim?.content.careers[career.trackId]?.levels?.length ?? 0, 0)));
  const levels = trackLen >= 1 ? Math.max(trackLen, Math.floor(num(career.level))) : 5;
  return (
    <div class="hud-careercard">
      <div class="hud-careercard__head">
        <span class="hud-careercard__icon" aria-hidden="true">
          <Icon name={career.icon || 'work'} size="1.375rem" />
        </span>
        <div class="hud-careercard__titles">
          <div class="u-eyebrow">{career.trackName}</div>
          <div class="hud-careercard__title u-display u-ellipsis">{career.title}</div>
        </div>
        <div class="hud-careercard__level">
          <span class="hud-careercard__lvlnum u-num">{career.level}</span>
          <span class="hud-careercard__lvlof">/{levels}</span>
        </div>
      </div>
      <dl class="hud-careercard__facts">
        <div>
          <dt>
            <Icon name="money" size="0.875rem" />
          </dt>
          <dd class="u-num">{ht('career.wage', { wage: formatMoney(career.wage) })}</dd>
        </div>
        <div>
          <dt>
            <Icon name="calendar" size="0.875rem" />
          </dt>
          <dd class="u-ellipsis">{career.schedule}</dd>
        </div>
        <div class="is-status">
          <dt>
            <Icon name="clock" size="0.875rem" />
          </dt>
          <dd class="u-ellipsis">{career.status}</dd>
        </div>
      </dl>
      <div class="hud-perf" tabIndex={0} {...tip({ title: `${ht('career.performance')} ${formatSigned(perf)}`, body: ht('career.perf.body') })}>
        <div class="hud-perf__head">
          <span class="u-caps">{ht('career.performance')}</span>
          <span class={`hud-perf__value u-num ${perf >= 0 ? 'is-pos' : 'is-neg'}`}>{formatSigned(perf)}</span>
        </div>
        <div class="hud-perf__track" role="meter" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={Math.round(perf)} aria-label={ht('career.performance')}>
          <span class="hud-perf__fired" style={{ left: '10%' }} aria-hidden="true" />
          <span class="hud-perf__mid" aria-hidden="true" />
          <span class={`hud-perf__fill ${perf >= 0 ? 'is-pos' : 'is-neg'}`} style={perf >= 0 ? { left: '50%', width: `${(frac - 0.5) * 100}%` } : { left: `${frac * 100}%`, width: `${(0.5 - frac) * 100}%` }} />
        </div>
      </div>
      <div class="hud-promo">
        <span class="hud-promo__next u-ellipsis">{career.nextTitle ? ht('career.promotion', { title: career.nextTitle }) : ht('career.top')}</span>
        {career.nextTitle && (
          <span class="hud-promo__reqs">
            {career.promoteReq.map((r) => (
              <span
                key={r.skill}
                class={`hud-req${r.met ? ' is-met' : ''}`}
                tabIndex={0}
                {...tip({ title: `${ht(`skill.${r.skill}`)} ${r.level}`, body: `${r.met ? ht('career.req.met') : ht('career.req.unmet')} · ${ht('skills.level', { level: lvlOf(r.skill) })}`, tone: r.met ? 'good' : 'warm' })}
              >
                <Icon name={r.met ? 'check' : 'lock'} size="0.75rem" strokeWidth={2.2} />
                {ht(`skill.${r.skill}`)} {r.level}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────── Relationships ─────────────────────────────

export function RelationshipsTab({ game, summary }: { game: GameController; summary: AgentSummary }) {
  const ui = useHudStore();
  const all = safe('relationships', () => game.sim?.relationships(summary.id) ?? [], []);
  if (all.length === 0) return <Empty icon="wave" title={ht('tab.relationships')} text={ht('rel.none')} />;
  const counts: Record<RelFilter, number> = Object.fromEntries(REL_FILTERS.map((f) => [f, filterRelationships(all, f).length])) as Record<RelFilter, number>;
  const list = sortRelationships(filterRelationships(all, ui.relFilter), ui.relSort);
  const nextSort = REL_SORTS[(REL_SORTS.indexOf(ui.relSort) + 1) % REL_SORTS.length];
  return (
    <div class="hud-rels">
      <div class="hud-rels__bar">
        <ChipRail<RelFilter>
          label={ht('rel.filter.label')}
          value={ui.relFilter}
          onChange={(f) => {
            hudStore.set({ relFilter: f });
            game.playUi('uiTab');
          }}
          chips={REL_FILTERS.filter((f) => f === 'all' || counts[f] > 0 || f === ui.relFilter).map((f) => ({ value: f, label: ht(`rel.filter.${f}`), count: counts[f] }))}
        />
        <button
          type="button"
          class="hud-sortbtn"
          aria-label={`${ht('rel.sort')}: ${ht(`rel.sort.${ui.relSort}`)}`}
          onClick={() => hudStore.set({ relSort: nextSort })}
          {...tip({ title: `${ht('rel.sort')}: ${ht(`rel.sort.${ui.relSort}`)}`, body: `→ ${ht(`rel.sort.${nextSort}`)}` })}
        >
          <Icon name="sort" size="0.9375rem" />
        </button>
      </div>
      {list.length === 0 ? (
        <p class="hud-empty-line">{ht('rel.empty')}</p>
      ) : (
        <ul class="hud-rels__list" aria-label={ht('tab.relationships')} {...ROVING_LIST}>
          {list.map((r, i) => (
            <RelRow key={r.otherId} r={r} game={game} first={i === 0} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RelRow({ r, game, first }: { r: RelationshipView; game: GameController; first: boolean }) {
  const other = safe('rel.agent', () => game.sim?.agent(r.otherId), undefined);
  const f = clamp(num(r.friendship), -100, 100);
  const ro = clamp(num(r.romance), 0, 100);
  const tone = relationTone(r);
  const where = r.inHousehold ? ht('rel.household') : r.onLot ? ht('rel.visitor') : '';
  const summary = [ht('rel.friendship', { value: formatSigned(f) }), ht('rel.romance', { value: Math.round(ro) }), where].filter(Boolean);
  return (
    <li
      class={`hud-rel is-${tone}`}
      data-roving=""
      tabIndex={first ? 0 : -1}
      aria-label={`${r.name}, ${r.label}. ${summary.join('. ')}.`}
      {...tip({ title: `${r.name} · ${r.label}`, body: summary.join('\n'), place: 'right' })}
    >
      {other?.appearance ? (
        <Portrait size="2.125rem" appearance={other.appearance} band={f >= 35 ? 'good' : f <= -35 ? 'miserable' : 'fine'} ring={false} />
      ) : (
        <span class="hud-rel__initial" aria-hidden="true">
          {(r.name || '?').slice(0, 1)}
        </span>
      )}
      <div class="hud-rel__main">
        <div class="hud-rel__top">
          <span class="hud-rel__name u-ellipsis">{r.name}</span>
          <span class={`hud-rel__label is-${tone}`}>{r.label}</span>
          {r.inHousehold && (
            <span class="hud-rel__flag" aria-hidden="true">
              <Icon name="house" size="0.75rem" />
            </span>
          )}
          {r.onLot && !r.inHousehold && (
            <span class="hud-rel__flag is-here" aria-hidden="true">
              <Icon name="wave" size="0.75rem" />
            </span>
          )}
        </div>
        <div class="hud-rel__bars">
          <span class="hud-relbar is-friend" aria-hidden="true">
            <Icon name="users" size="0.6875rem" />
            <span class="hud-relbar__track">
              <span class="hud-relbar__mid" />
              <span class={`hud-relbar__fill ${f >= 0 ? 'is-pos' : 'is-neg'}`} style={f >= 0 ? { left: '50%', width: `${f / 2}%` } : { left: `${50 + f / 2}%`, width: `${-f / 2}%` }} />
            </span>
            <span class="hud-relbar__num u-num">{formatSigned(f)}</span>
          </span>
          <span class={`hud-relbar is-romance${ro <= 0 ? ' is-zero' : ''}`} aria-hidden="true">
            <Icon name="heart" size="0.6875rem" />
            <span class="hud-relbar__track">
              <span class="hud-relbar__fill is-romance" style={{ left: '0%', width: `${ro}%` }} />
            </span>
            <span class="hud-relbar__num u-num">{Math.round(ro)}</span>
          </span>
        </div>
      </div>
    </li>
  );
}

// ───────────────────────────── Aspiration ─────────────────────────────

export function AspirationTab({ game, summary }: { game: GameController; summary: AgentSummary }) {
  const asp = safe('aspiration', () => game.sim?.aspiration(summary.id) ?? null, null);
  if (!asp) return <Empty icon="trophy" title={ht('tab.aspiration')} text={ht('asp.none')} />;
  const done = asp.milestones.filter((m) => m.done).length;
  const total = asp.milestones.length;
  return (
    <div class="hud-asp">
      <div class="hud-asp__head">
        <span class="hud-asp__icon" aria-hidden="true">
          <Icon name={asp.icon || 'trophy'} size="1.375rem" />
        </span>
        <div class="hud-asp__titles">
          <div class="hud-asp__name u-display u-ellipsis">{asp.name}</div>
          <div class="hud-asp__progress">
            <ProgressBar value={total ? done / total : 0} size="sm" tone="candle" label={ht('asp.progress', { done, total })} />
            <span class="u-num">{ht('asp.progress', { done, total })}</span>
          </div>
        </div>
        <span class="hud-points" tabIndex={0} {...tip({ title: ht('asp.points.label'), body: ht('asp.points.body') })} aria-label={`${ht('asp.points.label')}: ${asp.points}`}>
          <Icon name="gem" size="1rem" />
          <span class="u-num">{ht('asp.points', { points: Math.round(num(asp.points)).toLocaleString('en-US') })}</span>
        </span>
      </div>
      <ul class="hud-milestones">
        {asp.milestones.map((m) => (
          <li key={m.id} class={`hud-milestone${m.done ? ' is-done' : ''}`}>
            <span class="hud-milestone__check" aria-hidden="true">
              {m.done && <Icon name="check" size="0.75rem" strokeWidth={2.6} />}
            </span>
            <span class="hud-milestone__label">{m.label}</span>
            <span class="hud-milestone__pts u-num">+{m.points}</span>
            <span class="u-sr-only">{m.done ? ht('asp.done') : ht('asp.todo')}</span>
          </li>
        ))}
      </ul>
      <Button
        size="sm"
        variant={asp.rewards.some((r) => !r.owned && r.affordable) ? 'primary' : 'secondary'}
        icon="gift"
        label={ht('asp.rewards')}
        class="hud-asp__store"
        data-hint-anchor="rewards reward-store"
        onClick={() => {
          game.playUi('uiOpen');
          game.openDialog('rewards');
        }}
      />
    </div>
  );
}

// ───────────────────────────── Info ─────────────────────────────

export function InfoTab({ game, summary }: { game: GameController; summary: AgentSummary }) {
  const sim = game.sim;
  const agent = safe('info.agent', () => sim?.agent(summary.id), undefined);
  const career = safe('info.career', () => sim?.career(summary.id) ?? null, null);
  const traits = [...(agent?.traits ?? []).map((t) => ({ id: t, reward: false })), ...(agent?.rewardTraits ?? []).map((t) => ({ id: t, reward: true }))];
  const vitality = clamp(num(agent?.vitality, 100), 0, 100);
  const status = !agent
    ? ht(`status.${summary.presence}`)
    : agent.status?.feral
      ? ht('status.feral')
      : agent.status?.passedOut
        ? ht('status.passedOut')
        : agent.anim === 'sleep'
          ? ht('status.asleep')
          : ht(`status.${agent.presence}`);
  return (
    <div class="hud-info">
      <LimbDiagram limbs={agent?.limbs ?? null} />
      <div class="hud-info__side">
        <div class="hud-info__section">
          <div class="u-caps hud-info__label">{ht('info.traits')}</div>
          <ul class="hud-traits" aria-label={ht('info.traits')} {...ROVING_LIST}>
            {traits.map((t, i) => {
              const def = safe('trait.def', () => sim?.content.traits[t.id], undefined);
              return (
                <li
                  key={`${t.id}${t.reward ? ':r' : ''}`}
                  class={`hud-trait${t.reward ? ' is-reward' : ''}`}
                  data-roving=""
                  tabIndex={i === 0 ? 0 : -1}
                  {...tip({ title: def?.name ?? t.id, body: [def?.description ?? '', t.reward ? ht('info.rewardTrait') : ''].filter(Boolean).join('\n'), tone: t.reward ? 'good' : null })}
                >
                  <Icon name={def?.icon ?? 'star'} size="0.875rem" />
                  <span class="u-ellipsis">{def?.name ?? t.id}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <div class="hud-info__section" tabIndex={0} {...tip({ title: `${ht('info.vitality')} ${Math.round(vitality)}`, body: ht('info.vitality.body') })}>
          <div class="hud-info__row">
            <span class="u-caps hud-info__label">
              <Icon name="hourglass" size="0.75rem" /> {ht('info.vitality')}
            </span>
            <span class="u-num hud-info__num">{Math.round(vitality)}</span>
          </div>
          <ProgressBar value={vitality / 100} tone="cryo" size="sm" label={ht('info.vitality')} />
        </div>
        <dl class="hud-info__kv">
          <dt>{ht('info.occupation')}</dt>
          <dd class="hud-info__wrap">{career?.title ?? agent?.occupation ?? ht('info.unemployed')}</dd>
          <dt>{ht('info.status')}</dt>
          <dd class="hud-info__wrap">{status}</dd>
        </dl>
      </div>
    </div>
  );
}

const LIMB_PATH: Record<LimbId, string> = {
  // front view: the zombie's left arm is on the viewer's right
  armR: 'M18.6 23.4c-3.4 1-5.2 4-6 8.2l-2.4 12.6c-.4 2 .8 3.2 2.4 3.4 1.6.2 2.6-.8 3-2.4l3.2-12.4z',
  armL: 'M41.4 23.4c3.4 1 5.2 4 6 8.2l2.4 12.6c.4 2-.8 3.2-2.4 3.4-1.6.2-2.6-.8-3-2.4l-3.2-12.4z',
  legR: 'M22.6 46.4h7l-.6 22.8c0 1.6-1.2 2.6-2.8 2.6h-1.6c-1.6 0-2.6-1.2-2.6-2.8z',
  legL: 'M30.4 46.4h7l.6 22.6c0 1.6-1 2.8-2.6 2.8h-1.6c-1.6 0-2.8-1-2.8-2.6z',
};

const LIMB_JOINT: Record<LimbId, [number, number]> = { armR: [18.4, 24.8], armL: [41.6, 24.8], legR: [26, 47.4], legL: [34, 47.4] };

export function LimbDiagram({ limbs }: { limbs: LimbState | null }) {
  const state = (id: LimbId): LimbCondition => (limbs && (limbs[id] === 'missing' || limbs[id] === 'prosthetic') ? limbs[id] : 'ok');
  const allOk = LIMB_IDS.every((l) => state(l) === 'ok');
  return (
    <figure class="hud-limbs" aria-label={ht('info.limbs')}>
      <svg viewBox="0 0 60 76" class="hud-limbs__svg" role="img" aria-label={allOk ? ht('limb.allOk') : LIMB_IDS.map((l) => `${ht(`limb.${l}`)}: ${ht(`limb.${state(l)}`)}`).join(', ')}>
        <ellipse cx="30" cy="73.5" rx="17" ry="2.2" class="hud-limbs__shadow" />
        <circle cx="30" cy="11.2" r="8.4" class="hud-limbs__body" />
        <path d="M30 4.6c1.8 1.4 2.2 3.6 1.2 5.6" class="hud-limbs__stitch" />
        <path d="M21.6 21.6c2.4-1.8 5.2-2.6 8.4-2.6s6 .8 8.4 2.6l2.2 2.4-1.6 22.6H21l-1.6-22.6z" class="hud-limbs__body" />
        <path d="M24 30.4h12M24 36.4h12" class="hud-limbs__stitch" stroke-dasharray="1.2 1.6" />
        {LIMB_IDS.map((l) => {
          const st = state(l);
          const [jx, jy] = LIMB_JOINT[l];
          return (
            <g key={l} class={`hud-limb is-${st}`} {...tip({ title: ht(`limb.${l}`), body: ht(`limb.${st}`), tone: st === 'missing' ? 'bad' : st === 'prosthetic' ? 'warm' : 'good' })}>
              <path d={LIMB_PATH[l]} />
              {st === 'missing' && <path d={`M${jx - 2} ${jy - 2}l4 4M${jx + 2} ${jy - 2}l-4 4`} class="hud-limb__x" />}
              {st === 'prosthetic' && (
                <>
                  <circle cx={jx} cy={jy + (l.startsWith('arm') ? 6 : 8)} r="0.9" class="hud-limb__bolt" />
                  <circle cx={jx + (l === 'armR' ? -3 : l === 'armL' ? 3 : 0)} cy={jy + (l.startsWith('arm') ? 14 : 16)} r="0.9" class="hud-limb__bolt" />
                </>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption class="hud-limbs__legend">
        {allOk ? (
          <span class="is-ok">{ht('limb.allOk')}</span>
        ) : (
          LIMB_IDS.filter((l) => state(l) !== 'ok').map((l) => (
            <span key={l} class={`is-${state(l)}`}>
              <i aria-hidden="true" />
              {ht(`limb.${l}`)} · {ht(`limb.${state(l)}`)}
            </span>
          ))
        )}
      </figcaption>
    </figure>
  );
}

