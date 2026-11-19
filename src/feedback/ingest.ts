/**
 * Ingest core for `npm run feedback:ingest <file>` (W-110 §3 step 1) — pure functions, no Node/DOM APIs, bundled
 * by scripts/feedback-ingest.mjs so the script and the client share ONE validator (schema.ts).
 *
 *  1. strict parse + validate (size, depth, exact shape, checksum, image/save checks, under-13 invariants) —
 *     anything malformed, oversized or forged is rejected with reasons;
 *  2. RE-SCRUB everything human-readable (never trust the producer: an edited file can carry names/e-mails);
 *  3. dedupe key = SHA-256(error signature | area | version), first 16 hex — identical crashes from many players
 *     group together; reports without an error group by type + presets;
 *  4. a normalised record (screenshot/save split out as attachments) + a GitHub-issue-ready markdown summary.
 * No network access, ever: filing the issue is a human (or, with W-097, a server-side bot) step.
 */
import { base64ToBytes } from '../persistence/bytes';
import { sha256HexSync } from '../persistence/sha256';
import { scrubDeep, scrubText } from './pii';
import { parseReport, type FeedbackReport } from './schema';

export interface NormalisedRecord {
  id: string;
  receivedAt: string;
  createdAt: string;
  dedupeKey: string;
  signature: string;
  type: FeedbackReport['type'];
  area: FeedbackReport['area'];
  source: FeedbackReport['source'];
  bracket: FeedbackReport['bracket'];
  game: FeedbackReport['game'];
  presets: string[];
  text: string;
  attachments: { screenshot: { file: string; mime: string; width: number; height: number; bytes: number } | null; save: { file: string; encoding: string; bytes: number; sha256: string } | null };
  diagnostics: FeedbackReport['diagnostics'];
  reportSha256: string;
}

export type IngestResult =
  | { ok: true; record: NormalisedRecord; markdown: string; screenshot: Uint8Array | null; save: Uint8Array | null }
  | { ok: false; errors: string[] };

