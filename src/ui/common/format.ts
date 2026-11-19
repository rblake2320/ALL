/**
 * Pure formatters shared by the shell and HUD. All are total: NaN / Infinity / garbage never throw and never
 * render "NaN" to the player.
 */
import { t } from '../../i18n';

/** Clamp with NaN safety (NaN → lo). */
export function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? lo : v > 0 ? hi : lo;
  return v < lo ? lo : v > hi ? hi : v;
}

/** Insert thousands separators into a non-negative integer string. */
function group(intStr: string): string {
  let out = '';
  for (let i = 0; i < intStr.length; i++) {
    const fromEnd = intStr.length - i;
    out += intStr[i];
    if (fromEnd > 1 && fromEnd % 3 === 1) out += ',';
  }
  return out;
}

const MINUS = '−';

/** 1234.5 → "1,235"; -3 → "−3". Non-finite → "—". */
export function formatNumber(n: number, decimals = 0): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  const d = Math.max(0, Math.min(6, Math.floor(decimals)));
  const abs = Math.abs(n);
  const fixed = abs.toFixed(d);
  const [i, f] = fixed.split('.');
  const neg = n < 0 && Number(fixed) !== 0;
  return (neg ? MINUS : '') + group(i) + (f ? '.' + f : '');
}

/**
 * Dollars: 6500 → "$6,500"; -45 → "−$45"; with sign: 45 → "+$45". Compact: 12500 → "$12.5k", 2_400_000 → "$2.4M".
 * Non-finite → "$—".
 */
export function formatMoney(n: number, opts?: { sign?: boolean; compact?: boolean }): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '$—';
  const rounded = Math.round(n);
  const abs = Math.abs(rounded);
  let body: string;
  if (opts?.compact && abs >= 10_000) {
    if (abs >= 1_000_000) body = trimZero((abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)) + 'M';
    else body = trimZero((abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)) + 'k';
  } else {
    body = group(String(abs));
  }
  const prefix = rounded < 0 ? MINUS : opts?.sign && rounded > 0 ? '+' : '';
  return `${prefix}$${body}`;
}

function trimZero(s: string): string {
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/** 0.623 → "62%". Clamped to [0, 100]. */
export function formatPercent(v01: number): string {
  return `${Math.round(clamp(v01, 0, 1) * 100)}%`;
}

/** Bytes → "512 B", "12 KB", "3.4 MB". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${trimZero((n / (1024 * 1024)).toFixed(1))} MB`;
}

/** Game/real minutes → "45 min", "3 h 12 min", "2 h". */
export function formatDurationMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return t('time.minutes', { m: 0 });
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return t('time.minutes', { m });
  if (m === 0) return t('time.hours', { h: formatNumber(h) });
  return t('time.hoursMinutes', { h: formatNumber(h), m });
}

/** Parses an ISO date; returns NaN for garbage. */
export function parseTime(iso: string | number | null | undefined): number {
  if (typeof iso === 'number') return Number.isFinite(iso) ? iso : NaN;
  if (typeof iso !== 'string' || iso.length === 0) return NaN;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : NaN;
}

/** "Mar 3, 2026" without relying on Intl (stable in tests and every locale). */
export function formatDate(ms: number): string {
  if (!Number.isFinite(ms)) return t('time.unknown');
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return t('time.unknown');
  const months = t('time.monthsShort').split(' ');
  return t('time.date', { month: months[d.getMonth()] ?? '', day: d.getDate(), year: d.getFullYear() });
}

/** Relative "saved … ago" label. Future timestamps (clock skew) read as "just now". */
export function formatSavedAgo(iso: string | number | null | undefined, nowMs: number): string {
  const then = parseTime(iso);
  if (!Number.isFinite(then) || !Number.isFinite(nowMs)) return t('time.unknown');
  const diffSec = (nowMs - then) / 1000;
  if (diffSec < 45) return t('time.justNow');
  const min = Math.round(diffSec / 60);
  if (min < 60) return t('time.minutesAgo', { count: Math.max(1, min) });
  const hours = Math.floor(diffSec / 3600);
  if (hours < 24) return t('time.hoursAgo', { count: hours });
  const days = Math.floor(diffSec / 86400);
  if (days < 2) return t('time.yesterday');
  if (days < 7) return t('time.daysAgo', { count: days });
  return formatDate(then);
}

/** Trend per game hour → 0..3 arrow count (sign gives direction). Thresholds: 0.5 / 4 / 12 per hour. */
export function trendMagnitude(perHour: number): -3 | -2 | -1 | 0 | 1 | 2 | 3 {
  if (!Number.isFinite(perHour)) return 0;
  const a = Math.abs(perHour);
  const m = a < 0.5 ? 0 : a < 4 ? 1 : a < 12 ? 2 : 3;
  if (m === 0) return 0;
  return (perHour > 0 ? m : -m) as 1 | 2 | 3 | -1 | -2 | -3;
}

/** Spoken/visible label for a trend magnitude. */
export function trendLabel(mag: number): string {
  switch (mag) {
    case 3:
      return t('need.trend.upFast');
    case 2:
      return t('need.trend.up');
    case 1:
      return t('need.trend.upSlow');
    case -1:
      return t('need.trend.downSlow');
    case -2:
      return t('need.trend.down');
    case -3:
      return t('need.trend.downFast');
    default:
      return t('need.trend.steady');
  }
}

/** Display name for an agent-ish object, tolerating blanks. */
export function displayName(first: string | null | undefined, last?: string | null): string {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  const full = [f, l].filter(Boolean).join(' ');
  return full || t('caz.unnamed');
}

/** Initials for avatars: "Mortimer Grimsby" → "MG". */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = Array.from(parts[0])[0] ?? '';
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? '') : '';
  return (first + last).toUpperCase();
}
