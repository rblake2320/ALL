/** Join truthy class names: cx('a', cond && 'b', null, 'c') → 'a b c'. */
export function cx(...parts: (string | false | null | undefined | 0)[]): string {
  let out = '';
  for (const p of parts) {
    if (p) out = out ? `${out} ${p}` : p;
  }
  return out;
}
