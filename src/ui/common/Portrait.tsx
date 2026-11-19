/**
 * Procedural zombie portrait (SVG) from a ZombieAppearance: head shape from build/height, skin tone, hair
 * silhouette per style & colour, eyes per eye style & colour, outfit neckline, accessory, stitches, and an
 * optional mood ring. Pure presentation — safe with partial or garbage appearance data.
 *
 * A cast body (appearance.body, shared/cast.ts) has no procedural parts: its baked thumbnail
 * (assets/ui/cast/<id>.webp) is shown face-cropped in the same frame + ring instead. If the image fails to load
 * (missing asset, offline file://), the portrait falls back to the procedural SVG for that body; while the browser
 * is offline an image that was not preloaded (castArtCache) is not requested at all.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

import type { ZombieAppearance } from '../../shared/appearance';
import { t } from '../../i18n';
import {
  appearanceSeed,
  eyeShapes,
  hairShapes,
  headPath,
  mouthPath,
  portraitDims,
  portraitPalette,
  shouldersPath,
  type PortraitDims,
  type PortraitPalette,
} from './portraitParts';
import { castBodyOf, castFaceCrop, faceCropRect } from './castArt';
import { castArtHref } from './castArtCache';
import { cx } from './cx';
import { useUid } from './uid';

export interface PortraitProps {
  appearance: Partial<ZombieAppearance> | null | undefined;
  /** CSS length or px. Default 4rem. */
  size?: string | number;
  /** Mood-ring colour; null hides the ring. */
  ring?: string | null;
  /** Pulsing ring (critical need / alert). */
  alert?: boolean;
  /** Greyed out (away, crumbled). */
  dimmed?: boolean;
  expression?: string;
  /** Magnification of the bust inside the frame (default 1.1). ~1.45 frames just the head (choice tiles). */
  zoom?: number;
  /** Vertical pivot for the zoom in viewBox units (default 54; ~40 centres the face). */
  focusY?: number;
  /** Accessible name; omit for decorative portraits. */
  name?: string;
  class?: string;
  style?: JSX.CSSProperties;
}

const INK = '#22182a';

