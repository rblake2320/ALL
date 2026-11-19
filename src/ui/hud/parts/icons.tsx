/**
 * HUD icon set — original inline SVG glyphs on a 24×24 grid, rounded 1.75px strokes (ART_DIRECTION "UI").
 * Covers every BUBBLE_ICONS id (bubbles, moodlets, interactions, skills, careers) plus HUD-specific glyphs.
 * Glyph builders return fresh vnodes on every call (Preact vnodes must not be shared between renders).
 */
import type { JSX } from 'preact';
import type { BubbleIcon } from '../../../sim/contracts';
import { Icon as ShellIcon, hasIcon as shellHasIcon } from '../../icons';

type Attrs = Record<string, string | number>;
const p = (d: string, a?: Attrs) => <path d={d} {...a} />;
const c = (cx: number, cy: number, r: number, a?: Attrs) => <circle cx={cx} cy={cy} r={r} {...a} />;
const dot = (cx: number, cy: number, r = 1.1) => <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;
const rect = (x: number, y: number, w: number, h: number, rx = 0, a?: Attrs) => <rect x={x} y={y} width={w} height={h} rx={rx} {...a} />;
const FILL: Attrs = { fill: 'currentColor' };

const HEART = 'M12 20.2 4.9 13.3a4.6 4.6 0 0 1 6.5-6.5l.6.6.6-.6a4.6 4.6 0 0 1 6.5 6.5z';
const WRENCH = 'M10.25 19.5V10.4A4.5 4.5 0 0 1 10.5 2.01V5.25h3V2.01A4.5 4.5 0 0 1 13.75 10.4V19.5a1.75 1.75 0 0 1-3.5 0z';
const BUBBLE = 'M5 5h14a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-7.3L7 20.2v-3.7H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z';

function face(...inner: JSX.Element[]): JSX.Element[] {
  return [c(12, 12, 8.6), ...inner];
}

function fly(x: number, y: number): JSX.Element[] {
  return [
    <circle cx={x} cy={y} r={1.25} fill="currentColor" stroke="none" />,
    p(`M${x - 0.5} ${y - 1}c-1.6-1.4-.6-2.9.7-1.7M${x + 0.5} ${y - 1}c1.6-1.4.6-2.9-.7-1.7`, { 'stroke-width': 1.3 }),
  ];
}

