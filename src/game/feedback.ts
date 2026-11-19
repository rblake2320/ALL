/**
 * Feedback service (W-110 client half): the controller-side glue between the game and the pure report modules in
 * src/feedback. Exposed to the UI as `game.feedback` (FeedbackFacade).
 *
 *  capture(source)  SYNCHRONOUS, called before the dialog is opened: mints the report id, takes the canvas screenshot
 *                   (renderer.snapshot renders + encodes in the same task, so it never shows the dialog), freezes the
 *                   diagnostics text, error ring, sim faults, event trail and FPS summary as they were at that moment.
 *  submit(form)     builds the report for the player's bracket (fails closed to under-13), scrubs personal data with
 *                   every name the world/saves/CAZ hold, seals the checksum and writes it to the crash-safe outbox.
 *  exportReport(id) downloads `<id>.alreport` through the existing download path (GameEnv.download — a blob: URL;
 *                   Electron's will-download handler allows our own blob: downloads and sanitises the name), so no
 *                   new IPC channel is needed on desktop.
 * Nothing is sent anywhere: there is no network code here (the backend, W-097, does not exist yet).
 */
import type { ProfileStore, StorageBackend } from '../persistence/contracts';
import type { RendererAPI } from '../render/contracts';
import type { SimulationAPI } from '../sim/contracts';
import type { WorldState } from '../sim/types';
import type { ErrorEntry } from './diagnostics';
import type { GameEnv } from './env';
import { base64ToBytes, bytesToBase64, utf8Encode } from '../persistence/bytes';
import { canonicalJson } from '../persistence/canonicalJson';
import { compressionAvailable, gzipBytes } from '../persistence/gzip';
import { sha256Hex } from '../persistence/sha256';
import { BUILD_SHA, CHECKLIST_VERSION } from '../feedback/build';
import { areaFor, filterText, reportBracket, rulesFor, validateForm, type FeedbackForm, type FormError } from '../feedback/form';
import { newFeedbackId } from '../feedback/id';
import { imageInfo, splitImageDataUrl } from '../feedback/image';
import { FeedbackOutbox, type OutboxEntry } from '../feedback/outbox';
import { nameMatcher, normaliseNames, scrubDeep } from '../feedback/pii';
import {
  DIAG_TEXT_MAX, ERRORS_MAX, FAULTS_MAX, REPORT_EXTENSION, SAVE_MAX_BYTES, SCREENSHOT_MAX_BYTES, SCREENSHOT_MAX_DIM,
  encodeReport, sealReport, type FeedbackDiagnostics, type FeedbackReport, type ReportArea, type ReportBracket, type ReportSave, type ReportSource,
} from '../feedback/schema';
import type { EventTrail } from '../feedback/trail';

export interface FeedbackDraft {
  id: string;
  source: ReportSource;
  area: ReportArea;
  bracket: ReportBracket;
  createdAt: number;
  /** data:image/jpeg URL for the thumbnail, or null (no GL context / capture failed). */
  screenshot: { url: string; width: number; height: number } | null;
  crash: { message: string; stack: string | null } | null;
  /** A live world exists, so "attach my save" can work (13+ only). */
  saveAvailable: boolean;
}

export type SubmitResult =
  | { ok: true; id: string; dropped: string[]; replaced: boolean; stored: true }
  | { ok: false; reason: 'invalid'; errors: FormError[] }
  | { ok: false; reason: 'storage' | 'noDraft' | 'saveTooLarge'; error: string };

/** What the UI may use (game.feedback). */
export interface FeedbackFacade {
  readonly draft: FeedbackDraft | null;
  capture(source: ReportSource, crash?: { message: string; stack?: string | null } | null): FeedbackDraft;
  discard(): void;
  submit(form: FeedbackForm): Promise<SubmitResult>;
  exportReport(id: string): Promise<boolean>;
  outbox(): Promise<OutboxEntry[]>;
  report(id: string): Promise<FeedbackReport | null>;
}