export function Portrait({ appearance, size = '4rem', ring = '#d9cfb8', alert, dimmed, expression, zoom = 1.1, focusY = 54, name, class: cls, style }: PortraitProps) {
  const uid = useUid().replace(/[^A-Za-z0-9_-]/g, '');
  const app = appearance ?? {};
  const d = portraitDims(app);
  const pal = portraitPalette(app);
  const hair = hairShapes(app.hairStyle, d);
  const eyes = eyeShapes(app.eyeStyle, d);
  const seed = appearanceSeed(app);
  const blotchRight = seed % 2 === 0;
  const dim = typeof size === 'number' ? `${size}px` : size;
  const accessory = app.accessory ?? 'none';
  const ids = { bg: `pbg${uid}`, clip: `pcl${uid}`, skin: `psk${uid}`, hair: `phr${uid}` };
  const z = Number.isFinite(zoom) ? Math.min(3, Math.max(0.5, zoom)) : 1.1;
  const fy = Number.isFinite(focusY) ? Math.min(100, Math.max(0, focusY)) : 54;
  const castId = castBodyOf(app);
  const [brokenCast, setBrokenCast] = useState<string | null>(null);
  // preloaded blob URL, the network URL while online, or null offline (procedural face, no doomed request)
  const castHref = castId !== null ? castArtHref(castId) : null;

  if (castId !== null && castHref !== null && brokenCast !== castId) {
    const r = faceCropRect(castFaceCrop(castId));
    return (
      <span
        class={cx('ui-portrait', 'ui-portrait--cast', alert && 'is-alert', !!ring && 'has-ring', dimmed && 'is-dimmed', cls)}
        style={{ width: dim, height: dim, ...(style as object), ...(ring ? { '--ring': ring } : {}) } as JSX.CSSProperties}
        role={name ? 'img' : undefined}
        aria-label={name ? t('portrait.aria', { name }) : undefined}
        aria-hidden={name ? undefined : 'true'}
        data-cast={castId}
      >
        <svg viewBox="0 0 100 100" width="100%" height="100%">
          <defs>
            <radialGradient id={ids.bg} cx="50%" cy="34%" r="72%">
              <stop offset="0%" stop-color="#8a7ba3" />
              <stop offset="48%" stop-color="#584a6e" />
              <stop offset="100%" stop-color="#2a2236" />
            </radialGradient>
            <clipPath id={ids.clip}>
              <circle cx="50" cy="50" r="45.5" />
            </clipPath>
          </defs>
          <circle cx="50" cy="50" r="45.5" fill={`url(#${ids.bg})`} />
          <g clip-path={`url(#${ids.clip})`}>
            <image
              href={castHref}
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
              preserveAspectRatio="xMidYMid slice"
              onError={() => setBrokenCast(castId)}
            />
          </g>
          <circle cx="50" cy="50" r="45.5" fill="none" stroke="#0b0710" stroke-opacity="0.55" stroke-width="1.2" />
          {ring ? <circle class="ui-portrait__ring" cx="50" cy="50" r="47.6" fill="none" stroke-width="3.6" /> : null}
        </svg>
      </span>
    );
  }

  return (
    <span
      class={cx('ui-portrait', alert && 'is-alert', !!ring && 'has-ring', dimmed && 'is-dimmed', cls)}
      style={{ width: dim, height: dim, ...(style as object), ...(ring ? { '--ring': ring } : {}) } as JSX.CSSProperties}
      role={name ? 'img' : undefined}
      aria-label={name ? t('portrait.aria', { name }) : undefined}
      aria-hidden={name ? undefined : 'true'}
    >
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <defs>
          <radialGradient id={ids.bg} cx="50%" cy="34%" r="72%">
            <stop offset="0%" stop-color="#8a7ba3" />
            <stop offset="48%" stop-color="#584a6e" />
            <stop offset="100%" stop-color="#2a2236" />
          </radialGradient>
          <radialGradient id={ids.skin} cx="40%" cy="32%" r="78%">
            <stop offset="0%" stop-color={pal.skinLight} />
            <stop offset="55%" stop-color={pal.skin} />
            <stop offset="100%" stop-color={pal.skinShade} />
          </radialGradient>
          <linearGradient id={ids.hair} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color={pal.hairLight} />
            <stop offset="100%" stop-color={pal.hair} />
          </linearGradient>
          <clipPath id={ids.clip}>
            <circle cx="50" cy="50" r="45.5" />
          </clipPath>
        </defs>
        <circle cx="50" cy="50" r="45.5" fill={`url(#${ids.bg})`} />
        <g clip-path={`url(#${ids.clip})`}>
          <g transform={`translate(50 ${fy}) scale(${z}) translate(-50 ${-fy})`}>
          <ellipse cx="50" cy="96" rx="40" ry="10" fill="#0d0912" opacity="0.35" />
          {hair.back.map((p, i) => (
            <path key={`hb${i}`} d={p} fill={`url(#${ids.hair})`} stroke={pal.hairRim} stroke-width="1" stroke-opacity="0.7" />
          ))}
          <Torso app={app} pal={pal} d={d} />
          <path d={`M${50 - 7.5} ${d.chin - 6}L${50 - 7.5} ${78}Q50 82 ${50 + 7.5} 78L${50 + 7.5} ${d.chin - 6}Z`} fill={pal.skinShade} />
          <ellipse cx={50 - d.hw * 1.03} cy={d.cy + 2.5} rx="3.2" ry="5" fill={pal.skinShade} stroke={pal.skinDeep} stroke-width="0.8" />
          <ellipse cx={50 + d.hw} cy={d.cy + 2.5} rx="3.2" ry="5" fill={pal.skinShade} stroke={pal.skinDeep} stroke-width="0.8" />
          <path d={headPath(d)} fill={`url(#${ids.skin})`} stroke={pal.skinDeep} stroke-width="0.9" />
          <ellipse
            cx={blotchRight ? 50 + d.hw * 0.52 : 50 - d.hw * 0.55}
            cy={d.cy + 7}
            rx="4.2"
            ry="3"
            fill={pal.skinDeep}
            opacity="0.2"
            transform={`rotate(${blotchRight ? -18 : 15} ${blotchRight ? 50 + d.hw * 0.52 : 50 - d.hw * 0.55} ${d.cy + 7})`}
          />
          <Eyes eyes={eyes} pal={pal} accessory={accessory} />
          <Brows d={d} pal={pal} style={app.eyeStyle} bald={app.hairStyle === 'bald'} />
          <path d={`M${49} ${d.cy + 6.5}q1.6 2.6 3.2 .2`} fill="none" stroke={pal.skinDeep} stroke-width="1.2" stroke-linecap="round" opacity="0.75" />
          <path
            d={mouthPath(expression, d)}
            fill={expression === 'shocked' ? '#3a2430' : 'none'}
            stroke="#3a2430"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          {app.stitches !== false ? <Stitches d={d} pal={pal} right={!blotchRight} /> : null}
          {hair.front.map((p, i) => (
            <path key={`hf${i}`} d={p} fill={`url(#${ids.hair})`} stroke={pal.hairRim} stroke-width="0.9" stroke-opacity="0.75" stroke-linejoin="round" />
          ))}
          {hair.strands.map((p, i) => (
            <path key={`hs${i}`} d={p} fill="none" stroke={pal.hair} stroke-width="1.3" stroke-linecap="round" />
          ))}
          <Accessory kind={accessory} d={d} pal={pal} />
          </g>
        </g>
        <circle cx="50" cy="50" r="45.5" fill="none" stroke="#0b0710" stroke-opacity="0.55" stroke-width="1.2" />
        {ring ? <circle class="ui-portrait__ring" cx="50" cy="50" r="47.6" fill="none" stroke-width="3.6" /> : null}
      </svg>
    </span>
  );
}

