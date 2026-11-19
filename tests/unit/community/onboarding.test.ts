/**
 * Community contribution kit (docs/community/, AGENTS.md, CONTRIBUTING.md, .github/ISSUE_TEMPLATE/): docs must match
 * the repository (a doc claim the code doesn't implement is P0). Proves:
 *  1. every relative link and #anchor in the kit resolves;
 *  2. every `npm run <script>` the kit tells people to run exists in package.json;
 *  3. every repo path the kit names in backticks exists, except the few it explicitly says do not exist yet;
 *  4. every starter task's work item is still `todo` on the workboard (a taken item can't be advertised);
 *  5. issue forms: required keys, unique field ids, and only labels defined in labels.json; labels.json is well-formed;
 *  6. status claims bound to code: packs register brand skins only; exactly eight house brands; licensed, foreign-brand
 *     and killed skins are refused (the "sponsorship stays with the owner" table);
 *  7. adversarial: the checkers themselves catch a broken link, a missing script and a missing path.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HOUSE_BRANDS, HOUSE_BRAND_SKINS, setBrandSkinDisabled, setBrandsEnabled, skinUsable } from '../../../src/economy/brands';

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const KIT_DIR = 'docs/community';
const KIT_DOCS = [...readdirSync(join(ROOT, KIT_DIR)).filter((f) => f.endsWith('.md')).map((f) => `${KIT_DIR}/${f}`), 'AGENTS.md', 'CONTRIBUTING.md'];
const FORM_DIR = '.github/ISSUE_TEMPLATE';
const FORMS = readdirSync(join(ROOT, FORM_DIR)).filter((f) => f.endsWith('.yml') && f !== 'config.yml');
/** Paths the kit names on purpose that do not exist yet; each sentence naming one says so. */
const NOT_YET = new Set(['tests/unit/world/homeOnly.determinism.test.ts']);

/** GitHub-style heading slug. */
function slug(h: string): string {
  return h.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s/g, '-');
}
function anchorsOf(md: string): Set<string> {
  const out = new Set<string>();
  for (const m of md.matchAll(/^#{1,6}\s+(.+)$/gm)) out.add(slug(m[1]));
  return out;
}
function stripCode(md: string): string {
  return md.replace(/```[\s\S]*?```/g, '');
}

export function brokenLinks(file: string, md: string, exists = (p: string) => existsSync(p), readAbs = (p: string) => readFileSync(p, 'utf8')): string[] {
  const bad: string[] = [];
  for (const m of stripCode(md).matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:)/.test(target)) continue;
    const [path, anchor] = target.split('#');
    const abs = path ? normalize(join(ROOT, dirname(file), path)) : join(ROOT, file);
    if (!exists(abs)) {
      bad.push(`${file}: ${target} (missing file)`);
      continue;
    }
    if (anchor && abs.endsWith('.md') && !anchorsOf(readAbs(abs)).has(anchor)) bad.push(`${file}: ${target} (missing #${anchor})`);
  }
  return bad;
}

export function missingScripts(md: string, scripts: Record<string, string>): string[] {
  return [...md.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]).filter((s) => !(s in scripts));
}

