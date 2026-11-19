/**
 * W-110 client service: capture-before-dialog, child-safety rules enforced at send time, screenshot limits, save
 * attachment, export, the F8 hotkey through the real controller input layer — and the PII PROPERTY TEST: names,
 * e-mails, paths and IPs planted everywhere the game keeps text must never reach a stored report.
 */
import { describe, expect, it } from 'vitest';
import type { SimulationAPI } from '../../../src/sim/contracts';
import { buildDiagnostics, ErrorRing } from '../../../src/game/diagnostics';
import { DEFAULT_SETTINGS } from '../../../src/game/contracts';
import { FeedbackService, screenshotSize, type FeedbackHost } from '../../../src/game/feedback';
import { EventTrail } from '../../../src/feedback/trail';
import { defaultForm, type FeedbackForm } from '../../../src/feedback/form';
import { encodeReport, parseReport, validateReport, type FeedbackReport } from '../../../src/feedback/schema';
import { utf8DecodeStrict } from '../../../src/persistence/bytes';
import { gunzipBytes } from '../../../src/persistence/gzip';
import { base64ToBytes } from '../../../src/persistence/bytes';
import { jpegDataUrl, memoryProfile } from './helpers';
import { startedHarness } from '../game/controllerHarness';

const NOW = Date.parse('2026-11-06T12:00:00Z');

interface World {
  household: string;
  agents: { firstName: string; lastName: string }[];
  faults: { tick: number; where: string; message: string }[];
}

function fakeSim(w: World): SimulationAPI {
  const state = {
    tick: 1234,
    seed: 99,
    household: { name: w.household, memberIds: ['a1'], funds: 500 },
    agents: Object.fromEntries(w.agents.map((a, i) => [`a${i + 1}`, { id: `a${i + 1}`, presence: 'onLot', visit: null, ...a }])),
    objects: {},
    choices: [],
    gameOver: false,
  };
  return { state, time: () => ({ day: 3, label: 'Wed 9:00 AM' }), faults: () => w.faults, serialize: () => state } as unknown as SimulationAPI;
}

function makeHost(o: { world?: World; bracket?: unknown; saveNames?: string[]; caz?: FeedbackHost['caz']; errors?: ErrorRing; snapshot?: (w: number, h: number) => string; downloads?: { name: string; data: Uint8Array }[] } = {}) {
  const { store, backend } = memoryProfile();
  const errors = o.errors ?? new ErrorRing(30, () => NOW);
  const trail = new EventTrail(() => 0);
  const sim = o.world ? fakeSim(o.world) : null;
  const snaps: [number, number][] = [];
  const host: FeedbackHost = {
    env: {
      randomU32: (() => {
        let s = 7;
        return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0);
      })(),
      wallNow: () => NOW,
      viewport: () => ({ width: 1920, height: 1080 }),
      devicePixelRatio: () => 2,
      userAgent: () => 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140',
      native: () => null,
      download: (name, data) => {
        o.downloads?.push({ name, data });
        return true;
      },
    },
    renderer: {
      snapshot: (w, h) => {
        snaps.push([w, h]);
        return o.snapshot ? o.snapshot(w, h) : jpegDataUrl(w, h);
      },
    },
    rendererReady: () => true,
    profile: store,
    backend: () => backend,
    trail,
    screen: () => 'game',
    mode: () => 'buy',
    dialog: () => null,
    tool: () => 'buy:placing',
    fps: () => 57,
    settings: () => DEFAULT_SETTINGS,
    ageBracket: () => (typeof o.bracket === 'function' ? (o.bracket as () => unknown)() : o.bracket),
    sim: () => sim,
    anySim: () => sim,
    caz: o.caz ?? (() => null),
    saveNames: async () => o.saveNames ?? [],
    errors: () => errors.list(),
    diagnosticsText: () =>
      buildDiagnostics({
        userAgent: () => 'Mozilla/5.0',
        platform: () => null,
        screen: () => 'game',
        mode: () => 'buy',
        speed: () => '1',
        fps: () => 57,
        renderer: () => ({ ready: true }),
        sim: () => (sim ? { household: sim.state.household.name, tick: 1234 } : null),
        faults: () => o.world?.faults ?? [],
        errors: () => errors.list(),
        settings: () => DEFAULT_SETTINGS,
        storage: () => ({ backend: 'memory' }),
        loop: () => ({ frames: 1 }),
        wallNow: () => NOW,
      }),
    version: '1.0.0',
    report: (w, e) => errors.push(w, e),
  };
  return { host, store, backend, snaps, trail, errors, svc: new FeedbackService(host) };
}