/** Volatile parts of an error message (numbers, hex, quoted values, ids, URLs) → placeholders, for grouping. */
export function normaliseSignature(s: string): string {
  return s
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .replace(/(["'`]).*?\1/g, '<str>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/\d+(\.\d+)?/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** The error that best identifies a report: the crash, else the newest error, else the newest sim fault. */
export function errorSignature(r: Pick<FeedbackReport, 'diagnostics' | 'type' | 'presets'>): string {
  const d = r.diagnostics;
  if (d.crash) return `crash: ${normaliseSignature(d.crash.message)}`;
  const e = d.errors[d.errors.length - 1];
  if (e) return `error: ${e.where.replace(/[^A-Za-z0-9:._-]/g, '')}: ${normaliseSignature(e.message)}`;
  const f = d.faults[d.faults.length - 1];
  if (f) return `fault: ${f.where.replace(/[^A-Za-z0-9:._-]/g, '')}: ${normaliseSignature(f.message)}`;
  return `${r.type}: ${[...r.presets].sort().join('+') || 'text'}`;
}

export function dedupeKey(signature: string, area: string, version: string): string {
  return sha256HexSync(`${signature}|${area}|${version}`).slice(0, 16);
}

const TYPE_LABEL: Record<FeedbackReport['type'], string> = { bug: 'bug', idea: 'idea', praise: 'praise' };

function mdEscape(s: string): string {
  // no markup injection into the issue: escape markdown/HTML specials, neutralise @mentions and #refs
  return s.replace(/[\\`*_{}[\]()<>#+!|~]/g, '\\$&').replace(/@/g, '@\u200b');
}

function fence(s: string): string {
  return s.replace(/```/g, '`\u200b``');
}

export function markdownSummary(rec: NormalisedRecord): string {
  const d = rec.diagnostics;
  const lines: string[] = [];
  const title = rec.text ? rec.text.split('\n')[0].slice(0, 80) : rec.presets.join(', ') || rec.type;
  lines.push(`### [${TYPE_LABEL[rec.type]}] ${mdEscape(title)}`, '');
  lines.push(`Labels: \`${rec.type}\` \`area:${rec.area}\` \`v${rec.game.version}\``, '');
  lines.push('| | |', '|---|---|');
  lines.push(`| Report | ${rec.id} |`);
  lines.push(`| Dedupe key | \`${rec.dedupeKey}\` |`);
  lines.push(`| Signature | ${mdEscape(rec.signature)} |`);
  lines.push(`| Created | ${rec.createdAt} (from ${rec.source}) |`);
  lines.push(`| Version | ${rec.game.version} · build ${rec.game.build} · checklist ${rec.game.checklist} |`);
  lines.push(`| Player | ${rec.bracket === 'under13' ? 'child profile (presets only)' : 'non-child profile'} |`);
  lines.push(`| Platform | ${mdEscape(d.platform.native ?? d.platform.userAgent.slice(0, 120))} |`);
  lines.push(`| Graphics | ${mdEscape(Object.entries(d.graphics).map(([k, v]) => `${k}=${String(v)}`).join(', ').slice(0, 200))} |`);
  lines.push(`| FPS | now ${d.fps.now} · avg ${d.fps.avg} · min ${d.fps.min} (${d.fps.samples} samples) |`);
  lines.push(`| Screen / mode / tool | ${mdEscape(`${d.screen} / ${d.mode} / ${d.tool}`)} |`);
  lines.push(`| Attachments | ${[rec.attachments.screenshot ? `screenshot ${rec.attachments.screenshot.width}×${rec.attachments.screenshot.height} (${rec.attachments.screenshot.file})` : null, rec.attachments.save ? `save (${rec.attachments.save.file})` : null].filter(Boolean).join(', ') || 'none'} |`);
  lines.push('');
  if (rec.presets.length) lines.push(`**Presets:** ${rec.presets.join(', ')}`, '');
  if (rec.text) lines.push('**What happened:**', '', ...rec.text.split('\n').map((l) => `> ${mdEscape(l)}`), '');
  if (d.crash) lines.push('**Crash:**', '', '```', fence(`${d.crash.message}\n${d.crash.stack ?? ''}`.trim()), '```', '');
  if (d.errors.length) lines.push(`**Recent errors (${d.errors.length}):**`, '', '```', ...d.errors.slice(-10).map((e) => fence(`${e.at} ${e.where}: ${e.message}`)), '```', '');
  if (d.faults.length) lines.push(`**Sim faults (${d.faults.length}):**`, '', '```', ...d.faults.slice(-10).map((f) => fence(`[tick ${f.tick}] ${f.where}: ${f.message}`)), '```', '');
  lines.push(`<details><summary>Last ${d.events.length} events</summary>`, '', '```', fence(d.events.map((e) => `+${e.t}ms ${e.k}${e.n > 1 ? ` ×${e.n}` : ''}`).join('\n')), '```', '</details>', '');
  lines.push('<details><summary>Diagnostics</summary>', '', '```', fence(d.text), '```', '</details>');
  return `${lines.join('\n')}\n`;
}

/** Validate + normalise one `.alreport` file's text. */
export function ingestReport(text: string, opts: { now: number }): IngestResult {
  const parsed = parseReport(text, { now: opts.now });
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const r = parsed.report;
  // re-scrub (names are unknown here: the generic patterns still remove e-mails, numbers, links, user folders)
  const diagnostics = scrubDeep(r.diagnostics, { phones: false });
  const textOut = scrubText(r.text);
  const signature = errorSignature({ diagnostics, type: r.type, presets: r.presets });
  const key = dedupeKey(signature, r.area, r.game.version);
  const shot = r.screenshot ? base64ToBytes(r.screenshot.data) : null;
  const save = r.save ? base64ToBytes(r.save.data) : null;
  const base = r.id.toLowerCase();
  const record: NormalisedRecord = {
    id: r.id,
    receivedAt: new Date(opts.now).toISOString(),
    createdAt: r.createdAt,
    dedupeKey: key,
    signature,
    type: r.type,
    area: r.area,
    source: r.source,
    bracket: r.bracket,
    game: { ...r.game },
    presets: [...r.presets],
    text: r.bracket === 'under13' ? '' : textOut,
    attachments: {
      screenshot: r.screenshot && shot ? { file: `${base}${r.screenshot.mime === 'image/webp' ? '.webp' : '.jpg'}`, mime: r.screenshot.mime, width: r.screenshot.width, height: r.screenshot.height, bytes: shot.length } : null,
      save: r.save && save ? { file: `${base}.world${r.save.encoding === 'gzip' ? '.json.gz' : '.json'}`, encoding: r.save.encoding, bytes: save.length, sha256: r.save.sha256 } : null,
    },
    diagnostics,
    reportSha256: r.sha256,
  };
  return { ok: true, record, markdown: markdownSummary(record), screenshot: shot, save };
}

export interface GroupIndex {
  v: 1;
  groups: Record<string, { signature: string; area: string; version: string; type: string; count: number; ids: string[]; firstSeen: string; lastSeen: string }>;
}

/** Add a record to the dedupe groups (idempotent per report id). Returns the group's count after the update. */
export function addToGroups(index: GroupIndex, rec: NormalisedRecord): { index: GroupIndex; count: number; duplicate: boolean } {
  const groups = { ...index.groups };
  const g = groups[rec.dedupeKey];
  if (g && g.ids.includes(rec.id)) return { index, count: g.count, duplicate: true };
  const next = g
    ? { ...g, count: g.count + 1, ids: [...g.ids, rec.id].slice(-200), lastSeen: rec.receivedAt }
    : { signature: rec.signature, area: rec.area, version: rec.game.version, type: rec.type, count: 1, ids: [rec.id], firstSeen: rec.receivedAt, lastSeen: rec.receivedAt };
  groups[rec.dedupeKey] = next;
  return { index: { v: 1, groups }, count: next.count, duplicate: false };
}

/** Largest file the ingest reads (bytes); anything bigger is refused before it is read. */
export const INGEST_MAX_BYTES = 4 * 1024 * 1024;

export function emptyGroups(): GroupIndex {
  return { v: 1, groups: {} };
}

/** Accept a stored group index only if it has the expected shape (it is our own file, but never trust disk). */
export function readGroups(raw: unknown): GroupIndex {
  if (!raw || typeof raw !== 'object' || (raw as { v?: unknown }).v !== 1) return emptyGroups();
  const g = (raw as { groups?: unknown }).groups;
  if (!g || typeof g !== 'object' || Array.isArray(g)) return emptyGroups();
  const out: GroupIndex = emptyGroups();
  for (const [k, v] of Object.entries(g as Record<string, unknown>)) {
    if (!/^[0-9a-f]{16}$/.test(k) || !v || typeof v !== 'object') continue;
    const x = v as Record<string, unknown>;
    if (!Array.isArray(x.ids) || typeof x.count !== 'number') continue;
    out.groups[k] = {
      signature: String(x.signature ?? ''),
      area: String(x.area ?? ''),
      version: String(x.version ?? ''),
      type: String(x.type ?? ''),
      count: Math.max(0, Math.floor(x.count)),
      ids: x.ids.filter((i): i is string => typeof i === 'string').slice(-200),
      firstSeen: String(x.firstSeen ?? ''),
      lastSeen: String(x.lastSeen ?? ''),
    };
  }
  return out;
}