function Torso({ app, pal, d }: { app: Partial<ZombieAppearance>; pal: PortraitPalette; d: PortraitDims }) {
  const style = app.topStyle ?? 'tee';
  const neckY = 76.5;
  const shirt = '#e6dcc2';
  return (
    <g>
      <path d={shouldersPath(app.build ?? 0.4)} fill={pal.top} stroke={pal.topShade} stroke-width="1" />
      {style === 'tee' ? <path d={`M41 ${neckY - 0.5}Q50 ${neckY + 6.5} 59 ${neckY - 0.5}`} fill={pal.skinShade} stroke={pal.topShade} stroke-width="1.6" /> : null}
      {style === 'hoodie' ? (
        <g>
          <path d={`M33 ${neckY + 3}Q36 ${neckY - 5} 50 ${neckY - 3.5}Q64 ${neckY - 5} 67 ${neckY + 3}Q60 ${neckY + 0.5} 50 ${neckY + 6}Q40 ${neckY + 0.5} 33 ${neckY + 3}Z`} fill={pal.topShade} />
          <path d={`M46.5 ${neckY + 5.5}v9M53.5 ${neckY + 5.5}v9`} stroke="#e8e0c8" stroke-width="1.2" stroke-linecap="round" opacity="0.8" />
        </g>
      ) : null}
      {style === 'suit' ? (
        <g>
          <path d={`M42.5 ${neckY - 0.5}L50 ${neckY + 13}L57.5 ${neckY - 0.5}Z`} fill={shirt} />
          <path d={`M48.6 ${neckY + 2.2}h2.8l-.5 2.2 1.1 7-2 2.3-2-2.3 1.1-7z`} fill="#6e2a35" />
          <path d={`M41.5 ${neckY - 1}L50 ${neckY + 15}L44 ${neckY + 15}L36.5 ${neckY + 3}Z`} fill={pal.topShade} />
          <path d={`M58.5 ${neckY - 1}L50 ${neckY + 15}L56 ${neckY + 15}L63.5 ${neckY + 3}Z`} fill={pal.topShade} />
        </g>
      ) : null}
      {style === 'blouse' ? (
        <g>
          <path d={`M41.5 ${neckY - 1}Q50 ${neckY + 4} 58.5 ${neckY - 1}`} fill={pal.skinShade} />
          <path d={`M41 ${neckY - 1.5}L49.5 ${neckY + 3.5}L44 ${neckY + 7}Z M59 ${neckY - 1.5}L50.5 ${neckY + 3.5}L56 ${neckY + 7}Z`} fill={shirt} stroke={pal.topShade} stroke-width="0.8" stroke-linejoin="round" />
        </g>
      ) : null}
      {style === 'dress' ? (
        <g>
          <path d={`M34 ${neckY + 2}Q50 ${neckY + 14} 66 ${neckY + 2}L64 ${neckY - 1}Q50 ${neckY + 3} 36 ${neckY - 1}Z`} fill={pal.skinShade} />
          <path d={`M37 ${neckY + 1}l-2.5 8M63 ${neckY + 1}l2.5 8`} stroke={pal.topShade} stroke-width="2.2" stroke-linecap="round" />
        </g>
      ) : null}
      {style === 'tatters' ? (
        <g>
          <path d={`M40 ${neckY - 1}l2.2 4 2-2.6 2.4 4.4 2.1-3.1 2.3 4.2 2.2-3.6 2.4 3.4 2-4.2 2.4 2.1V${neckY - 1}Q50 ${neckY + 2} 40 ${neckY - 1}Z`} fill={pal.skinShade} />
          <ellipse cx="37" cy={neckY + 13} rx="2.2" ry="1.6" fill="#120d17" opacity="0.6" />
          <ellipse cx="62.5" cy={neckY + 17} rx="1.6" ry="1.2" fill="#120d17" opacity="0.55" />
        </g>
      ) : null}
      {style === 'cardigan' ? (
        <g>
          <path d={`M43 ${neckY - 1}L50 ${neckY + 16}L57 ${neckY - 1}Z`} fill={shirt} />
          <path d={`M43 ${neckY - 1}L50 ${neckY + 16}M57 ${neckY - 1}L50 ${neckY + 16}`} stroke={pal.topShade} stroke-width="1.4" />
          <circle cx="50" cy={neckY + 19} r="1" fill={pal.topShade} />
          <circle cx="50" cy={neckY + 23} r="1" fill={pal.topShade} />
        </g>
      ) : null}
      <path d={`M${50 - 7.5} ${d.chin + 2}Q50 ${d.chin + 6} ${50 + 7.5} ${d.chin + 2}`} fill="none" stroke={pal.skinDeep} stroke-width="0.8" opacity="0.45" />
    </g>
  );
}

