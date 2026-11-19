/**
 * `.alreport` — the feedback report file (W-110 §1–§2), version 1. One JSON object, UTF-8:
 *
 *   { format: 'afterlife-lease-report', v: 1, id: 'FB-XXXXX-XXXXX', createdAt: ISO,
 *     game: { version, build, checklist }, bracket: 'under13' | '13plus', type, area, source,
 *     presets: PresetId[], text, screenshot: { mime, width, height, data(base64) } | null,
 *     save: { encoding, bytes, sha256, data(base64) } | null, diagnostics: FeedbackDiagnostics, sha256 }
 *
 * `sha256` = SHA-256 hex of canonicalJson(every other field). Like the save checksums (docs/SECURITY.md §5) it
 * detects corruption and casual edits, NOT a determined forger (an offline client holds no secret key) — the
 * ingest therefore re-validates and re-scrubs everything regardless.
 *
 * `validateReport` is the single strict validator, shared by the client (outbox load, export self-check) and
 * `npm run feedback:ingest` (bundled from this file): exact key sets, closed enums, bounded strings/arrays, image
 * magic bytes + dimensions, base64 sizes, child-safety invariants (under-13: presets only, no text, no save).
 * It never throws; it returns a typed report or a list of problems.
 */
import { base64ToBytes } from '../persistence/bytes';
import { canonicalJson } from '../persistence/canonicalJson';
import { sanitizeParse, isPlainObject } from '../persistence/sanitize';
import { sha256HexSync, SHA256_HEX_RE } from '../persistence/sha256';
import { isFeedbackId } from './id';
import { imageInfo } from './image';

export const REPORT_FORMAT = 'afterlife-lease-report';
export const REPORT_VERSION = 1;
export const REPORT_EXTENSION = '.alreport';

export const TEXT_MAX = 2000;
export const SCREENSHOT_MAX_BYTES = 300 * 1024;
export const SCREENSHOT_MAX_DIM = 1280;
export const SAVE_MAX_BYTES = 1024 * 1024;
export const DIAG_TEXT_MAX = 48 * 1024;
export const EVENTS_MAX = 50;
export const ERRORS_MAX = 30;
export const FAULTS_MAX = 20;
export const PRESETS_MAX = 4;
/** Whole file (characters of JSON text): screenshot + save as base64 + diagnostics, with headroom. */
export const REPORT_MAX_CHARS = 2 * 1024 * 1024;

export const REPORT_TYPES = ['bug', 'idea', 'praise'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export const REPORT_AREAS = ['live', 'buy', 'build', 'caz', 'store', 'menu'] as const;
export type ReportArea = (typeof REPORT_AREAS)[number];
export const REPORT_SOURCES = ['pause', 'settings', 'hotkey', 'crash', 'menu'] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];
/** Preset chips (D-033): the only way an under-13 player describes a problem. */
export const PRESET_IDS = ['cantPlace', 'lookedWrong', 'stuck', 'lostProgress', 'tooHard', 'confusing', 'loveIt', 'wantMore'] as const;
export type PresetId = (typeof PRESET_IDS)[number];
/** Never the exact age or birth year: only whether the child-safety rules apply. */
export type ReportBracket = 'under13' | '13plus';

export interface ReportScreenshot {
  mime: 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  data: string;
}

export interface ReportSave {
  /** 'gzip' = gzip of canonical world JSON; 'json' = the JSON bytes (no CompressionStream on this platform). */
  encoding: 'gzip' | 'json';
  bytes: number;
  sha256: string;
  data: string;
}

export interface TrailEvent {
  /** ms since the trail started (relative — no wall clock). */
  t: number;
  /** Closed-vocabulary event key, e.g. 'dialog:pause', 'key:modeBuy', 'sim:notify', 'error:audio.sfx'. */
  k: string;
  /** Repeat count (consecutive identical events are merged). */
  n: number;
}

