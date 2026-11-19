/**
 * Storage error taxonomy shared by every backend. Backends throw StorageError (or platform errors
 * that classifyStorageError understands); the SaveManager maps them onto SaveResult/LoadResult codes.
 *
 * The Electron bridge cannot carry error classes across the context bridge, so main/preload encode
 * the code as a leading tag in the message: "[quota] Not enough disk space ...".
 */

export type StorageErrorCode = 'quota' | 'io' | 'busy' | 'invalid';

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  override readonly cause: unknown;
  constructor(code: StorageErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.cause = cause;
  }
}

const TAG_RE = /^\s*\[(quota|io|busy|invalid|forbidden)\]\s*/;

function field(e: unknown, k: string): unknown {
  if (e === null || (typeof e !== 'object' && typeof e !== 'function')) return undefined;
  try {
    return (e as Record<string, unknown>)[k];
  } catch {
    return undefined;
  }
}

export function errorMessage(e: unknown): string {
  const m = field(e, 'message');
  if (typeof m === 'string' && m.length > 0) return m;
  try {
    return String(e);
  } catch {
    return 'unknown error';
  }
}

/** True for every flavour of "storage is full" we know about (DOMException, Firefox legacy, Node, tags). */
export function isQuotaError(e: unknown): boolean {
  if (e instanceof StorageError) return e.code === 'quota';
  const name = field(e, 'name');
  const code = field(e, 'code');
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  if (code === 22 || code === 1014 || code === 'ENOSPC' || code === 'EDQUOT') return true;
  const msg = errorMessage(e);
  const tag = TAG_RE.exec(msg);
  if (tag) return tag[1] === 'quota';
  return /quota|ENOSPC|EDQUOT|no space left|disk (is )?full/i.test(msg);
}

export function classifyStorageError(e: unknown): StorageErrorCode {
  if (e instanceof StorageError) return e.code;
  if (isQuotaError(e)) return 'quota';
  const tag = TAG_RE.exec(errorMessage(e));
  if (tag) return tag[1] === 'forbidden' ? 'invalid' : (tag[1] as StorageErrorCode);
  const code = field(e, 'code');
  const name = field(e, 'name');
  if (code === 'EBUSY' || code === 'EMFILE' || code === 'ENFILE' || name === 'TransactionInactiveError') return 'busy';
  if (name === 'DataCloneError' || name === 'DataError') return 'invalid';
  return 'io';
}

/** Normalize anything thrown by a backend into a StorageError (message tags stripped). */
export function toStorageError(e: unknown, context: string): StorageError {
  if (e instanceof StorageError) return e;
  const code = classifyStorageError(e);
  const msg = errorMessage(e).replace(TAG_RE, '');
  return new StorageError(code, `${context}: ${msg}`, e);
}
