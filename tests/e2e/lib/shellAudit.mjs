/**
 * In-page audit of a shell screen (New Game, Create-a-Zombie, …) on a phone-sized viewport (W-118). Evaluated with
 * page.evaluate(auditShell, { root, start }); self-contained (serialised into the page).
 *
 *  - overflow:  every visible element that carries its own text (a non-empty text node child) and is not inline has
 *               scrollWidth ≤ clientWidth + 1 — text never runs out of its box sideways
 *  - overlaps:  no two visible interactive elements intersect (by more than 1 px each way), measured on the part of
 *               each box its scrolling ancestors actually show; nested controls (one inside the other) are skipped,
 *               and so are drag surfaces marked [data-surface] (the CAZ 3D stage, a role="slider" for turning
 *               the zombie) that host their own overlay controls
 *  - start:     the primary action (`start` selector) can be scrolled into view and then receives a hit at its centre
 *  - page:      no horizontal page overflow
 *
 * @param {{ root: string, start: string | null }} o
 */
export function auditShell({ root, start }) {
  const scope = document.querySelector(root) || document.body;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const hidden = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return true;
      if (e.classList && e.classList.contains('u-sr-only')) return true;
    }
    return false;
  };
  const describe = (el) => {
    const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    const label = el.getAttribute('aria-label') || (el.textContent || '').trim();
    return `${el.tagName.toLowerCase()}${cls} "${label.replace(/\s+/g, ' ').slice(0, 32)}"`;
  };
  /** The box of `el` clipped by every scrolling / clipping ancestor (and the viewport); null when nothing shows. */
  const shownBox = (el) => {
    const r = el.getBoundingClientRect();
    let b = { l: Math.max(r.left, 0), t: Math.max(r.top, 0), r: Math.min(r.right, vw), b: Math.min(r.bottom, vh) };
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const pr = p.getBoundingClientRect();
        b = { l: Math.max(b.l, pr.left), t: Math.max(b.t, pr.top), r: Math.min(b.r, pr.right), b: Math.min(b.b, pr.bottom) };
      }
    }
    return b.r - b.l > 0.5 && b.b - b.t > 0.5 ? b : null;
  };
  // ── text overflow ──
  const overflow = [];
  for (const el of scope.querySelectorAll('*')) {
    if (!(el instanceof HTMLElement)) continue;
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own || hidden(el) || el.closest('.u-sr-only, [aria-hidden="true"]')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'inline' || cs.display === 'contents') continue;
    if (!shownBox(el)) continue;
    if (el.scrollWidth > el.clientWidth + 1) overflow.push(`${describe(el)} scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
  }
  // ── interactive overlaps ──
  const sel = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"], [role="option"], [tabindex]:not([tabindex="-1"])';
  const items = [];
  // a drag surface ([data-surface], the CAZ 3D stage) carries its own controls on top by design
  const surface = (el) => el.hasAttribute('data-surface');
  for (const el of scope.querySelectorAll(sel)) {
    if (surface(el)) continue;
    if (hidden(el) || el.closest('[aria-hidden="true"]') || getComputedStyle(el).pointerEvents === 'none') continue;
    const b = shownBox(el);
    if (b) items.push({ el, b });
  }
  const overlaps = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const c = items[j];
      if (a.el.contains(c.el) || c.el.contains(a.el)) continue;
      const w = Math.min(a.b.r, c.b.r) - Math.max(a.b.l, c.b.l);
      const h = Math.min(a.b.b, c.b.b) - Math.max(a.b.t, c.b.t);
      if (w > 1 && h > 1) overlaps.push(`${describe(a.el)} ∩ ${describe(c.el)} (${Math.round(w)}×${Math.round(h)})`);
    }
  }
  // ── the primary action ──
  let startOk = null;
  if (start) {
    const s = document.querySelector(start);
    startOk = false;
    if (s) {
      s.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = s.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      startOk = { reachable: !!hit && (hit === s || s.contains(hit)), box: [r.left, r.top, r.right, r.bottom].map(Math.round), font: parseFloat(getComputedStyle(s).fontSize) };
    }
  }
  return {
    vw,
    vh,
    root: parseFloat(getComputedStyle(document.documentElement).fontSize),
    sw: document.documentElement.scrollWidth,
    controls: items.length,
    overflow: overflow.slice(0, 12),
    overflowCount: overflow.length,
    overlaps: overlaps.slice(0, 12),
    overlapCount: overlaps.length,
    start: startOk,
  };
}
