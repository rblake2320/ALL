/**
 * Townie picker (sim.townies(selectedId)). Two modes (HUD store `inviteMode`): a single "Invite Over", or the
 * party guest list (up to 6 picks, or "Surprise me" to let the sim choose).
 */
import { useState } from 'preact/hooks';
import type { TownieView } from '../../../sim/contracts';
import { clamp, formatSigned, num } from '../lib/format';
import { runPhone } from '../lib/phoneData';
import { relationTone, sortTownies } from '../lib/relationships';
import { safe } from '../lib/safe';
import { useHudStore } from '../lib/store';
import { MAX_PARTY_GUESTS, toggleGuest } from '../lib/validation';
import { Button } from '../parts/controls';
import { HudDialog } from '../parts/Dialog';
import { useGame } from '../parts/hooks';
import { Icon } from '../parts/icons';
import { Portrait } from '../parts/Portrait';
import { ht } from '../strings';
import './dialogs.css';

const MAX_GUESTS = MAX_PARTY_GUESTS;

export function InviteDialog() {
  const game = useGame();
  const ui = useHudStore();
  const party = ui.inviteMode === 'party';
  const id = game.selectedAgentId;
  const sim = game.sim;
  const summary = id ? safe('invite.summary', () => sim?.summary(id) ?? null, null) : null;
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const all = id ? safe('invite.townies', () => sim?.townies(id) ?? [], [] as TownieView[]) : [];
  const list = sortTownies(all, query);
  const close = () => {
    game.closeDialog();
    game.playUi('uiClose');
  };
  const invite = (t: TownieView) => {
    runPhone(game, 'invite', { townieId: t.id });
    game.closeDialog();
  };
  const sendParty = (auto: boolean) => {
    runPhone(game, 'party', auto ? {} : { guests: picked.join(',') });
    game.closeDialog();
  };
  return (
    <HudDialog
      id="invite"
      title={party ? ht('invite.party.title') : ht('invite.title')}
      subtitle={party ? ht('invite.party.subtitle', { max: MAX_GUESTS }) : summary ? ht('invite.subtitle', { name: summary.firstName || summary.name }) : undefined}
      icon={party ? 'party' : 'envelopeHeart'}
      size="md"
      tall
      onClose={close}
      footer={
        party ? (
          <>
            <span class="hud-guestcount u-num" aria-live="polite">
              <Icon name="users" size="1rem" />
              {ht('invite.party.count', { n: picked.length, max: MAX_GUESTS })}
            </span>
            <span class="ui-modal__footer-spacer" />
            <Button variant="ghost" icon="sparkle" label={ht('invite.party.auto')} onClick={() => sendParty(true)} tipSpec={{ title: ht('invite.party.auto'), body: ht('invite.party.auto.body') }} />
            <Button variant="primary" icon="party" label={ht('invite.party.send')} disabled={picked.length === 0} onClick={() => sendParty(false)} />
          </>
        ) : undefined
      }
    >
      <label class="ui-input-wrap hud-dialog__search">
        <span class="ui-input-wrap__icon">
          <Icon name="search" size="1rem" />
        </span>
        <input
          class="ui-input"
          type="search"
          value={query}
          placeholder={ht('invite.search')}
          aria-label={ht('invite.search')}
          // Esc clears a non-empty search first (like the buy catalog); an empty field lets Esc close the dialog.
          data-esc-local={query ? '' : undefined}
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.preventDefault();
              setQuery('');
            }
          }}
        />
      </label>
      {all.length === 0 ? (
        <div class="ui-empty">
          <div class="ui-empty__icon">
            <Icon name="wave" size="1.5rem" />
          </div>
          <p class="ui-empty__text">{ht('invite.empty')}</p>
        </div>
      ) : list.length === 0 ? (
        <p class="hud-empty-line">{ht('invite.noMatch')}</p>
      ) : (
        <ul class="hud-townies" role={party ? 'group' : 'list'} aria-label={party ? ht('invite.party.title') : ht('invite.title')}>
          {list.map((t) => {
            const appearance = safe('invite.agent', () => sim?.agent(t.id)?.appearance, undefined);
            const f = clamp(num(t.friendship), -100, 100);
            const tone = relationTone(t);
            const on = picked.includes(t.id);
            const full = !on && picked.length >= MAX_GUESTS;
            return (
              <li key={t.id} class={`hud-townie${t.available ? '' : ' is-busy'}${on ? ' is-picked' : ''}`}>
                {appearance ? (
                  <Portrait size="2.5rem" appearance={appearance} band={f >= 35 ? 'good' : f <= -35 ? 'miserable' : 'fine'} ring={false} />
                ) : (
                  <span class="hud-rel__initial">{t.name.slice(0, 1)}</span>
                )}
                <div class="hud-townie__main">
                  <div class="hud-townie__top">
                    <span class="hud-townie__name u-ellipsis">{t.name}</span>
                    <span class={`hud-rel__label is-${tone}`}>{t.met ? t.label : ht('invite.notMet')}</span>
                  </div>
                  <div class="hud-townie__sub u-ellipsis">
                    {t.occupation ?? ''}
                    {t.met && (
                      <span class="hud-townie__rel u-num">
                        <Icon name="users" size="0.6875rem" /> {formatSigned(f)}
                        {num(t.romance) > 0 && (
                          <>
                            <Icon name="heart" size="0.6875rem" /> {Math.round(num(t.romance))}
                          </>
                        )}
                      </span>
                    )}
                  </div>
                </div>
                {party ? (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on ? 'true' : 'false'}
                    aria-label={t.name}
                    class="hud-check"
                    disabled={!t.available || full}
                    onClick={() => setPicked((p) => toggleGuest(p, t.id, MAX_GUESTS))}
                  >
                    {on && <Icon name="check" size="0.875rem" strokeWidth={2.6} />}
                  </button>
                ) : (
                  <Button size="sm" variant={t.available ? 'secondary' : 'ghost'} icon={t.available ? 'envelopeHeart' : 'clock'} label={t.available ? ht('invite.send') : ht('invite.busy')} disabled={!t.available} onClick={() => invite(t)} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </HudDialog>
  );
}
