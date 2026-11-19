/**
 * DEV ONLY — aliased in place of `./hud/Hud` by dev/ui-shell.vite.config.ts. Renders a lightweight HUD stand-in
 * (stable screenshots) unless `?hud=real`, in which case the real UI-HUD module is lazily loaded if present.
 */
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useGame } from '../../hooks';
import { Icon } from '../../icons';
import { IconButton } from '../../common/IconButton';
import { Portrait } from '../../common/Portrait';
import { NeedBar } from '../../common/NeedBar';
import { ToastCard } from '../../common/ToastCard';
import { moodBandColor } from '../../common/color';
import { formatMoney } from '../../common/format';
import { openRootDialog } from '../nav';
import { Portal } from '../../common/Portal';

const realHud = import.meta.glob('../../hud/Hud.tsx');

/** `?crash=overlay`: a component that throws while rendering inside a portal (dialog-layer) tree after a click. */
function OverlayBomb() {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setArmed(true), 300);
    return () => clearTimeout(id);
  }, []);
  if (armed) throw new Error('OverlayBomb: simulated crash inside a portal tree (harness ?crash=overlay)');
  return <div class="dev-bomb">arming…</div>;
}

export function Hud() {
  const params = new URLSearchParams(location.search);
  const wantReal = params.get('hud') === 'real';
  const crash = params.get('crash') === '1';
  const [Real, setReal] = useState<ComponentType | null>(null);
  useEffect(() => {
    if (!wantReal) return;
    const load = Object.values(realHud)[0];
    if (!load) return;
    load()
      .then((m) => setReal(() => (m as { Hud: ComponentType }).Hud))
      .catch((e) => console.error('[harness] real HUD failed to load', e));
  }, [wantReal]);
  if (crash) throw new Error('HudStub: simulated render crash (harness ?crash=1)');
  if (params.get('crash') === 'overlay') {
    return (
      <>
        <HudStub />
        <Portal layer="dialog">
          <OverlayBomb />
        </Portal>
      </>
    );
  }
  if (wantReal && Real) return <Real />;
  return <HudStub />;
}

function HudStub() {
  const game = useGame();
  const sim = game.sim;
  const household = sim?.household() ?? [];
  const time = sim?.time();
  const sel = household.find((h) => h.id === game.selectedAgentId) ?? household[0];
  const needs = sel && sim ? sim.needs(sel.id) : [];
  const icons: Record<string, string> = { hunger: 'hunger', energy: 'energy', preservation: 'freshness', social: 'social', fun: 'fun', hygiene: 'hygiene' };
  return (
    <div class="dev-hud">
      <div class="dev-hud__top ui-panel ui-interactive">
        <div class="dev-hud__clock">
          <Icon name="clock" size="1.125rem" />
          <span class="u-num">{time?.label ?? '—'}</span>
          <span class="u-faint">Day {time?.day ?? '—'}</span>
        </div>
        <div class="dev-hud__speeds">
          {(['pause', 'speed1', 'speed2', 'speed3', 'ultra'] as const).map((s, i) => (
            <IconButton key={s} icon={s} size="sm" label={['Pause', 'Normal speed', 'Fast', 'Faster', 'Ultra'][i]} pressed={game.speed === i} onClick={() => game.setSpeed(i as 0 | 1 | 2 | 3 | 4)} />
          ))}
        </div>
        <div class="dev-hud__funds u-num">
          <Icon name="money" size="1.125rem" />
          {formatMoney(sim?.state.household.funds ?? 0)}
        </div>
        <IconButton icon="menu" size="sm" label="Menu" hotkey="Escape" onClick={() => openRootDialog(game, 'pause')} />
      </div>
      <div class="dev-hud__family ui-panel ui-interactive">
        {household.map((h) => (
          <button key={h.id} type="button" class="dev-hud__member" onClick={() => game.selectAgent(h.id)} aria-label={h.name}>
            <Portrait appearance={h.appearance} size="3.25rem" ring={moodBandColor(h.moodBand)} alert={!!h.criticalNeed} dimmed={h.presence !== 'onLot'} />
          </button>
        ))}
      </div>
      {sel ? (
        <div class="dev-hud__panel ui-panel ui-interactive">
          <div class="dev-hud__who">
            <Portrait appearance={sel.appearance} size="3.5rem" ring={moodBandColor(sel.moodBand)} />
            <div>
              <div class="dev-hud__name">{sel.name}</div>
              <div class="u-faint u-small">{sel.activity}</div>
            </div>
          </div>
          <div class="dev-hud__needs">
            {needs.map((n) => (
              <NeedBar key={n.id} label={n.label} icon={icons[n.id]} value={n.value} cap={n.cap} trend={n.trend} critical={n.critical} compact />
            ))}
          </div>
        </div>
      ) : null}
      <div class="dev-hud__toasts">
        <ToastCard kind="money" title="Bills are due" text="$186 due Thursday 9:00 AM. The mailbox flag is up." time="Thu 9:00 AM" onDismiss={() => {}} remaining={0.6} />
      </div>
    </div>
  );
}
