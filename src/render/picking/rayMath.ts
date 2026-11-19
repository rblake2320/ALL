/**
 * Ray intersection primitives used by picking (pure, allocation free). Rays are (origin o, direction d);
 * d need not be normalised — returned t values are in units of |d|. "No hit" is Infinity.
 */

/** Ray vs horizontal plane y = h. Only forward hits (t ≥ 0). */
export function rayPlaneY(oy: number, dy: number, h: number): number {
  if (!Number.isFinite(oy) || !Number.isFinite(dy) || !Number.isFinite(h) || Math.abs(dy) < 1e-12) return Infinity;
  const t = (h - oy) / dy;
  return t >= 0 ? t : Infinity;
}

/** Ray vs axis-aligned box (slab method). Returns the entry t (or 0 if the origin is inside), Infinity on miss. */
export function rayAabb(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): number {
  let tmin = 0;
  let tmax = Infinity;
  // X
  if (Math.abs(dx) < 1e-12) {
    if (ox < minX || ox > maxX) return Infinity;
  } else {
    let t1 = (minX - ox) / dx;
    let t2 = (maxX - ox) / dx;
    if (t1 > t2) {
      const s = t1;
      t1 = t2;
      t2 = s;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  // Y
  if (Math.abs(dy) < 1e-12) {
    if (oy < minY || oy > maxY) return Infinity;
  } else {
    let t1 = (minY - oy) / dy;
    let t2 = (maxY - oy) / dy;
    if (t1 > t2) {
      const s = t1;
      t1 = t2;
      t2 = s;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  // Z
  if (Math.abs(dz) < 1e-12) {
    if (oz < minZ || oz > maxZ) return Infinity;
  } else {
    let t1 = (minZ - oz) / dz;
    let t2 = (maxZ - oz) / dz;
    if (t1 > t2) {
      const s = t1;
      t1 = t2;
      t2 = s;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return Number.isFinite(tmin) ? tmin : Infinity;
}

/** Ray vs sphere (centre c, radius r): nearest forward t, Infinity on miss. */
export function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number {
  const mx = ox - cx;
  const my = oy - cy;
  const mz = oz - cz;
  const a = dx * dx + dy * dy + dz * dz;
  if (!(a > 1e-18)) return Infinity;
  const b = mx * dx + my * dy + mz * dz;
  const c = mx * mx + my * my + mz * mz - r * r;
  if (c > 0 && b > 0) return Infinity;
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 ? t : 0;
}

/**
 * Ray vs capsule (segment p→q, radius r). Returns the nearest forward t or Infinity.
 * Classic formulation: intersect the infinite cylinder, clip to the segment, fall back to the end spheres.
 */
export function rayCapsule(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  px: number,
  py: number,
  pz: number,
  qx: number,
  qy: number,
  qz: number,
  r: number,
): number {
  if (!(r > 0) || !Number.isFinite(r)) return Infinity;
  const bax = qx - px;
  const bay = qy - py;
  const baz = qz - pz;
  const oax = ox - px;
  const oay = oy - py;
  const oaz = oz - pz;
  const baba = bax * bax + bay * bay + baz * baz;
  if (!(baba > 1e-12)) return raySphere(ox, oy, oz, dx, dy, dz, px, py, pz, r);
  const bard = bax * dx + bay * dy + baz * dz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const rdrd = dx * dx + dy * dy + dz * dz;
  const a = baba * rdrd - bard * bard;
  const b = baba * rdoa - baoa * bard;
  const c = baba * oaoa - baoa * baoa - r * r * baba;
  let best = Infinity;
  if (Math.abs(a) > 1e-12) {
    const h = b * b - a * c;
    if (h >= 0) {
      const t = (-b - Math.sqrt(h)) / a;
      const y = baoa + t * bard;
      if (y > 0 && y < baba && t >= 0) best = t;
    }
  }
  if (best === Infinity) {
    const t0 = raySphere(ox, oy, oz, dx, dy, dz, px, py, pz, r);
    const t1 = raySphere(ox, oy, oz, dx, dy, dz, qx, qy, qz, r);
    best = Math.min(t0, t1);
  }
  return best;
}
