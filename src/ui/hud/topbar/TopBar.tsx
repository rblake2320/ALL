/**
 * Top bar: household plaque (name, animated funds with floaters, bills badge), clock (day/night dial, full moon,
 * speed controls) and the right cluster (mode switch, wall view, camera, save indicator, notices, menu).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { GameController } from '../../../game/contracts';
import type { Speed } from '../../../sim/types';
import type { Perspective, WallMode, ViewMode } from '../../../render/contracts';
import { formatMoney, formatSignedMoney, num, tweenInt } from '../lib/format';
import { safe } from '../lib/safe';
import { hudStore, useHudStore } from '../lib/store';
import { Badge, IconButton, Segmented } from '../parts/controls';
import { useEscape, useGame, useOutsidePointer, useRafLoop, useReducedMotion } from '../parts/hooks';
import { Icon, type HudIconName } from '../parts/icons';
import { tip } from '../parts/tooltip';
import { ht } from '../strings';
import type { KeyAction } from '../lib/keys';
import { SoundMenu } from './SoundMenu';
import './topbar.css';

export type Tier = 'normal' | 'compact' | 'tight';

export function TopBar({ tier, phone = false }: { tier: Tier; phone?: boolean }) {
  const game = useGame();
  const bar = useRef<HTMLDivElement>(null);
  // Publish the clock's centre so the party meter / choice letters line up under it even when it slides over.
  useLayoutEffect(() => {
    const el = bar.current;
    const clock = el?.querySelector<HTMLElement>('.hud-clock');
    const hud = el?.closest<HTMLElement>('.hud');
    if (!el || !clock || !hud) return;
    const publish = () => {
      const r = clock.getBoundingClientRect();
      const h = hud.getBoundingClientRect();
      if (r.width > 0) hud.style.setProperty('--hud-clock-cx', `${Math.round(r.left + r.width / 2 - h.left)}px`);
    };
    publish();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    ro?.observe(el);
    ro?.observe(clock);
    window.addEventListener('resize', publish);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', publish);
    };
  }, [tier, phone]);
  // Phone: publish the bar's bottom edge (it wraps to two rows in portrait) for the panels laid out under it —
  // the household portraits and the economy HUD (outside .hud).
  useLayoutEffect(() => {
    const el = bar.current;
    const html = typeof document !== 'undefined' ? document.documentElement : null;
    if (!phone || !el || !html) return undefined;
    const publish = () => html.style.setProperty('--hud-topbar-b', `${Math.round(el.getBoundingClientRect().bottom)}px`);
    publish();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    ro?.observe(el);
    window.addEventListener('resize', publish);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', publish);
      html.style.removeProperty('--hud-topbar-b');
    };
  }, [phone]);
  if (phone) {
    return (
      <div ref={bar} class="hud-topbar hud-topbar--phone" data-tier={tier} data-hud-region="10">
        <PhoneTopBar game={game} />
        <PerspectiveAnnouncer game={game} />
      </div>
    );
  }
  return (
    <div ref={bar} class="hud-topbar" data-tier={tier} data-hud-region="10">
      <HouseholdPlaque game={game} tier={tier} />
      <ClockCluster game={game} tier={tier} />
      <RightCluster game={game} tier={tier} />
      <PerspectiveAnnouncer game={game} />
    </div>
  );
}

// ───────────────────────────── household plaque ─────────────────────────────

function billSummary(game: GameController) {
  const b = safe('bills', () => game.sim?.bills() ?? null, null);
  if (!b) return { count: 0, amount: 0, overdueCount: 0, overdueAmount: 0, nextDue: null as string | null, power: true };
  const unpaid = (b.bills ?? []).filter((x) => x && !x.paid);
  const overdue = unpaid.filter((x) => x.overdue);
  const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + num(x.amount), 0);
  return {
    count: unpaid.length,
    amount: unpaid.length ? sum(unpaid) : num(b.outstanding),
    overdueCount: overdue.length,
    overdueAmount: overdue.length ? sum(overdue) : num(b.overdue),
    nextDue: b.nextDueLabel ?? null,
    power: b.utilitiesOn !== false,
  };
}

function HouseholdPlaque({ game, tier }: { game: GameController; tier: Tier }) {
  const name = safe('household.name', () => game.sim?.state.household.name ?? '', '');
  const funds = safe('household.funds', () => game.sim?.state.household.funds ?? 0, 0);
  const bills = billSummary(game);
  const billsTone = bills.overdueCount > 0 || !bills.power ? 'danger' : bills.count > 0 ? 'warm' : null;
  const billsBody = [
    bills.count === 0 ? ht('top.bills.none') : bills.overdueCount > 0 ? ht('top.bills.overdue', { count: bills.overdueCount, amount: formatMoney(bills.overdueAmount) }) : ht('top.bills.outstanding', { count: bills.count, amount: formatMoney(bills.amount) }),
    bills.nextDue ? ht('top.bills.nextDue', { when: bills.nextDue }) : '',
    !bills.power ? ht('top.bills.power') : '',
    ht('top.bills.open'),
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <div class="hud-plaque ui-panel ui-interactive" data-hint-anchor="household-plaque funds plaque">
      <button
        type="button"
        class="hud-plaque__name u-display u-ellipsis"
        onClick={() => {
          game.playUi('uiOpen');
          game.openDialog('household');
        }}
        {...tip({ title: name || ht('household.title'), body: `${ht('household.title')} · ${ht('top.bills.open')}`, place: 'bottom' })}
      >
        {name || '—'}
      </button>
      <div class="hud-plaque__row">
        <Funds value={funds} game={game} epoch={game.sim} />
        <button
          type="button"
          class={`hud-bills${billsTone ? ` is-${billsTone}` : ''}`}
          aria-label={`${ht('top.bills')}: ${bills.count === 0 ? ht('top.bills.none') : formatMoney(bills.amount)}`}
          data-hint-anchor="bills"
          onClick={() => {
            game.playUi('uiOpen');
            game.openDialog('household');
          }}
          {...tip({ title: ht('top.bills'), body: billsBody, place: 'bottom', tone: billsTone === 'danger' ? 'bad' : billsTone === 'warm' ? 'warm' : null })}
        >
          <Icon name={bills.power ? 'mail' : 'plugOff'} size="1.0625rem" />
          {bills.count > 0 && tier !== 'tight' && <span class="hud-bills__amt u-num">{formatMoney(bills.overdueCount ? bills.overdueAmount : bills.amount, { compact: true })}</span>}
          {bills.count > 0 && <span class="hud-bills__count u-num">{bills.count}</span>}
        </button>
      </div>
    </div>
  );
}

let floaterSeq = 0;

/** Funds with a count-up tween and +/− floaters (reduced motion: instant value, static floaters). */
function Funds({ value, game, epoch }: { value: number; game: GameController; epoch: unknown }) {
  const reduce = useReducedMotion(game);
  const amountRef = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  const anim = useRef<{ from: number; to: number; start: number } | null>(null);
  const last = useRef(value);
  const [floaters, setFloaters] = useState<{ id: number; delta: number }[]>([]);
  const [animating, setAnimating] = useState(false);
  const world = useRef(epoch);
  const floaterTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(
    () => () => {
      for (const t of floaterTimers.current) clearTimeout(t);
      floaterTimers.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (world.current !== epoch) {
      // A different save/world: jump straight to the new balance — no floater, no tween.
      world.current = epoch;
      last.current = value;
      shown.current = value;
      anim.current = null;
      setAnimating(false);
      if (amountRef.current) amountRef.current.textContent = formatMoney(value);
      return;
    }
    const prev = last.current;
    if (value === prev || !Number.isFinite(value)) return;
    last.current = value;
    const delta = value - prev;
    const id = ++floaterSeq;
    setFloaters((f) => [...f.slice(-2), { id, delta }]);
    const t = setTimeout(() => {
      floaterTimers.current.delete(t);
      setFloaters((f) => f.filter((x) => x.id !== id));
    }, 1900);
    floaterTimers.current.add(t);
    if (reduce) {
      shown.current = value;
      if (amountRef.current) amountRef.current.textContent = formatMoney(value);
      return;
    }
    anim.current = { from: shown.current, to: value, start: performance.now() };
    setAnimating(true);
  }, [value, epoch]);

  useRafLoop((_, now) => {
    const a = anim.current;
    if (!a) return;
    const dur = Math.min(900, 380 + Math.log10(1 + Math.abs(a.to - a.from)) * 120);
    const t = (now - a.start) / dur;
    const v = t >= 1 ? a.to : tweenInt(a.from, a.to, t);
    shown.current = v;
    if (amountRef.current) amountRef.current.textContent = formatMoney(v);
    if (t >= 1) {
      anim.current = null;
      setAnimating(false);
    }
  }, animating);

  return (
    <div class="hud-funds" {...tip({ title: ht('top.funds'), body: `${formatMoney(value)}\n${ht('top.funds.body')}`, place: 'bottom' })} tabIndex={0} role="status" aria-label={`${ht('top.funds')}: ${formatMoney(value)}`}>
      <span class="hud-funds__coin" aria-hidden="true">
        <Icon name="money" size="1.125rem" />
      </span>
      <span ref={amountRef} class="hud-funds__amount u-num">
        {formatMoney(animating ? shown.current : value)}
      </span>
      <span class="hud-funds__floaters" aria-hidden="true">
        {floaters.map((f) => (
          <span key={f.id} class={`hud-floater ${f.delta >= 0 ? 'is-gain' : 'is-loss'}${reduce ? ' is-static' : ''}`}>
            {formatSignedMoney(f.delta)}
          </span>
        ))}
      </span>
    </div>
  );
}