function Eyes({ eyes, pal, accessory }: { eyes: ReturnType<typeof eyeShapes>; pal: PortraitPalette; accessory: string }) {
  const patchRight = accessory === 'eyepatch';
  const visible = (i: number) => !(patchRight && i === 1);
  return (
    <g>
      {eyes.sockets.map(([x, y, rx, ry], i) => (visible(i) ? <ellipse key={`s${i}`} cx={x} cy={y} rx={rx} ry={ry} fill={pal.skinDeep} opacity="0.32" /> : null))}
      {eyes.whites.map(([x, y, rx, ry], i) => (visible(i) ? <ellipse key={`w${i}`} cx={x} cy={y} rx={rx} ry={ry} fill="#efe8cf" stroke={INK} stroke-opacity="0.35" stroke-width="0.6" /> : null))}
      {eyes.irises.map(([x, y, r], i) =>
        visible(i) ? <circle key={`i${i}`} cx={x} cy={y} r={r} fill={eyes.whites.length ? pal.eye : INK} stroke={eyes.whites.length ? '#3a2c1c' : 'none'} stroke-opacity="0.45" stroke-width="0.5" /> : null,
      )}
      {eyes.pupils.map(([x, y, r], i) => (visible(i) ? <circle key={`p${i}`} cx={x} cy={y} r={r} fill={INK} /> : null))}
      {eyes.irises.map(([x, y, r], i) => (visible(i) ? <circle key={`h${i}`} cx={x - r * 0.38} cy={y - r * 0.42} r={Math.max(0.55, r * 0.28)} fill="#fffaf0" opacity="0.9" /> : null))}
      {eyes.lids.map((p, i) => (visible(i) ? <path key={`l${i}`} d={p} fill={pal.skin} /> : null))}
      {eyes.lines.map((p, i) => (visible(i) ? <path key={`ll${i}`} d={p} fill="none" stroke={INK} stroke-width="1.05" stroke-linecap="round" opacity="0.8" /> : null))}
    </g>
  );
}

