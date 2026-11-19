/**
 * Single-line text that ellipsizes and — only when it is actually cut off — reveals the full text in a themed
 * tooltip on hover. The full string is always in the DOM, so screen readers never lose it.
 *
 *   <Truncate text={slot.name} class="sh-slot__name" />
 */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Tooltip } from './Tooltip';
import type { Placement } from './position';
import { cx } from './cx';

export interface TruncateProps {
  text: string;
  class?: string;
  placement?: Placement;
}

export function Truncate({ text, class: cls, placement = 'top' }: TruncateProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const c = el.scrollWidth > el.clientWidth + 1;
      setCut((p) => (p === c ? p : c));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return (
    <Tooltip content={cut ? text : null} placement={placement} class="ui-trunc">
      <span ref={ref} class={cx('ui-trunc__text', cls)}>
        {text}
      </span>
    </Tooltip>
  );
}
