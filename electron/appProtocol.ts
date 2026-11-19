/**
 * app://game/<path> -> file inside the packaged renderer build (dist/). PURE path logic, unit tested.
 *
 * Why a custom protocol instead of file://: a real origin (CSP 'self', CORS, fetch() for GLB/audio
 * assets — Chromium refuses fetch() on file:// URLs), no ambient access to the whole disk, and the
 * Electron security checklist recommends it. Requests are confined to the root: percent-encoded
 * traversal (%2e%2e, %2f, %5c), backslashes, drive letters, NUL bytes, alternate data streams
 * (':'), Windows device names and dot-files are all refused.
 */
import * as path from 'node:path';

export const APP_SCHEME = 'app';
export const APP_HOST = 'game';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

const RESERVED_RE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
const SEGMENT_RE = /^[^\\/:*?"<>|\u0000-\u001f]+$/;

export type AppPathResult = { ok: true; filePath: string; relPath: string } | { ok: false; status: 400 | 403 | 404 };

export function resolveAppRequest(rootDir: string, requestUrl: string): AppPathResult {
  let u: URL;
  try {
    u = new URL(requestUrl);
  } catch {
    return { ok: false, status: 400 };
  }
  if (u.protocol !== `${APP_SCHEME}:` || u.host !== APP_HOST || u.username || u.password) return { ok: false, status: 403 };
  const rawSegments = u.pathname.split('/').filter((s) => s.length > 0);
  const segments: string[] = [];
  for (const raw of rawSegments) {
    let seg: string;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return { ok: false, status: 400 };
    }
    if (seg === '.' || seg === '..' || seg.startsWith('.')) return { ok: false, status: 403 };
    if (!SEGMENT_RE.test(seg) || seg.endsWith(' ') || seg.endsWith('.')) return { ok: false, status: 403 };
    if (RESERVED_RE.test(seg)) return { ok: false, status: 403 };
    segments.push(seg);
  }
  if (segments.length === 0) segments.push('index.html');
  const root = path.resolve(rootDir);
  const filePath = path.resolve(root, ...segments);
  const rel = path.relative(root, filePath);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return { ok: false, status: 403 };
  return { ok: true, filePath, relPath: segments.join('/') };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.hdr': 'application/octet-stream',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

export function mimeTypeFor(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/** Response headers for a served file (CSP only on documents). */
export function responseHeaders(filePath: string, csp: string): Record<string, string> {
  const type = mimeTypeFor(filePath);
  const h: Record<string, string> = {
    'content-type': type,
    'x-content-type-options': 'nosniff',
    'cache-control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  };
  if (type.startsWith('text/html')) {
    h['content-security-policy'] = csp;
    h['cross-origin-opener-policy'] = 'same-origin';
    h['referrer-policy'] = 'no-referrer';
  }
  return h;
}
