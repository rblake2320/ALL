/**
 * Canonical JSON: a deterministic serialization (object keys sorted by UTF-16 code unit order, no
 * insignificant whitespace) used for checksums. Two structurally equal JSON values always produce
 * byte-identical text, and `canonicalJson(JSON.parse(canonicalJson(x))) === canonicalJson(x)`.
 *
 * Unlike JSON.stringify it REFUSES values that would silently change meaning on a round trip:
 * NaN/±Infinity, undefined, functions, symbols, bigints, sparse-array holes, cycles and non-plain
 * objects (Map, Set, Date, class instances, typed arrays). Errors name the offending path.
 */

export class CanonicalJsonError extends Error {
  readonly path: string;
  constructor(message: string, path: string) {
    super(`canonicalJson: ${message} at ${path}`);
    this.name = 'CanonicalJsonError';
    this.path = path;
  }
}

export interface CanonicalJsonOptions {
  /**
   * 'reject' (default): any undefined value is an error.
   * 'omit': object properties whose value is undefined are skipped (JSON.stringify semantics);
   * undefined array elements are still rejected.
   */
  undefinedProps?: 'reject' | 'omit';
  /** Maximum nesting depth (default 256). */
  maxDepth?: number;
  /** Pretty-print with this many spaces of indentation (key order stays canonical). */
  indent?: number;
  /**
   * Object keys to leave out (e.g. RESERVED_KEYS, which the loader drops — serializing them would make a
   * checksum cover data that can never be loaded). `onDroppedKey` receives each dropped key's path.
   */
  dropKeys?: ReadonlySet<string>;
  onDroppedKey?: (path: string) => void;
}

export const DEFAULT_MAX_DEPTH = 256;

function describe(v: object): string {
  const ctor = (v as { constructor?: { name?: unknown } }).constructor;
  const name = ctor && typeof ctor.name === 'string' ? ctor.name : 'unknown';
  return name || 'anonymous class';
}

export function canonicalJson(value: unknown, opts: CanonicalJsonOptions = {}): string {
  const omitUndefined = opts.undefinedProps === 'omit';
  const dropKeys = opts.dropKeys && opts.dropKeys.size > 0 ? opts.dropKeys : null;
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const indent = opts.indent && opts.indent > 0 ? Math.min(10, Math.floor(opts.indent)) : 0;
  const ancestors = new Set<object>();
  const segs: (string | number)[] = [];

  const pathString = (): string => {
    let p = '$';
    for (const s of segs) p += typeof s === 'number' ? `[${s}]` : /^[A-Za-z_$][\w$]*$/.test(s) ? `.${s}` : `[${JSON.stringify(s)}]`;
    return p;
  };
  const fail = (msg: string): never => {
    throw new CanonicalJsonError(msg, pathString());
  };

  const ser = (v: unknown, depth: number): string => {
    switch (typeof v) {
      case 'string':
        return JSON.stringify(v);
      case 'number':
        if (!Number.isFinite(v)) fail(`non-finite number (${String(v)})`);
        return JSON.stringify(v); // -0 serializes as "0"
      case 'boolean':
        return v ? 'true' : 'false';
      case 'undefined':
        return fail('undefined value');
      case 'function':
        return fail('function value');
      case 'symbol':
        return fail('symbol value');
      case 'bigint':
        return fail('bigint value');
      default:
        break;
    }
    if (v === null) return 'null';
    const obj = v as object;
    if (depth >= maxDepth) fail(`nesting deeper than ${maxDepth}`);
    if (ancestors.has(obj)) fail('circular reference');
    ancestors.add(obj);
    try {
      const nl = indent ? '\n' + ' '.repeat(indent * (depth + 1)) : '';
      const close = indent ? '\n' + ' '.repeat(indent * depth) : '';
      const sep = indent ? ': ' : ':';
      if (Array.isArray(obj)) {
        if (obj.length === 0) return '[]';
        const parts: string[] = new Array(obj.length);
        for (let i = 0; i < obj.length; i++) {
          segs.push(i);
          if (!(i in obj)) fail('sparse array hole');
          const item: unknown = obj[i];
          if (item === undefined) fail('undefined array element');
          parts[i] = ser(item, depth + 1);
          segs.pop();
        }
        return '[' + nl + parts.join(',' + nl) + close + ']';
      }
      const proto: unknown = Object.getPrototypeOf(obj);
      if (proto !== Object.prototype && proto !== null) fail(`non-plain object (${describe(obj)})`);
      const rec = obj as Record<string, unknown>;
      const keys = Object.keys(rec).sort();
      const parts: string[] = [];
      for (const k of keys) {
        if (dropKeys && dropKeys.has(k)) {
          if (opts.onDroppedKey) {
            segs.push(k);
            opts.onDroppedKey(pathString());
            segs.pop();
          }
          continue;
        }
        const val = rec[k];
        if (val === undefined && omitUndefined) continue;
        segs.push(k);
        parts.push(JSON.stringify(k) + sep + ser(val, depth + 1));
        segs.pop();
      }
      if (parts.length === 0) return '{}';
      return '{' + nl + parts.join(',' + nl) + close + '}';
    } finally {
      ancestors.delete(obj);
    }
  };

  return ser(value, 0);
}
