/**
 * Original inline-SVG icon set for Afterlife Lease (24px grid, 1.75px rounded strokes, currentColor).
 *
 *   <Icon name="coffin" />                    decorative (aria-hidden)
 *   <Icon name="warning" title="Overdue" />   meaningful (role="img" + <title>)
 *
 * Covers every BubbleIcon in src/sim/contracts.ts plus UI glyphs. Unknown names render a fallback glyph and
 * never throw. `iconNames` lists every available name.
 */
import type { JSX } from 'preact';
import { BUBBLE_ICON_DEFS } from './common/iconData/bubble';
import { UI_ICON_DEFS } from './common/iconData/ui';
import type { IconDef, IconPart } from './common/iconData/geom';
import { circle } from './common/iconData/geom';

const FALLBACK: IconDef = [
  { d: circle(12, 12, 8.75), dash: '2.2 2.6' },
  'M9.75 9.75a2.3 2.3 0 0 1 4.45.75c0 1.5-2.2 1.9-2.2 3.4',
  'F ' + circle(12, 16.6, 1.05),
];

const ICONS: Record<string, IconDef> = { ...BUBBLE_ICON_DEFS, ...UI_ICON_DEFS };

/** Aliases so callers can use descriptive names. */
const ALIASES: Record<string, string> = {
  speedUltra: 'ultra',
  preservation: 'freshness',
  arm: 'limbArm',
  leg: 'limbLeg',
  graphics: 'monitor',
  audio: 'volume',
  gameplay: 'dice',
  controls: 'keyboard',
  notification: 'bell',
  funds: 'money',
};

export type IconName = keyof typeof BUBBLE_ICON_DEFS | keyof typeof UI_ICON_DEFS;

/** Every icon name (sorted), excluding aliases. */
export const iconNames: string[] = Object.keys(ICONS).sort();

export function hasIcon(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ICONS, name) || Object.prototype.hasOwnProperty.call(ALIASES, name);
}

function resolve(name: string): IconDef {
  if (typeof name !== 'string') return FALLBACK;
  if (Object.prototype.hasOwnProperty.call(ICONS, name)) return ICONS[name];
  if (Object.prototype.hasOwnProperty.call(ALIASES, name)) return ICONS[ALIASES[name]] ?? FALLBACK;
  return FALLBACK;
}

function renderPart(p: IconPart, i: number): JSX.Element {
  if (typeof p === 'string') {
    if (p.startsWith('F ')) return <path key={i} d={p.slice(2)} fill="currentColor" stroke="none" />;
    if (p.startsWith('T ')) return <path key={i} d={p.slice(2)} fill="currentColor" fill-opacity="0.22" stroke="none" />;
    if (p.startsWith('D ')) return <path key={i} d={p.slice(2)} stroke-opacity="0.5" />;
    return <path key={i} d={p} />;
  }
  const scaled = !!p.transform && p.transform.includes('scale');
  if (p.fill || p.soft) {
    return (
      <path
        key={i}
        d={p.d}
        fill="currentColor"
        fill-opacity={p.soft ? '0.22' : undefined}
        stroke="none"
        transform={p.transform}
      />
    );
  }
  return (
    <path
      key={i}
      d={p.d}
      stroke-opacity={p.dim ? '0.5' : undefined}
      stroke-width={p.width}
      stroke-dasharray={p.dash}
      transform={p.transform}
      vector-effect={scaled ? 'non-scaling-stroke' : undefined}
    />
  );
}

export interface IconProps {
  name: IconName | (string & {});
  /** CSS length or px number. Default 1.25em (scales with the surrounding text). */
  size?: number | string;
  /** Accessible name. Omit for decorative icons (they are aria-hidden). */
  title?: string;
  class?: string;
  strokeWidth?: number;
  style?: JSX.CSSProperties;
}

export function Icon({ name, size = '1.25em', title, class: cls, strokeWidth = 1.75, style }: IconProps): JSX.Element {
  const def = resolve(name as string);
  const dim = typeof size === 'number' ? `${size}px` : size;
  return (
    <svg
      class={cls ? `ui-icon ${cls}` : 'ui-icon'}
      width={dim}
      height={dim}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      aria-label={title || undefined}
      focusable="false"
      style={style}
      data-icon={name as string}
    >
      {title ? <title>{title}</title> : null}
      {def.map(renderPart)}
    </svg>
  );
}