function Brows({ d, pal, style, bald }: { d: PortraitDims; pal: PortraitPalette; style?: string; bald: boolean }) {
  const y = d.cy - 6.2 - (style === 'wide' ? 1.2 : 0);
  const color = bald ? pal.skinDeep : pal.hairShade;
  const tilt = style === 'sleepy' || style === 'droopy' ? 1.1 : style === 'beady' ? -0.6 : 0;
  return (
    <path
      d={`M${50 - 11.5} ${y + tilt}Q${50 - 7.5} ${y - 1.8} ${50 - 3.5} ${y - 0.4}M${50 + 3.8} ${y - 0.6}Q${50 + 8} ${y - 2.2} ${50 + 12} ${y + tilt * 0.7}`}
      fill="none"
      stroke={color}
      stroke-width="1.7"
      stroke-linecap="round"
      opacity="0.9"
    />
  );
}

function Stitches({ d, pal, right }: { d: PortraitDims; pal: PortraitPalette; right: boolean }) {
  const sx = right ? 50 + d.hw * 0.5 : 50 - d.hw * 0.62;
  const sy = d.cy + 4.5;
  const dir = right ? 1 : -1;
  const ex = sx + dir * 3.6;
  const ey = sy + 7.5;
  const ticks = [0.2, 0.5, 0.8].map((k) => {
    const x = sx + (ex - sx) * k;
    const y = sy + (ey - sy) * k;
    return `M${x - 1.7} ${y - dir * 0.8 * -1}L${x + 1.7} ${y + dir * 0.8 * -1}`;
  });
  return (
    <g stroke="#2a1d26" stroke-linecap="round" fill="none" opacity="0.85">
      <path d={`M${sx} ${sy}L${ex} ${ey}`} stroke={pal.skinDeep} stroke-width="1.1" />
      <path d={ticks.join('')} stroke-width="0.95" />
      <path d={`M${50 - 6} ${d.chin + 6.5}L${50 + 6} ${d.chin + 6.5}`} stroke={pal.skinDeep} stroke-width="0.9" opacity="0.8" />
      <path d={`M${50 - 4} ${d.chin + 5}v3M50 ${d.chin + 5}v3M${50 + 4} ${d.chin + 5}v3`} stroke-width="0.85" />
    </g>
  );
}