const GLYPHS = {
  // ───────────── bubble / content icons (BUBBLE_ICONS) ─────────────
  brain: () => [
    p('M11.4 5.3c-.9-1.4-3.2-1.6-4.2-.2-1.6 0-2.8 1.4-2.4 3-1.4.8-1.7 2.7-.6 3.8-.6 1.5.4 3.1 2 3.3.4 1.6 2.2 2.3 3.6 1.5.4.5 1 .8 1.6.8'),
    p('M12.6 5.3c.9-1.4 3.2-1.6 4.2-.2 1.6 0 2.8 1.4 2.4 3 1.4.8 1.7 2.7.6 3.8.6 1.5-.4 3.1-2 3.3-.4 1.6-2.2 2.3-3.6 1.5-.4.5-1 .8-1.6.8'),
    p('M12 5.6v11.9M8.1 8.4c1 .2 1.7.9 1.8 1.9M7.1 12.3c1.1-.4 2.3 0 2.9.9M15.9 8.4c-1 .2-1.7.9-1.8 1.9M16.9 12.3c-1.1-.4-2.3 0-2.9.9M12 17.5v2.2'),
  ],
  coffin: () => [p('M9 2.8h6l3.1 5.4-2.3 13H8.2L5.9 8.2z'), p('M12 7.6v6.8M9.6 10h4.8')],
  soap: () => [rect(3.5, 11, 13, 8.5, 3), p('M7 15.3h6'), c(17.6, 7, 2.2), c(12.3, 6.6, 1.3), c(20.2, 11.6, 1.1)],
  chat: () => [p(BUBBLE), dot(8, 10.8), dot(12, 10.8), dot(16, 10.8)],
  heart: () => [p(HEART)],
  heartBroken: () => [p(HEART), p('M12.6 7.2 10.9 10.6l2.5 1.6-1.6 3.6')],
  joke: () => face(p('M7.8 10.2 9.4 8.8 11 10.2M13 10.2l1.6-1.4 1.6 1.4'), p('M8.2 13.3h7.6a3.8 3.8 0 0 1-7.6 0z')),
  angry: () => face(p('M7.6 8.6l2.8 1.4M16.4 8.6l-2.8 1.4'), dot(9.6, 11.8, 1), dot(14.4, 11.8, 1), p('M9 16.4c1.8-1.3 4.2-1.3 6 0')),
  zzz: () => [p('M3.5 9.5h5.2l-5.2 6h5.2'), p('M11.5 4.5h4.2l-4.2 5h4.2'), p('M16.8 13.5h3.7l-3.7 4.2h3.7')],
  money: () => [c(12, 12, 8.6), p('M14.6 9.2c-.5-.9-1.5-1.4-2.6-1.4-1.5 0-2.6.8-2.6 2s1.1 1.7 2.6 2.1 2.7.9 2.7 2.2-1.2 2-2.7 2c-1.2 0-2.2-.5-2.7-1.5M12 6.3v1.5M12 16.6v1.3')],
  book: () => [p('M3.5 6.2c2.8-1 5.8-.9 8.5.8v12.2c-2.7-1.6-5.7-1.7-8.5-.7z'), p('M20.5 6.2c-2.8-1-5.8-.9-8.5.8v12.2c2.7-1.6 5.7-1.7 8.5-.7z')],
  tv: () => [rect(3.5, 7.8, 17, 12, 2.6), rect(6, 10.2, 9.6, 7.2, 1.4), p('M8.6 3.6 12 7.2l3.4-3.6'), dot(18, 11.6, 0.95), dot(18, 14.8, 0.95)],
  paint: () => [
    p('M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 1.9-1 1.4-2.1-.6-1.2.1-2.4 1.5-2.4h2.4c1.8 0 3.2-1.4 3.2-3.2C20.5 7.6 16.7 3.5 12 3.5z'),
    dot(7.6, 11.2, 1.15),
    dot(9.6, 7.6, 1.15),
    dot(14, 7, 1.15),
    dot(16.9, 10, 1.15),
  ],
  music: () => [p('M9 17.5V6.2l10-2.1v11.4'), c(6.8, 17.5, 2.2), c(16.8, 15.5, 2.2)],
  volume: () => [p('M4 9.5h3.2L12 5.5v13l-4.8-4H4z'), p('M15.5 9a4 4 0 0 1 0 6'), p('M18 6.6a7.4 7.4 0 0 1 0 10.8')],
  volumeOff: () => [p('M4 9.5h3.2L12 5.5v13l-4.8-4H4z'), p('M16 9.5l5 5M21 9.5l-5 5')],
  dance: () => [c(13.6, 4.6, 1.9), p('M13 7.4 11.4 13.4M6.8 6.4l5.8 2.6 5-3.4M11.4 13.4l-3.8 6.4M11.4 13.4l3.4 3 .9 3.9')],
  limb: () => [
    <g transform="rotate(-45 12 12)">
      {p('M7.3 10.3h9.4M7.3 13.7h9.4')}
      {p('M7.3 10.3a1.9 1.9 0 1 0-1.9 1.7 1.9 1.9 0 1 0 1.9 1.7M16.7 10.3a1.9 1.9 0 1 1 1.9 1.7 1.9 1.9 0 1 1-1.9 1.7')}
    </g>,
  ],
  fridge: () => [rect(6, 3, 12, 18, 2.2), p('M6 10h12M9 5.8v2.2M9 12.6v3.4')],
  plate: () => [p('M4.6 16.6a7.4 7.4 0 0 1 14.8 0z'), p('M12 9.2V7.6M10.4 7.6h3.2M3 19.4h18'), p('M8.4 13.2c.6-1.2 1.6-2 2.8-2.3', { 'stroke-width': 1.4 })],
  dish: () => [<ellipse cx={12} cy={15.6} rx={8.2} ry={3.6} />, <ellipse cx={12} cy={15.2} rx={4} ry={1.4} />, p('M8.8 10.4c-.9-1.1.9-2.1 0-3.3M12 9.8c-.9-1.1.9-2.1 0-3.3M15.2 10.4c-.9-1.1.9-2.1 0-3.3')],
  fire: () => [
    p('M12 21c-3.6 0-6-2.4-6-5.6 0-3.4 2.6-5 3.4-8.4 1.9 1.3 2.7 3 2.7 4.6.8-.6 1.4-1.6 1.5-2.9 2.4 1.7 4.4 4.1 4.4 6.7 0 3.2-2.4 5.6-6 5.6z'),
    p('M12 21c-1.5 0-2.5-1-2.5-2.4 0-1.5 1.2-2.4 2.5-3.8 1.3 1.4 2.5 2.3 2.5 3.8 0 1.4-1 2.4-2.5 2.4z'),
  ],
  question: () => [p('M8.9 8.9a3.1 3.1 0 1 1 4.7 2.6c-1 .6-1.6 1.3-1.6 2.5v.6'), dot(12, 18.2, 1.2)],
  exclamation: () => [p('M12 4.5v10.2'), dot(12, 18.6, 1.25)],
  skull: () => [
    p('M12 3.4c-4.4 0-7.6 3-7.6 7.1 0 2.4 1.2 4.1 2.9 5.1V19a1.5 1.5 0 0 0 1.5 1.5h6.4a1.5 1.5 0 0 0 1.5-1.5v-3.4c1.7-1 2.9-2.7 2.9-5.1 0-4.1-3.2-7.1-7.6-7.1z'),
    c(9, 11, 1.7),
    c(15, 11, 1.7),
    p('M12 13.6l-.9 1.7h1.8zM10.1 20.5v-2M13.9 20.5v-2'),
  ],
  star: () => [p('M12 3.6l2.5 5.2 5.6.7-4.1 3.9 1.1 5.6L12 16.3 6.9 19l1.1-5.6-4.1-3.9 5.6-.7z')],
  work: () => [rect(3.5, 7.5, 17, 12, 2), p('M9 7.5V5.8c0-.9.7-1.6 1.6-1.6h2.8c.9 0 1.6.7 1.6 1.6v1.7M3.5 12.6h17M11 12.6v1.7h2v-1.7')],
  phone: () => [
    p('M6.6 3.8 9.3 4.6c.6.2 1 .8.9 1.4l-.4 2.7c0 .4-.3.8-.6 1-.4.3-.5.8-.3 1.2.9 1.8 2.3 3.2 4.1 4.1.4.2.9.1 1.2-.3.2-.3.6-.6 1-.6l2.7-.4c.6-.1 1.2.3 1.4.9l.8 2.7c.2.7-.1 1.4-.8 1.7-1 .5-2.1.7-3.2.6C9.5 19 5 14.5 4.5 8.9c-.1-1.1.1-2.2.6-3.2.3-.7 1-1 1.5-.9z'),
  ],
  mail: () => [rect(3.5, 5.5, 17, 13, 2), p('M4.2 7.2 12 13l7.8-5.8')],
  flies: () => [...fly(7.5, 9), ...fly(16.5, 7.5), ...fly(12.5, 16), p('M9 11.3c1.4 1.6 2.6 2 3.6 2.6M14.6 9.6c-.3 1.6-.9 3-1.6 4.2', { 'stroke-dasharray': '0.1 2.4', 'stroke-width': 1.5 })],
  stitch: () => [p('M4.5 19.5 19.5 4.5'), p('M6.2 14.2l3.6 3.6M9.8 10.6l3.6 3.6M13.4 7l3.6 3.6')],
  embalm: () => [
    <g transform="rotate(45 12 12)">
      {rect(9.5, 6.5, 5, 9.5, 1.1)}
      {p('M12 2.5v4M9.8 2.5h4.4M12 16v5.5M9.5 9.4h2.6M9.5 12.4h2.6')}
    </g>,
  ],
  chess: () => [c(12, 6, 2.3), p('M9.3 10.1h5.4M10.3 10.1 9.2 16.6h5.6l-1.1-6.5M7.6 20.5l1-3.9h6.8l1 3.9zM6.6 20.5h10.8')],
  dumbbell: () => [p('M7 12h10'), rect(3.6, 8, 3.4, 8, 1.1), rect(17, 8, 3.4, 8, 1.1), p('M2.3 10.3v3.4M21.7 10.3v3.4')],
  mirror: () => [<ellipse cx={12} cy={9.8} rx={5.6} ry={6.9} />, p('M12 16.7v3.8M8.8 20.5h6.4M9.5 7.7l2-2M9.6 11l4.4-4.4')],
  gift: () => [rect(4.5, 10, 15, 10.5, 1.5), rect(3.5, 7, 17, 3, 1), p('M12 7v13.5M12 7c-1.8-3.6-5.6-3-4.6-.6.5 1 2.6.6 4.6.6zM12 7c1.8-3.6 5.6-3 4.6-.6-.5 1-2.6.6-4.6.6z')],
  party: () => [p('M4 20.2 8.4 9.4l6.4 6.4z'), p('M13 4.4l.6 2.1M18.6 5.6 17 7.2M19.8 11.2l-2 .5M14.8 9.2c.8-1.6 2.3-2.4 3.6-2.2'), dot(10.5, 4.6, 0.95), dot(20.2, 15.2, 0.95)],
  house: () => [p('M3.5 11.2 12 4.2l8.5 7'), p('M5.6 9.6V20h12.8V9.6'), p('M10 20v-5.6h4V20')],
  sad: () => face(p('M8 9.3l2.3-.9M16 9.3l-2.3-.9'), dot(9.6, 11.8, 1), dot(14.4, 11.8, 1), p('M8.8 16.6c2-1.6 4.4-1.6 6.4 0')),
  happy: () => face(dot(9.4, 10.2, 1.05), dot(14.6, 10.2, 1.05), p('M8.4 13.6c1.8 2.5 5.4 2.5 7.2 0')),
  disgusted: () => face(p('M7.9 10.3l2.4.6M16.1 10.3l-2.4.6'), p('M8.4 15.6c.9-.9 1.7.9 2.6 0s1.7-.9 2.6 0 1.7.9 2.2 0')),
  gossip: () => [
    p('M3.6 4.8h9.8a1.6 1.6 0 0 1 1.6 1.6v4.9a1.6 1.6 0 0 1-1.6 1.6H8.1l-3 2.6v-2.6H3.6A1.6 1.6 0 0 1 2 11.3V6.4a1.6 1.6 0 0 1 1.6-1.6z'),
    p('M17.4 9.4h3a1.6 1.6 0 0 1 1.6 1.6v4.8a1.6 1.6 0 0 1-1.6 1.6H20v2.5l-3-2.5h-4.6a1.6 1.6 0 0 1-1.6-1.6v-.8'),
  ],
  bite: () => [p('M3.4 8.2h17.2c0 5.6-3.9 9.4-8.6 9.4s-8.6-3.8-8.6-9.4z'), p('M6.6 8.2l1.4 3.4 1.4-3.4M14.6 8.2l1.4 3.4 1.4-3.4'), p('M9.4 14.6c1.6.9 3.6.9 5.2 0', { 'stroke-width': 1.4 })],
  rose: () => [
    p('M12 13.5c-3 0-4.5-2-4.5-4.5 0-1.5 1-3 2-3.5.5 1 1.5 1.5 2.5 1.5s2-.5 2.5-1.5c1 .5 2 2 2 3.5 0 2.5-1.5 4.5-4.5 4.5z'),
    p('M10.8 9.3c.5.8 1.9.8 2.4 0M12 13.5V21M12 17.4c-2 0-3.4-1-4-2.4M12 18.6c1.5 0 2.9-.8 3.5-2'),
  ],
  ring: () => [c(12, 15, 5.5), p('M9.6 9.8 8.5 6.5 10 4.5h4l1.5 2-1.1 3.3M8.5 6.5h7')],
  ice: () => [
    p('M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9'),
    p('M9.8 4.4 12 6.1l2.2-1.7M9.8 19.6 12 17.9l2.2 1.7M5.1 10.6l2.6-.4.8-2.6M18.9 13.4l-2.6.4-.8 2.6M5.1 13.4l2.6.4.8 2.6M18.9 10.6l-2.6-.4-.8-2.6'),
  ],
  shower: () => [p('M5 21V6.6A2.6 2.6 0 0 1 7.6 4h2.8A2.6 2.6 0 0 1 13 6.6V8'), p('M9.4 8h7.2l-1.1 2.6h-5z'), p('M10.6 13.6l-.5 1.5M13 13.6v1.5M15.4 13.6l.5 1.5M10.2 17.6l-.5 1.5M13 17.6v1.5M15.8 17.6l.5 1.5')],
  plant: () => [p('M7.4 14h9.2l-1.2 6.5H8.6z'), p('M12 14V8.6M12 10.2c-1.6-3-4.6-3.6-6.2-3 .3 2.6 2.9 4.1 6.2 3zM12 8.6c1-3.1 4.1-4.1 6.2-3.6-.2 2.6-2.9 4.1-6.2 3.6z')],
  game: () => [
    p('M7 8h10a4.5 4.5 0 0 1 4.3 5.8l-1 3.2a2.4 2.4 0 0 1-4.2.7L14.5 16h-5l-1.6 1.7a2.4 2.4 0 0 1-4.2-.7l-1-3.2A4.5 4.5 0 0 1 7 8z'),
    p('M7.6 10.8v3.2M6 12.4h3.2'),
    dot(15.6, 11.6, 1),
    dot(17.6, 13.4, 1),
  ],
  coffee: () => [p('M5 9.5h11v5.6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z'), p('M16 11h1.5a2.5 2.5 0 0 1 0 5H16'), p('M8.6 3.5c-.8 1 .8 2 0 3.2M12 3.5c-.8 1 .8 2 0 3.2')],
  pizza: () => [p('M12 21 3.8 6.6c5-2.7 11.4-2.7 16.4 0z'), p('M5.3 9.1c4.2-2.1 9.2-2.1 13.4 0'), c(10, 11.6, 1.2), c(14.1, 12, 1), c(12, 15.6, 1)],
  computer: () => [rect(3, 4.5, 18, 12, 2), p('M9 20.5h6M12 16.5v4')],
  lightning: () => [p('M13.2 3 5.6 13.4h5.6L10 21l7.6-10.4H12z')],
  urn: () => [
    p('M9 3.5h6M9.6 3.5v1.8c0 .8-1 1.2-1.6 1.9C6.6 8.6 6 10.3 6 12.5c0 3.5 2.3 6 3 7H8V21h8v-1.5h-1c.7-1 3-3.5 3-7 0-2.2-.6-3.9-2-5.3-.6-.7-1.6-1.1-1.6-1.9V3.5'),
    p('M7.2 10.5h9.6'),
  ],
  wave: () => [
    p('M8 13V6.6a1.3 1.3 0 0 1 2.6 0V11M10.6 10.2V5a1.3 1.3 0 0 1 2.6 0v5.2M13.2 10.4V6.1a1.3 1.3 0 0 1 2.6 0v6M15.8 12.5V8.6a1.3 1.3 0 0 1 2.6 0V14c0 3.6-2.6 6.5-6.2 6.5-2.4 0-4-1-5.3-2.7l-2.3-2.8a1.4 1.4 0 0 1 2.2-1.7l1.2 1.2'),
    p('M3.6 7.6c.3-1.4 1-2.6 2-3.5M19.4 3.9c1 .9 1.7 2.1 2 3.5'),
  ],
  sparkle: () => [
    p('M11 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z'),
    p('M18.5 14.6c.3 1.6 1 2.3 2.5 2.5-1.5.2-2.2.9-2.5 2.5-.3-1.6-1-2.3-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5z'),
  ],
  clock: () => [c(12, 12, 8.6), p('M12 7.4V12l3 2.1')],
  trophy: () => [p('M8 4.5h8v5a4 4 0 0 1-8 0z'), p('M8 6.5H5.6a2.6 2.6 0 0 0 2.6 3.6M16 6.5h2.4a2.6 2.6 0 0 1-2.6 3.6'), p('M12 13.5v3.4M8.6 20.5h6.8M9.6 20.5l.5-3.6h3.8l.5 3.6')],
  wrench: () => [p(WRENCH, { transform: 'rotate(45 12 12)' }), c(12, 17.9, 0.95, { transform: 'rotate(45 12 12)' })],

  // ───────────── HUD glyphs ─────────────
  pause: () => [rect(6.4, 5, 3.8, 14, 1.3, FILL), rect(13.8, 5, 3.8, 14, 1.3, FILL)],
  speed1: () => [p('M8 5.6v12.8l10.4-6.4z', FILL)],
  speed2: () => [p('M3.8 6.2v11.6l7.6-5.8zM12.4 6.2v11.6L20 12z', FILL)],
  speed3: () => [p('M2.2 7v10l5.6-5zM8.4 7v10l5.6-5zM14.6 7v10l5.6-5z', FILL)],
  speed4: () => [p('M14 2.6 6.6 13h5L10 21.4 17.6 11h-5z', FILL), p('M2.6 8.2h3M2 12h2.4M2.6 15.8h2.2')],
  live: () => [p(HEART), p('M6.4 12.2h2.8l1.3-2.6 2.1 5 1.3-2.4h3.7', { 'stroke-width': 1.5 })],
  buy: () => [p('M5 11V8.6A2.6 2.6 0 0 1 7.6 6h8.8A2.6 2.6 0 0 1 19 8.6V11'), p('M3.5 11.6a1.5 1.5 0 0 1 3 0V14h11v-2.4a1.5 1.5 0 0 1 3 0V17a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 17z'), p('M6 18.5v1.6M18 18.5v1.6')],
  build: () => [p('M13 5.6l2-2.1 5.5 5.5-2.1 2z'), p('M14.6 8.5 4.6 18.5a1.4 1.4 0 0 0 2 2l10-10'), p('M11.5 5.2c-1.3-.5-2.8-.2-3.8.8')],
  wallUp: () => [rect(4, 4, 16, 16, 1.6), p('M4 9.3h16M4 14.7h16M10 4v5.3M15 9.3v5.4M9 14.7V20')],
  wallCutaway: () => [rect(4, 12.5, 16, 7.5, 1.4), p('M4 16.2h16M10 12.5v3.7M15 16.2V20'), p('M4 9.4V5.6A1.6 1.6 0 0 1 5.6 4h12.8A1.6 1.6 0 0 1 20 5.6v3.8', { 'stroke-dasharray': '1.8 2.2', 'stroke-width': 1.4 })],
  wallDown: () => [rect(4, 16.6, 16, 3.4, 1.1), p('M4 13V5.6A1.6 1.6 0 0 1 5.6 4h12.8A1.6 1.6 0 0 1 20 5.6V13', { 'stroke-dasharray': '1.8 2.2', 'stroke-width': 1.4 })],
  viewOverview: () => [p('M12 3.8 20.4 8.6 12 13.4 3.6 8.6z'), p('M3.6 12.6 12 17.4l8.4-4.8'), p('M3.6 16.4 12 21.2l8.4-4.8')],
  viewShoulder: () => [c(9.4, 8.2, 3.1), p('M3.4 20.2c0-3.7 2.6-6.2 6-6.2s6 2.5 6 6.2'), rect(16.4, 4.2, 4.6, 3.4, 0.9), p('M17.4 9.4l-2 2.2')],
  viewFirstPerson: () => [p('M2.6 12S6 5.6 12 5.6 21.4 12 21.4 12 18 18.4 12 18.4 2.6 12 2.6 12z'), c(12, 12, 3), c(12, 12, 0.9, FILL)],
  rotateLeft: () => [p('M4.6 12a7.4 7.4 0 1 0 2.2-5.3'), p('M4.4 3.6v4h4')],
  rotateRight: () => [p('M19.4 12a7.4 7.4 0 1 1-2.2-5.3'), p('M19.6 3.6v4h-4')],
  save: () => [p('M6 20.5V10a6 6 0 0 1 12 0v10.5'), p('M4.4 20.5h15.2'), p('M9.3 12.4l1.9 1.9 3.6-3.8')],
  check: () => [p('M5 12.6l4.4 4.4L19 7.4')],
  close: () => [p('M6.6 6.6l10.8 10.8M17.4 6.6 6.6 17.4')],
  menu: () => [p('M4.5 7h15M4.5 12h15M4.5 17h15')],
  bell: () => [p('M6.5 16.6V11a5.5 5.5 0 0 1 11 0v5.6l1.6 2H4.9z'), p('M10 20.6a2 2 0 0 0 4 0')],
  sun: () => [c(12, 12, 4), p('M12 2.6v2.1M12 19.3v2.1M4.6 4.6 6.1 6.1M17.9 17.9l1.5 1.5M2.6 12h2.1M19.3 12h2.1M4.6 19.4l1.5-1.5M17.9 6.1l1.5-1.5')],
  moon: () => [p('M19.4 14.6A8 8 0 1 1 9.4 4.6a6.4 6.4 0 0 0 10 10z')],
  fullMoon: () => [c(12, 12, 8.2), c(9.4, 9.6, 1.7), c(14.6, 14.2, 2.3), c(15, 8.6, 0.95)],
  search: () => [c(10.6, 10.6, 6.1), p('M15.2 15.2l5 5')],
  undo: () => [p('M9 14.2 4 9.2l5-5'), p('M4 9.2h10.4a5.4 5.4 0 0 1 0 10.8H11')],
  redo: () => [p('M15 14.2l5-5-5-5'), p('M20 9.2H9.6a5.4 5.4 0 0 0 0 10.8H13')],
  room: () => [rect(4, 4, 16, 16, 1.4), rect(8, 8, 8, 8, 0.6, { 'stroke-dasharray': '1.8 2', 'stroke-width': 1.4 })],
  deleteWall: () => [rect(3.5, 9.5, 11.5, 10, 1.2), p('M3.5 14.5h11.5M9.2 9.5v5M6.4 14.5v5M12 14.5v5'), p('M16.6 3.6l4.4 4.4M21 3.6 16.6 8')],
  door: () => [p('M6 20.5V4.6a1.1 1.1 0 0 1 1.1-1.1h9.8A1.1 1.1 0 0 1 18 4.6v15.9'), p('M3.8 20.5h16.4'), dot(14.6, 12.2, 1.15)],
  window: () => [p('M5.6 20.5V10a6.4 6.4 0 0 1 12.8 0v10.5z'), p('M12 3.8v16.7M5.6 12.6h12.8')],
  floor: () => [p('M2.8 14.8 12 10.2l9.2 4.6-9.2 4.6z'), p('M7.4 12.5l9.2 4.6M16.6 12.5l-9.2 4.6'), p('M12 4v3.4M9.8 6.2 12 8.2l2.2-2', { 'stroke-width': 1.5 })],
  removeFloor: () => [p('M2.8 14.8 12 10.2l9.2 4.6-9.2 4.6z'), p('M7.4 12.5l9.2 4.6M16.6 12.5l-9.2 4.6', { opacity: 0.55 }), p('M4.5 4.5l15 15')],
  roller: () => [rect(4, 3.5, 13, 5.2, 1.6), p('M17 6.1h2.6v5.6H11.2v3.2'), rect(9.7, 14.9, 3, 5.8, 1.1)],
  eyedropper: () => [p('M17.7 3.8a2.3 2.3 0 0 1 3.2 3.2l-2.5 2.5-3.2-3.2z'), p('M15.6 6.9 6 16.5l-1 3.5 3.5-1 9.6-9.6'), p('M13.3 8.7l2 2')],
  select: () => [p('M6.2 3.6 18.4 12l-5.6 1.3 3.1 6.1-2.3 1.2-3.1-6.2-4.3 4z')],
  chevronRight: () => [p('M9.4 5.6 15.8 12l-6.4 6.4')],
  chevronLeft: () => [p('M14.6 5.6 8.2 12l6.4 6.4')],
  chevronDown: () => [p('M5.6 9.4 12 15.8l6.4-6.4')],
  chevronUp: () => [p('M5.6 14.6 12 8.2l6.4 6.4')],
  trendUp: () => [p('M6 15.5 12 9l6 6.5', { 'stroke-width': 2.6 })],
  trendDown: () => [p('M6 8.5 12 15l6-6.5', { 'stroke-width': 2.6 })],
  plug: () => [p('M9 3.5V8M15 3.5V8'), p('M6.5 8h11v3.2a5.5 5.5 0 0 1-11 0z'), p('M12 16.7v3.8')],
  plugOff: () => [p('M9 3.5V8M15 3.5V8'), p('M6.5 8h11v3.2a5.5 5.5 0 0 1-11 0z'), p('M12 16.7v3.8'), p('M3.5 3.5l17 17')],
  tag: () => [p('M3.5 12.2V4.6a1.1 1.1 0 0 1 1.1-1.1h7.6l8.8 8.8a1.5 1.5 0 0 1 0 2.1l-6.6 6.6a1.5 1.5 0 0 1-2.1 0z'), c(8, 8, 1.4)],
  rotate: () => [p('M20 12a8 8 0 1 1-2.3-5.7'), p('M20.2 3.8v4.6h-4.6')],
  info: () => [c(12, 12, 8.6), p('M12 11v5.6'), dot(12, 7.8, 1.15)],
  warning: () => [p('M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z'), p('M12 9.4v4.6'), dot(12, 17.2, 1.1)],
  users: () => [c(9, 8, 3.2), p('M3 19.5c.4-3.3 2.9-5.5 6-5.5s5.6 2.2 6 5.5'), p('M15.6 5.1a3 3 0 0 1 0 5.8M17.6 14.2c2 .7 3.2 2.7 3.4 5.3')],
  user: () => [c(12, 8, 3.6), p('M5 20c.5-3.8 3.4-6.3 7-6.3s6.5 2.5 7 6.3')],
  gear: () => [
    c(12, 12, 3),
    p('M12 2.8l1.5 2.4 2.7-.8.6 2.8 2.5 1.3-1.1 2.6 1.1 2.6-2.5 1.3-.6 2.8-2.7-.8L12 21.2l-1.5-2.2-2.7.8-.6-2.8-2.5-1.3 1.1-2.6-1.1-2.6 2.5-1.3.6-2.8 2.7.8z'),
  ],
  idCard: () => [rect(3, 5, 18, 14, 2.2), c(8.6, 11, 2), p('M5.8 16.2c.5-1.5 1.5-2.2 2.8-2.2s2.2.7 2.7 2.2M14 10h4M14 13.6h3')],
  pulse: () => [p('M2.8 12.4h4.1l2.1-5.6 4.2 10.6 2.1-5h5.9')],
  medal: () => [c(12, 14.6, 5.2), p('M8.4 3.5l2.2 6.6M15.6 3.5l-2.2 6.6M8 3.5h8'), c(12, 14.6, 2.1)],
  hourglass: () => [p('M7 3.5h10M7 20.5h10M8 3.5c0 4 4 5 4 8.5s-4 4.5-4 8.5M16 3.5c0 4-4 5-4 8.5s4 4.5 4 8.5'), p('M10 18.6h4l-2-2.1z', FILL)],
  gem: () => [p('M7 4.5h10l3.5 5L12 20.5 3.5 9.5z'), p('M3.5 9.5h17M9.6 4.5 8.1 9.5l3.9 11 3.9-11-1.5-5')],
  lock: () => [rect(5, 10.5, 14, 10, 2.2), p('M8 10.5V7.6a4 4 0 0 1 8 0v2.9'), dot(12, 15.4, 1.2)],
  sort: () => [p('M7 4v16M3.6 16.5 7 20l3.4-3.5M17 20V4M13.6 7.5 17 4l3.4 3.5')],
  plus: () => [p('M12 5v14M5 12h14')],
  minus: () => [p('M5 12h14')],
  thermometer: () => [p('M10 14.2V5a2 2 0 0 1 4 0v9.2a4 4 0 1 1-4 0z'), p('M12 9v7.2')],
  exit: () => [p('M13.8 4.5H6.6a1.1 1.1 0 0 0-1.1 1.1v12.8a1.1 1.1 0 0 0 1.1 1.1h7.2'), p('M10.4 12h10M17 8.5l3.5 3.5-3.5 3.5')],
  envelopeHeart: () => [rect(2.8, 5.5, 15, 12, 2), p('M3.5 7.2 10.3 12l6.8-4.8'), p('M19.2 21.2l-2.4-2.3a1.5 1.5 0 0 1 2.1-2.1l.3.3.3-.3a1.5 1.5 0 0 1 2.1 2.1z', { 'stroke-width': 1.5 })],
  target: () => [c(12, 12, 6.8), c(12, 12, 1.6), p('M12 2.6v3.2M12 18.2v3.2M2.6 12h3.2M18.2 12h3.2')],
  calendar: () => [rect(3.5, 5, 17, 15.5, 2.2), p('M3.5 10h17M8 3v4M16 3v4')],
  table: () => [rect(3, 7.4, 18, 3.2, 1.1), p('M5.6 10.6v9M18.4 10.6v9M5.6 15h12.8')],
  candle: () => [rect(9, 10, 6, 10.5, 1.1), p('M12 10V8.2'), p('M12 3.4c1.5 1.6 1.8 3 0 4.6-1.8-1.6-1.5-3 0-4.6z'), p('M6.8 20.5h10.4M15 12.8c-.8.5-.8 1.6 0 2.1')],
  headstone: () => [p('M6.4 20.5V9.6a5.6 5.6 0 0 1 11.2 0v10.9'), p('M4.4 20.5h15.2M12 9v6.2M9.7 11.1h4.6')],
  crate: () => [p('M3.5 7.6 12 3.6l8.5 4v8.8L12 20.4l-8.5-4z'), p('M3.5 7.6 12 11.6l8.5-4M12 11.6v8.8')],
  tree: () => [p('M12 21V11.5M12 14.6 8.4 11.4M12 13l4.2-3.6M8.4 11.4 5.8 9.6M8.4 11.4 7.6 7.8M16.2 9.4l1.2-3.4M16.2 9.4l2.8-.6M12 11.5V6.8l-1.6-2.6M12 6.8l1.8-2.4'), p('M8 21h8')],
  sofa: () => [p('M5 11V8.6A2.6 2.6 0 0 1 7.6 6h8.8A2.6 2.6 0 0 1 19 8.6V11'), p('M3.5 11.6a1.5 1.5 0 0 1 3 0V14h11v-2.4a1.5 1.5 0 0 1 3 0V17a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 17z'), p('M6 18.5v1.6M18 18.5v1.6')],
  bed: () => [p('M3 18.5V6M3 14h18v4.5M21 14v-2.4a3 3 0 0 0-3-3h-6.5V14'), c(7.2, 10.8, 1.9)],
  bulb: () => [p('M9 17.5h6M10 20.5h4M8.6 14.4A5.6 5.6 0 1 1 15.4 14.4c-.8.6-1.2 1.4-1.2 2.3v.8H9.8v-.8c0-.9-.4-1.7-1.2-2.3z')],
  arrowRight: () => [p('M4.5 12h15M14 6.5l5.5 5.5-5.5 5.5')],
  eye: () => [p('M2.6 12S6 5.6 12 5.6 21.4 12 21.4 12 18 18.4 12 18.4 2.6 12 2.6 12z'), c(12, 12, 3)],
  dots: () => [dot(6, 12, 1.4), dot(12, 12, 1.4), dot(18, 12, 1.4)],
  moodGreat: () => face(p('M8 9.6l1.5-1.3 1.5 1.3M13 9.6l1.5-1.3L16 9.6'), p('M7.8 12.8h8.4a4.2 4.2 0 0 1-8.4 0z')),
  moodGood: () => face(dot(9.4, 10.2, 1.05), dot(14.6, 10.2, 1.05), p('M8.4 13.6c1.8 2.5 5.4 2.5 7.2 0')),
  moodFine: () => face(dot(9.4, 10.4, 1.05), dot(14.6, 10.4, 1.05), p('M8.8 15h6.4')),
  moodUneasy: () => face(dot(9.4, 10.4, 1.05), dot(14.6, 10.4, 1.05), p('M8.4 15.6c.9-.9 1.7.9 2.6 0s1.7-.9 2.6 0 1.7.9 2.2 0')),
  moodMiserable: () => face(p('M8 9.3l2.3-.9M16 9.3l-2.3-.9'), dot(9.6, 11.6, 1), dot(14.4, 11.6, 1), p('M8.8 16.6c2-1.6 4.4-1.6 6.4 0'), p('M15.8 13.2c.8 1 .8 1.8 0 2.4-.8-.6-.8-1.4 0-2.4z', FILL)),
} satisfies Record<string, () => JSX.Element[]>;

