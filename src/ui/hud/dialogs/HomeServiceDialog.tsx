/**
 * The home service screens (docs/contract-requests/home-build-system.md steps 3-4): the Hearth and its upgrades, the
 * Wardrobe's saved builds, the Embalming table's respec and the Crypt vault. Opened from the object's click menu
 * (src/game/homeMenu.ts); everything shown comes from src/game/homeView.ts and every button dispatches a `home` command
 * that the homeServices system validates again. Nothing here changes a fight stat (CB-2).
 */
import type { HomeDialogService } from '../../../shared/homeServices';
import { BUILD_DATA_READY } from '../../../shared/homeServices';
import { hearthView, respecView, vaultView, wardrobeView, type HearthRowView } from '../../../game/homeView';
import { safe } from '../lib/safe';
import { Button } from '../parts/controls';
import { HudDialog } from '../parts/Dialog';
import { useGame } from '../parts/hooks';
import { Icon } from '../parts/icons';
import { ht } from '../strings';
import './dialogs.css';

const TITLE: Readonly<Record<HomeDialogService, { key: string; icon: string }>> = {
  hearth: { key: 'home.hearth.title', icon: 'fire' },
  wardrobe: { key: 'home.wardrobe.title', icon: 'coffin' },
  embalming: { key: 'home.embalming.title', icon: 'embalm' },
  vault: { key: 'home.vault.title', icon: 'crate' },
};

export function HomeServiceDialog() {
  const game = useGame();
  const service = game.dialogOptions?.service ?? 'hearth';
  const t = TITLE[service];
  const close = () => {
    game.closeDialog();
    game.playUi('uiClose');
  };
  return (
    <HudDialog id="homeService" title={ht(t.key)} icon={t.icon} size="md" onClose={close}>
      {service === 'hearth' && <HearthPanel />}
      {service === 'wardrobe' && <WardrobePanel />}
      {service === 'embalming' && <EmbalmingPanel />}
      {service === 'vault' && <VaultPanel />}
    </HudDialog>
  );
}

function Note({ icon = 'info', children }: { icon?: string; children: preact.ComponentChildren }) {
  return (
    <p class="hud-dialog__note">
      <Icon name={icon} size="0.9375rem" />
      {children}
    </p>
  );
}

