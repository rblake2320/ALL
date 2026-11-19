/** "Rest in Pieces": game-over summary with the household's final stats, Load last save / Main menu. */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameController } from '../../../game/contracts';
import { t } from '../../../i18n';
import { useGame, useInitialFocus } from '../../hooks';
import { Icon, type IconName } from '../../icons';
import { Button } from '../../common/Button';
import { Ornament } from '../../common/Divider';
import { Portrait } from '../../common/Portrait';
import { Truncate } from '../../common/Truncate';
import { formatMoney, formatNumber } from '../../common/format';

/** Portraits shown on the headstone row; the rest collapse into a "+N" chip. */
export const GAME_OVER_MAX_MEMBERS = 8;

export interface GameOverSummary {
  household: string | null;
  day: number | null;
  funds: number | null;
  /** Every household member (render at most GAME_OVER_MAX_MEMBERS). */
  members: { id: string; name: string; firstName: string; appearance: unknown }[];
  stats: { key: string; icon: IconName; value: number }[];
}

/** Reads what it can from the (possibly half-broken) simulation. Never throws. */
export function gameOverSummary(game: Pick<GameController, 'sim'>): GameOverSummary {
  const out: GameOverSummary = { household: null, day: null, funds: null, members: [], stats: [] };
  const sim = game.sim;
  if (!sim) return out;
  try {
    const hh = sim.state?.household;
    if (hh && typeof hh.name === 'string' && hh.name.trim()) out.household = hh.name.trim();
    if (hh && Number.isFinite(hh.funds)) out.funds = hh.funds;
  } catch {
    /* ignore */
  }
  try {
    const d = sim.time()?.day;
    if (Number.isFinite(d)) out.day = d;
  } catch {
    /* ignore */
  }
  try {
    const list = sim.household();
    const seen = new Set<string>();
    out.members = (Array.isArray(list) ? list : [])
      .filter((a) => a && typeof a === 'object' && typeof a.id === 'string' && !seen.has(a.id) && (seen.add(a.id), true))
      .map((a) => {
        const name = typeof a.name === 'string' && a.name.trim() ? a.name.trim() : t('caz.unnamed');
        const first = typeof a.firstName === 'string' && a.firstName.trim() ? a.firstName.trim() : name.split(/\s+/)[0] || name;
        return { id: a.id, name, firstName: first, appearance: a.appearance };
      });
  } catch {
    /* ignore */
  }
  try {
    const c = sim.state?.stats?.counters ?? {};
    const pick: { key: string; icon: IconName }[] = [
      { key: 'limbsLost', icon: 'limb' },
      { key: 'mealsCooked', icon: 'plate' },
      { key: 'partiesThrown', icon: 'party' },
      { key: 'billsPaid', icon: 'bills' },
    ];
    out.stats = pick.map((p) => ({ ...p, value: Number.isFinite(c[p.key]) ? c[p.key] : 0 }));
  } catch {
    /* ignore */
  }
  return out;
}

export function GameOverScreen() {
  const game = useGame();
  const [summary] = useState(() => gameOverSummary(game));
  const rootRef = useRef<HTMLDivElement>(null);
  useInitialFocus(rootRef);
  const shown = summary.members.slice(0, GAME_OVER_MAX_MEMBERS);
  const hidden = summary.members.length - shown.length;
  const [hasSave, setHasSave] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    game
      .listSaves()
      .then((l) => alive && setHasSave(Array.isArray(l) && l.length > 0))
      .catch(() => alive && setHasSave(false));
    return () => {
      alive = false;
    };
  }, [game]);

  const loadLast = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const ok = await game.continueLatest();
      if (!ok) setMsg(t('gameOver.noSave'));
    } catch {
      setMsg(t('gameOver.noSave'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="sh-screen sh-gameover ui-interactive" role="main" ref={rootRef}>
      <div class="sh-gameover__card">
        <div class="sh-gameover__stone" aria-hidden="true">
          <Icon name="tombstone" size="3.5rem" strokeWidth={1.4} />
        </div>
        <div class="u-eyebrow">{t('gameOver.eyebrow')}</div>
        <h1 class="sh-gameover__title">{t('gameOver.title')}</h1>
        <p class="sh-gameover__sub">{summary.household ? t('gameOver.subtitle', { household: summary.household }) : t('gameOver.subtitleUnknown')}</p>
        {game.gameOverReason && game.gameOverReason.trim() && game.gameOverReason.trim() !== t('gameOver.title') ? <p class="sh-gameover__reason">{game.gameOverReason.trim()}</p> : null}
        {shown.length ? (
          <ul class="sh-gameover__members" aria-label={t('gameOver.members')}>
            {shown.map((m) => (
              <li key={m.id}>
                <Portrait appearance={m.appearance as never} size="3rem" ring={null} dimmed name={m.name} />
                <Truncate text={m.firstName} />
              </li>
            ))}
            {hidden > 0 ? (
              <li>
                <span class="sh-gameover__more" role="img" aria-label={t('gameOver.moreMembers', { count: hidden })}>
                  +{formatNumber(hidden)}
                </span>
              </li>
            ) : null}
          </ul>
        ) : null}
        <Ornament width={60} class="sh-gameover__orn" />
        <dl class="sh-gameover__stats">
          <div>
            <dt>
              <Icon name="moon" size="0.875rem" />
              {t('gameOver.days')}
            </dt>
            <dd class="u-num">{summary.day !== null ? formatNumber(summary.day) : '—'}</dd>
          </div>
          <div>
            <dt>
              <Icon name="money" size="0.875rem" />
              {t('gameOver.funds')}
            </dt>
            <dd class="u-num">{summary.funds !== null ? formatMoney(summary.funds) : '—'}</dd>
          </div>
          {summary.stats.map((s) => (
            <div key={s.key}>
              <dt>
                <Icon name={s.icon} size="0.875rem" />
                {t(`gameOver.${s.key}`)}
              </dt>
              <dd class="u-num">{formatNumber(s.value)}</dd>
            </div>
          ))}
        </dl>
        <p class="sh-gameover__epitaph">{t('gameOver.epitaph')}</p>
        {msg ? (
          <p class="sh-gameover__msg" role="alert">
            {msg}
          </p>
        ) : null}
        <div class="sh-gameover__actions">
          <Button variant="secondary" icon="house" onClick={() => void game.quitToMenu()}>
            {t('gameOver.mainMenu')}
          </Button>
          <Button variant="primary" icon="load" onClick={loadLast} loading={busy} disabled={hasSave === false} data-autofocus>
            {t('gameOver.loadLast')}
          </Button>
        </div>
      </div>
    </div>
  );
}
