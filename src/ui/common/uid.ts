/**
 * Globally unique, stable-per-instance ids. Preact's useId() is unique only within one render tree, and the UI
 * renders overlays into separate portal trees — ids would collide (duplicate aria-labelledby targets, modal stack
 * confusion). This counter is process-wide.
 */
import { useRef } from 'preact/hooks';

let counter = 0;

export function nextUid(prefix = 'ui'): string {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}-${counter.toString(36)}`;
}

export function useUid(prefix = 'ui'): string {
  const ref = useRef<string | null>(null);
  if (ref.current === null) ref.current = nextUid(prefix);
  return ref.current;
}