export interface FeedbackDiagnostics {
  platform: { userAgent: string; native: string | null; language: string };
  graphics: Record<string, string | number | boolean | null>;
  screen: string;
  mode: string;
  tool: string;
  fps: { now: number; min: number; avg: number; max: number; samples: number };
  events: TrailEvent[];
  errors: { at: string; where: string; message: string }[];
  faults: { tick: number; where: string; message: string }[];
  crash: { message: string; stack: string | null } | null;
  /** buildDiagnostics() text, scrubbed. */
  text: string;
}

export interface FeedbackReport {
  format: typeof REPORT_FORMAT;
  v: typeof REPORT_VERSION;
  id: string;
  createdAt: string;
  game: { version: string; build: string; checklist: string };
  bracket: ReportBracket;
  type: ReportType;
  area: ReportArea;
  source: ReportSource;
  presets: PresetId[];
  text: string;
  screenshot: ReportScreenshot | null;
  save: ReportSave | null;
  diagnostics: FeedbackDiagnostics;
  sha256: string;
}

export type ReportBody = Omit<FeedbackReport, 'sha256'>;
export type ValidateResult = { ok: true; report: FeedbackReport } | { ok: false; errors: string[] };

const TOP_KEYS = ['format', 'v', 'id', 'createdAt', 'game', 'bracket', 'type', 'area', 'source', 'presets', 'text', 'screenshot', 'save', 'diagnostics', 'sha256'];
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SHORT_RE = /^[A-Za-z0-9._+-]{1,40}$/;
const EVENT_KEY_RE = /^[A-Za-z0-9:._[\]-]{1,64}$/;

/** Checksum over the body (every field except sha256). */
export function reportChecksum(body: ReportBody | Record<string, unknown>): string {
  const copy: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  delete copy.sha256;
  return sha256HexSync(canonicalJson(copy));
}

export function sealReport(body: ReportBody): FeedbackReport {
  return { ...body, sha256: reportChecksum(body) };
}

/** Serialise for export (stable key order; pretty enough to read in an editor). */
export function encodeReport(report: FeedbackReport): string {
  return `${canonicalJson(report, { indent: 1 })}\n`;
}

function base64Size(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return (b64.length / 4) * 3 - pad;
}