// ───────────────────────────── clock + speed ─────────────────────────────

function ClockCluster({ game, tier }: { game: GameController; tier: Tier }) {
  const time = safe('time', () => game.sim?.time() ?? null, null);
  const paused = game.speed === 0;
  const night = !!time?.isNight;
  const moon = !!time?.fullMoon;
  return (
    <div class={`hud-clock ui-panel ui-interactive${paused ? ' is-paused' : ''}${night ? ' is-night' : ''}${moon ? ' is-moon' : ''}`} data-hint-anchor="clock speed speed-controls">
      <ClockTime game={game} tier={tier} />
      <SpeedControls game={game} />
    </div>
  );
}

/** Clock face + labels; the phone top bar shows it without the dial in its own pill. */
function ClockTime({ game, tier, dial = true }: { game: GameController; tier: Tier; dial?: boolean }) {
  const time = safe('time', () => game.sim?.time() ?? null, null);
  const paused = game.speed === 0;
  const night = !!time?.isNight;
  const moon = !!time?.fullMoon;
  const minute = num(time?.minuteOfDay, 540);
  // 24h dial: midnight at the bottom, noon at the top.
  const angle = (minute / 1440) * 360 + 180;
  const rad = (angle * Math.PI) / 180;
  const mx = 20 + Math.sin(rad) * 15.5;
  const my = 20 - Math.cos(rad) * 15.5;
  const day = num(time?.day, 1);
  const label = time?.label ?? '—';
  return (
    <div
      class="hud-clock__time"
      tabIndex={0}
      role="timer"
      aria-label={`${label}, ${ht('top.day', { day })}${paused ? `, ${ht('top.paused')}` : ''}`}
      {...tip({
        title: `${label} · ${ht('top.day', { day })}`,
        body: [ht('top.clock.body', { day, weekday: time?.weekdayName ?? '' }), moon ? `${ht('top.fullMoon')}: ${ht('top.fullMoon.body')}` : ''].filter(Boolean).join('\n'),
        place: 'bottom',
      })}
    >
      {dial && (
        <svg class="hud-dial" viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="15.5" class="hud-dial__track" />
          {/* night arc 20:00 → 06:00 (bottom half, slightly wider) */}
          <path d={arcPath(20, 20, 15.5, (1200 / 1440) * 360 + 180, (360 / 1440) * 360 + 180 + 360)} class="hud-dial__night" />
          <circle cx={mx} cy={my} r="3.2" class="hud-dial__hand" />
          <g transform="translate(11.5 11.5) scale(0.7083)" class="hud-dial__glyph">
            <Icon name={moon ? 'fullMoon' : night ? 'moon' : 'sun'} size="24" />
          </g>
        </svg>
      )}
      <div class="hud-clock__labels">
        <span class="hud-clock__label u-num">{label}</span>
        {(tier === 'normal' || paused) && (
          <span class="hud-clock__day">
            {paused ? <span class="hud-clock__paused">{ht('top.paused')}</span> : ht('top.day', { day })}
            {moon && tier === 'normal' && (
              <span class="hud-moonbadge">
                <Icon name="fullMoon" size="0.75rem" />
                {ht('top.fullMoon')}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => {
    const rad = (a * Math.PI) / 180;
    return [cx + Math.sin(rad) * r, cy - Math.cos(rad) * r];
  };
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = Math.abs(a1 - a0) % 360 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Ultra speed (GDD §2) — the controller's verdict (GameController.ultraAllowed); derived locally only if absent. */
/** Notices button name: the unread count is part of it (the red badge is only its visual echo). */
export function noticesLabel(unread: number): string {
  const n = Number.isFinite(unread) ? Math.max(0, Math.floor(unread)) : 0;
  return n > 0 ? `${ht('log.open')}, ${ht('log.unread', { count: n })}` : ht('log.open');
}

export function ultraAllowed(game: GameController): boolean {
  if (game.speed === 4) return true;
  if (typeof game.ultraAllowed === 'boolean') return game.ultraAllowed;
  const sim = game.sim;
  if (!sim) return false;
  const members = safe('ultra.household', () => sim.household(), []);
  for (const m of members) {
    if (m.presence !== 'onLot') continue;
    const ag = safe('ultra.agent', () => sim.agent(m.id), undefined);
    const asleep = ag?.anim === 'sleep' || !!ag?.status?.passedOut || m.activityIcon === 'zzz';
    if (!asleep) return false;
  }
  return true;
}

const SPEEDS: { speed: Speed; icon: HudIconName; key: KeyAction }[] = [
  { speed: 0, icon: 'pause', key: 'pause' },
  { speed: 1, icon: 'speed1', key: 'speed1' },
  { speed: 2, icon: 'speed2', key: 'speed2' },
  { speed: 3, icon: 'speed3', key: 'speed3' },
  { speed: 4, icon: 'speed4', key: 'speedUltra' },
];

function SpeedControls({ game }: { game: GameController }) {
  const ultra = ultraAllowed(game);
  const ref = useRef<HTMLDivElement>(null);
  const pick = (s: Speed) => {
    if (s === 0 && game.speed === 0) game.togglePause();
    else if (s !== game.speed) game.setSpeed(s);
    game.playUi('speedChange');
  };
  const onKey = (e: KeyboardEvent) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    const allowed = SPEEDS.filter((s) => s.speed !== 4 || ultra).map((s) => s.speed);
    const i = Math.max(0, allowed.indexOf(game.speed));
    const next = allowed[(i + dir + allowed.length) % allowed.length];
    pick(next);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  };
  return (
    <div ref={ref} class="hud-speed" role="radiogroup" aria-label={ht('speed.group')} onKeyDown={onKey}>
      {SPEEDS.map((s) => {
        const active = game.speed === s.speed;
        const disabled = s.speed === 4 && !ultra;
        return (
          <button
            type="button"
            role="radio"
            key={s.speed}
            aria-checked={active ? 'true' : 'false'}
            aria-label={ht(`speed.${s.speed}`)}
            aria-disabled={disabled ? 'true' : undefined}
            tabIndex={active ? 0 : -1}
            class={`hud-speed__btn${active ? ' is-active' : ''}${disabled ? ' is-locked' : ''}${s.speed === 0 ? ' is-pause' : ''}`}
            onClick={() => (disabled ? game.playUi('uiError') : pick(s.speed))}
            {...tip({ title: ht(`speed.${s.speed}`), keys: s.key, body: disabled ? ht('speed.ultra.locked') : null, place: 'bottom', tone: disabled ? 'warm' : null })}
          >
            <Icon name={s.icon} size={s.speed === 0 ? '0.95rem' : '1.05rem'} />
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────────── right cluster ─────────────────────────────

const MODES: { mode: ViewMode; icon: HudIconName; key: KeyAction }[] = [
  { mode: 'live', icon: 'live', key: 'modeLive' },
  { mode: 'buy', icon: 'buy', key: 'modeBuy' },
  { mode: 'build', icon: 'build', key: 'modeBuild' },
];

const PERSPECTIVE_ICON: Record<Perspective, HudIconName> = { overview: 'viewOverview', shoulder: 'viewShoulder', firstPerson: 'viewFirstPerson' };

const PERSPECTIVE_ORDER: readonly Perspective[] = ['overview', 'shoulder', 'firstPerson'];

/**
 * W-136: one button that steps the view down to the selected zombie and back (overview → shoulder → first person).
 * Its name carries the current view. (On a phone the three views are a row of the More menu instead.)
 */
function PerspectiveButton({ game }: { game: GameController }) {
  const view: Perspective = safe('perspective', () => game.perspective, 'overview');
  const live = game.mode === 'live';
  const name = ht('persp.now', { name: ht(`persp.${view}`) });
  return (
    <IconButton
      icon={PERSPECTIVE_ICON[view] ?? 'viewOverview'}
      label={name}
      size="sm"
      pressed={view !== 'overview'}
      disabled={!live}
      data-testid="perspective"
      data-perspective={view}
      data-hint-anchor="perspective"
      onClick={() => game.cyclePerspective()}
      tipSpec={{ title: name, body: ht(live ? 'persp.body' : 'persp.body.locked'), keys: 'perspective', place: 'bottom' }}
    />
  );
}

/**
 * W-136: a polite live region that says the view after every change — the button, the `V` key, Esc, the More menu
 * and the game returning to the overview by itself (Buy / Build, the zombie leaving). Silent until the first change.
 */
function PerspectiveAnnouncer({ game }: { game: GameController }) {
  const view: Perspective = safe('perspective', () => game.perspective, 'overview');
  const first = useRef(view);
  const [said, setSaid] = useState('');
  useEffect(() => {
    if (first.current === view) return;
    first.current = view;
    setSaid(ht('persp.now', { name: ht(`persp.${view}`) }));
  }, [view]);
  return (
    <span class="u-sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="perspective-live">
      {said}
    </span>
  );
}

const WALLS: { mode: WallMode; icon: HudIconName }[] = [
  { mode: 'up', icon: 'wallUp' },
  { mode: 'cutaway', icon: 'wallCutaway' },
  { mode: 'down', icon: 'wallDown' },
];

function RightCluster({ game, tier }: { game: GameController; tier: Tier }) {
  const ui = useHudStore();
  const unread = safe('notifications', () => (game.sim?.state.notifications ?? []).filter((n) => n && !n.read).length, 0);
  const rotate = (dir: 1 | -1) => {
    try {
      game.rotateCamera(dir);
      game.playUi('uiClick');
    } catch {
      /* camera not ready */
    }
  };
  const wallIdx = WALLS.findIndex((w) => w.mode === game.wallMode);
  return (
    <div class="hud-right">
      <div class="hud-modes ui-panel ui-interactive" data-hint-anchor="modes mode-switch">
        <Segmented<ViewMode>
          label={ht('mode.group')}
          value={game.mode}
          size="lg"
          iconOnly={tier !== 'normal'}
          class="hud-modes__seg"
          onChange={(m) => {
            game.setMode(m);
            game.playUi(m === 'live' ? 'modeLive' : m === 'buy' ? 'modeBuy' : 'modeBuild');
          }}
          options={MODES.map((m) => ({
            value: m.mode,
            label: ht(`mode.${m.mode}`),
            icon: m.icon,
            anchor: `mode-${m.mode}`,
            tipSpec: { title: ht(`mode.${m.mode}`), body: ht(`mode.${m.mode}.body`), keys: m.key, place: 'bottom' },
          }))}
        />
      </div>
      <div class="hud-tools ui-panel ui-interactive" data-hint-anchor="view-tools wall-mode camera">
        {tier === 'tight' ? (
          <IconButton
            icon={WALLS[Math.max(0, wallIdx)].icon}
            label={ht(`wall.${game.wallMode}`)}
            size="sm"
            onClick={() => game.cycleWallMode()}
            tipSpec={{ title: ht(`wall.${game.wallMode}`), body: ht('wall.body'), keys: 'wallMode', place: 'bottom' }}
          />
        ) : (
          <Segmented<WallMode>
            label={ht('wall.group')}
            value={game.wallMode}
            size="sm"
            iconOnly
            class="hud-walls"
            onChange={(m) => {
              game.setWallMode(m);
              game.playUi('uiToggle');
            }}
            options={WALLS.map((w) => ({
              value: w.mode,
              label: ht(`wall.${w.mode}`),
              icon: w.icon,
              tipSpec: { title: ht(`wall.${w.mode}`), body: ht('wall.body'), keys: 'wallMode', place: 'bottom' },
            }))}
          />
        )}
        <PerspectiveButton game={game} />
        {tier !== 'tight' && (
          <>
            <span class="hud-tools__sep" aria-hidden="true" />
            <IconButton icon="rotateLeft" label={ht('cam.left')} size="sm" onClick={() => rotate(-1)} tipSpec={{ title: ht('cam.left'), keys: 'rotateCamLeft', place: 'bottom' }} />
            <IconButton icon="rotateRight" label={ht('cam.right')} size="sm" onClick={() => rotate(1)} tipSpec={{ title: ht('cam.right'), keys: 'rotateCamRight', place: 'bottom' }} />
          </>
        )}
      </div>
      <div class="hud-sys ui-panel ui-interactive">
        <SaveIndicator game={game} />
        <SoundMenu game={game} />
        <IconButton
          icon="bell"
          label={noticesLabel(unread)}
          size="sm"
          pressed={ui.logOpen}
          data-hint-anchor="notices log"
          onClick={() => {
            hudStore.set({ logOpen: !ui.logOpen });
            game.playUi(ui.logOpen ? 'uiClose' : 'uiOpen');
          }}
          badge={
            unread > 0 ? (
              <Badge tone="danger" solid count>
                {unread > 99 ? '99+' : unread}
              </Badge>
            ) : null
          }
          tipSpec={{ title: ht('log.open'), body: unread > 0 ? ht('log.unread', { count: unread }) : null, place: 'bottom' }}
        />
        <IconButton
          icon="menu"
          label={ht('menu.open')}
          size="sm"
          data-hint-anchor="menu pause-menu"
          onClick={() => {
            game.playUi('uiOpen');
            game.openDialog('pause');
          }}
          tipSpec={{ title: ht('menu.open'), body: ht('menu.open.body'), keys: 'menu', place: 'bottom' }}
        />
      </div>
    </div>
  );
}

// ───────────────────────────── phone top bar (W-114) ─────────────────────────────

/**
 * Phone arrangement (lib/phoneLayout.ts, phone.css): plaque, clock pill, More + Game menu on the first row; speed and
 * the labelled Live / Buy / Build tabs on the second row in portrait (one row in landscape). Wall view, camera,
 * quick save and notices — the secondary tools — move into the More menu. Every control is ≥ 44 × 44 px.
 */
function PhoneTopBar({ game }: { game: GameController }) {
  const time = safe('time', () => game.sim?.time() ?? null, null);
  const paused = game.speed === 0;
  return (
    <>
      <HouseholdPlaque game={game} tier="compact" />
      <div class={`hud-clock hud-clock--phone ui-panel ui-interactive${paused ? ' is-paused' : ''}${time?.isNight ? ' is-night' : ''}${time?.fullMoon ? ' is-moon' : ''}`} data-hint-anchor="clock">
        <ClockTime game={game} tier="compact" dial={false} />
      </div>
      <div class="hud-sys hud-sys--phone ui-panel ui-interactive">
        <MoreMenu game={game} />
        <IconButton
          icon="menu"
          label={ht('menu.open')}
          data-hint-anchor="menu pause-menu"
          onClick={() => {
            game.playUi('uiOpen');
            game.openDialog('pause');
          }}
          tipSpec={{ title: ht('menu.open'), body: ht('menu.open.body'), keys: 'menu', place: 'bottom' }}
        />
      </div>
      <span class="hud-topbar__break" aria-hidden="true" />
      <div class="hud-speedbox ui-panel ui-interactive" data-hint-anchor="speed speed-controls">
        <SpeedControls game={game} />
      </div>
      <div class="hud-modes hud-modes--phone ui-panel ui-interactive" data-hint-anchor="modes mode-switch">
        <Segmented<ViewMode>
          label={ht('mode.group')}
          value={game.mode}
          class="hud-modes__seg"
          onChange={(m) => {
            game.setMode(m);
            game.playUi(m === 'live' ? 'modeLive' : m === 'buy' ? 'modeBuy' : 'modeBuild');
          }}
          options={MODES.map((m) => ({
            value: m.mode,
            label: ht(`mode.${m.mode}`),
            icon: m.icon,
            anchor: `mode-${m.mode}`,
            tipSpec: { title: ht(`mode.${m.mode}`), body: ht(`mode.${m.mode}.body`), keys: m.key, place: 'bottom' },
          }))}
        />
      </div>
    </>
  );
}

/** The phone top bar's overflow menu: wall view, camera rotation, quick save, notices. */
function MoreMenu({ game }: { game: GameController }) {
  const ui = useHudStore();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const unread = safe('notifications', () => (game.sim?.state.notifications ?? []).filter((n) => n && !n.read).length, 0);
  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  useOutsidePointer([btn, pop], () => setOpen(false), open);
  useEscape(() => close(true), open);
  useLayoutEffect(() => {
    if (open) pop.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus({ preventScroll: true });
  }, [open]);
  const onKey = (e: KeyboardEvent) => {
    const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    const items = Array.from(pop.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + dir + items.length) % items.length]?.focus();
  };
  const rotate = (dir: 1 | -1) => {
    try {
      game.rotateCamera(dir);
      game.playUi('uiClick');
    } catch {
      /* camera not ready */
    }
  };
  const saving = !!game.saving;
  const failed = !saving && game.lastSaveFailed === true;
  const saveLabel = saving ? ht('save.saving') : failed ? `${ht('save.quick')} — ${ht('save.failed')}` : ht('save.quick');
  const label = unread > 0 ? ht('top.more.unread', { count: unread }) : ht('top.more');
  return (
    <>
      <button
        ref={btn}
        type="button"
        class={`ui-iconbtn hud-topbar__more${open ? ' is-open' : ''}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls="hud-topbar-overflow"
        data-hint-anchor="notices log save view-tools wall-mode camera"
        onClick={() => {
          game.playUi(open ? 'uiClose' : 'uiOpen');
          setOpen(!open);
        }}
      >
        <Icon name="dots" size="1.25rem" />
        {unread > 0 && (
          <span class="ui-iconbtn__badge" aria-hidden="true">
            <Badge tone="danger" solid count>
              {unread > 99 ? '99+' : unread}
            </Badge>
          </span>
        )}
        {failed && <span class="hud-save__alert" aria-hidden="true" />}
      </button>
      {open && (
        <div ref={pop} id="hud-topbar-overflow" class="hud-topbar__overflow ui-panel ui-interactive" role="menu" aria-label={ht('top.more')} onKeyDown={onKey}>
          <div class="hud-overflow__row" role="group" aria-label={ht('wall.group')}>
            {WALLS.map((w) => (
              <button
                key={w.mode}
                type="button"
                role="menuitemradio"
                tabIndex={-1}
                aria-checked={game.wallMode === w.mode ? 'true' : 'false'}
                class={`hud-overflow__item is-tile${game.wallMode === w.mode ? ' is-on' : ''}`}
                onClick={() => {
                  game.setWallMode(w.mode);
                  game.playUi('uiToggle');
                }}
              >
                <Icon name={w.icon} size="1.25rem" />
                <span class="hud-overflow__label">{ht(`wall.${w.mode}`)}</span>
              </button>
            ))}
          </div>
          <div class="hud-overflow__row" role="group" aria-label={ht('persp.group')}>
            {PERSPECTIVE_ORDER.map((v) => (
              <button
                key={v}
                type="button"
                role="menuitemradio"
                tabIndex={-1}
                aria-checked={game.perspective === v ? 'true' : 'false'}
                aria-disabled={game.mode !== 'live' && v !== 'overview' ? 'true' : undefined}
                data-testid={`perspective-${v}`}
                class={`hud-overflow__item is-tile${game.perspective === v ? ' is-on' : ''}`}
                onClick={() => {
                  game.setPerspective(v);
                  game.playUi('uiToggle');
                }}
              >
                <Icon name={PERSPECTIVE_ICON[v]} size="1.25rem" />
                <span class="hud-overflow__label">{ht(`persp.${v}`)}</span>
              </button>
            ))}
          </div>
          <div class="hud-overflow__row" role="group" aria-label={ht('top.more.camera')}>
            <button type="button" role="menuitem" tabIndex={-1} class="hud-overflow__item" onClick={() => rotate(-1)}>
              <Icon name="rotateLeft" size="1.25rem" />
              <span class="hud-overflow__label">{ht('cam.left')}</span>
            </button>
            <button type="button" role="menuitem" tabIndex={-1} class="hud-overflow__item" onClick={() => rotate(1)}>
              <Icon name="rotateRight" size="1.25rem" />
              <span class="hud-overflow__label">{ht('cam.right')}</span>
            </button>
          </div>
          <div class="hud-overflow__row">
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              class={`hud-overflow__item hud-save${failed ? ' is-failed' : ''}`}
              aria-disabled={saving ? 'true' : undefined}
              onClick={() => {
                if (saving) return;
                game.playUi('save');
                game.saveGame().catch(() => game.playUi('uiError'));
                close();
              }}
            >
              <Icon name="save" size="1.25rem" />
              <span class="hud-overflow__label">{saveLabel}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              class="hud-overflow__item"
              aria-pressed={ui.logOpen ? 'true' : 'false'}
              onClick={() => {
                hudStore.set({ logOpen: !ui.logOpen });
                game.playUi(ui.logOpen ? 'uiClose' : 'uiOpen');
                close();
              }}
            >
              <Icon name="bell" size="1.25rem" />
              <span class="hud-overflow__label">{noticesLabel(unread)}</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function SaveIndicator({ game }: { game: GameController }) {
  const saving = !!game.saving;
  // lastSaveLabel is a complete player-facing phrase ("Saved 12 min ago", "Save failed"): shown verbatim.
  const label = typeof game.lastSaveLabel === 'string' && game.lastSaveLabel.trim() ? game.lastSaveLabel : null;
  const failed = !saving && game.lastSaveFailed === true;
  const [flash, setFlash] = useState(false);
  const wasSaving = useRef(saving);
  useEffect(() => {
    if (wasSaving.current && !saving && !game.lastSaveFailed) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1600);
      wasSaving.current = saving;
      return () => clearTimeout(t);
    }
    wasSaving.current = saving;
    return undefined;
  }, [saving]);
  // Failed: the controller's own phrase leads (verbatim), then what to do about it — never "Save failed" twice.
  const title = saving ? ht('save.saving') : failed ? (label ?? ht('save.failed')) : ht('save.quick');
  const body = failed ? ht('save.failed.body') : (label ?? ht('save.never'));
  return (
    <button
      type="button"
      class={`ui-iconbtn ui-iconbtn--sm hud-save${saving ? ' is-saving' : ''}${flash ? ' is-flash' : ''}${failed ? ' is-failed' : ''}`}
      aria-label={failed ? `${ht('save.quick')} — ${ht('save.failed')}` : saving ? ht('save.saving') : ht('save.quick')}
      aria-busy={saving ? 'true' : undefined}
      disabled={saving}
      data-hint-anchor="save"
      onClick={() => {
        game.playUi('save');
        game.saveGame().catch(() => game.playUi('uiError'));
      }}
      {...tip({ title, body, keys: 'quickSave', place: 'bottom', tone: failed ? 'bad' : null })}
    >
      {saving ? (
        <svg class="ui-spinner" viewBox="0 0 24 24" width="1.0625rem" height="1.0625rem" aria-hidden="true">
          <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-dasharray="34 60" stroke-linecap="round" />
        </svg>
      ) : (
        <Icon name="save" size="1.0625rem" />
      )}
      {failed && <span class="hud-save__alert" aria-hidden="true" />}
    </button>
  );
}