function HearthPanel() {
  const game = useGame();
  const w = game.sim?.state;
  const v = w ? safe('home.hearth', () => hearthView(w), null) : null;
  if (!v) return <Note>{ht('home.unavailable')}</Note>;
  const buy = (r: HearthRowView) => void game.home({ action: 'hearthBuy', upgradeId: r.id });
  return (
    <div class="hud-home">
      <div class="hud-home__stats">
        <span class="ui-badge ui-badge--info">{ht('home.hearth.essence', { n: v.essence })}</span>
        <span class={`ui-badge ${v.powered ? 'ui-badge--good' : 'ui-badge--warn'}`}>{v.powered ? ht('home.hearth.warm') : ht('home.hearth.cold')}</span>
      </div>
      {!v.powered && <Note icon="plugOff">{ht('home.hearth.coldNote')}</Note>}
      <p class="hud-home__lede">{ht('home.hearth.lede')}</p>
      <h3 class="hud-home__h">{ht('home.hearth.upgrades')}</h3>
      <ul class="hud-home__list">
        {v.rows.map((r) => (
          <li key={r.id} class={`hud-home__row is-${r.status}`} data-upgrade={r.id}>
            <div class="hud-home__rowmain">
              <span class="hud-home__name">{r.name}</span>
              <span class="hud-home__effect">{r.effect}</span>
              {r.note && <span class="hud-home__why">{r.note}</span>}
            </div>
            {r.status === 'owned' ? (
              <span class="hud-home__owned">
                <Icon name="check" size="0.875rem" strokeWidth={2.4} />
                {ht('home.hearth.owned')}
              </span>
            ) : (
              <Button size="sm" variant="primary" label={ht('home.hearth.buy', { cost: r.cost })} disabled={r.status !== 'buy'} onClick={() => buy(r)} />
            )}
          </li>
        ))}
      </ul>
      <h3 class="hud-home__h">{ht('home.bonuses')}</h3>
      {v.bonuses.length === 0 ? (
        <p class="hud-home__why">{v.live ? ht('home.bonuses.none') : ht('home.bonuses.inactive')}</p>
      ) : (
        <ul class="hud-home__bonuses" data-home-bonuses>
          {v.bonuses.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {v.sets.length > 0 && (
        <ul class="hud-home__sets">
          {v.sets.map((s) => (
            <li key={s.name} data-set={s.name}>
              {s.nextAt === null ? ht('home.sets.done', { name: s.name, n: s.pieces }) : ht('home.sets.progress', { name: s.name, n: s.pieces, next: s.nextAt })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WardrobePanel() {
  const game = useGame();
  const id = game.selectedAgentId;
  const w = game.sim?.state;
  const name = id && game.sim ? safe('home.wardrobe.name', () => game.sim?.summary(id)?.firstName ?? '', '') : '';
  const v = w && id ? safe('home.wardrobe', () => wardrobeView(w, id), null) : null;
  if (!id || !v) return <Note>{ht('home.pickZombie')}</Note>;
  return (
    <div class="hud-home">
      <p class="hud-home__lede">{ht('home.wardrobe.lede', { name, max: v.max, minutes: v.cooldownMinutes })}</p>
      {!BUILD_DATA_READY && <Note>{ht('home.wardrobe.noBuilds')}</Note>}
      {v.swapReadyInTicks > 0 && <Note icon="hourglass">{ht('home.wardrobe.cooldown', { minutes: v.cooldownMinutes })}</Note>}
      {v.slots.length === 0 ? (
        <p class="hud-home__why">{ht('home.wardrobe.empty', { name })}</p>
      ) : (
        <ul class="hud-home__list">
          {v.slots.map((s) => (
            <li key={s.id} class={`hud-home__row${s.active ? ' is-owned' : ''}`} data-build={s.id}>
              <div class="hud-home__rowmain">
                <span class="hud-home__name">{s.name}</span>
                {s.active && <span class="hud-home__why">{ht('home.wardrobe.on')}</span>}
              </div>
              <span class="hud-home__actions">
                <Button size="sm" variant="primary" label={ht('home.wardrobe.swap')} disabled={s.active || v.swapReadyInTicks > 0} onClick={() => void game.home({ action: 'wardrobeSwap', agentId: id, recordId: s.id })} />
                <Button size="sm" label={ht('home.wardrobe.delete')} onClick={() => void game.home({ action: 'wardrobeDelete', agentId: id, recordId: s.id })} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" icon="plus" label={ht('home.wardrobe.save')} disabled={!BUILD_DATA_READY || v.slots.length >= v.max} />
    </div>
  );
}

function EmbalmingPanel() {
  const game = useGame();
  const id = game.selectedAgentId;
  const w = game.sim?.state;
  const name = id && game.sim ? safe('home.respec.name', () => game.sim?.summary(id)?.firstName ?? '', '') : '';
  const v = w && id ? safe('home.respec', () => respecView(w, id), null) : null;
  if (!id || !v) return <Note>{ht('home.pickZombie')}</Note>;
  return (
    <div class="hud-home">
      <p class="hud-home__lede">{ht('home.embalming.lede', { name })}</p>
      {!BUILD_DATA_READY && <Note>{ht('home.embalming.noBuilds')}</Note>}
      <p class="hud-home__why">{v.note}</p>
      <Button variant="primary" label={ht('home.embalming.respec', { name })} disabled={!BUILD_DATA_READY || !v.ready} onClick={() => void game.home({ action: 'respec', agentId: id })} />
    </div>
  );
}

function VaultPanel() {
  const game = useGame();
  const w = game.sim?.state;
  const rows = w ? safe('home.vault', () => vaultView(w), []) : [];
  return (
    <div class="hud-home">
      <p class="hud-home__lede">{ht('home.vault.lede')}</p>
      <ul class="hud-home__list" data-vault>
        {rows.map((r) => (
          <li key={r.id} class="hud-home__row" data-material={r.id}>
            <div class="hud-home__rowmain">
              <span class="hud-home__name">{r.name}</span>
            </div>
            <span class="hud-home__count u-num">
              {r.count} / {r.cap}
            </span>
          </li>
        ))}
      </ul>
      <Note>{ht('home.vault.note')}</Note>
    </div>
  );
}
