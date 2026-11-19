/**
 * Build mode tools (bottom): tool palette (Select, Wall, Room, Delete Wall, Doors, Windows, Floors, Paint,
 * Eyedropper), per-tool style grids from src/shared/styles.ts and door/window specs from the catalog, the
 * "whole room" paint toggle and undo/redo. The cost label near the cursor lives in CursorLabel.
 */
import type { ComponentChildren } from 'preact';
import type { BuildTool, GameController } from '../../../game/contracts';
import { FLOOR_STYLES, WALL_SEGMENT_PRICE, WALL_STYLES, type FloorStyle, type WallStyle } from '../../../shared/styles';
import { openingSpecs } from '../lib/catalog';
import { formatMoney } from '../lib/format';
import { safe } from '../lib/safe';
import { hudStore, useHudStore, type HudUiState } from '../lib/store';
import { IconButton, Toggle } from '../parts/controls';
import { useGame } from '../parts/hooks';
import { Icon } from '../parts/icons';
import { rovingKeyDown, rovingTabIndex } from '../parts/roving';
import { Rail } from '../parts/Rail';
import { tip } from '../parts/tooltip';
import { ht } from '../strings';
import { Thumb } from '../buy/Thumb';
import { floorSwatch, wallSwatch } from './swatches';
import './build.css';

type ToolKind = BuildTool['kind'];

const TOOLS: { kind: ToolKind; icon: string }[] = [
  { kind: 'select', icon: 'select' },
  { kind: 'wall', icon: 'wallUp' },
  { kind: 'room', icon: 'room' },
  { kind: 'deleteWall', icon: 'deleteWall' },
  { kind: 'door', icon: 'door' },
  { kind: 'window', icon: 'window' },
  { kind: 'floor', icon: 'floor' },
  { kind: 'paintWall', icon: 'roller' },
  { kind: 'eyedropper', icon: 'eyedropper' },
];

/** Build the controller tool for a palette choice from the remembered styles. */
export function toolFor(kind: ToolKind, s: HudUiState['styles']): BuildTool {
  switch (kind) {
    case 'wall':
      return { kind, style: s.wall };
    case 'room':
      return { kind, floor: s.roomFloor, wallStyle: s.roomWall };
    case 'door':
      return { kind, defId: s.door };
    case 'window':
      return { kind, defId: s.window };
    case 'floor':
      return { kind, styleId: s.floor };
    case 'paintWall':
      return { kind, styleId: s.paint, wholeRoom: s.wholeRoom };
    case 'deleteWall':
    case 'eyedropper':
    case 'select':
    default:
      return { kind } as BuildTool;
  }
}

export function BuildTools() {
  const game = useGame();
  const ui = useHudStore();
  const tool = game.buildTool ?? { kind: 'select' };
  const set = (t: BuildTool) => {
    game.setBuildTool(t);
    game.playUi('uiClick');
  };
  const setStyles = (patch: Partial<HudUiState['styles']>, apply: (s: HudUiState['styles']) => BuildTool) => {
    const styles = { ...ui.styles, ...patch };
    hudStore.set({ styles });
    set(apply(styles));
  };
  return (
    <section class="hud-build ui-panel ui-interactive" aria-label={ht('build.label')} data-hint-anchor="build-tools build" data-hud-region="80">
      <div class="hud-build__main">
        <div class="hud-tools-palette" role="radiogroup" aria-label={ht('build.label')} data-roving-group="" onKeyDown={rovingKeyDown}>
          {TOOLS.map((t, i) => {
            const on = tool.kind === t.kind;
            return (
              <button
                type="button"
                role="radio"
                key={t.kind}
                aria-checked={on ? 'true' : 'false'}
                tabIndex={rovingTabIndex(i, TOOLS.findIndex((x) => x.kind === tool.kind), TOOLS.length)}
                class={`hud-tool${on ? ' is-active' : ''}`}
                data-hint-anchor={`tool-${t.kind}`}
                onClick={() => set(toolFor(t.kind, ui.styles))}
                {...tip({ title: ht(`tool.${t.kind}`), body: ht(`tool.${t.kind}.body`) })}
              >
                <span class="hud-tool__icon">
                  <Icon name={t.icon} size="1.375rem" />
                </span>
                <span class="hud-tool__label">{ht(`tool.${t.kind}`)}</span>
              </button>
            );
          })}
        </div>
        <div class="hud-build__options">
          <div class="hud-build__optHead">
            <div>
              <h3 class="hud-build__title u-display">{ht(`tool.${tool.kind}`)}</h3>
              <p class="hud-build__desc">{ht(`tool.${tool.kind}.body`)}</p>
            </div>
            <div class="hud-build__undo">
              <IconButton icon="undo" label={ht('build.undo')} size="sm" disabled={!game.canUndo} onClick={() => game.undo()} tipSpec={{ title: ht('build.undo'), keys: 'undo' }} />
              <IconButton icon="redo" label={ht('build.redo')} size="sm" disabled={!game.canRedo} onClick={() => game.redo()} tipSpec={{ title: ht('build.redo'), keys: 'redo' }} />
            </div>
          </div>
          <ToolOptions game={game} tool={tool} ui={ui} setStyles={setStyles} />
        </div>
      </div>
    </section>
  );
}

