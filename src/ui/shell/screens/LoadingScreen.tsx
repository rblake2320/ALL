/** Boot / loading screen: emblem, wordmark, stitched progress bar, live label and rotating tips. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { t } from '../../../i18n';
import { useGame } from '../../hooks';
import { ProgressBar } from '../../common/ProgressBar';
import { Ornament } from '../../common/Divider';
import { Icon } from '../../icons';
import { Emblem, Wordmark } from '../Brand';
import { LOADING_TIP_COUNT } from '../data';

const TIP_MS = 6500;

/** Next tip index (never repeats the current one when more than one tip exists). */
export function nextTipIndex(current: number, count: number, rand: number): number {
  const n = Math.max(1, Math.floor(count));
  if (n === 1) return 0;
  const r = Number.isFinite(rand) ? Math.min(0.999999, Math.max(0, rand)) : 0;
  const step = 1 + Math.floor(r * (n - 1));
  const cur = Number.isFinite(current) ? ((Math.floor(current) % n) + n) % n : 0;
  return (cur + step) % n;
}

export function LoadingScreen() {
  const game = useGame();
  const initial = useMemo(() => Math.floor(Math.random() * LOADING_TIP_COUNT), []);
  const [tip, setTip] = useState(initial);
  useEffect(() => {
    const id = setInterval(() => setTip((c) => nextTipIndex(c, LOADING_TIP_COUNT, Math.random())), TIP_MS);
    return () => clearInterval(id);
  }, []);

  const raw = game.loadingProgress;
  const progress = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
  const pct = Math.round(progress * 100);
  const label = game.loadingLabel?.trim() || t('loading.default');

  return (
    <div class="sh-screen sh-loading ui-interactive" role="main" aria-busy="true">
      <div class="sh-loading__fog" aria-hidden="true" />
      <div class="sh-loading__center">
        <Emblem size="5.5rem" class="sh-loading__emblem" />
        <Wordmark size="md" />
        <div class="sh-loading__progress">
          <ProgressBar value={progress} stitched label={t('loading.title')} valueText={`${pct}% — ${label}`} />
          <div class="sh-loading__meta">
            <span class="sh-loading__label" aria-live="polite">
              {label}
            </span>
            <span class="sh-loading__pct u-num">{t('loading.percent', { pct })}</span>
          </div>
        </div>
        <div class="sh-loading__tip" aria-live="polite">
          <div class="sh-loading__tiphead">
            <Icon name="candle" size="1rem" />
            <span class="u-eyebrow">{t('loading.tipLabel')}</span>
          </div>
          <p class="sh-loading__tiptext" key={tip}>
            {t(`loading.tip.${tip + 1}`)}
          </p>
          <Ornament width={56} class="sh-loading__orn" />
        </div>
      </div>
    </div>
  );
}
