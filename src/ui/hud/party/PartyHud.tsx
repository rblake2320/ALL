/** Party HUD (when sim.party()?.active): score meter with Lame/Legendary thresholds, time left, guest count. */
import { clamp, num, partyBand, partyEndsTime } from '../lib/format';
import { safe } from '../lib/safe';
import { useGame } from '../parts/hooks';
import { Icon } from '../parts/icons';
import { tip } from '../parts/tooltip';
import { ht } from '../strings';
import './party.css';

export function PartyHud() {
  const game = useGame();
  const party = safe('party', () => game.sim?.party() ?? null, null);
  if (!party || !party.active) return null;
  const score = clamp(num(party.score), 0, 100);
  const band = partyBand(score);
  const guests = Math.max(0, Math.round(num(party.guests)));
  // the party system already says "Ends 1:16 AM"; the engine fallback only gives the time
  const ends = partyEndsTime(party.endsLabel);
  const endsText = 'phrase' in ends ? ends.phrase : ht('party.ends', { when: ends.when });
  return (
    <section class={`hud-party ui-panel ui-interactive is-${band}`} aria-label={ht('party.title')} data-hint-anchor="party">
      <span class="hud-party__icon" aria-hidden="true">
        <Icon name="party" size="1.25rem" />
      </span>
      <div class="hud-party__main" tabIndex={0} {...tip({ title: `${ht('party.score')} ${Math.round(score)} · ${ht(`party.band.${band}`)}`, body: ht('party.body'), place: 'bottom' })}>
        <div class="hud-party__top">
          <span class="hud-party__title u-display">{ht('party.title')}</span>
          <span class="hud-party__band">{ht(`party.band.${band}`)}</span>
          <span class="hud-party__score u-num">{Math.round(score)}</span>
        </div>
        <div class="hud-party__meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(score)} aria-label={ht('party.score')}>
          <span class="hud-party__fill" style={{ width: `${score}%` }} />
          <span class="hud-party__mark is-lame" style={{ left: '30%' }} />
          <span class="hud-party__mark is-legend" style={{ left: '70%' }} />
        </div>
      </div>
      <div class="hud-party__facts">
        <span class="u-num">
          <Icon name="clock" size="0.8125rem" />
          {endsText}
        </span>
        <span class="u-num">
          <Icon name="users" size="0.8125rem" />
          {guests === 1 ? ht('party.guest') : ht('party.guests', { count: guests })}
        </span>
      </div>
    </section>
  );
}