export function missingPaths(md: string, exists = (p: string) => existsSync(join(ROOT, p))): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(/`((?:src|tests|scripts|docs|public|tools|\.github)\/[^`\s]*)`/g)) {
    const p = m[1].replace(/\/$/, '');
    if (/[<>*{}]|YYYY|\.\.\./.test(p) || NOT_YET.has(p)) continue;
    if (!exists(p)) out.push(p);
  }
  return out;
}

describe('community kit: links, commands and paths are real', () => {
  it('has the expected files', () => {
    for (const f of ['README.md', 'GETTING_STARTED.md', 'ASSETS.md', 'WORLD_BUILDING.md', 'TRIAGE.md', 'PLAYTEST.md', 'STARTER_TASKS.md', 'labels.json']) {
      expect(existsSync(join(ROOT, KIT_DIR, f)), f).toBe(true);
    }
    expect(KIT_DOCS.length).toBeGreaterThanOrEqual(9);
  });

  it.each(KIT_DOCS)('%s: every relative link and anchor resolves', (f) => {
    expect(brokenLinks(f, read(f))).toEqual([]);
  });

  it.each(KIT_DOCS)('%s: every `npm run` script exists', (f) => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
    expect(missingScripts(read(f), scripts)).toEqual([]);
  });

  it.each(KIT_DOCS)('%s: every named repo path exists (or is declared not-yet)', (f) => {
    expect(missingPaths(read(f))).toEqual([]);
  });

  it('each not-yet path is introduced as not existing yet wherever it is named', () => {
    for (const f of KIT_DOCS) {
      const md = read(f);
      for (const p of NOT_YET) if (md.includes(p)) expect(md, `${f} must say ${p} does not exist yet`).toMatch(/does not exist yet|lands with/);
    }
  });

  it('starter tasks only advertise work items that are still todo', () => {
    const board = read('docs/WORKBOARD.md');
    const ids = [...new Set([...read(`${KIT_DIR}/STARTER_TASKS.md`).matchAll(/\*\*(W-\d{3})\*\*/g)].map((m) => m[1]))];
    expect(ids.length).toBeGreaterThanOrEqual(5);
    for (const id of ids) {
      const row = board.split('\n').find((l) => l.startsWith(`| ${id} |`));
      expect(row, `${id} on the workboard`).toBeDefined();
      expect(row!.split('|').map((c) => c.trim())[5], `${id} status`).toBe('todo');
    }
  });
});

describe('issue forms and labels', () => {
  const labels = JSON.parse(read(`${KIT_DIR}/labels.json`)) as { version: number; labels: { name: string; color: string; description: string }[] };
  const names = new Set(labels.labels.map((l) => l.name));

  it('labels.json: unique names, 6-hex colours, descriptions ≤ 100 chars', () => {
    expect(names.size).toBe(labels.labels.length);
    for (const l of labels.labels) {
      expect(l.color, l.name).toMatch(/^[0-9a-f]{6}$/);
      expect(l.description.length, l.name).toBeLessThanOrEqual(100);
    }
    for (const step of ['needs-triage', 'ready', 'claimed', 'in-progress', 'in-review', 'merged', 'shipped']) expect(names.has(step), step).toBe(true);
  });

  it.each(FORMS)('%s: name, description, body; unique ids; labels defined; needs-triage applied', (f) => {
    const y = read(`${FORM_DIR}/${f}`);
    expect(y).toMatch(/^name: \S/m);
    expect(y).toMatch(/^description: \S/m);
    expect(y).toMatch(/^body:$/m);
    const ids = [...y.matchAll(/^\s+id: ([\w-]+)$/gm)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    const lab = /^labels: \[([^\]]*)\]$/m.exec(y);
    expect(lab, 'labels line').not.toBeNull();
    const used = lab![1].split(',').map((s) => s.trim()).filter(Boolean);
    expect(used).toContain('needs-triage');
    for (const l of used) expect(names.has(l), `${f} label ${l}`).toBe(true);
    expect(y).not.toMatch(/\t/);
  });

  it('every form the kit names exists', () => {
    const readme = read(`${KIT_DIR}/README.md`) + read(`${KIT_DIR}/TRIAGE.md`);
    const titles = FORMS.map((f) => /^name: (.+)$/m.exec(read(`${FORM_DIR}/${f}`))![1].trim());
    for (const t of ['Claim work', 'Asset submission', 'World content', 'Playtest feedback']) {
      expect(titles, t).toContain(t);
      expect(readme.toLowerCase()).toContain(t.toLowerCase());
    }
  });
});

describe('status claims are bound to the code', () => {
  afterEach(() => {
    setBrandsEnabled(true);
    for (const s of HOUSE_BRAND_SKINS) setBrandSkinDisabled(s.id, false);
  });

  it('packs register brand skins only (WORLD_BUILDING §1, README §6)', () => {
    const verify = read('src/packs/verify.ts');
    expect(/const REGISTRABLE = new Set\(\[([^\]]*)\]\)/.exec(verify)![1].trim()).toBe("'brandSkins'");
    expect(read(`${KIT_DIR}/WORLD_BUILDING.md`)).toContain('**only** house-brand skins');
  });

  it('exactly eight house brands, as README §6 says', () => {
    expect(HOUSE_BRANDS.length).toBe(8);
    expect(read(`${KIT_DIR}/README.md`)).toContain('Only the eight original house brands');
  });

  it('licensed, foreign-brand and killed skins are refused; a normal house skin is usable', () => {
    const base = HOUSE_BRAND_SKINS.find((s) => s.enabled);
    expect(base, 'at least one enabled house skin').toBeDefined();
    expect(skinUsable(base!)).toBe(true);
    expect(skinUsable({ ...base!, licensed: true })).toBe(false);
    expect(skinUsable({ ...base!, brand: 'Real Soda Co' })).toBe(false);
    setBrandSkinDisabled(base!.id, true);
    expect(skinUsable(base!)).toBe(false);
    setBrandSkinDisabled(base!.id, false);
    setBrandsEnabled(false);
    expect(skinUsable(base!)).toBe(false);
  });

  it('packs are signature-checked against allowed publisher keys (README §6 table)', () => {
    const verify = read('src/packs/verify.ts');
    expect(verify).toMatch(/trustedKeys/);
    expect(verify).toMatch(/Ed25519/);
  });
});

describe('adversarial: the checkers catch what they claim to', () => {
  it('a broken link, a bad anchor, a missing script and a missing path are all reported', () => {
    const md = '[a](nope.md) [b](README.md#no-such-heading) `npm run definitely-not-a-script` `src/does/not/exist.ts`';
    const links = brokenLinks(`${KIT_DIR}/X.md`, md);
    expect(links.some((l) => l.includes('nope.md (missing file)'))).toBe(true);
    expect(links.some((l) => l.includes('missing #no-such-heading'))).toBe(true);
    expect(missingScripts(md, { dev: 'vite' })).toEqual(['definitely-not-a-script']);
    expect(missingPaths(md)).toEqual(['src/does/not/exist.ts']);
  });

  it('links inside code fences, URLs and placeholders are not checked', () => {
    const md = '```\n[x](nope.md)\n```\n[y](https://example.com) `docs/drafts/<id>/pack.json` `public/assets/manifest.*.json`';
    expect(brokenLinks(`${KIT_DIR}/X.md`, md)).toEqual([]);
    expect(missingPaths(md)).toEqual([]);
  });

  it('the slugger matches GitHub for the gate heading README links to', () => {
    expect(slug('5. Gates before anyone outside the team is invited')).toBe('5-gates-before-anyone-outside-the-team-is-invited');
    // repository paths are compared with '/' on every OS (path.relative returns 'docs\community' on Windows)
    expect(relative(ROOT, join(ROOT, KIT_DIR)).split(sep).join('/')).toBe(KIT_DIR);
  });
});
