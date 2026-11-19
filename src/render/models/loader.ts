/**
 * Network + parse helpers: a concurrency-limited task queue, a fetch wrapper with timeout, and GLB parsing via
 * GLTFLoader.parseAsync (works in browsers and in Node for texture-less GLBs, which is all the pipeline emits).
 */
import type * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Minimal fetch surface the library needs (lets tests inject a file-system fetch). */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<unknown>;
}
export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchResponseLike>;

export function defaultFetch(): FetchLike | null {
  const f = (globalThis as { fetch?: unknown }).fetch;
  if (typeof f !== 'function') return null;
  return (url, init) => (f as (u: string, i?: { signal?: AbortSignal }) => Promise<FetchResponseLike>).call(globalThis, url, init);
}

export class TaskQueue {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  get running(): number {
    return this.active;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((res) => this.waiting.push(res));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      const next = this.waiting.shift();
      if (next) next();
    }
  }
}

export class TimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} timed out after ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(p: Promise<T>, ms: number, what: string, onTimeout?: () => void): Promise<T> {
  if (!(ms > 0) || !Number.isFinite(ms)) return p;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<never>((_, rej) => {
    timer = setTimeout(() => {
      onTimeout?.();
      rej(new TimeoutError(what, ms));
    }, ms);
  });
  try {
    return await Promise.race([p, t]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function fetchBytes(fetchFn: FetchLike, url: string, timeoutMs: number): Promise<ArrayBuffer> {
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const res = await withTimeout(fetchFn(url, ac ? { signal: ac.signal } : undefined), timeoutMs, url, () => ac?.abort());
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return withTimeout(res.arrayBuffer(), timeoutMs, url, () => ac?.abort());
}

export async function fetchJson(fetchFn: FetchLike, url: string, timeoutMs: number): Promise<unknown> {
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const res = await withTimeout(fetchFn(url, ac ? { signal: ac.signal } : undefined), timeoutMs, url, () => ac?.abort());
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return withTimeout(res.json(), timeoutMs, url, () => ac?.abort());
}

let sharedLoader: GLTFLoader | null = null;

export async function parseGlb(data: ArrayBuffer, resourcePath: string): Promise<THREE.Group> {
  if (!(data instanceof ArrayBuffer) || data.byteLength < 20) throw new Error('GLB payload too small');
  const magic = new DataView(data).getUint32(0, true);
  if (magic !== 0x46546c67) throw new Error('not a binary glTF (bad magic)');
  sharedLoader ??= new GLTFLoader();
  const gltf = await sharedLoader.parseAsync(data, resourcePath);
  return gltf.scene;
}
