/** Brand marks: the coffin-house emblem and the "Afterlife Lease" wordmark (original artwork). */
import type { JSX } from 'preact';

import { t } from '../../i18n';
import { cx } from '../common/cx';
import { useUid } from '../common/uid';

export function Emblem({ size = '4rem', glow = true, class: cls }: { size?: string; glow?: boolean; class?: string }) {
  const id = useUid().replace(/[^A-Za-z0-9_-]/g, '');
  return (
    <svg class={cx('sh-emblem', cls)} width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`eb${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#4c3e60" />
          <stop offset="1" stop-color="#231c2e" />
        </linearGradient>
        <radialGradient id={`ew${id}`} cx="50%" cy="50%" r="60%">
          <stop offset="0" stop-color="#e4ffcf" />
          <stop offset="0.45" stop-color="#9fe870" />
          <stop offset="1" stop-color="#4f9a33" />
        </radialGradient>
      </defs>
      {glow ? <circle cx="32" cy="35" r="20" fill="#9fe870" opacity="0.1" /> : null}
      <path d="M50.5 6.5a7.5 7.5 0 1 1-6.2 11.6 6.3 6.3 0 0 0 6.2-11.6z" fill="#ffd08f" opacity="0.92" />
      <path d="M42.5 12.6v-4.6h4.1v8" fill="#2a2236" stroke="#e8e0c8" stroke-width="1.6" stroke-linejoin="round" />
      <path d="M32 4.5L53 21.5 46.5 59.5H17.5L11 21.5z" fill={`url(#eb${id})`} stroke="#e8e0c8" stroke-width="2.2" stroke-linejoin="round" />
      <path d="M32 9.5L48.3 22.6 42.9 55.5H21.1L15.7 22.6z" stroke="#e8e0c8" stroke-opacity="0.22" stroke-width="1" stroke-linejoin="round" />
      <rect x="25.5" y="25" width="13" height="12.5" rx="1.6" fill={`url(#ew${id})`} />
      <path d="M32 25v12.5M25.5 31.2h13" stroke="#231c2e" stroke-width="1.6" />
      <path d="M28.5 59.5v-9.3a3.5 3.5 0 0 1 7 0v9.3" fill="#130f19" stroke="#e8e0c8" stroke-width="1.6" />
      <path d="M21 44.5l2.2 2.2M23.2 44.5L21 46.7M40.8 44.5l2.2 2.2M43 44.5l-2.2 2.2" stroke="#ffb35a" stroke-width="1.2" stroke-linecap="round" opacity="0.8" />
    </svg>
  );
}

export function Wordmark({ animated = false, size = 'lg', class: cls }: { animated?: boolean; size?: 'lg' | 'md' | 'sm'; class?: string }) {
  const first = 'Afterlife';
  const second = 'Lease';
  return (
    <h1 class={cx('sh-wordmark', `sh-wordmark--${size}`, animated && 'is-animated', cls)} aria-label={t('app.title')}>
      <span class="sh-wordmark__first" aria-hidden="true">
        {Array.from(first).map((ch, i) => (
          <span key={i} class="sh-wordmark__ch" style={{ '--i': String(i) } as JSX.CSSProperties}>
            {ch}
          </span>
        ))}
      </span>
      <span class="sh-wordmark__second" aria-hidden="true">
        <span class="sh-wordmark__rule" />
        <span class="sh-wordmark__lease">{second}</span>
        <span class="sh-wordmark__rule" />
      </span>
    </h1>
  );
}