/** Strict validation of an untrusted parsed object (see module doc). */
export function validateReport(raw: unknown, opts: { now?: number; checksum?: boolean } = {}): ValidateResult {
  const errors: string[] = [];
  const bad = (m: string): void => {
    if (errors.length < 40) errors.push(m);
  };
  if (!isPlainObject(raw)) return { ok: false, errors: ['not a JSON object'] };
  const r = raw as Record<string, unknown>;
  if (r.format !== REPORT_FORMAT) return { ok: false, errors: ['not an Afterlife Lease report (format)'] };
  if (r.v !== REPORT_VERSION) return { ok: false, errors: [`unsupported report version ${JSON.stringify(r.v)}`] };
  for (const k of Object.keys(r)) if (!TOP_KEYS.includes(k)) bad(`unexpected field "${k.slice(0, 40)}"`);
  for (const k of TOP_KEYS) if (!(k in r)) bad(`missing field "${k}"`);
  if (errors.length) return { ok: false, errors };

  if (!isFeedbackId(r.id)) bad('id is not FB-XXXXX-XXXXX');
  if (typeof r.createdAt !== 'string' || !ISO_RE.test(r.createdAt) || Number.isNaN(Date.parse(r.createdAt))) bad('createdAt is not an ISO-8601 UTC time');
  else if (opts.now !== undefined && Date.parse(r.createdAt) > opts.now + 24 * 3600_000) bad('createdAt is in the future');

  const game = r.game;
  if (!isPlainObject(game) || Object.keys(game).sort().join() !== 'build,checklist,version') bad('game must be { version, build, checklist }');
  else for (const k of ['version', 'build', 'checklist'] as const) if (typeof game[k] !== 'string' || !SHORT_RE.test(game[k] as string)) bad(`game.${k} is invalid`);

  if (r.bracket !== 'under13' && r.bracket !== '13plus') bad('bracket must be under13 or 13plus');
  if (!(REPORT_TYPES as readonly unknown[]).includes(r.type)) bad('type is not bug/idea/praise');
  if (!(REPORT_AREAS as readonly unknown[]).includes(r.area)) bad('area is invalid');
  if (!(REPORT_SOURCES as readonly unknown[]).includes(r.source)) bad('source is invalid');

  const presets = r.presets;
  if (!Array.isArray(presets) || presets.length > PRESETS_MAX || presets.some((p) => !(PRESET_IDS as readonly unknown[]).includes(p)) || new Set(presets).size !== presets.length) bad(`presets must be up to ${PRESETS_MAX} distinct preset ids`);

  const text = r.text;
  if (typeof text !== 'string') bad('text must be a string');
  else if (Array.from(text).length > TEXT_MAX) bad(`text is longer than ${TEXT_MAX} characters`);
  if (typeof text === 'string' && Array.isArray(presets) && text.trim() === '' && presets.length === 0) bad('report has neither text nor a preset');

  // Child safety (D-033, T10): an under-13 report carries presets only — no free text, no save.
  if (r.bracket === 'under13') {
    if (typeof text === 'string' && text.length > 0) bad('under-13 reports must not contain free text');
    if (r.save !== null) bad('under-13 reports must not attach a save');
  }

  const shot = r.screenshot;
  if (shot !== null) {
    if (!isPlainObject(shot) || Object.keys(shot).sort().join() !== 'data,height,mime,width') bad('screenshot must be { mime, width, height, data } or null');
    else {
      const bytes = typeof shot.data === 'string' && shot.data.length <= Math.ceil(SCREENSHOT_MAX_BYTES / 3) * 4 + 4 ? base64ToBytes(shot.data) : null;
      if (!bytes) bad(`screenshot data is not base64 of at most ${SCREENSHOT_MAX_BYTES} bytes`);
      else {
        const info = imageInfo(bytes);
        if (!info) bad('screenshot is not a JPEG or WebP image');
        else {
          if (info.mime !== shot.mime) bad(`screenshot claims ${String(shot.mime).slice(0, 20)} but is ${info.mime}`);
          if (info.width !== shot.width || info.height !== shot.height) bad('screenshot dimensions do not match the image');
          if (info.width > SCREENSHOT_MAX_DIM || info.height > SCREENSHOT_MAX_DIM || info.width < 1 || info.height < 1) bad(`screenshot is larger than ${SCREENSHOT_MAX_DIM} px`);
        }
      }
    }
  }

  const save = r.save;
  if (save !== null) {
    if (!isPlainObject(save) || Object.keys(save).sort().join() !== 'bytes,data,encoding,sha256') bad('save must be { encoding, bytes, sha256, data } or null');
    else {
      if (save.encoding !== 'gzip' && save.encoding !== 'json') bad('save.encoding is invalid');
      const ok = typeof save.data === 'string' && save.data.length <= Math.ceil(SAVE_MAX_BYTES / 3) * 4 + 4;
      const bytes = ok ? base64ToBytes(save.data as string) : null;
      if (!bytes) bad(`save data is not base64 of at most ${SAVE_MAX_BYTES} bytes`);
      else {
        if (save.bytes !== bytes.length) bad('save.bytes does not match the data');
        if (typeof save.sha256 !== 'string' || !SHA256_HEX_RE.test(save.sha256) || sha256HexSync(bytes) !== save.sha256) bad('save checksum mismatch');
        if (save.encoding === 'gzip' && !(bytes[0] === 0x1f && bytes[1] === 0x8b)) bad('save claims gzip but is not');
      }
    }
  }

  validateDiagnostics(r.diagnostics, bad);

  if (typeof r.sha256 !== 'string' || !SHA256_HEX_RE.test(r.sha256)) bad('missing checksum');
  else if (errors.length === 0 && opts.checksum !== false && reportChecksum(r) !== r.sha256) bad('checksum mismatch (the file was altered or damaged)');

  return errors.length ? { ok: false, errors } : { ok: true, report: r as unknown as FeedbackReport };
}

function str(v: unknown, max: number): boolean {
  return typeof v === 'string' && v.length <= max;
}