const form = (over: Partial<FeedbackForm> = {}): FeedbackForm => ({ ...defaultForm('buy', false), ...over });

async function stored(svc: FeedbackService, id: string): Promise<FeedbackReport> {
  const r = await svc.report(id);
  if (!r) throw new Error('not stored');
  return r;
}

// ───────────────────────────── PII property test ─────────────────────────────

function prng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
const LETTERS = 'abcdefghijklmnopqrstuvwxyzéüñøß';
function word(r: () => number, min = 3, max = 10): string {
  const n = min + Math.floor(r() * (max - min + 1));
  let s = '';
  for (let i = 0; i < n; i++) s += LETTERS[Math.floor(r() * LETTERS.length)];
  return s[0].toUpperCase() + s.slice(1);
}

describe('PII property test: planted personal data never reaches a report', () => {
  it('300 random worlds × names in household / zombies / saves / CAZ / errors / faults / free text, e-mails, user paths, IPs', async () => {
    for (let iter = 0; iter < 300; iter++) {
      const r = prng(0xbeef + iter * 7919);
      const first = Array.from({ length: 1 + Math.floor(r() * 4) }, () => word(r));
      const last = word(r, 4, 9);
      const household = `The ${word(r, 4, 12)}s`;
      const saveName = `${word(r)} ${word(r)} save`;
      const cazName = word(r);
      const user = `${word(r, 4, 8)} ${word(r, 4, 8)}`.toLowerCase(); // account folders may hold a space ("Jane Doe")
      const email = `${word(r).toLowerCase()}.${word(r).toLowerCase()}@${word(r).toLowerCase()}.com`;
      const ip = `${10 + Math.floor(r() * 200)}.${Math.floor(r() * 255)}.${Math.floor(r() * 255)}.${1 + Math.floor(r() * 250)}`;
      const winPath = `C:\\Users\\${user}\\AppData\\Roaming\\Afterlife Lease\\saves\\x.dat`;
      const nixPath = `/home/${user}/.config/Afterlife Lease/main.log`;
      const errors = new ErrorRing(30, () => NOW);
      errors.push('saveFlow.save', new Error(`could not write ${winPath} for ${household}`));
      errors.push('ui.listener', new Error(`${first[0]} ${last} failed: mail ${email} from ${ip}`));
      const err = new Error(`boom for ${first[first.length - 1]}`);
      err.stack = `Error: boom\n    at file:///home/${user}/game/index.js:1:2\n    at ${nixPath}:3:4`;
      errors.push('render.frame', err);
      const world: World = {
        household,
        agents: first.map((f) => ({ firstName: f, lastName: last })),
        faults: [{ tick: 9, where: 'interaction', message: `${first[0]} could not reach ${saveName}` }],
      };
      const bracket = r() < 0.5 ? 'adult' : 'teen';
      const { svc } = makeHost({ world, bracket, errors, saveNames: [saveName], caz: () => ({ householdName: household, members: [{ firstName: cazName, lastName: last }] }) });
      svc.capture(r() < 0.5 ? 'pause' : 'hotkey');
      const res = await svc.submit(form({ text: `Hi it's ${first[0]} ${last} (${cazName}) — ${email}, ${winPath}, saved as "${saveName}" ${ip} call 555-123-4567`, presets: ['stuck'] }));
      expect(res.ok, JSON.stringify(res)).toBe(true);
      if (!res.ok) continue;
      const rep = await stored(svc, res.id);
      expect(validateReport(rep).ok).toBe(true);
      const text = encodeReport({ ...rep, screenshot: null }); // base64 pixels are not text
      const planted = [...first, last, household, household.replace(/^The /, ''), saveName, cazName, email, ip, user, ...user.split(' '), '555-123-4567'];
      for (const p of planted) {
        const re = new RegExp(`(?<![\\p{L}\\p{N}])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu');
        expect(re.test(text), `iteration ${iter}: "${p}" leaked`).toBe(false);
      }
      expect(text).toContain('[name]');
      expect(text).toContain('[email]');
    }
  }, 120_000);
});

// ───────────────────────────── child safety ─────────────────────────────

describe('child safety at send time (fails closed)', () => {
  for (const bracket of ['under13', 'unknown', undefined, 'garbage', () => {
    throw new Error('economy broken');
  }]) {
    it(`bracket ${typeof bracket === 'function' ? '(throws)' : String(bracket)} → presets only, no text, no save`, async () => {
      const { svc } = makeHost({ world: { household: 'The Ghouls', agents: [{ firstName: 'Edna', lastName: 'Ghoul' }], faults: [] }, bracket });
      const d = svc.capture('pause');
      expect(d.bracket).toBe('under13');
      // a UI bug (or a forged call) passing text + save: the service drops both; chips-only validation then passes
      const res = await svc.submit(form({ text: 'my real name is Sam', attachSave: true, presets: ['lookedWrong'] }));
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const rep = await stored(svc, res.id);
      expect(rep.bracket).toBe('under13');
      expect(rep.text).toBe('');
      expect(rep.save).toBeNull();
      expect(rep.presets).toEqual(['lookedWrong']);
      expect(encodeReport(rep)).not.toContain('Sam');
    });
  }
  it('under-13 with no chip is refused (nothing typed can stand in for one)', async () => {
    const { svc } = makeHost({ bracket: 'under13' });
    svc.capture('hotkey');
    const res = await svc.submit(form({ text: 'hello' }));
    expect(res).toMatchObject({ ok: false, reason: 'invalid' });
  });
  it('the stricter bracket wins: answering the age gate mid-dialog never unlocks text for that draft', async () => {
    let b = 'unknown';
    const { svc } = makeHost({ bracket: () => b });
    svc.capture('pause');
    b = 'adult';
    const res = await svc.submit(form({ text: 'now I can type', presets: ['stuck'] }));
    expect(res.ok).toBe(true);
    if (res.ok) expect((await stored(svc, res.id)).text).toBe('');
  });
});

// ───────────────────────────── capture, screenshot, save, export ─────────────────────────────

describe('capture / screenshot / save / export', () => {
  it('screenshot fits 1280 px (aspect kept); the player can remove it; junk snapshots become null', async () => {
    expect(screenshotSize(3840, 2160)).toEqual({ width: 1280, height: 720 });
    expect(screenshotSize(800, 1600)).toEqual({ width: 640, height: 1280 });
    expect(screenshotSize(640, 480)).toEqual({ width: 640, height: 480 });
    const { svc, snaps } = makeHost({ bracket: 'adult' });
    const d = svc.capture('pause');
    expect(snaps[0]).toEqual([1280, 720]); // 1920×1080 @2x viewport → 3840×2160 buffer → 1280×720
    expect(d.screenshot).toMatchObject({ width: 1280, height: 720 });
    const kept = await svc.submit(form({ text: 'x' }));
    expect(kept.ok && (await stored(svc, kept.id)).screenshot).toMatchObject({ mime: 'image/jpeg', width: 1280, height: 720 });
    svc.capture('pause');
    const removed = await svc.submit(form({ text: 'x', includeScreenshot: false }));
    expect(removed.ok && (await stored(svc, removed.id)).screenshot).toBeNull();
    for (const bad of ['', 'data:image/png;base64,iVBORw0KGgo=', 'data:image/svg+xml;base64,PHN2Zz4=', 'javascript:alert(1)']) {
      const h = makeHost({ snapshot: () => bad });
      expect(h.svc.capture('hotkey').screenshot).toBeNull();
    }
    const throwing = makeHost({ snapshot: () => {
      throw new Error('context lost');
    } });
    expect(throwing.svc.capture('crash', { message: 'x' }).screenshot).toBeNull();
  });

  it('13+ "attach my save" embeds the world (gzip, checksummed); off by default', async () => {
    const world: World = { household: 'The Rots', agents: [{ firstName: 'Mort', lastName: 'Rot' }], faults: [] };
    const { svc } = makeHost({ world, bracket: 'teen' });
    svc.capture('pause');
    const off = await svc.submit(form({ text: 'no save' }));
    expect(off.ok && (await stored(svc, off.id)).save).toBeNull();
    svc.capture('pause');
    const on = await svc.submit(form({ text: 'with save', attachSave: true }));
    expect(on.ok).toBe(true);
    if (!on.ok) return;
    const rep = await stored(svc, on.id);
    expect(rep.save?.encoding).toBe('gzip');
    const json = utf8DecodeStrict(await gunzipBytes(base64ToBytes(rep.save!.data)!, 1 << 20));
    expect(JSON.parse(json).household.name).toBe('The Rots'); // the player opted in: the save is theirs, unscrubbed
  });

  it('same draft sent twice → one outbox entry (idempotent id); export writes a parseable .alreport', async () => {
    const downloads: { name: string; data: Uint8Array }[] = [];
    const { svc } = makeHost({ bracket: 'adult', downloads });
    const d = svc.capture('settings');
    const a = await svc.submit(form({ text: 'first click' }));
    const b = await svc.submit(form({ text: 'second click' }));
    expect(a.ok && b.ok).toBe(true);
    expect(b.ok && b.replaced).toBe(true);
    expect((await svc.outbox()).map((e) => e.id)).toEqual([d.id]);
    expect(await svc.exportReport(d.id)).toBe(true);
    expect(downloads[0].name).toBe(`afterlife-report-${d.id}.alreport`);
    const parsed = parseReport(utf8DecodeStrict(downloads[0].data));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.report.text).toBe('second click');
    expect((await svc.outbox())[0].exportedAt).not.toBeNull();
    expect(await svc.exportReport('FB-00000-00000')).toBe(false);
  });

  it('diagnostics: trail events, errors, faults, fps summary, crash text; the household line is blanked', async () => {
    const world: World = { household: 'The Unique Haunts', agents: [], faults: [{ tick: 3, where: 'autonomy', message: 'stuck' }] };
    const h = makeHost({ world, bracket: 'adult' });
    h.trail.push('mode', 'buy');
    h.trail.push('key', 'rotateObject');
    h.trail.push('key', 'rotateObject');
    h.errors.push('input.buy', new Error('placement refused'));
    h.svc.capture('crash', { message: 'TypeError: x is undefined', stack: 'TypeError\n at a.js:1' });
    const res = await h.svc.submit(form({ text: 'crashed' }));
    const rep = res.ok ? await stored(h.svc, res.id) : null;
    expect(rep?.diagnostics.events.map((e) => [e.k, e.n])).toEqual(expect.arrayContaining([['mode:buy', 1], ['key:rotateObject', 2]]));
    expect(rep?.diagnostics.errors[0]).toMatchObject({ where: 'input.buy', message: 'placement refused' });
    expect(rep?.diagnostics.faults).toEqual([{ tick: 3, where: 'autonomy', message: 'stuck' }]);
    expect(rep?.diagnostics.crash?.message).toBe('TypeError: x is undefined');
    expect(rep?.diagnostics.text).toMatch(/household: \[name\]/);
    expect(rep?.diagnostics.text).not.toContain('Unique Haunts');
    expect(rep?.source).toBe('crash');
  });

  it('submit without a capture is refused; discard forgets the draft', async () => {
    const { svc } = makeHost();
    expect(await svc.submit(form({ presets: ['stuck'] }))).toMatchObject({ ok: false, reason: 'noDraft' });
    svc.capture('menu');
    svc.discard();
    expect(svc.draft).toBeNull();
  });
});

// ───────────────────────────── controller: F8 through the input layer ─────────────────────────────

describe('F8 hotkey (real controller + input layer)', () => {
  it('in game: screenshot BEFORE the dialog opens, the game pauses, nothing fires while typing or behind a dialog', async () => {
    const h = await startedHarness();
    const dialogAtSnapshot: (string | null)[] = [];
    const orig = h.renderer.snapshot.bind(h.renderer);
    h.renderer.snapshot = (w: number, hh: number) => {
      dialogAtSnapshot.push(h.game.dialog);
      return orig(w, hh);
    };
    const fb = h.game.feedback!;
    expect(fb).toBeTruthy();

    // typing in a text field: the key belongs to the field
    const typing = new Event('keydown', { cancelable: true });
    Object.assign(typing, { code: 'F8', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false });
    Object.defineProperty(typing, 'target', { value: { tagName: 'INPUT' } });
    h.win.dispatchEvent(typing);
    expect(h.game.dialog).toBeNull();
    expect(fb.draft).toBeNull();

    h.key('keydown', 'F8');
    expect(dialogAtSnapshot).toEqual([null]);
    expect(h.game.dialog).toBe('feedback');
    expect(fb.draft?.source).toBe('hotkey');
    expect(fb.draft?.area).toBe('live');
    expect(h.game.speed).toBe(0); // paused behind a system dialog

    // a second F8 while the dialog is open does nothing (blocked)
    const id = fb.draft?.id;
    h.key('keydown', 'F8');
    expect(fb.draft?.id).toBe(id);
    h.game.closeDialog();
    expect(h.game.speed).not.toBe(0);
  });

  it('not on the main menu (the menu offers Settings → Help instead)', async () => {
    const { createHarness } = await import('../game/controllerHarness');
    const h = await createHarness();
    h.key('keydown', 'F8');
    expect(h.game.dialog).toBeNull();
    expect(h.game.feedback?.draft ?? null).toBeNull();
  });
});
