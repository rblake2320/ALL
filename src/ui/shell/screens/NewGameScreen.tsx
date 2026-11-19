/**
 * New Game: choose a lot and a difficulty, then continue to Create-a-Zombie. The derelict claim (the story start, W-113)
 * comes first and is the default; the furnished Fixer-Upper (sandbox) and the Empty Plot follow.
 */
import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { CazState } from '../../../game/contracts';
import { t } from '../../../i18n';
import { useGame, useHotkey, useInitialFocus } from '../../hooks';
import { Icon } from '../../icons';
import { Button } from '../../common/Button';
import { Card } from '../../common/Card';
import { Segmented } from '../../common/Segmented';
import { Badge } from '../../common/Badge';
import { formatMoney } from '../../common/format';
import { lotInfo } from '../data';
import { StarterLotArt, EmptyLotArt, DerelictLotArt } from './LotArt';

type Lot = CazState['lotTemplate'];
type Difficulty = CazState['difficulty'];

export const NEW_GAME_LOTS: Lot[] = ['derelict', 'starter', 'empty'];
const LOTS = NEW_GAME_LOTS;
const DIFFICULTIES: Difficulty[] = ['relaxed', 'normal', 'grim'];

export function NewGameScreen() {
  const game = useGame();
  const [lot, setLot] = useState<Lot>(game.caz?.lotTemplate ?? 'derelict');
  const [difficulty, setDifficulty] = useState<Difficulty>(game.caz?.difficulty ?? 'normal');
  const lotsRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Arriving by keyboard (Enter on "New Game"): land on the selected lot so arrows work immediately.
  useInitialFocus(rootRef, '.sh-lots [role="radio"][aria-checked="true"]');

  const next = () => {
    if (!game.caz) game.beginNewGame();
    game.updateCaz({ lotTemplate: lot, difficulty });
    if (game.screen !== 'caz') game.goto('caz');
  };
  const back = () => game.goto('menu');
  useHotkey('Escape', back, { enabled: game.dialog === null });

  const onLotsKey = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const i = LOTS.indexOf(lot);
    const n = LOTS[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + LOTS.length) % LOTS.length];
    setLot(n);
    lotsRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[LOTS.indexOf(n)]?.focus();
  };

  return (
    <div class="sh-screen sh-newgame ui-interactive" ref={rootRef}>
      <div class="sh-newgame__sheet">
        <header class="sh-newgame__head">
          <div class="u-eyebrow">{t('newGame.eyebrow')}</div>
          <h1 class="sh-title">{t('newGame.title')}</h1>
          <p class="sh-subtitle">{t('newGame.subtitle')}</p>
        </header>

        <div class="sh-lots" role="radiogroup" aria-label={t('newGame.lots')} ref={lotsRef} onKeyDown={onLotsKey}>
          {LOTS.map((id) => {
            const selected = lot === id;
            const info = lotInfo(id, game.lotTemplates);
            const name = info.name ?? t(`newGame.lot.${id}.name`);
            return (
              <Card key={id} role="radio" selected={selected} onClick={() => setLot(id)} class={`sh-lot sh-lot--${id}`} tabIndex={selected ? 0 : -1} aria-label={name} dataset={{ lot: id }}>
                <div class="sh-lot__art">{id === 'starter' ? <StarterLotArt /> : id === 'derelict' ? <DerelictLotArt /> : <EmptyLotArt />}</div>
                <div class="sh-lot__body">
                  <div class="sh-lot__titlerow">
                    <h2 class="sh-lot__name">{name}</h2>
                    <Badge tone={id === 'derelict' ? 'accent' : id === 'starter' ? 'neutral' : 'warm'} caps class="sh-lot__tag">
                      {t(`newGame.lot.${id}.tag`)}
                    </Badge>
                  </div>
                  <p class="sh-lot__desc">{info.description ?? t(`newGame.lot.${id}.desc`)}</p>
                  <ul class="sh-lot__features">
                    {[1, 2, 3].map((k) => (
                      <li key={k}>
                        <Icon name="check" size="0.9375rem" />
                        <span>{t(`newGame.lot.${id}.f${k}`)}</span>
                      </li>
                    ))}
                  </ul>
                  <div class="sh-lot__funds">
                    <span class="sh-lot__fundslabel">{t('newGame.funds')}</span>
                    <span class="sh-lot__fundsvalue u-num">{formatMoney(info.startingFunds)}</span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
        <p class="sh-newgame__bonus">
          <Icon name="money" size="1rem" />
          {t('newGame.fundsBonus')}
        </p>

        <section class="sh-difficulty" aria-labelledby="ng-diff-label">
          <div class="sh-difficulty__row">
            <h2 class="sh-difficulty__label" id="ng-diff-label">
              {t('newGame.difficulty')}
            </h2>
            <Segmented
              value={difficulty}
              onChange={setDifficulty}
              labelledBy="ng-diff-label"
              describedBy="ng-diff-desc"
              size="lg"
              options={DIFFICULTIES.map((d) => ({
                value: d,
                label: t(`newGame.difficulty.${d}`),
                icon: d === 'relaxed' ? 'coffee' : d === 'normal' ? 'coffin' : 'skull',
              }))}
            />
          </div>
          <p class="sh-difficulty__desc" id="ng-diff-desc" aria-live="polite" key={difficulty}>
            {t(`newGame.difficulty.${difficulty}.desc`)}
          </p>
        </section>

        <footer class="sh-newgame__foot">
          <Button variant="ghost" icon="chevronLeft" onClick={back} hotkey="Escape">
            {t('newGame.back')}
          </Button>
          <Button variant="primary" size="lg" iconRight="chevronRight" onClick={next}>
            {t('newGame.next')}
          </Button>
        </footer>
      </div>
    </div>
  );
}
