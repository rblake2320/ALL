import { describe, it, expect } from 'vitest';
import { gridPickAt, EDGE_PICK_RADIUS } from '../../../src/render/picking/gridPick';
import { parseEdgeKey, edgeSideTile } from '../../../src/render/build/edges';

describe('pickGrid nearest-edge selection', () => {
  it('tile + fractional coords', () => {
    const g = gridPickAt(4.5, 7.5, 30, 30)!;
    expect([g.x, g.z, g.fx, g.fz]).toEqual([4, 7, 4.5, 7.5]);
    expect(g.edge).toBeNull(); // centre: every edge is 0.5 away (> 0.3)
    expect(g.edgeSide).toBe(0);
  });

  it('picks each of the four edges and the side the cursor is on', () => {
    expect(gridPickAt(4.1, 7.5, 30, 30)).toMatchObject({ edge: 'v:4:7', edgeSide: 1 }); // left edge, cursor on +X side
    expect(gridPickAt(4.9, 7.5, 30, 30)).toMatchObject({ edge: 'v:5:7', edgeSide: 0 }); // right edge
    expect(gridPickAt(4.5, 7.05, 30, 30)).toMatchObject({ edge: 'h:4:7', edgeSide: 1 }); // top edge
    expect(gridPickAt(4.5, 7.8, 30, 30)).toMatchObject({ edge: 'h:4:8', edgeSide: 0 }); // bottom edge
  });

  it('the reported side tile is always the tile under the cursor', () => {
    for (let i = 0; i < 400; i++) {
      const fx = 2 + ((i * 0.6180339) % 1) * 20;
      const fz = 2 + ((i * 0.4142135) % 1) * 20;
      const g = gridPickAt(fx, fz, 30, 30)!;
      if (!g.edge) continue;
      const e = parseEdgeKey(g.edge)!;
      expect(edgeSideTile(e, g.edgeSide)).toEqual({ x: g.x, z: g.z });
    }
  });

  it('chooses the strictly nearest edge near a corner', () => {
    expect(gridPickAt(4.05, 7.1, 30, 30)!.edge).toBe('v:4:7');
    expect(gridPickAt(4.1, 7.05, 30, 30)!.edge).toBe('h:4:7');
  });

  it('respects the radius (inclusive) and ties resolve left > right > top > bottom', () => {
    expect(gridPickAt(4 + EDGE_PICK_RADIUS, 7.5, 30, 30)!.edge).toBe('v:4:7');
    expect(gridPickAt(4 + EDGE_PICK_RADIUS + 0.01, 7.5, 30, 30)!.edge).toBeNull();
    expect(gridPickAt(4.2, 7.2, 30, 30)!.edge).toBe('v:4:7'); // left/top tie → left
    expect(gridPickAt(4.8, 7.8, 30, 30)!.edge).toBe('v:5:7'); // right/bottom tie → right
    expect(gridPickAt(4.5, 7.5, 30, 30, 0.5)!.edge).toBe('v:4:7'); // all tie at the centre with r=0.5
    expect(gridPickAt(4.1, 7.5, 30, 30, 0)!.edge).toBeNull();
  });

  describe('adversarial', () => {
    it('outside the lot or non-finite input → null', () => {
      expect(gridPickAt(-0.01, 5, 30, 30)).toBeNull();
      expect(gridPickAt(30, 5, 30, 30)).toBeNull();
      expect(gridPickAt(5, 30.5, 30, 30)).toBeNull();
      expect(gridPickAt(NaN, 5, 30, 30)).toBeNull();
      expect(gridPickAt(5, Infinity, 30, 30)).toBeNull();
      expect(gridPickAt(5, 5, NaN, 30)).toBeNull();
      expect(gridPickAt(5, 5, -30, 30)).toBeNull();
    });

    it('garbage radius falls back to the default; radius is capped at half a tile', () => {
      expect(gridPickAt(4.1, 7.5, 30, 30, NaN)!.edge).toBe('v:4:7');
      expect(gridPickAt(4.1, 7.5, 30, 30, -1)!.edge).toBe('v:4:7');
      expect(gridPickAt(4.5, 7.5, 30, 30, 99)!.edge).toBe('v:4:7');
    });

    it('lot boundary edges are still reported (the build service validates them)', () => {
      expect(gridPickAt(0.1, 3.5, 30, 30)!.edge).toBe('v:0:3');
      expect(gridPickAt(29.9, 3.5, 30, 30)!.edge).toBe('v:30:3');
    });
  });
});
