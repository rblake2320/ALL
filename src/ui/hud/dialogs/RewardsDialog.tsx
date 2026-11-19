/** Reward store (sim.aspiration(id).rewards) — purchases go through the HUD's command helper (buyReward). */
import { useState } from 'preact/hooks';
import { num } from '../lib/format';
import { buyReward } from '../lib/commands';
import { safe } from '../lib/safe';
import { Button } from '../parts/controls';
import { HudDialog } from '../parts/Dialog';
import { useGame } from '../parts/hooks';
import { Icon } from '../parts/icons';
import { ht } from '../strings';
import './dialogs.css';

export function RewardsDialog() {
  const game = useGame();
  const id = game.selectedAgentId;
  const sim = game.sim;
  const summary = id ? safe('rewards.summary', () => sim?.summary(id) ?? null, null) : null;
  const asp = id ? safe('rewards.aspiration', () => sim?.aspiration(id) ?? null, null) : null;
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const close = () => {
    game.closeDialog();
    game.playUi('uiClose');
  };
  const points = Math.round(num(asp?.points));
  return (
    <HudDialog
      id="rewards"
      title={ht('rewards.title')}
      subtitle={asp && summary ? ht('rewards.subtitle', { aspiration: asp.name, name: summary.firstName || summary.name }) : undefined}
      icon="gift"
      size="lg"
      onClose={close}
      initialFocus="close"
    >
      {!asp ? (
        <div class="ui-empty">
          <div class="ui-empty__icon">
            <Icon name="aspiration" size="1.5rem" />
          </div>
          <p class="ui-empty__text">{ht('rewards.none')}</p>
        </div>
      ) : (
        <>
          <div class="hud-rewards__bar">
            <span class="hud-points is-lg" aria-label={`${ht('rewards.points')}: ${points}`}>
              <Icon name="gem" size="1.25rem" />
              <span class="u-num">{points.toLocaleString('en-US')}</span>
              <span class="hud-points__label">{ht('rewards.points')}</span>
            </span>
            {status && (
              <span class={`hud-rewards__status ${status.ok ? 'is-ok' : 'is-bad'}`} role="status">
                <Icon name={status.ok ? 'sparkle' : 'warning'} size="1rem" />
                {status.text}
              </span>
            )}
          </div>
          <ul class="hud-rewards">
            {asp.rewards.map((r) => {
              const short = Math.max(0, Math.round(num(r.cost)) - points);
              const traitDef = safe('rewards.trait', () => (sim?.content.rewards[r.id]?.kind === 'trait' ? 'trait' : sim?.content.rewards[r.id]?.kind), undefined);
              const kind = traitDef === 'consumable' ? 'consumable' : 'trait';
              return (
                <li key={r.id} class={`hud-reward${r.owned ? ' is-owned' : ''}${!r.owned && !r.affordable ? ' is-poor' : ''}`}>
                  <span class="hud-reward__icon" aria-hidden="true">
                    <Icon name={r.icon || 'gift'} size="1.5rem" />
                  </span>
                  <div class="hud-reward__main">
                    <div class="hud-reward__top">
                      <h3 class="hud-reward__name u-display">{r.name}</h3>
                      <span class="hud-reward__kind">{ht(`rewards.${kind}`)}</span>
                    </div>
                    <p class="hud-reward__desc">{r.description}</p>
                  </div>
                  <div class="hud-reward__buy">
                    <span class="hud-reward__cost u-num">
                      <Icon name="gem" size="0.875rem" />
                      {Math.round(num(r.cost)).toLocaleString('en-US')}
                    </span>
                    {r.owned ? (
                      <span class="ui-badge ui-badge--accent ui-badge--caps">
                        <Icon name="check" size="0.75rem" strokeWidth={2.6} />
                        {ht('rewards.owned')}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant={r.affordable ? 'primary' : 'secondary'}
                        label={r.affordable ? ht('rewards.buy') : ht('rewards.need', { n: short.toLocaleString('en-US') })}
                        disabled={!r.affordable || !id}
                        onClick={() => {
                          const res = buyReward(game, id!, r.id);
                          setStatus(res.ok ? { ok: true, text: ht('rewards.bought', { name: r.name }) } : { ok: false, text: ht('rewards.failed', { reason: res.reason ?? '?' }) });
                        }}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </HudDialog>
  );
}
