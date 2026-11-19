import { cx } from './cx';

/** Spinning arc. Decorative unless `label` is given (then role="status"). */
export function Spinner({ size = '1.125em', label, class: cls }: { size?: string | number; label?: string; class?: string }) {
  const dim = typeof size === 'number' ? `${size}px` : size;
  return (
    <span role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'} class="u-center" style={{ display: 'inline-flex' }}>
      <svg class={cx('ui-spinner', cls)} width={dim} height={dim} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.2" stroke-width="2.5" />
        <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
      </svg>
    </span>
  );
}
