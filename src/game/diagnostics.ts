/**
 * Diagnostics: an error ring buffer plus a copyable plain-text report (Settings → Diagnostics, crash screen).
 * Building the report never throws — every probe is isolated, so it works even when the sim/renderer is broken.
 */
import type { Settings } from './contracts';
import { GAME_TITLE, GAME_VERSION } from './version';

export interface ErrorEntry {
  at: number; // wall ms
  where: string;
  message: string;
  stack: string | null;
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name || 'Error';
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
    try {
      const s = JSON.stringify(err);
      if (s && s !== '{}') return s.length > 300 ? `${s.slice(0, 299)}…` : s;
    } catch {
      /* circular */
    }
  }
  return String(err);
}

function stackOf(err: unknown): string | null {
  if (err instanceof Error && typeof err.stack === 'string') {
    return err.stack.split('\n').slice(0, 8).join('\n');
  }
  return null;
}

export class ErrorRing {
  private readonly items: ErrorEntry[] = [];
  private total = 0;

  constructor(
    private readonly capacity = 30,
    private readonly wallNow: () => number = () => Date.now(),
  ) {}

  push(where: string, err: unknown): ErrorEntry {
    const entry: ErrorEntry = { at: this.wallNow(), where: String(where).slice(0, 80), message: describeError(err).slice(0, 500), stack: stackOf(err) };
    this.items.push(entry);
    this.total++;
    while (this.items.length > this.capacity) this.items.shift();
    return entry;
  }

  list(): readonly ErrorEntry[] {
    return this.items;
  }

  get count(): number {
    return this.total;
  }

  clear(): void {
    this.items.length = 0;
  }
}

export interface DiagnosticsInput {
  userAgent: () => string;
  platform: () => string | null;
  screen: () => string;
  mode: () => string;
  speed: () => string;
  fps: () => number;
  renderer: () => Record<string, string | number | boolean | null>;
  sim: () => Record<string, string | number | boolean | null> | null;
  faults: () => readonly { tick: number; where: string; message: string }[];
  errors: () => readonly ErrorEntry[];
  settings: () => Settings;
  storage: () => Record<string, string | number | boolean | null>;
  loop: () => Record<string, string | number | boolean | null>;
  /** Optional AudioAPI.stats() snapshot (context state, voices, loops, dropped events). */
  audio?: () => Readonly<Record<string, string | number | boolean>> | null;
  wallNow: () => number;
}

function probe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function kv(obj: Record<string, string | number | boolean | null> | null): string[] {
  if (!obj) return ['  (none)'];
  return Object.keys(obj).map((k) => `  ${k}: ${String(obj[k])}`);
}

export function buildDiagnostics(d: DiagnosticsInput): string {
  const lines: string[] = [];
  const when = probe(() => new Date(d.wallNow()).toISOString(), 'unknown');
  lines.push(`${GAME_TITLE} ${GAME_VERSION} — diagnostics @ ${when}`);
  lines.push(`User agent: ${probe(d.userAgent, 'unknown')}`);
  const plat = probe(d.platform, null);
  if (plat) lines.push(`Native: ${plat}`);
  lines.push(`Screen: ${probe(d.screen, '?')} · Mode: ${probe(d.mode, '?')} · Speed: ${probe(d.speed, '?')} · FPS: ${probe(() => Math.round(d.fps()), 0)}`);
  lines.push('Renderer:', ...kv(probe(d.renderer, null)));
  lines.push('Simulation:', ...kv(probe(d.sim, null)));
  lines.push('Loop:', ...kv(probe(d.loop, null)));
  lines.push('Storage:', ...kv(probe(d.storage, null)));
  if (d.audio) lines.push('Audio:', ...kv(probe(() => (d.audio ? { ...(d.audio() ?? {}) } : null), null)));
  const faults = probe(d.faults, []);
  lines.push(`Sim faults (${faults.length}, newest last):`);
  for (const f of faults.slice(-20)) lines.push(`  [tick ${f.tick}] ${f.where}: ${f.message}`);
  const errs = probe(d.errors, []);
  lines.push(`Errors (${errs.length}, newest last):`);
  for (const e of errs.slice(-20)) {
    lines.push(`  ${probe(() => new Date(e.at).toISOString(), '?')} ${e.where}: ${e.message}`);
    if (e.stack) for (const s of e.stack.split('\n').slice(1, 4)) lines.push(`      ${s.trim()}`);
  }
  lines.push(`Settings: ${probe(() => JSON.stringify(d.settings()), '{}')}`);
  return lines.join('\n');
}
