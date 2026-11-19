/**
 * Content-Security-Policy for the game. PURE (no imports): used by electron/main.ts (response header on every
 * app:// document and on dev-server documents) AND by vite.config.ts (a <meta http-equiv> tag injected into the
 * built index.html, so the WEB build is protected too — see docs/SECURITY.md §3).
 *
 * Production (app://game): scripts only from the app itself. 'wasm-unsafe-eval' (compiling WebAssembly —
 * three.js' meshopt/Draco/KTX2 decoders — without permitting JS eval) is OFF by default: nothing ships
 * WebAssembly today; pass `allowWasm: true` only when an asset starts to need a decoder (the protocol test
 * scans the shipped GLBs for compression extensions and fails if one appears). Styles allow
 * 'unsafe-inline' because Preact components set inline style attributes and theme code injects
 * <style> text; style injection cannot execute code. blob:/data: are allowed for images, media and
 * fetches because GLTFLoader decodes embedded textures through blob URLs. No remote origins at all.
 * Dev (Vite dev server): additionally the dev origin and its HMR websocket.
 *
 * The meta variant (buildMetaCsp) is the same policy minus `frame-ancestors`, which browsers ignore (and warn
 * about) in a <meta> tag — framing is decided by the host's headers (itch.io embeds the web build in an
 * iframe). `scriptHashes` ('sha256-<base64>') allow the exact inline scripts of the single-file build.
 */
export interface CspOptions {
  devOrigin?: string | null;
  allowWasm?: boolean;
  /** Extra script-src sources of the form 'sha256-<base64>' (single-file build's inline scripts). */
  scriptHashes?: readonly string[];
  /**
   * Extra connect-src origins, each exactly ws://host[:port] or wss://host[:port] (the shared-town test page's one
   * server). The game's own page never passes this: it talks to nobody.
   */
  connect?: readonly string[];
}

const HASH_RE = /^'sha256-[A-Za-z0-9+/]{43}='$/;
const CONNECT_RE = /^wss?:\/\/[a-z0-9.-]+(:\d{1,5})?$/;

function directives(opts: CspOptions): [string, string][] {
  const dev = opts.devOrigin ?? null;
  const wasm = opts.allowWasm ?? false;
  const hashes = opts.scriptHashes ?? [];
  for (const h of hashes) if (!HASH_RE.test(h)) throw new Error(`invalid CSP script hash: ${h}`);
  const connect = opts.connect ?? [];
  for (const c of connect) if (!CONNECT_RE.test(c)) throw new Error(`invalid CSP connect origin: ${c}`);
  const self = dev ? `'self' ${dev}` : "'self'";
  const ws = dev ? ` ${dev.replace(/^http/, 'ws')}` : '';
  return [
    ['default-src', self],
    ['script-src', `${self}${wasm ? " 'wasm-unsafe-eval'" : ''}${hashes.map((h) => ` ${h}`).join('')}`],
    ['style-src', `${self} 'unsafe-inline'`],
    ['img-src', `${self} data: blob:`],
    ['media-src', `${self} data: blob:`],
    ['font-src', `${self} data:`],
    ['connect-src', `${self} data: blob:${ws}${connect.map((c) => ` ${c}`).join('')}`],
    ['worker-src', `${self} blob:`],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'none'"],
    ['frame-src', "'none'"],
    ['frame-ancestors', "'none'"],
  ];
}

/** The HTTP-header policy (Electron). */
export function buildCsp(opts: CspOptions = {}): string {
  return directives(opts)
    .map(([k, v]) => `${k} ${v}`)
    .join('; ');
}

/** The <meta http-equiv="Content-Security-Policy"> policy (web build): header policy minus frame-ancestors. */
export function buildMetaCsp(opts: CspOptions = {}): string {
  return directives(opts)
    .filter(([k]) => k !== 'frame-ancestors')
    .map(([k, v]) => `${k} ${v}`)
    .join('; ');
}
