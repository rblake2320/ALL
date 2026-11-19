/**
 * Schema-v1 save fixtures (tests/fixtures/saves/v1-saves.json): real saves written by the pre-W-025 build (commit
 * fd20992) — one per lot template, with and without a W-119 journal — stored as memory-backend dumps (every storage
 * key → base64 bytes), exactly as the browser / desktop backends hold them. Provenance: tests/unit/world/ac1.record.ts.
 */
import data from '../../fixtures/saves/v1-saves.json';
import { createMemoryBackend, type MemoryBackend } from '../../../src/persistence/backends/memory';
import { gunzipBytes, isGzip } from '../../../src/persistence/gzip';
import { utf8DecodeStrict } from '../../../src/persistence/bytes';
import type { WorldState } from '../../../src/sim/types';

export interface V1Fixture {
  template: 'derelict' | 'starter' | 'empty';
  seed: number;
  slotId: string;
  compressed: boolean;
  snapshotTick: number;
  /** payloadSha256 of the stored v1 snapshot (the journal epoch is bound to it). */
  snapshotSha: string;
  /** ac1SaveHash of the snapshot as the old engine serialized it. */
  snapshotHash: string;
  /** Active quest steps at the snapshot ('<questId>#<stepIndex>'). */
  quests: string[];
  /** The journal written after the snapshot (null = none) and the old engine's LIVE world at its end. */
  journal: { endTick: number; commands: number; liveHash: string } | null;
  backend: Record<string, string>;
}

interface FixtureFile {
  engine: string;
  schemaVersion: number;
  fixtures: Record<string, V1Fixture>;
}

export const V1 = data as unknown as FixtureFile;
export const V1_NAMES = Object.keys(V1.fixtures).sort();

export function fixture(name: string): V1Fixture {
  const f = V1.fixtures[name];
  if (!f) throw new Error(`no v1 fixture ${name}`);
  return f;
}

/** A fresh memory backend holding exactly the fixture's storage keys. */
export function backendOf(f: V1Fixture): MemoryBackend {
  const b = createMemoryBackend();
  for (const [k, v] of Object.entries(f.backend)) b.store.set(k, new Uint8Array(Buffer.from(v, 'base64')));
  return b;
}

/** The raw v1 payload of the fixture's primary save (decoded straight from the stored bytes, no pipeline). */
export async function rawV1Payload(f: V1Fixture): Promise<WorldState> {
  const key = Object.keys(f.backend).find((k) => k.endsWith(':primary') && k.includes(f.slotId));
  if (!key) throw new Error('no primary');
  let bytes: Uint8Array = new Uint8Array(Buffer.from(f.backend[key], 'base64'));
  if (isGzip(bytes)) bytes = await gunzipBytes(bytes, 64 * 1024 * 1024);
  const env = JSON.parse(utf8DecodeStrict(bytes)) as { schemaVersion: number; payload: WorldState };
  if (env.schemaVersion !== 1 || env.payload.schemaVersion !== 1) throw new Error('fixture is not schema v1');
  return env.payload;
}