export interface FeedbackHost {
  env: Pick<GameEnv, 'randomU32' | 'wallNow' | 'viewport' | 'devicePixelRatio' | 'userAgent' | 'native' | 'download'>;
  renderer: Pick<RendererAPI, 'snapshot'> & { graphicsInfo?: RendererAPI['graphicsInfo'] };
  rendererReady: () => boolean;
  profile: ProfileStore;
  backend: () => Pick<StorageBackend, 'list' | 'remove'> | null;
  trail: EventTrail;
  screen: () => string;
  mode: () => string;
  dialog: () => string | null;
  tool: () => string;
  fps: () => number;
  settings: () => { quality: string; autoQuality: string; language: string; pixelRatio: number };
  ageBracket: () => unknown;
  /** The played world (null on menus / game over). */
  sim: () => SimulationAPI | null;
  /** The world on screen (played or menu demo) for faults. */
  anySim: () => SimulationAPI | null;
  caz: () => { householdName?: unknown; members?: readonly { firstName?: unknown; lastName?: unknown }[] } | null;
  saveNames: () => Promise<string[]>;
  errors: () => readonly ErrorEntry[];
  diagnosticsText: () => string;
  version: string;
  report: (where: string, err: unknown) => void;
}

const ISO = (ms: number) => {
  try {
    return new Date(ms).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
};

function worldNames(sim: SimulationAPI | null): string[] {
  if (!sim) return [];
  const out: string[] = [];
  try {
    const st = sim.state;
    if (typeof st.household?.name === 'string') out.push(st.household.name);
    for (const a of Object.values(st.agents ?? {})) {
      if (a && typeof a.firstName === 'string') out.push(a.firstName);
      if (a && typeof a.lastName === 'string') out.push(a.lastName);
      if (a && typeof a.firstName === 'string' && typeof a.lastName === 'string') out.push(`${a.firstName} ${a.lastName}`);
    }
  } catch {
    /* a broken world contributes no names */
  }
  return out;
}

/** Fit (w, h) inside SCREENSHOT_MAX_DIM keeping the aspect ratio. */
export function screenshotSize(w: number, h: number): { width: number; height: number } {
  const sw = Number.isFinite(w) && w > 0 ? w : 1280;
  const sh = Number.isFinite(h) && h > 0 ? h : 720;
  const k = Math.min(1, SCREENSHOT_MAX_DIM / Math.max(sw, sh));
  return { width: Math.max(16, Math.round(sw * k)), height: Math.max(16, Math.round(sh * k)) };
}

export class FeedbackService implements FeedbackFacade {
  private readonly outboxStore: FeedbackOutbox;
  private current: (FeedbackDraft & { frozen: FrozenDiagnostics; names: string[]; saveNames: Promise<string[]> }) | null = null;

  constructor(private readonly host: FeedbackHost) {
    this.outboxStore = new FeedbackOutbox({ store: host.profile, backend: host.backend(), now: () => host.env.wallNow() });
  }

  get draft(): FeedbackDraft | null {
    if (!this.current) return null;
    const { frozen: _f, names: _n, saveNames: _s, ...d } = this.current;
    return d;
  }

  capture(source: ReportSource, crash: { message: string; stack?: string | null } | null = null): FeedbackDraft {
    const h = this.host;
    const now = h.env.wallNow();
    const id = newFeedbackId(() => h.env.randomU32());
    const screenshot = this.takeScreenshot();
    const names = [...worldNames(h.sim()), ...worldNames(h.anySim()), ...cazNames(h.caz())];
    let saveNames: Promise<string[]>;
    try {
      saveNames = h.saveNames().catch(() => []);
    } catch {
      saveNames = Promise.resolve([]);
    }
    let area: ReportArea = 'menu';
    try {
      area = areaFor(h.screen(), h.mode(), h.dialog());
    } catch {
      /* keep menu */
    }
    this.current = {
      id,
      source,
      area,
      bracket: reportBracket(safe(h.ageBracket, 'unknown')),
      createdAt: now,
      screenshot,
      crash: crash ? { message: String(crash.message ?? '').slice(0, 500), stack: typeof crash.stack === 'string' ? crash.stack.split('\n').slice(0, 12).join('\n').slice(0, 4000) : null } : null,
      saveAvailable: safe(() => h.sim() !== null, false),
      frozen: this.freeze(),
      names,
      saveNames,
    };
    h.trail.push('feedback', `open-${source}`);
    return this.draft!;
  }

  discard(): void {
    this.current = null;
  }

  private takeScreenshot(): FeedbackDraft['screenshot'] {
    const h = this.host;
    if (!safe(h.rendererReady, false)) return null;
    try {
      const g = h.renderer.graphicsInfo?.();
      const vp = h.env.viewport();
      const dpr = h.env.devicePixelRatio();
      const size = screenshotSize(g?.bufferWidth || vp.width * dpr, g?.bufferHeight || vp.height * dpr);
      const url = h.renderer.snapshot(size.width, size.height);
      const parts = splitImageDataUrl(url);
      if (!parts) return null;
      const bytes = base64ToBytes(parts.data);
      if (!bytes || bytes.length > SCREENSHOT_MAX_BYTES) return null;
      const info = imageInfo(bytes);
      if (!info || info.width > SCREENSHOT_MAX_DIM || info.height > SCREENSHOT_MAX_DIM) return null;
      return { url, width: info.width, height: info.height };
    } catch (e) {
      h.report('feedback.screenshot', e);
      return null;
    }
  }

  private freeze(): FrozenDiagnostics {
    const h = this.host;
    const s = safe(h.settings, { quality: '?', autoQuality: '?', language: 'en', pixelRatio: 0 });
    const graphics: Record<string, string | number | boolean | null> = { quality: s.quality, autoQuality: s.autoQuality, pixelRatioSetting: s.pixelRatio };
    try {
      const g = safe(h.rendererReady, false) ? h.renderer.graphicsInfo?.() : null;
      if (g) {
        graphics.level = g.level;
        graphics.pixelRatio = Math.round(g.pixelRatio * 100) / 100;
        graphics.buffer = `${g.bufferWidth}x${g.bufferHeight}`;
        if (g.auto) {
          graphics.autoLevel = g.auto.level;
          graphics.gpuKind = g.auto.gpuKind;
          graphics.gpuCeiling = g.auto.ceiling;
          graphics.gpu = String(g.auto.gpu ?? '').slice(0, 120);
        }
      }
    } catch {
      /* renderer unavailable */
    }
    const native = safe(() => {
      const n = h.env.native();
      return n ? `${String(n.platform).slice(0, 30)} ${String(n.version).slice(0, 30)}` : null;
    }, null);
    let faults: { tick: number; where: string; message: string }[] = [];
    try {
      const f = h.anySim()?.faults() ?? [];
      faults = f.slice(-FAULTS_MAX).map((x) => ({ tick: Number.isFinite(x.tick) ? x.tick : 0, where: String(x.where).slice(0, 80), message: String(x.message).slice(0, 500) }));
    } catch {
      faults = [];
    }
    const errors = safe(h.errors, [] as readonly ErrorEntry[])
      .slice(-ERRORS_MAX)
      .map((e) => ({ at: ISO(e.at), where: String(e.where).slice(0, 80), message: String(e.message).slice(0, 500) }));
    const text = safe(h.diagnosticsText, 'diagnostics unavailable')
      // the household line names the player's household: never part of a report
      .replace(/^(\s*household:).*$/gm, '$1 [name]');
    return {
      platform: { userAgent: safe(h.env.userAgent, 'unknown').slice(0, 400), native, language: String(s.language).slice(0, 16) },
      graphics,
      screen: String(safe(h.screen, '?')).slice(0, 40),
      mode: String(safe(h.mode, '?')).slice(0, 40),
      tool: String(safe(h.tool, 'none')).slice(0, 40),
      fps: h.trail.fps(safe(h.fps, 0)),
      events: h.trail.list(),
      errors,
      faults,
      text: text.slice(0, DIAG_TEXT_MAX),
    };
  }

  async submit(form: FeedbackForm): Promise<SubmitResult> {
    const d = this.current;
    if (!d) return { ok: false, reason: 'noDraft', error: 'nothing to send' };
    // Re-read the bracket at send time and keep the stricter one (answering the gate mid-dialog never loosens it).
    const bracket: ReportBracket = d.bracket === 'under13' || reportBracket(safe(this.host.ageBracket, 'unknown')) === 'under13' ? 'under13' : '13plus';
    const rules = rulesFor(bracket);
    const f: FeedbackForm = { ...form, text: rules.freeText ? form.text : '', attachSave: rules.attachSave && form.attachSave && d.saveAvailable };
    const errs = validateForm(f, bracket);
    if (errs.length) return { ok: false, reason: 'invalid', errors: errs };
    const allNames = normaliseNames([...d.names, ...(await d.saveNames), ...cazNames(safe(this.host.caz, null)), ...worldNames(safe(this.host.sim, null))]);
    const matcher = nameMatcher(allNames);
    let save: ReportSave | null = null;
    if (f.attachSave) {
      const s = await this.encodeSave();
      if (s === 'tooLarge') return { ok: false, reason: 'saveTooLarge', error: `save is larger than ${SAVE_MAX_BYTES} bytes` };
      save = s;
    }
    const shot = f.includeScreenshot && d.screenshot ? splitImageDataUrl(d.screenshot.url) : null;
    const diagnostics: FeedbackDiagnostics = scrubDeep(
      { ...d.frozen, crash: d.crash ? { message: d.crash.message, stack: d.crash.stack } : null },
      { names: matcher, phones: false },
    );
    const report = sealReport({
      format: 'afterlife-lease-report',
      v: 1,
      id: d.id,
      createdAt: ISO(d.createdAt),
      game: { version: safeShort(this.host.version), build: BUILD_SHA, checklist: CHECKLIST_VERSION },
      bracket,
      type: f.type,
      area: f.area,
      source: d.source,
      presets: [...new Set(f.presets)],
      text: rules.freeText ? filterText(f.text, allNames) : '',
      screenshot: shot && d.screenshot ? { mime: shot.mime, width: d.screenshot.width, height: d.screenshot.height, data: shot.data } : null,
      save,
      diagnostics,
    });
    const r = await this.outboxStore.put(report);
    if (!r.ok) {
      this.lastUnstored = report;
      return { ok: false, reason: 'storage', error: r.error };
    }
    this.lastUnstored = null;
    this.host.trail.push('feedback', 'queued');
    return { ok: true, id: r.id, dropped: r.dropped, replaced: r.replaced, stored: true };
  }

  /** A report that could not be stored (quota…) stays exportable for this session. */
  private lastUnstored: FeedbackReport | null = null;

  private async encodeSave(): Promise<ReportSave | null | 'tooLarge'> {
    let world: WorldState | null = null;
    try {
      world = this.host.sim()?.serialize() ?? null;
    } catch (e) {
      this.host.report('feedback.save', e);
      return null;
    }
    if (!world) return null;
    try {
      const json = utf8Encode(canonicalJson(world, { undefinedProps: 'omit' }));
      let bytes: Uint8Array = json;
      let encoding: ReportSave['encoding'] = 'json';
      if (compressionAvailable()) {
        bytes = await gzipBytes(json);
        encoding = 'gzip';
      }
      if (bytes.length > SAVE_MAX_BYTES) return 'tooLarge';
      return { encoding, bytes: bytes.length, sha256: await sha256Hex(bytes), data: bytesToBase64(bytes) };
    } catch (e) {
      this.host.report('feedback.save', e);
      return null;
    }
  }

  async exportReport(id: string): Promise<boolean> {
    const report = (await this.outboxStore.get(id)) ?? (this.lastUnstored?.id === id ? this.lastUnstored : null);
    if (!report) return false;
    let ok = false;
    try {
      ok = this.host.env.download(`afterlife-report-${report.id}${REPORT_EXTENSION}`, utf8Encode(encodeReport(report)), 'application/octet-stream');
    } catch (e) {
      this.host.report('feedback.export', e);
      ok = false;
    }
    if (ok) await this.outboxStore.markExported(report.id).catch(() => undefined);
    return ok;
  }

  outbox(): Promise<OutboxEntry[]> {
    return this.outboxStore.list().catch(() => []);
  }

  report(id: string): Promise<FeedbackReport | null> {
    return this.outboxStore.get(id).catch(() => null);
  }
}

type FrozenDiagnostics = Omit<FeedbackDiagnostics, 'crash'>;

function cazNames(caz: ReturnType<FeedbackHost['caz']>): string[] {
  if (!caz) return [];
  const out: string[] = [];
  if (typeof caz.householdName === 'string') out.push(caz.householdName);
  for (const m of Array.isArray(caz.members) ? caz.members : []) {
    if (typeof m?.firstName === 'string') out.push(m.firstName);
    if (typeof m?.lastName === 'string') out.push(m.lastName);
  }
  return out;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function safeShort(v: string): string {
  return /^[A-Za-z0-9._+-]{1,40}$/.test(v) ? v : 'unknown';
}
