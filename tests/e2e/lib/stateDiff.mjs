/**
 * Whole-world comparison for tests/e2e/oldSave.mjs (unit-tested in tests/unit/e2e/stateDiff.test.ts): what did a newer
 * build change, drop or add when it loaded an older build's world?
 */

/** `changed`: paths where `next` changed or dropped something `prev` had. `added`: keys only `next` has. */
export function diffStates(prev, next) {
  const changed = [];
  const added = [];
  const show = (v) => String(JSON.stringify(v)).slice(0, 80);
  const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  const walk = (a, b, p) => {
    if (a === b) return;
    const ta = kind(a);
    if (ta !== kind(b) || (ta !== 'object' && ta !== 'array')) {
      changed.push(`${p}: ${show(a)} → ${show(b)}`);
      return;
    }
    if (ta === 'array') {
      if (a.length !== b.length) changed.push(`${p}.length: ${a.length} → ${b.length}`);
      for (let i = 0; i < Math.min(a.length, b.length); i++) walk(a[i], b[i], `${p}[${i}]`);
      return;
    }
    for (const k of Object.keys(a)) {
      if (!(k in b)) changed.push(`${p}.${k}: dropped (was ${show(a[k])})`);
      else walk(a[k], b[k], `${p}.${k}`);
    }
    for (const k of Object.keys(b)) if (!(k in a)) added.push(`${p}.${k}`);
  };
  walk(prev, next, 'state');
  return { changed, added };
}
