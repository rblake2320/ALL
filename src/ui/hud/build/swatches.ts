/**
 * CSS backgrounds that suggest each wall/floor pattern (src/shared/styles.ts) from its base + accent colours,
 * so style pickers read like little material samples rather than flat chips. Pure; invalid colours fall back.
 */
import type { FloorPattern, WallPattern } from '../../../shared/styles';
import { mixHex, parseHex } from '../lib/format';

function c(hex: unknown, fallback: string): string {
  return typeof hex === 'string' && parseHex(hex) ? hex : fallback;
}

export function wallSwatch(pattern: WallPattern | string, base: string, accent: string): string {
  const b = c(base, '#d9cfb8');
  const a = c(accent, mixHex(b, '#000000', 0.2));
  const hi = mixHex(b, '#ffffff', 0.12);
  switch (pattern) {
    case 'stripes':
      return `repeating-linear-gradient(90deg, ${b} 0 0.42rem, ${a} 0.42rem 0.62rem)`;
    case 'damask':
      return `radial-gradient(ellipse 0.32rem 0.5rem at 50% 50%, ${a} 0 70%, transparent 72%) 0 0 / 1rem 1.2rem, radial-gradient(circle at 0 0, ${a} 0 0.12rem, transparent 0.14rem) 0 0 / 0.5rem 0.6rem, ${b}`;
    case 'wallpaperFloral':
      return `radial-gradient(circle at 30% 30%, ${a} 0 0.14rem, transparent 0.16rem) 0 0 / 0.8rem 0.8rem, radial-gradient(circle at 70% 70%, ${mixHex(a, b, 0.4)} 0 0.1rem, transparent 0.12rem) 0 0 / 0.8rem 0.8rem, ${b}`;
    case 'brick':
      return `linear-gradient(0deg, ${a} 0 0.08rem, transparent 0.08rem) 0 0 / 100% 0.55rem, linear-gradient(90deg, ${a} 0 0.08rem, transparent 0.08rem) 0 0 / 1.1rem 1.1rem, linear-gradient(90deg, ${a} 0 0.08rem, transparent 0.08rem) 0.55rem 0.55rem / 1.1rem 1.1rem, ${b}`;
    case 'wood':
      return `repeating-linear-gradient(90deg, ${b} 0 0.7rem, ${a} 0.7rem 0.78rem), linear-gradient(180deg, ${hi}, ${b})`;
    case 'tile':
      return `linear-gradient(0deg, ${a} 0 0.07rem, transparent 0.07rem) 0 0 / 0.6rem 0.6rem, linear-gradient(90deg, ${a} 0 0.07rem, transparent 0.07rem) 0 0 / 0.6rem 0.6rem, ${b}`;
    case 'stone':
      return `linear-gradient(0deg, ${a} 0 0.1rem, transparent 0.1rem) 0 0 / 100% 0.8rem, linear-gradient(90deg, ${a} 0 0.1rem, transparent 0.1rem) 0 0 / 1.3rem 1.6rem, linear-gradient(90deg, ${a} 0 0.1rem, transparent 0.1rem) 0.65rem 0.8rem / 1.3rem 1.6rem, radial-gradient(circle at 30% 20%, ${hi}, ${b})`;
    case 'plaster':
    default:
      return `radial-gradient(circle at 20% 30%, ${hi} 0 18%, transparent 40%), radial-gradient(circle at 75% 70%, ${a} 0 12%, transparent 38%), ${b}`;
  }
}

export function floorSwatch(pattern: FloorPattern | string, base: string, accent: string): string {
  const b = c(base, '#7a5a3e');
  const a = c(accent, mixHex(b, '#000000', 0.25));
  const hi = mixHex(b, '#ffffff', 0.12);
  switch (pattern) {
    case 'planks':
      return `linear-gradient(0deg, ${a} 0 0.07rem, transparent 0.07rem) 0 0 / 100% 0.55rem, linear-gradient(90deg, ${a} 0 0.07rem, transparent 0.07rem) 0 0 / 1.6rem 1.1rem, linear-gradient(90deg, ${a} 0 0.07rem, transparent 0.07rem) 0.8rem 0.55rem / 1.6rem 1.1rem, ${b}`;
    case 'checker':
      return `conic-gradient(${a} 0 25%, ${b} 0 50%, ${a} 0 75%, ${b} 0) 0 0 / 1rem 1rem`;
    case 'carpet':
      return `radial-gradient(circle, ${a} 0 0.05rem, transparent 0.07rem) 0 0 / 0.22rem 0.22rem, radial-gradient(circle at 30% 30%, ${hi}, ${b})`;
    case 'stone':
      return `linear-gradient(0deg, ${a} 0 0.1rem, transparent 0.1rem) 0 0 / 100% 0.9rem, linear-gradient(90deg, ${a} 0 0.1rem, transparent 0.1rem) 0 0 / 1.2rem 1.8rem, linear-gradient(90deg, ${a} 0 0.1rem, transparent 0.1rem) 0.6rem 0.9rem / 1.2rem 1.8rem, radial-gradient(circle at 70% 30%, ${hi}, ${b})`;
    case 'tile':
      return `linear-gradient(0deg, ${a} 0 0.08rem, transparent 0.08rem) 0 0 / 0.75rem 0.75rem, linear-gradient(90deg, ${a} 0 0.08rem, transparent 0.08rem) 0 0 / 0.75rem 0.75rem, ${b}`;
    case 'dirt':
      return `radial-gradient(circle at 20% 30%, ${a} 0 0.08rem, transparent 0.1rem) 0 0 / 0.55rem 0.5rem, radial-gradient(circle at 70% 60%, ${hi} 0 0.06rem, transparent 0.08rem) 0 0 / 0.45rem 0.6rem, ${b}`;
    case 'parquet':
      return `repeating-linear-gradient(45deg, ${b} 0 0.35rem, ${a} 0.35rem 0.42rem), repeating-linear-gradient(-45deg, transparent 0 0.7rem, ${a} 0.7rem 0.77rem)`;
    case 'marble':
      return `linear-gradient(115deg, transparent 38%, ${a} 40%, transparent 43%), linear-gradient(160deg, transparent 60%, ${mixHex(a, b, 0.4)} 62%, transparent 65%), radial-gradient(circle at 30% 20%, ${hi}, ${b})`;
    default:
      return b;
  }
}
