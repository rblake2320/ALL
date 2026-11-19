#!/usr/bin/env node
/** Compare matching scenario/look records; keep unreachable-floor bucket separate. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const levels = new Set(['PASS', 'WARN', 'FAIL']);
export function readRows(text) {
  const rows = new Map();
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { throw new Error(`Invalid JSON at line ${i + 1}`); }
    if (typeof row.key !== 'string' || typeof row.look !== 'string' || !levels.has(row.verdict) || !Array.isArray(row.checks)) throw new Error(`Invalid evaluation at line ${i + 1}`);
    if (row.checks.some(c => c.name === 'error')) throw new Error(`Audit error at line ${i + 1}`);
    const identity = JSON.stringify([row.key, row.look]);
    if (rows.has(identity)) throw new Error(`Duplicate scenario/look at line ${i + 1}`);
    rows.set(identity, row);
  }
  if (!rows.size) throw new Error('No clipping evaluations');
  return rows;
}

function bucket(row) { return row.key === 'floor:beEmbalmed' ? 'furnitureOnlyFloor' : 'other'; }
function summary(rows) {
  const groups = { other: { PASS: 0, WARN: 0, FAIL: 0 }, furnitureOnlyFloor: { PASS: 0, WARN: 0, FAIL: 0 } };
  for (const row of rows.values()) groups[bucket(row)][row.verdict]++;
  return groups;
}

export function compare(before, after) {
  const transitions = {}, beforeOnly = [], afterOnly = [];
  let matched = 0;
  for (const [key, old] of before) {
    const current = after.get(key);
    if (!current) { beforeOnly.push({ key: old.key, look: old.look }); continue; }
    matched++;
    const k = `${bucket(old)}:${old.verdict}->${current.verdict}`;
    transitions[k] = (transitions[k] ?? 0) + 1;
  }
  for (const [key, row] of after) if (!before.has(key)) afterOnly.push({ key: row.key, look: row.look });
  return { before: summary(before), after: summary(after), matched, transitions,
    beforeOnlyCount: beforeOnly.length, afterOnlyCount: afterOnly.length,
    beforeOnlyExamples: beforeOnly.slice(0, 20), afterOnlyExamples: afterOnly.slice(0, 20) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node compare-clipping.mjs <before.jsonl> <after.jsonl>');
    console.log(JSON.stringify(compare(readRows(readFileSync(process.argv[2], 'utf8')), readRows(readFileSync(process.argv[3], 'utf8'))), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
