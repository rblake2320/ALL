/**
 * Live-mode interaction menu (game.menu): opens near the click point (clamped to the viewport), groups become
 * flyout sub-panels (hover-intent or click), entries with children (recipes, careers, townies) open nested
 * lists, disabled entries show their reason, costs are shown inline. Full keyboard support:
 * ↑/↓ Home/End move, →/Enter/Space open or choose, ←/Esc back, Esc at the root closes. Click outside closes.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { GameController, OpenMenu } from '../../../game/contracts';
import type { MenuEntry } from '../../../sim/contracts';
import { releaseFocus } from '../lib/focus';
import { formatMoney, num } from '../lib/format';
import { placeFlyout, placeMenu } from '../lib/layout';
import { safe } from '../lib/safe';
import { useEscape, useGame, useOutsidePointer } from '../parts/hooks';
import { Icon, type HudIconName } from '../parts/icons';
import { Portrait } from '../parts/Portrait';
import { ht } from '../strings';
import './menu.css';

export interface MenuRow {
  key: string;
  kind: 'entry' | 'group';
  label: string;
  icon: string;
  entry: MenuEntry | null;
  /** For child rows: the entry whose child list this row belongs to. */
  parent: MenuEntry | null;
  entries: MenuEntry[];
  available: boolean;
  reason: string | null;
  cost: number | null;
  hasSub: boolean;
}

const GROUP_ICON: Record<string, HudIconName> = {
  friendly: 'chat',
  romantic: 'heart',
  romance: 'heart',
  mean: 'angry',
  phone: 'phone',
  cook: 'plate',
  'cook…': 'plate',
  embalm: 'embalm',
};

function entryRow(e: MenuEntry, key: string, parent: MenuEntry | null = null): MenuRow {
  const children = Array.isArray(e.children) ? e.children.filter(Boolean) : [];
  return {
    key,
    kind: 'entry',
    label: typeof e.label === 'string' && e.label ? e.label : e.interactionId,
    icon: e.icon,
    entry: e,
    parent,
    entries: children,
    available: !!e.available,
    reason: e.available ? null : e.reason ?? null,
    cost: typeof e.cost === 'number' && Number.isFinite(e.cost) && e.cost > 0 ? e.cost : null,
    hasSub: parent === null && children.length > 0,
  };
}

/** Root rows: ungrouped entries in order; each group becomes one row at its first entry's position. */
export function rootRows(entries: readonly MenuEntry[] | null | undefined): MenuRow[] {
  const rows: MenuRow[] = [];
  const groups = new Map<string, MenuRow>();
  (entries ?? []).forEach((e, i) => {
    if (!e || typeof e.interactionId !== 'string') return;
    const g = typeof e.group === 'string' && e.group.trim() ? e.group.trim() : null;
    if (!g) {
      rows.push(entryRow(e, `e${i}:${e.interactionId}`));
      return;
    }
    let row = groups.get(g);
    if (!row) {
      row = {
        key: `g:${g}`,
        kind: 'group',
        label: g,
        icon: GROUP_ICON[g.toLowerCase()] ?? e.icon,
        entry: null,
        parent: null,
        entries: [],
        available: false,
        reason: null,
        cost: null,
        hasSub: true,
      };
      groups.set(g, row);
      rows.push(row);
    }
    row.entries.push(e);
    row.available = row.available || !!e.available;
  });
  return rows;
}

/** Rows of the flyout opened from `row`. */
export function subRows(row: MenuRow | undefined): MenuRow[] {
  if (!row || !row.hasSub) return [];
  if (row.kind === 'group') return row.entries.map((e, i) => entryRow(e, `${row.key}/${i}:${e.interactionId}`));
  return row.entries.map((c, i) => entryRow(c, `${row.key}/c${i}`, row.entry));
}

interface Open {
  key: string;
  rect: { x: number; y: number; w: number; h: number };
}

/** Identity of an open menu: a different key means a different menu (remount, fresh focus). */
export function menuKey(menu: Pick<OpenMenu, 'actorId' | 'title' | 'x' | 'y'> | null | undefined): string {
  return menu ? `${menu.actorId}|${menu.title}|${menu.x}|${menu.y}` : '';
}

export function InteractionMenu() {
  const game = useGame();
  const menu = game.menu;
  if (!menu) return null;
  return <MenuView key={menuKey(menu)} game={game} menu={menu} />;
}