function ToolOptions({
  game,
  tool,
  ui,
  setStyles,
}: {
  game: GameController;
  tool: BuildTool;
  ui: HudUiState;
  setStyles: (patch: Partial<HudUiState['styles']>, apply: (s: HudUiState['styles']) => BuildTool) => void;
}) {
  switch (tool.kind) {
    case 'wall':
      return (
        <StyleRow label={ht('build.wallStyle')} note={ht('build.segment', { price: formatMoney(WALL_SEGMENT_PRICE) })}>
          <WallGrid value={tool.style} onPick={(id) => setStyles({ wall: id }, (s) => ({ kind: 'wall', style: s.wall }))} />
        </StyleRow>
      );
    case 'room':
      return (
        <div class="hud-build__rows">
          <StyleRow label={ht('build.walls')}>
            <WallGrid value={tool.wallStyle} compact onPick={(id) => setStyles({ roomWall: id }, (s) => ({ kind: 'room', floor: s.roomFloor, wallStyle: s.roomWall }))} />
          </StyleRow>
          <StyleRow label={ht('build.floor')}>
            <FloorGrid value={tool.floor} compact allowNone onPick={(id) => setStyles({ roomFloor: id }, (s) => ({ kind: 'room', floor: s.roomFloor, wallStyle: s.roomWall }))} />
          </StyleRow>
        </div>
      );
    case 'floor':
      return (
        <StyleRow label={ht('build.floorStyle')}>
          <FloorGrid value={tool.styleId} allowNone onPick={(id) => setStyles({ floor: id }, (s) => ({ kind: 'floor', styleId: s.floor }))} />
        </StyleRow>
      );
    case 'paintWall':
      return (
        <StyleRow
          label={ht('build.wallStyle')}
          extra={
            <label class="hud-build__toggle" {...tip({ title: ht('build.wholeRoom'), body: ht('build.wholeRoom.body') })}>
              <Toggle checked={tool.wholeRoom} label={ht('build.wholeRoom')} onChange={(v) => setStyles({ wholeRoom: v }, (s) => ({ kind: 'paintWall', styleId: s.paint, wholeRoom: s.wholeRoom }))} />
              <span>{ht('build.wholeRoom')}</span>
            </label>
          }
        >
          <WallGrid value={tool.styleId} onPick={(id) => setStyles({ paint: id }, (s) => ({ kind: 'paintWall', styleId: s.paint, wholeRoom: s.wholeRoom }))} />
        </StyleRow>
      );
    case 'door':
    case 'window':
      return <OpeningsRow game={game} kind={tool.kind} defId={tool.defId} setStyles={setStyles} />;
    default:
      return (
        <div class="hud-build__info">
          <Icon name={tool.kind === 'eyedropper' ? 'eyedropper' : tool.kind === 'deleteWall' ? 'deleteWall' : 'select'} size="1.75rem" />
          <p>{ht(`tool.${tool.kind}.body`)}</p>
        </div>
      );
  }
}

function OpeningsRow({
  game,
  kind,
  defId,
  setStyles,
}: {
  game: GameController;
  kind: 'door' | 'window';
  defId: string;
  setStyles: (patch: Partial<HudUiState['styles']>, apply: (s: HudUiState['styles']) => BuildTool) => void;
}) {
  const specs = safe('build.openings', () => openingSpecs(kind, game.sim?.content.objects), []);
  const funds = game.sim?.state.household.funds ?? 0;
  return (
    <StyleRow label={ht(`tool.${kind}`)}>
      <Rail class="hud-styles hud-styles--openings" label={ht(`tool.${kind}`)} selectedKey={defId}>
        {specs.map((s, i) => {
          const on = defId === s.id;
          const poor = s.price > funds;
          return (
            <button
              type="button"
              role="radio"
              key={s.id}
              aria-checked={on ? 'true' : 'false'}
              tabIndex={rovingTabIndex(i, specs.findIndex((x) => x.id === defId), specs.length)}
              class={`hud-style is-opening${poor ? ' is-poor' : ''}`}
              onClick={() => !on && setStyles(kind === 'door' ? { door: s.id } : { window: s.id }, (st) => (kind === 'door' ? { kind: 'door', defId: st.door } : { kind: 'window', defId: st.window }))}
              {...tip({ title: s.name, body: [s.description, poor ? ht('buy.cantAfford') : ''].filter(Boolean).join('\n'), tone: poor ? 'bad' : null })}
            >
              <Thumb game={game} defId={s.id} fallbackIcon={kind} size="3.75rem" />
              {/* W-118 / WCAG 2.5.3: the name comes from this visible text (no overriding aria-label) */}
              <span class="hud-style__name u-ellipsis">{s.name}</span>{' '}
              <span class="hud-style__price u-num">{formatMoney(s.price)}</span>
              {poor && <span class="u-sr-only">, {ht('buy.cantAfford')}</span>}
            </button>
          );
        })}
      </Rail>
    </StyleRow>
  );
}