export type HudIconName = keyof typeof GLYPHS;

/** Every BUBBLE_ICONS id has a glyph (compile-time check). */
const _bubbleCoverage: Record<BubbleIcon, () => JSX.Element[]> = GLYPHS;
void _bubbleCoverage;

export function hasIcon(name: string): name is HudIconName {
  return Object.prototype.hasOwnProperty.call(GLYPHS, name);
}

export interface IconProps {
  name: HudIconName | BubbleIcon | string;
  /** CSS size (default 1.25rem — scales with the UI). */
  size?: string;
  class?: string;
  /** Accessible label; omit for decorative icons (aria-hidden). */
  label?: string;
  strokeWidth?: number;
}

/** HUD names that map onto a differently-named glyph in the shell set. */
const SHELL_ALIAS: Record<string, string> = {
  wallUp: 'wallsUp',
  wallCutaway: 'cutaway',
  wallDown: 'wallsDown',
  speed4: 'ultra',
  tag: 'sell',
  exit: 'quit',
  headstone: 'tombstone',
  needHunger: 'hunger',
  needEnergy: 'energy',
  needPreservation: 'freshness',
  needSocial: 'social',
  needFun: 'fun',
  needHygiene: 'hygiene',
};

/** HUD-only glyphs that must win over a same-named shell glyph (HUD-specific meaning). */
const HUD_FIRST = new Set<string>(['moodGreat', 'moodGood', 'moodFine', 'moodUneasy', 'moodMiserable']);

