/** Test helpers: read + parse the real zombie.glb in Node (no DOM needed: the asset has no textures). */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const ROOT = resolve(__dirname, '../../..');
/** CHAR_GLB=<path> runs the asset tests against another build (e.g. to prove a test catches a regression). */
export const GLB_PATH = process.env.CHAR_GLB ? resolve(process.env.CHAR_GLB) : resolve(ROOT, 'public/assets/models/characters/zombie.glb');
export const MANIFEST_PATH = resolve(ROOT, 'public/assets/manifest.characters.json');

export function glbExists(): boolean {
  return existsSync(GLB_PATH);
}

export function readGlbJson(path = GLB_PATH): { json: any; bin: Buffer } {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  let off = 12;
  let json: any = null;
  let bin: Buffer = Buffer.alloc(0);
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  return { json, bin };
}

let cached: Promise<GLTF> | null = null;

/** Fresh parse each call when `fresh`, otherwise a cached parse (parsing takes ~1 s). */
export function loadGltf(fresh = false): Promise<GLTF> {
  if (!fresh && cached) return cached;
  const buf = readFileSync(GLB_PATH);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const p = new Promise<GLTF>((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
  if (!fresh) cached = p;
  return p;
}