function StyleRow({ label, note, extra, children }: { label: string; note?: string; extra?: ComponentChildren; children: ComponentChildren }) {
  return (
    <div class="hud-build__row">
      <div class="hud-build__rowhead">
        <span class="u-caps">{label}</span>
        {note && <span class="hud-build__note">{note}</span>}
        {extra}
      </div>
      {children}
    </div>
  );
}

function WallGrid({ value, onPick, compact }: { value: string; onPick: (id: string) => void; compact?: boolean }) {
  return (
    <Rail class={`hud-styles${compact ? ' is-compact' : ''}`} label={ht('build.wallStyle')} selectedKey={value}>
      {WALL_STYLES.map((s: WallStyle, i) => (
        <StyleChip key={s.id} tabIndex={rovingTabIndex(i, WALL_STYLES.findIndex((x) => x.id === value), WALL_STYLES.length)} on={value === s.id} name={s.name} price={ht('build.perSide', { price: formatMoney(s.price) })} bg={wallSwatch(s.pattern, s.base, s.accent)} compact={compact} onPick={() => onPick(s.id)} />
      ))}
    </Rail>
  );
}

function FloorGrid({ value, onPick, compact, allowNone }: { value: string | null; onPick: (id: string | null) => void; compact?: boolean; allowNone?: boolean }) {
  const ids: (string | null)[] = [...(allowNone ? [null] : []), ...FLOOR_STYLES.map((f) => f.id)];
  const sel = ids.indexOf(value);
  const ti = (id: string | null) => rovingTabIndex(ids.indexOf(id), sel, ids.length);
  return (
    <Rail class={`hud-styles${compact ? ' is-compact' : ''}`} label={ht('build.floorStyle')} selectedKey={value}>
      {allowNone && (
        <StyleChip
          tabIndex={ti(null)}
          on={value === null}
          name={ht('build.removeFloor')}
          price={ht('build.removeFloor.short')}
          tipBody={ht('build.removeFloor.body')}
          bg="repeating-linear-gradient(-45deg, rgba(232,224,200,0.08) 0 0.3rem, transparent 0.3rem 0.6rem), #2a2236"
          icon="removeFloor"
          compact={compact}
          onPick={() => onPick(null)}
        />
      )}
      {FLOOR_STYLES.map((s: FloorStyle) => (
        <StyleChip key={s.id} tabIndex={ti(s.id)} on={value === s.id} name={s.name} price={ht('build.perTile', { price: formatMoney(s.price) })} bg={floorSwatch(s.pattern, s.base, s.accent)} compact={compact} onPick={() => onPick(s.id)} />
      ))}
    </Rail>
  );
}

function StyleChip({ on, name, price, bg, icon, compact, onPick, tipBody, tabIndex }: { on: boolean; name: string; price: string; bg: string; icon?: string; compact?: boolean; onPick: () => void; tipBody?: string; tabIndex: number }) {
  return (
    <button type="button" role="radio" aria-checked={on ? 'true' : 'false'} tabIndex={tabIndex} aria-label={compact ? `${name}, ${price}` : undefined} class={`hud-style${compact ? ' is-compact' : ''}`} onClick={() => !on && onPick()} {...tip({ title: name, body: tipBody ? `${price}\n${tipBody}` : price })}>
      <span class="hud-style__sample" style={{ background: bg }}>
        {icon && <Icon name={icon} size="1.25rem" />}
        {on && (
          <span class="hud-style__check" aria-hidden="true">
            <Icon name="check" size="0.75rem" strokeWidth={3} />
          </span>
        )}
      </span>
      {/* W-118 / WCAG 2.5.3: with visible text the name comes from it; the icon-only compact chip keeps its label */}
      {!compact && <span class="hud-style__name">{name}</span>}
      {!compact && ' '}
      {!compact && <span class="hud-style__price u-num">{price}</span>}
    </button>
  );
}