function MenuView({ game, menu }: { game: GameController; menu: OpenMenu }) {
  const layer = useRef<HTMLDivElement>(null);
  /** What had focus when this menu opened (normally the world canvas) — it gets focus back on close. */
  const opener = useRef<HTMLElement | null>(null);
  const [path, setPath] = useState<Open[]>([]);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const levels: MenuRow[][] = [rootRows(menu.entries)];
  for (let i = 0; i < path.length && i < 2; i++) {
    const parent = levels[i].find((r) => r.key === path[i].key);
    const rows = subRows(parent);
    if (rows.length === 0) break;
    levels.push(rows);
  }
  // Runs before the first row takes focus (that happens a frame later), so activeElement is still the opener.
  useLayoutEffect(() => {
    const a = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    opener.current = a && !layer.current?.contains(a) ? a : null;
  }, []);
  // Backlog #16: every way this menu can close must move focus out of it SYNCHRONOUSLY. Renders are coalesced per
  // frame, so a still-focused menuitem would otherwise own the next hotkey (Esc then 3 → the 3 was swallowed). The
  // HUD's own close paths call releaseFocus directly; this subscription covers closes the controller makes on its
  // own (target gone, mode switch, a new menu) — notifications for menu changes are delivered synchronously.
  useEffect(() => {
    const key = menuKey(menu);
    try {
      return game.subscribe(() => {
        if (menuKey(game.menu) !== key) releaseFocus(layer.current, opener.current);
      });
    } catch {
      return undefined;
    }
  }, [game, menu]);
  const close = () => {
    releaseFocus(layer.current, opener.current);
    game.closeMenu();
    game.playUi('uiClose');
  };
  useOutsidePointer([layer], close, true);
  useEscape(
    () => {
      if (path.length > 0) {
        const parentKey = path[path.length - 1].key;
        // focus the parent row NOW (it stays mounted): the flyout row unmounts with the next render, and a key
        // pressed in between would otherwise land on <body> and reach the game while the menu is still open
        focusRow(layer.current, parentKey);
        setPath((p) => p.slice(0, -1));
        return 'stay';
      }
      close();
    },
    true,
    () => menuKey(game.menu) === menuKey(menu),
  );
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  const open = (level: number, row: MenuRow, el: HTMLElement, focusFirst: boolean) => {
    const r = el.getBoundingClientRect();
    setPath((p) => [...p.slice(0, level), { key: row.key, rect: { x: r.left, y: r.top, w: r.width, h: r.height } }]);
    game.playUi('uiHover');
    if (focusFirst) requestAnimationFrame(() => focusFirstIn(layer.current, level + 1));
  };
  const choose = (row: MenuRow, el: HTMLElement | null) => {
    if (!row.available || !row.entry) {
      game.playUi('uiError');
      return;
    }
    game.playUi('uiConfirm');
    // Choosing closes the menu (controller): hand focus back first, for the same reason as close().
    releaseFocus(layer.current, opener.current);
    if (row.parent) game.chooseMenuEntry(row.parent, row.entry);
    else game.chooseMenuEntry(row.entry);
    // Refused (the controller kept this menu open): put the keyboard back where it was.
    if (menuKey(game.menu) === menuKey(menu) && el && el.isConnected) el.focus({ preventScroll: true });
  };
  const hover = (level: number, row: MenuRow, el: HTMLElement) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(
      () => {
        if (row.hasSub) {
          if (path[level]?.key !== row.key) open(level, row, el, false);
        } else if (path.length > level) setPath((p) => p.slice(0, level));
      },
      row.hasSub ? 110 : 180,
    );
  };
  const onKey = (level: number, rows: MenuRow[]) => (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    const idx = Number(el.getAttribute('data-idx'));
    const row = rows[idx];
    const move = (to: number) => {
      const btns = layer.current?.querySelectorAll<HTMLElement>(`[data-level="${level}"] [data-idx]`);
      if (!btns || btns.length === 0) return;
      btns[((to % btns.length) + btns.length) % btns.length].focus();
    };
    switch (e.key) {
      case 'ArrowDown':
        move(idx + 1);
        break;
      case 'ArrowUp':
        move(idx - 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(rows.length - 1);
        break;
      case 'Tab':
        move(e.shiftKey ? idx - 1 : idx + 1);
        break;
      case 'ArrowRight':
        if (row?.hasSub) open(level, row, el, true);
        else return;
        break;
      case 'ArrowLeft':
        if (level > 0) {
          const parentKey = path[level - 1]?.key;
          if (parentKey) focusRow(layer.current, parentKey); // synchronously, see the Esc handler
          setPath((p) => p.slice(0, level - 1));
        } else return;
        break;
      case 'Enter':
      case ' ':
        if (!row) return;
        if (row.hasSub) open(level, row, el, true);
        else choose(row, el);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const actor = safe('menu.actor', () => game.sim?.summary(menu.actorId) ?? null, null);
  return (
    <div ref={layer} class="hud-imenu-layer">
      {levels.map((rows, level) => (
        <MenuPanel
          key={level === 0 ? 'root' : path[level - 1]?.key}
          level={level}
          rows={rows}
          menu={menu}
          anchor={level === 0 ? null : path[level - 1]?.rect ?? null}
          openKey={path[level]?.key ?? null}
          title={level === 0 ? menu.title : levels[level - 1].find((r) => r.key === path[level - 1]?.key)?.label ?? ''}
          actorName={level === 0 ? actor?.firstName ?? actor?.name ?? null : null}
          actor={level === 0 ? actor : null}
          onKeyDown={onKey(level, rows)}
          onHover={(row, el) => hover(level, row, el)}
          onActivate={(row, el) => (row.hasSub ? (path[level]?.key === row.key ? setPath((p) => p.slice(0, level)) : open(level, row, el, false)) : choose(row, el))}
        />
      ))}
    </div>
  );
}

function focusFirstIn(root: HTMLElement | null, level: number) {
  const btn = root?.querySelector<HTMLElement>(`[data-level="${level}"] [data-idx]:not([aria-disabled="true"])`) ?? root?.querySelector<HTMLElement>(`[data-level="${level}"] [data-idx]`);
  btn?.focus();
}

function focusRow(root: HTMLElement | null, key: string) {
  root?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
}

function MenuPanel({
  level,
  rows,
  menu,
  anchor,
  openKey,
  title,
  actorName,
  actor,
  onKeyDown,
  onHover,
  onActivate,
}: {
  level: number;
  rows: MenuRow[];
  menu: OpenMenu;
  anchor: Open['rect'] | null;
  openKey: string | null;
  title: string;
  actorName: string | null;
  actor: { appearance: import('../../../shared/appearance').ZombieAppearance; moodBand: import('../../../sim/contracts').MoodView['band'] } | null;
  onKeyDown: (e: KeyboardEvent) => void;
  onHover: (row: MenuRow, el: HTMLElement) => void;
  onActivate: (row: MenuRow, el: HTMLElement) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const size = { w: el.offsetWidth, h: el.offsetHeight };
    const vp = { w: window.innerWidth, h: window.innerHeight };
    if (level === 0) {
      const p = placeMenu({ x: num(menu.x), y: num(menu.y) }, size, vp, 8, 12);
      el.style.left = `${Math.round(p.x)}px`;
      el.style.top = `${Math.round(p.y)}px`;
      el.style.transformOrigin = `${p.originX} ${p.originY}`;
    } else if (anchor) {
      const p = placeFlyout(anchor, size, vp, 8, 6);
      el.style.left = `${Math.round(p.x)}px`;
      el.style.top = `${Math.round(p.y)}px`;
      el.style.transformOrigin = p.side === 'right' ? 'left top' : 'right top';
    }
    el.style.visibility = 'visible';
  });
  useEffect(() => {
    if (level !== 0) return;
    requestAnimationFrame(() => focusFirstIn(ref.current?.parentElement ?? null, 0));
  }, []);
  const labelId = `hud-imenu-title-${level}`;
  return (
    <div
      ref={ref}
      class={`hud-imenu ui-interactive${level > 0 ? ' is-flyout' : ''}`}
      role="menu"
      aria-labelledby={labelId}
      data-level={level}
      style={{ visibility: 'hidden' }}
      onKeyDown={onKeyDown}
    >
      <div class="hud-imenu__head">
        {level === 0 && actor && (
          <span class="hud-imenu__actor" aria-hidden="true">
            <Portrait size="1.75rem" appearance={actor.appearance} band={actor.moodBand} ring={false} />
          </span>
        )}
        <div class="hud-imenu__titles">
          <div id={labelId} class="hud-imenu__title u-display u-ellipsis">
            {title}
          </div>
          {level === 0 && actorName && <div class="hud-imenu__as u-ellipsis">{ht('imenu.as', { name: actorName })}</div>}
        </div>
      </div>
      {rows.length === 0 ? (
        <div class="hud-imenu__empty">{ht('imenu.empty')}</div>
      ) : (
        <ul class="hud-imenu__list" role="none">
          {rows.map((row, i) => (
            <li key={row.key} role="none">
              <button
                type="button"
                role="menuitem"
                data-idx={i}
                data-key={row.key}
                aria-haspopup={row.hasSub ? 'menu' : undefined}
                aria-expanded={row.hasSub ? (openKey === row.key ? 'true' : 'false') : undefined}
                aria-disabled={!row.available ? 'true' : undefined}
                class={`hud-imenu__row${row.kind === 'group' ? ' is-group' : ''}${!row.available ? ' is-disabled' : ''}${openKey === row.key ? ' is-open' : ''}`}
                onPointerEnter={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  // Focus follows the pointer (menu convention), so hover and keyboard focus can never highlight
                  // two different rows at once.
                  if (e.pointerType !== 'touch' && document.activeElement !== el) el.focus({ preventScroll: true });
                  onHover(row, el);
                }}
                onClick={(e) => onActivate(row, e.currentTarget as HTMLElement)}
              >
                <span class="hud-imenu__icon" aria-hidden="true">
                  <Icon name={row.icon} size="1.0625rem" />
                </span>
                <span class="hud-imenu__text">
                  <span class="hud-imenu__label u-ellipsis">{row.label}</span>
                  {!row.available && row.reason && (
                    <span class="hud-imenu__reason u-ellipsis">
                      <Icon name="lock" size="0.6875rem" />
                      {row.reason}
                    </span>
                  )}
                </span>
                {row.cost !== null && <span class="hud-imenu__cost u-num">{formatMoney(row.cost)}</span>}
                {row.kind === 'group' && <span class="hud-imenu__count u-num">{row.entries.length}</span>}
                {row.hasSub && (
                  <span class="hud-imenu__chev" aria-hidden="true">
                    <Icon name="chevronRight" size="0.875rem" />
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
