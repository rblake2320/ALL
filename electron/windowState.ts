/**
 * Window placement persistence (userData/window-state.json). PURE logic + atomic file IO.
 * Restored bounds are validated against the CURRENT displays, so unplugging a monitor or changing
 * resolution never leaves the window off-screen or larger than the screen.
 */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { atomicWriteFile, nodeFs } from './fileStore';

export const DEFAULT_WIDTH = 1600;
export const DEFAULT_HEIGHT = 900;
export const MIN_WIDTH = 1280;
export const MIN_HEIGHT = 720;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds: Rect | null;
  maximized: boolean;
  fullscreen: boolean;
}

export interface Placement {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
  fullscreen: boolean;
}

function isRect(v: unknown): v is Rect {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k] as number));
}

export function parseWindowState(text: string | null): WindowState {
  const empty: WindowState = { bounds: null, maximized: false, fullscreen: false };
  if (!text) return empty;
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    return {
      bounds: isRect(v.bounds) ? v.bounds : null,
      maximized: v.maximized === true,
      fullscreen: v.fullscreen === true,
    };
  } catch {
    return empty;
  }
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Decide the initial placement. `workAreas` are the displays' usable areas (taskbar excluded),
 * primary first. Size never exceeds the chosen display; the minimum size is respected unless the
 * display itself is smaller (tiny screens get the whole work area).
 */
export function computePlacement(state: WindowState, workAreas: Rect[]): Placement {
  const primary = workAreas[0] ?? { x: 0, y: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  const fit = (area: Rect, w: number, h: number) => ({
    width: Math.round(Math.min(area.width, Math.max(Math.min(MIN_WIDTH, area.width), w))),
    height: Math.round(Math.min(area.height, Math.max(Math.min(MIN_HEIGHT, area.height), h))),
  });
  const b = state.bounds;
  if (b && b.width > 0 && b.height > 0) {
    // Display with the largest overlap; require a meaningful visible part (title bar reachable).
    let best: Rect | null = null;
    let bestArea = 0;
    for (const a of workAreas) {
      const o = overlap(b, a);
      if (o > bestArea) {
        bestArea = o;
        best = a;
      }
    }
    if (best && bestArea >= Math.min(b.width * b.height * 0.25, 200 * 100)) {
      const size = fit(best, b.width, b.height);
      const x = Math.round(Math.min(Math.max(b.x, best.x), best.x + best.width - size.width));
      const y = Math.round(Math.min(Math.max(b.y, best.y), best.y + best.height - size.height));
      return { ...size, x, y, maximized: state.maximized, fullscreen: state.fullscreen };
    }
  }
  const size = fit(primary, DEFAULT_WIDTH, DEFAULT_HEIGHT);
  return {
    ...size,
    x: Math.round(primary.x + (primary.width - size.width) / 2),
    y: Math.round(primary.y + (primary.height - size.height) / 2),
    maximized: state.maximized,
    fullscreen: state.fullscreen,
  };
}

export async function readWindowState(file: string): Promise<WindowState> {
  await removeStaleTemps(file);
  try {
    return parseWindowState(await fsp.readFile(file, 'utf8'));
  } catch {
    return parseWindowState(null);
  }
}

/** Delete '<file>.tmp-*' leftovers of a write interrupted by a crash/power loss (best effort). */
export async function removeStaleTemps(file: string): Promise<string[]> {
  const dir = path.dirname(file);
  const prefix = `${path.basename(file)}.tmp-`;
  const removed: string[] = [];
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return removed;
  }
  for (const n of names) {
    if (!n.startsWith(prefix) || !/^\d+-\d+$/.test(n.slice(prefix.length))) continue;
    try {
      await fsp.unlink(path.join(dir, n));
      removed.push(n);
    } catch {
      // locked or already gone: next start tries again
    }
  }
  return removed;
}

export async function writeWindowState(file: string, state: WindowState): Promise<void> {
  const data = new TextEncoder().encode(JSON.stringify(state));
  await atomicWriteFile({
    fs: nodeFs,
    dir: path.dirname(file),
    target: file,
    tmp: `${file}.tmp-${process.pid}-${Date.now()}`,
    data,
    fsyncDir: process.platform !== 'win32',
    withRetry: async (_label, fn) => fn(),
  });
}

/**
 * Synchronous atomic variant for the quit path (the process may exit right after 'will-quit', so an
 * async write could be cut off). Tiny file: tmp + fsync + rename, failures ignored by the caller.
 */
export function writeWindowStateSync(file: string, state: WindowState): void {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(tmp, 'wx');
  try {
    fs.writeFileSync(fd, JSON.stringify(state));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
    throw e;
  }
}