/**
 * <Icon name="brain" /> — resolves to the shell's icon set first (one visual language across the product),
 * then to the HUD's own glyphs; unknown names render the shell's neutral fallback instead of crashing.
 */
export function Icon({ name, size = '1.25rem', class: cls, label, strokeWidth = 1.75 }: IconProps) {
  const n = typeof name === 'string' ? name : '';
  const shellName = SHELL_ALIAS[n] ?? n;
  const classes = cls ? `hud-icon ${cls}` : 'hud-icon';
  if (!HUD_FIRST.has(n) && shellHasIcon(shellName)) {
    return <ShellIcon name={shellName} size={size} title={label} class={classes} strokeWidth={strokeWidth} />;
  }
  if (!hasIcon(n)) return <ShellIcon name={n} size={size} title={label} class={classes} strokeWidth={strokeWidth} />;
  const glyph = GLYPHS[n];
  return (
    <svg
      class={classes}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
    >
      {glyph()}
    </svg>
  );
}

/** The HUD's own glyph regardless of the shell set (dev sheets). */
export function HudGlyph({ name, size = '1.25rem' }: { name: HudIconName; size?: string }) {
  return (
    <svg class="hud-icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width={1.75} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {GLYPHS[name]()}
    </svg>
  );
}

export const ICON_NAMES = Object.keys(GLYPHS) as HudIconName[];
