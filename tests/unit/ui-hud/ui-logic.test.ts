import { beforeEach, describe, expect, it } from 'vitest';
import type { GameController } from '../../../src/game/contracts';
import type { MenuEntry } from '../../../src/sim/contracts';
import { FLOOR_STYLES, WALL_STYLES } from '../../../src/shared/styles';
import { rootRows, subRows } from '../../../src/ui/hud/menu/InteractionMenu';
import { _resetThumbs, cachedThumb, loadThumb, thumbFailed } from '../../../src/ui/hud/buy/thumbs';
import { floorSwatch, wallSwatch } from '../../../src/ui/hud/build/swatches';
import { isErrorLabel } from '../../../src/ui/hud/overlay/CursorLabel';
import { toolFor } from '../../../src/ui/hud/build/BuildTools';
import { hudStore } from '../../../src/ui/hud/lib/store';
import { escapeTarget, onEscapeClaimed, wantsLocalEscape } from '../../../src/ui/hud/parts/hooks';

const e = (interactionId: string, label: string, group: string | null = null, extra: Partial<MenuEntry> = {}): MenuEntry => ({
  interactionId,
  label,
  group,
  icon: 'chat',
  available: true,
  reason: null,
  cost: null,
  params: {},
  ...extra,
});

describe('interaction menu rows', () => {
  it('keeps ungrouped order and places each group at its first entry', () => {
    const rows = rootRows([e('a', 'A'), e('f1', 'F1', 'Friendly'), e('b', 'B'), e('r1', 'R1', 'Romantic'), e('f2', 'F2', 'Friendly')]);
    expect(rows.map((r) => r.label)).toEqual(['A', 'Friendly', 'B', 'Romantic']);
    expect(rows[1].entries.map((x) => x.label)).toEqual(['F1', 'F2']);
    expect(rows[1].hasSub).toBe(true);
  });
  it('group availability is true if any entry is available', () => {
    const rows = rootRows([e('m1', 'M1', 'Mean', { available: false, reason: 'No' }), e('m2', 'M2', 'Mean')]);
    expect(rows[0].available).toBe(true);
    const none = rootRows([e('m1', 'M1', 'Mean', { available: false })]);
    expect(none[0].available).toBe(false);
  });
  it('skips junk, trims group names, normalises costs and labels', () => {
    const rows = rootRows([null as never, { interactionId: 7 } as never, e('x', '', '  Phone  ', { cost: 0 }), e('y', 'Y', '   ', { cost: 35 })]);
    expect(rows.map((r) => r.kind)).toEqual(['group', 'entry']);
    expect(rows[0].label).toBe('Phone');
    expect(rows[0].entries[0].label).toBe('');
    expect(rows[1].cost).toBe(35);
    expect(subRows(rows[0])[0].label).toBe('x');
    expect(subRows(rows[0])[0].cost).toBeNull();
    expect(rootRows(undefined)).toEqual([]);
  });
  it('child lists keep their parent entry and do not nest further', () => {
    const cook = e('home_cook', 'Cook…', null, { children: [e('home_cook', 'Stew', null, { cost: 20, children: [e('deep', 'Deep')] }), e('home_cook', 'Flambé', null, { available: false, reason: 'Needs a Cryo-Fridge' })] });
    const [row] = rootRows([cook]);
    expect(row.hasSub).toBe(true);
    const kids = subRows(row);
    expect(kids.map((k) => k.label)).toEqual(['Stew', 'Flambé']);
    expect(kids.every((k) => k.parent === cook && !k.hasSub)).toBe(true);
    expect(kids[1].reason).toBe('Needs a Cryo-Fridge');
    expect(subRows(undefined)).toEqual([]);
    expect(subRows(rootRows([e('a', 'A')])[0])).toEqual([]);
  });
});

function fakeRenderer(impl: (id: string, tint: string | null) => Promise<string>) {
  return { renderer: { thumbnail: impl } } as unknown as GameController;
}

describe('thumbnail cache', () => {
  beforeEach(() => _resetThumbs());
  it('caches results and de-duplicates concurrent requests', async () => {
    let calls = 0;
    const g = fakeRenderer(async (id, tint) => {
      calls++;
      return `data:${id}:${tint ?? ''}`;
    });
    const [a, b] = await Promise.all([loadThumb(g, 'chair', null), loadThumb(g, 'chair', null)]);
    expect(a).toBe('data:chair:');
    expect(b).toBe(a);
    expect(calls).toBe(1);
    expect(cachedThumb('chair')).toBe('data:chair:');
    expect(await loadThumb(g, 'chair', '#ff0000')).toBe('data:chair:#ff0000');
    expect(calls).toBe(2);
  });
  it('never runs more than 3 renders at once', async () => {
    let active = 0;
    let peak = 0;
    const g = fakeRenderer(async (id) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return `t:${id}`;
    });
    const ids = Array.from({ length: 10 }, (_, i) => `obj${i}`);
    const out = await Promise.all(ids.map((id) => loadThumb(g, id)));
    expect(out).toEqual(ids.map((id) => `t:${id}`));
    expect(peak).toBeLessThanOrEqual(3);
  });
  it('records failures (rejections, throws, empty urls) without poisoning the queue', async () => {
    const g = fakeRenderer(async (id) => {
      if (id === 'boom') throw new Error('no model');
      if (id === 'empty') return '';
      return 'ok';
    });
    await expect(loadThumb(g, 'boom')).rejects.toThrow('no model');
    await expect(loadThumb(g, 'empty')).rejects.toThrow();
    expect(thumbFailed('boom')).toBe(true);
    expect(cachedThumb('empty')).toBeNull();
    expect(await loadThumb(g, 'fine')).toBe('ok');
    const sync = { renderer: { thumbnail: () => { throw new Error('sync'); } } } as unknown as GameController;
    await expect(loadThumb(sync, 'x')).rejects.toThrow('sync');
    expect(await loadThumb(g, 'fine2')).toBe('ok');
  });
});