function Accessory({ kind, d, pal }: { kind: string; d: PortraitDims; pal: PortraitPalette }) {
  const ey = d.cy + 1.5;
  switch (kind) {
    case 'glasses':
      return (
        <g fill="rgba(200,230,255,0.14)" stroke="#1a1320" stroke-width="1.5">
          <circle cx={50 - 7.2} cy={ey} r="5.9" />
          <circle cx={50 + 7.8} cy={ey} r="5.9" />
          <path d={`M${50 - 1.3} ${ey - 0.8}q1.6-1.6 3.2 0`} fill="none" />
          <path d={`M${50 - 13.1} ${ey - 1}L${50 - d.hw * 1.03} ${ey - 2}M${50 + 13.7} ${ey - 1}L${50 + d.hw} ${ey - 2}`} fill="none" />
        </g>
      );
    case 'bowtie':
      return (
        <g transform="translate(50 79.5)">
          <path d="M-1.8 0L-8.5 -4.2Q-9.6 0 -8.5 4.2Z M1.8 0L8.5 -4.2Q9.6 0 8.5 4.2Z" fill="#8c3644" stroke="#4a1a22" stroke-width="0.8" stroke-linejoin="round" />
          <rect x="-2.2" y="-2.4" width="4.4" height="4.8" rx="1.2" fill="#6e2a35" stroke="#4a1a22" stroke-width="0.8" />
        </g>
      );
    case 'necklace':
      return (
        <g>
          <path d={`M41 77.5Q50 88 59 77.5`} fill="none" stroke="#c9b27a" stroke-width="1" stroke-dasharray="1.4 1" />
          <path d="M50 84.6l2.1 2.6-2.1 3-2.1-3z" fill="#9fe870" stroke="#2f5a22" stroke-width="0.6" />
        </g>
      );
    case 'beanie': {
      const y0 = d.cy - d.hh * 0.42;
      const L = 50 - d.hw * 1.12;
      const R = 50 + d.hw * 1.1;
      return (
        <g>
          <path
            d={`M${L} ${y0}C${L - 1} ${d.top - 4} ${50 - d.hw * 0.6} ${d.top - 9} 50 ${d.top - 9}C${50 + d.hw * 0.6} ${d.top - 9} ${R + 1} ${d.top - 4} ${R} ${y0}Z`}
            fill="#c58b3a"
            stroke="#7a521d"
            stroke-width="1"
          />
          <path d={`M${L - 1} ${y0 - 4.5}Q50 ${y0 - 8} ${R + 1} ${y0 - 4.5}L${R + 1} ${y0 + 0.5}Q50 ${y0 - 3} ${L - 1} ${y0 + 0.5}Z`} fill="#a8722b" stroke="#7a521d" stroke-width="0.9" />
          <path d={`M${50 - 6} ${d.top - 3}v4M50 ${d.top - 4.5}v5M${50 + 6} ${d.top - 3}v4`} stroke="#7a521d" stroke-width="0.8" opacity="0.6" />
          <circle cx="50" cy={d.top - 10.5} r="3.6" fill="#e3cf6a" stroke="#7a521d" stroke-width="0.8" />
        </g>
      );
    }
    case 'bandage':
      return (
        <g transform={`rotate(-16 50 ${d.cy - 10})`}>
          <rect x={50 - d.hw - 2} y={d.cy - 13} width={d.hw * 2 + 4} height="5.4" rx="1.4" fill="#ece3c9" stroke="#a89f8c" stroke-width="0.8" />
          <path d={`M${50 - 6} ${d.cy - 13}v5.4M${50 - 2} ${d.cy - 13}v5.4M${50 + 2} ${d.cy - 13}v5.4M${50 + 6} ${d.cy - 13}v5.4`} stroke="#c8bd9f" stroke-width="0.7" />
          <ellipse cx={50 + 3} cy={d.cy - 10.2} rx="1.6" ry="1.1" fill="#a5532f" opacity="0.55" />
        </g>
      );
    case 'flower': {
      const fx = 50 + d.hw * 0.86;
      const fy = d.cy - d.hh * 0.62;
      return (
        <g transform={`translate(${fx} ${fy})`}>
          {[0, 72, 144, 216, 288].map((a) => (
            <ellipse key={a} cx="0" cy="-3.4" rx="2.4" ry="3.4" fill="#d87aa0" stroke="#8a3a5c" stroke-width="0.6" transform={`rotate(${a})`} />
          ))}
          <circle r="2.1" fill="#e3cf6a" stroke="#8a6a1c" stroke-width="0.6" />
        </g>
      );
    }
    case 'eyepatch':
      return (
        <g>
          <path d={`M${50 - d.hw * 1.03} ${ey - 9}L${50 + d.hw} ${ey + 2.5}`} stroke="#1a1320" stroke-width="1.4" />
          <path d={`M${50 + 2.6} ${ey - 3.8}Q${50 + 7.8} ${ey - 6.5} ${50 + 13} ${ey - 3.4}Q${50 + 13.2} ${ey + 5} ${50 + 7.8} ${ey + 5.6}Q${50 + 2.6} ${ey + 4.6} ${50 + 2.6} ${ey - 3.8}Z`} fill="#1f1824" stroke="#0d0910" stroke-width="0.8" />
        </g>
      );
    default:
      return null;
  }
}