function flatRecord(v: unknown, maxKeys: number): boolean {
  if (!isPlainObject(v)) return false;
  const ks = Object.keys(v);
  if (ks.length > maxKeys) return false;
  return ks.every((k) => k.length <= 40 && (v[k] === null || typeof v[k] === 'boolean' || (typeof v[k] === 'number' && Number.isFinite(v[k])) || str(v[k], 200)));
}

function validateDiagnostics(d: unknown, bad: (m: string) => void): void {
  const keys = 'crash,errors,events,faults,fps,graphics,mode,platform,screen,text,tool';
  if (!isPlainObject(d) || Object.keys(d).sort().join() !== keys) {
    bad('diagnostics has the wrong shape');
    return;
  }
  const p = d.platform;
  if (!isPlainObject(p) || Object.keys(p).sort().join() !== 'language,native,userAgent' || !str(p.userAgent, 400) || !(p.native === null || str(p.native, 80)) || !str(p.language, 16)) bad('diagnostics.platform is invalid');
  if (!flatRecord(d.graphics, 24)) bad('diagnostics.graphics is invalid');
  for (const k of ['screen', 'mode', 'tool'] as const) if (!str(d[k], 40)) bad(`diagnostics.${k} is invalid`);
  const f = d.fps;
  if (!isPlainObject(f) || Object.keys(f).sort().join() !== 'avg,max,min,now,samples' || Object.values(f).some((x) => typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 100000)) bad('diagnostics.fps is invalid');
  const ev = d.events;
  if (!Array.isArray(ev) || ev.length > EVENTS_MAX || ev.some((e) => !isPlainObject(e) || Object.keys(e).sort().join() !== 'k,n,t' || typeof e.k !== 'string' || !EVENT_KEY_RE.test(e.k) || !Number.isInteger(e.n) || (e.n as number) < 1 || typeof e.t !== 'number' || !Number.isFinite(e.t) || e.t < 0)) bad(`diagnostics.events must be ≤ ${EVENTS_MAX} {t,k,n} entries`);
  const er = d.errors;
  if (!Array.isArray(er) || er.length > ERRORS_MAX || er.some((e) => !isPlainObject(e) || Object.keys(e).sort().join() !== 'at,message,where' || !str(e.at, 40) || !str(e.where, 80) || !str(e.message, 500))) bad(`diagnostics.errors must be ≤ ${ERRORS_MAX} {at,where,message} entries`);
  const fa = d.faults;
  if (!Array.isArray(fa) || fa.length > FAULTS_MAX || fa.some((e) => !isPlainObject(e) || Object.keys(e).sort().join() !== 'message,tick,where' || typeof e.tick !== 'number' || !Number.isFinite(e.tick) || !str(e.where, 80) || !str(e.message, 500))) bad(`diagnostics.faults must be ≤ ${FAULTS_MAX} {tick,where,message} entries`);
  const c = d.crash;
  if (c !== null && (!isPlainObject(c) || Object.keys(c).sort().join() !== 'message,stack' || !str(c.message, 500) || !(c.stack === null || str(c.stack, 4000)))) bad('diagnostics.crash is invalid');
  if (!str(d.text, DIAG_TEXT_MAX)) bad(`diagnostics.text must be ≤ ${DIAG_TEXT_MAX} characters`);
}

export type ParseResult = ValidateResult & { tooLarge?: boolean };

/** Parse + validate `.alreport` text (hardened parse: size/depth caps, reserved keys dropped). */
export function parseReport(text: unknown, opts: { now?: number } = {}): ParseResult {
  if (typeof text !== 'string') return { ok: false, errors: ['not text'] };
  if (text.length > REPORT_MAX_CHARS) return { ok: false, errors: [`file is larger than ${REPORT_MAX_CHARS} characters`], tooLarge: true };
  let raw: unknown;
  try {
    raw = sanitizeParse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, { maxChars: REPORT_MAX_CHARS, maxDepth: 16 });
  } catch (e) {
    return { ok: false, errors: [`not valid JSON (${e instanceof Error ? e.message.slice(0, 120) : 'parse error'})`] };
  }
  return validateReport(raw, opts);
}

export function base64Bytes(b64: string): number {
  return base64Size(b64);
}