describe('style swatches', () => {
  it('produces a background for every wall and floor style', () => {
    for (const s of WALL_STYLES) expect(wallSwatch(s.pattern, s.base, s.accent).length).toBeGreaterThan(6);
    for (const s of FLOOR_STYLES) expect(floorSwatch(s.pattern, s.base, s.accent).length).toBeGreaterThan(6);
  });
  it('falls back on bad colours / unknown patterns', () => {
    expect(wallSwatch('plaster', 'nope', 'x')).toContain('#d9cfb8');
    expect(floorSwatch('unknown', '#123456', '#654321')).toBe('#123456');
    expect(floorSwatch('checker', 'bad', 'bad')).toContain('conic-gradient');
    expect(() => wallSwatch('stripes', null as never, undefined as never)).not.toThrow();
  });
});

describe('cursor label tone', () => {
  it('flags placement errors, not prices', () => {
    for (const s of ["Can't place over a wall", 'Can’t paint outside walls', 'Cannot build here', 'Not enough money', 'Must face a wall', 'Blocked by the sofa', 'Too close to the door']) {
      expect(isErrorLabel(s), s).toBe(true);
    }
    for (const s of ['$45 · 3 walls', '$450', 'Refund $30', 'Musty Armchair']) expect(isErrorLabel(s), s).toBe(false);
  });
});

describe('build tool from remembered styles', () => {
  it('maps palette kinds to controller tools', () => {
    const s = hudStore.get().styles;
    expect(toolFor('wall', s)).toEqual({ kind: 'wall', style: s.wall });
    expect(toolFor('room', s)).toEqual({ kind: 'room', floor: s.roomFloor, wallStyle: s.roomWall });
    expect(toolFor('paintWall', { ...s, wholeRoom: true })).toEqual({ kind: 'paintWall', styleId: s.paint, wholeRoom: true });
    expect(toolFor('floor', { ...s, floor: null })).toEqual({ kind: 'floor', styleId: null });
    expect(toolFor('door', s)).toEqual({ kind: 'door', defId: s.door });
    expect(toolFor('eyedropper', s)).toEqual({ kind: 'eyedropper' });
  });
});

describe('hud store', () => {
  it('notifies only on real changes and merges patches', () => {
    let n = 0;
    const off = hudStore.subscribe(() => n++);
    const before = hudStore.get().agentTab;
    hudStore.set({ agentTab: before });
    expect(n).toBe(0);
    hudStore.set({ agentTab: before === 'mood' ? 'skills' : 'mood' });
    expect(n).toBe(1);
    hudStore.set((st) => ({ logOpen: !st.logOpen }));
    expect(n).toBe(2);
    off();
    hudStore.set({ agentTab: before });
    expect(n).toBe(2);
  });
});

describe('escape layering', () => {
  const L = (name: string, closingAt = -Infinity) => ({ name, closingAt });
  it('gives Esc to the newest layer that is not already closing', () => {
    expect(escapeTarget([L('drawer'), L('dialog')], 1000)?.name).toBe('dialog');
    expect(escapeTarget([L('drawer'), L('dialog', 900)], 1000)?.name).toBe('drawer');
    expect(escapeTarget([L('drawer'), L('dialog', 600)], 1000)?.name).toBe('dialog');
  });
  it('returns null when nothing is open or everything is on its way out', () => {
    expect(escapeTarget([], 5)).toBeNull();
    expect(escapeTarget([L('menu', 990), L('dialog', 995)], 1000)).toBeNull();
  });
  it('leaves Esc to widgets that handle it themselves', () => {
    const inside = { closest: (sel: string) => (sel === '[data-esc-local]' ? {} : null) } as unknown as EventTarget;
    const outside = { closest: () => null } as unknown as EventTarget;
    expect(wantsLocalEscape(inside)).toBe(true);
    expect(wantsLocalEscape(outside)).toBe(false);
    expect(wantsLocalEscape(null)).toBe(false);
    expect(wantsLocalEscape({} as EventTarget)).toBe(false);
    expect(wantsLocalEscape({ closest: 'nope' } as unknown as EventTarget)).toBe(false);
  });
  it('observer registration is idempotent to unsubscribe', () => {
    const off = onEscapeClaimed(() => {});
    off();
    expect(() => off()).not.toThrow();
  });
  it('treats junk timestamps as not closing', () => {
    expect(escapeTarget([L('a', Number.NaN)], 10)?.name).toBe('a');
    expect(escapeTarget([L('a', 5000)], 10)?.name).toBe('a');
    expect(escapeTarget([L('a', 0)], Number.NaN)?.name).toBe('a');
    expect(escapeTarget([L('a', 100)], 150, 0)?.name).toBe('a');
  });
});
