/**
 * Choice popup (sim.state.choices): a "letter" with title, text, options (tooltips), the zombie it concerns and a
 * fuse that burns down to expiresTick (the sim then picks the default option). → game.resolveChoice(id, option).
 */
import type { ChoiceState } from '../../../sim/types';
import { clamp, formatDuration, minutesUntil, num } from '../lib/format';
import { safe } from '../lib/safe';
import { useGame } from '../parts/hooks';
import { Icon } from '../parts/icons';
import { Portrait } from '../parts/Portrait';
import { tip } from '../parts/tooltip';
import { ht } from '../strings';
import './choice.css';

export function ChoicePopup() {
  const game = useGame();
  const sim = game.sim;
  const choices = safe('choices', () => (sim?.state.choices ?? []).filter((c): c is ChoiceState => !!c && typeof c.id === 'string' && Array.isArray(c.options)), [] as ChoiceState[]);
  if (!sim || choices.length === 0) return null;
  const c = choices[0];
  const now = num(sim.state.tick);
  const total = Math.max(1, num(c.expiresTick) - num(c.tick));
  const left = clamp((num(c.expiresTick) - now) / total, 0, 1);
  const mins = minutesUntil(now, c.expiresTick);
  const who = c.agentId ? safe('choice.agent', () => sim.summary(c.agentId!), null) : null;
  const titleId = `hud-choice-${c.id}`;
  return (
    <section
      class="hud-choice ui-interactive"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={`${titleId}-text`}
      data-hint-anchor="choice"
      onKeyDown={(e) => {
        // 1…9 pick an option while focus is in the letter (the controller leaves keys inside alertdialogs alone,
        // so this never doubles as a speed change).
        if (e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
        const n = /^Digit([1-9])$/.exec(e.code) ?? /^Numpad([1-9])$/.exec(e.code);
        const i = n ? Number(n[1]) - 1 : -1;
        if (i < 0 || i >= c.options.length) return;
        e.preventDefault();
        e.stopPropagation();
        game.playUi('uiConfirm');
        game.resolveChoice(c.id, i);
      }}
    >
      <div class="hud-choice__paper">
        <div class="hud-choice__seal" aria-hidden="true">
          <Icon name="mail" size="1.125rem" />
        </div>
        <header class="hud-choice__head">
          <div class="hud-choice__eyebrow">
            <span>{ht('choice.label')}</span>
            {choices.length > 1 && <span class="hud-choice__count">{ht('choice.count', { n: 1, total: choices.length })}</span>}
          </div>
          <h2 id={titleId} class="hud-choice__title">
            {c.title}
          </h2>
          {who && (
            <div class="hud-choice__who">
              <Portrait size="1.75rem" appearance={who.appearance} band={who.moodBand} ring={false} />
              <span>{ht('choice.for', { name: who.name })}</span>
            </div>
          )}
        </header>
        <p id={`${titleId}-text`} class="hud-choice__text">
          {c.text}
        </p>
        <div class="hud-choice__options">
          {c.options.map((o, i) => (
            <button
              type="button"
              key={`${c.id}-${i}`}
              class={`hud-choice__opt${i === c.defaultOption ? ' is-default' : ''}`}
              aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
              onClick={() => {
                game.playUi('uiConfirm');
                game.resolveChoice(c.id, i);
              }}
              {...(o.tooltip || i === c.defaultOption ? tip({ title: o.label, body: [o.tooltip ?? '', i === c.defaultOption ? ht('choice.default') : ''].filter(Boolean).join('\n') }) : {})}
            >
              <span class="hud-choice__optnum" aria-hidden="true">
                {i + 1}
              </span>
              <span class="hud-choice__optlabel">{o.label}</span>
              {i === c.defaultOption && (
                <span class="hud-choice__default" aria-label={ht('choice.default')}>
                  <Icon name="hourglass" size="0.8125rem" />
                </span>
              )}
            </button>
          ))}
        </div>
        <div class="hud-choice__fuse" aria-label={ht('choice.auto', { time: formatDuration(mins) })} role="timer">
          <span class="hud-choice__fusetrack">
            <span class="hud-choice__fusefill" style={{ width: `${(left * 100).toFixed(1)}%` }}>
              <span class="hud-choice__spark" />
            </span>
          </span>
          <span class="hud-choice__fuselabel u-num">{ht('choice.auto', { time: formatDuration(mins) })}</span>
        </div>
      </div>
    </section>
  );
}
