/**
 * Main menu: left column (animated wordmark, tagline, menu, version footer); the right side stays transparent
 * so the renderer's 3D diorama shows through. ↑/↓ move between items.
 */
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { SaveSlotInfo } from '../../../persistence/contracts';
import { t } from '../../../i18n';
import { useGame, useHotkey } from '../../hooks';
import { Icon, type IconName } from '../../icons';
import { Ornament } from '../../common/Divider';
import { cx } from '../../common/cx';
import { Spinner } from '../../common/Spinner';
import { formatNumber } from '../../common/format';
import { Wordmark } from '../Brand';
import { openRootDialog } from '../nav';
import { APP_VERSION } from '../version';

/** Most recent save (by savedAt, falling back to list order); null for empty/garbage lists. */
export function latestSave(slots: readonly SaveSlotInfo[] | null | undefined): SaveSlotInfo | null {
  if (!Array.isArray(slots) || slots.length === 0) return null;
  let best: SaveSlotInfo | null = null;
  let bestT = -Infinity;
  for (const s of slots) {
    if (!s || typeof s !== 'object') continue;
    const ms = Date.parse(s.savedAt);
    const tt = Number.isFinite(ms) ? ms : -1;
    if (best === null || tt > bestT) {
      best = s;
      bestT = tt;
    }
  }
  return best;
}

interface ItemProps {
  icon: IconName;
  label: string;
  detail?: string | null;
  disabled?: boolean;
  busy?: boolean;
  primary?: boolean;
  /** Set on on/off items (W-150 music): rendered as aria-pressed. */
  pressed?: boolean;
  testId?: string;
  onClick: () => void;
}

function MenuItem({ icon, label, detail, disabled, busy, primary, pressed, testId, onClick }: ItemProps) {
  return (
    <li>
      <button type="button" class={cx('sh-menu__item', primary && 'is-primary')} disabled={disabled || busy} onClick={onClick} aria-busy={busy ? 'true' : undefined} aria-pressed={pressed === undefined ? undefined : pressed ? 'true' : 'false'} data-testid={testId}>
        <span class="sh-menu__glyph" aria-hidden="true">
          {busy ? <Spinner size="1.125rem" /> : <Icon name={icon} size="1.125rem" />}
        </span>
        <span class="sh-menu__text">
          <span class="sh-menu__label">{label}</span>
          {detail ? <span class="sh-menu__detail">{detail}</span> : null}
        </span>
        <span class="sh-menu__flame" aria-hidden="true">
          <Icon name="chevronRight" size="1rem" />
        </span>
      </button>
    </li>
  );
}

export function MainMenu() {
  const game = useGame();
  const [slots, setSlots] = useState<SaveSlotInfo[] | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navRef = useRef<HTMLUListElement>(null);
  const dialogOpen = game.dialog !== null;

  // (Re)load the save list on mount and whenever a dialog closes (saves may have been deleted/imported).
  useEffect(() => {
    if (dialogOpen) return;
    let alive = true;
    game
      .listSaves()
      .then((list) => alive && setSlots(Array.isArray(list) ? list : []))
      .catch(() => alive && setSlots([]));
    return () => {
      alive = false;
    };
  }, [game, dialogOpen]);

  const latest = latestSave(slots);
  const latestDay = latest?.meta?.day;
  const continueDetail =
    slots === null
      ? null
      : latest
        ? t('menu.continueDetail', {
            household: (latest.meta?.householdName || latest.name || '').trim() || t('common.unknown'),
            day: typeof latestDay === 'number' && Number.isFinite(latestDay) ? formatNumber(Math.floor(latestDay)) : '?',
          })
        : t('menu.continueNone');

  const onContinue = async () => {
    setError(null);
    setContinuing(true);
    try {
      const ok = await game.continueLatest();
      if (!ok) setError(t('menu.continueFailed'));
    } catch {
      setError(t('menu.continueFailed'));
    } finally {
      setContinuing(false);
    }
  };

  const onNavKey = (e: JSX.TargetedKeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(navRef.current?.querySelectorAll<HTMLButtonElement>('.sh-menu__item:not(:disabled)') ?? []);
    if (items.length === 0) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[i < 0 ? 0 : next].focus();
  };

  // Keyboard players: ↑/↓ from anywhere (nothing focused) jump into the menu.
  useHotkey(['ArrowDown', 'ArrowUp'], () => {
    const active = document.activeElement;
    if (active && active !== document.body && navRef.current?.contains(active)) return;
    navRef.current?.querySelector<HTMLButtonElement>('.sh-menu__item:not(:disabled)')?.focus();
  }, { enabled: !dialogOpen });

  // W-150: music is off until the player turns it on; this is the first place they can
  let musicOn = false;
  try {
    musicOn = game.settings.musicEnabled === true;
  } catch {
    musicOn = false;
  }

  return (
    <div class="sh-screen sh-menu">
      <div class="sh-menu__column ui-interactive">
        <div class="sh-menu__brand">
          <Wordmark animated />
          <p class="sh-menu__tagline">{t('app.tagline')}</p>
          <Ornament width={64} class="sh-menu__orn" />
        </div>
        <nav aria-label={t('menu.nav')}>
          <ul class="sh-menu__list" ref={navRef} onKeyDown={onNavKey}>
            <MenuItem icon="play" primary={!!latest} label={t('menu.continue')} detail={continueDetail} disabled={slots === null || !latest} busy={continuing} onClick={onContinue} />
            <MenuItem icon="coffin" primary={slots !== null && !latest} label={t('menu.newGame')} detail={t('menu.newGameDetail')} onClick={() => game.goto('newGame')} />
            <MenuItem icon="load" label={t('menu.loadGame')} disabled={slots !== null && slots.length === 0} onClick={() => openRootDialog(game, 'saveLoad', { saveLoadMode: 'load' })} />
            <MenuItem icon="settings" label={t('menu.settings')} onClick={() => openRootDialog(game, 'settings')} />
            <MenuItem
              icon="music"
              label={t(musicOn ? 'menu.musicOn' : 'menu.musicOff')}
              detail={musicOn ? undefined : t('menu.musicDetail')}
              pressed={musicOn}
              testId="menu-music"
              onClick={() => game.updateSettings({ musicEnabled: !musicOn })}
            />
            {game.economy ? <MenuItem icon="buy" label={t('menu.store')} detail={t('menu.storeDetail')} onClick={() => { game.economy?.focusStore('featured', null, 'menu'); openRootDialog(game, 'store'); }} /> : null}
            <MenuItem icon="book" label={t('menu.credits')} onClick={() => openRootDialog(game, 'credits')} />
            {game.canQuitApp ? <MenuItem icon="quit" label={t('menu.quit')} onClick={() => openRootDialog(game, 'confirmQuit')} /> : null}
          </ul>
        </nav>
        {error ? (
          <p class="sh-menu__error" role="alert">
            <Icon name="warning" size="1rem" />
            {error}
          </p>
        ) : null}
        <footer class="sh-menu__footer">
          <span class="u-num">{t('app.version', { version: game.appVersion || APP_VERSION })}</span>
          <span class="sh-menu__dot" aria-hidden="true">
            ·
          </span>
          <span>{t('menu.footer')}</span>
        </footer>
      </div>
    </div>
  );
}
