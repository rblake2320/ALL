#!/usr/bin/env node
// Ingest a player's `.alreport` file (W-110 §3 step 1) — LOCAL ONLY, no network calls.
//
//   npm run feedback:ingest -- <file.alreport> [more files…] [--out=<dir>] [--quiet]
//
// For each file: refuse anything larger than INGEST_MAX_BYTES before reading it, strict UTF-8, then the shared
// validator (src/feedback/schema.ts via src/feedback/ingest.ts — bundled here with esbuild so client and ingest can
// never disagree): hardened JSON parse (size/depth caps, reserved keys dropped), exact shape, checksum, image magic
// bytes + dimensions, save checksum, under-13 invariants. Valid reports are RE-SCRUBBED for personal data, given a
// dedupe key (error signature + area + version), and written atomically to
//   <out>/<id>.json            normalised record          <out>/<id>.jpg|.webp   screenshot (if any)
//   <out>/<id>.world.json[.gz] attached save (if any)     <out>/_groups.json     dedupe groups with counts
// (default <out> = feedback/inbox, gitignored). A GitHub-issue-ready markdown summary is printed to stdout.
// Re-ingesting the same file is idempotent; a different file claiming an already-filed id is refused (forgery).
// Exit codes: 0 all files filed · 1 at least one file rejected · 2 usage / internal error.

import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

async function loadCore() {
  const esbuild = require('esbuild');
  const out = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'feedback', 'ingest.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, 'wx');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Read at most `max` + 1 bytes: a file that grows or lies about its size still cannot make us read more. */
function readCapped(file, max) {
  const st = fs.statSync(file);
  if (!st.isFile()) throw new Error('not a regular file');
  if (st.size > max) return { tooLarge: true, size: st.size };
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(max + 1);
    let n = 0;
    for (;;) {
      const r = fs.readSync(fd, buf, n, buf.length - n, null);
      if (r === 0) break;
      n += r;
      if (n > max) return { tooLarge: true, size: n };
    }
    return { bytes: buf.subarray(0, n) };
  } finally {
    fs.closeSync(fd);
  }
}

export async function ingestFiles(files, { out = path.join(ROOT, 'feedback', 'inbox'), now = Date.now(), log = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s) } = {}) {
  const core = await loadCore();
  fs.mkdirSync(out, { recursive: true });
  const groupsFile = path.join(out, '_groups.json');
  let groups = core.readGroups(readJson(groupsFile));
  const results = [];
  for (const file of files) {
    const fail = (reasons) => {
      err(`REJECTED ${file}\n${reasons.map((r) => `  - ${r}`).join('\n')}\n`);
      results.push({ file, ok: false, errors: reasons });
    };
    let read;
    try {
      read = readCapped(file, core.INGEST_MAX_BYTES);
    } catch (e) {
      fail([`cannot read: ${e && e.code ? e.code : e}`]);
      continue;
    }
    if (read.tooLarge) {
      fail([`file is ${read.size} bytes; the limit is ${core.INGEST_MAX_BYTES}`]);
      continue;
    }
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(read.bytes);
    } catch {
      fail(['not valid UTF-8 text']);
      continue;
    }
    const r = core.ingestReport(text, { now });
    if (!r.ok) {
      fail(r.errors);
      continue;
    }
    const rec = r.record;
    const base = rec.id.toLowerCase();
    const recordFile = path.join(out, `${base}.json`);
    const prior = readJson(recordFile);
    if (prior && prior.reportSha256 !== rec.reportSha256) {
      fail([`${rec.id} was already filed with different content (forged or re-used id); refusing to overwrite`]);
      continue;
    }
    if (prior) rec.receivedAt = prior.receivedAt; // idempotent re-ingest keeps the first receipt time
    if (r.screenshot && rec.attachments.screenshot) writeAtomic(path.join(out, rec.attachments.screenshot.file), r.screenshot);
    if (r.save && rec.attachments.save) writeAtomic(path.join(out, rec.attachments.save.file), r.save);
    writeAtomic(recordFile, `${JSON.stringify(rec, null, 2)}\n`);
    const g = core.addToGroups(groups, rec);
    groups = g.index;
    writeAtomic(groupsFile, `${JSON.stringify(groups, null, 2)}\n`);
    log(`${core.markdownSummary(rec)}\n`);
    log(`Filed ${rec.id} → ${path.relative(ROOT, recordFile) || recordFile} · group ${rec.dedupeKey}: ${g.count} report${g.count === 1 ? '' : 's'}${g.duplicate ? ' (already ingested)' : ''}\n\n`);
    results.push({ file, ok: true, id: rec.id, dedupeKey: rec.dedupeKey, count: g.count, duplicate: g.duplicate });
  }
  return results;
}

async function main(argv) {
  const files = argv.filter((a) => !a.startsWith('--'));
  const outArg = argv.find((a) => a.startsWith('--out='));
  const quiet = argv.includes('--quiet');
  if (files.length === 0 || argv.includes('--help')) {
    process.stderr.write('usage: npm run feedback:ingest -- <file.alreport> [more…] [--out=<dir>] [--quiet]\n');
    return 2;
  }
  const results = await ingestFiles(files.map((f) => path.resolve(f)), {
    out: outArg ? path.resolve(outArg.slice(6)) : undefined,
    log: quiet ? () => {} : undefined,
  });
  const bad = results.filter((r) => !r.ok).length;
  process.stderr.write(`feedback:ingest — ${results.length - bad} filed, ${bad} rejected\n`);
  return bad ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`feedback:ingest failed: ${e && e.stack ? e.stack : e}\n`);
      process.exit(2);
    },
  );
}
