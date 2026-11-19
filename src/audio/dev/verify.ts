/**
 * Objective audio verification (we cannot listen): render every SFX, loop, voice emotion and 8 s of each
 * music mood offline, measure peak / RMS / non-silent span / DC / clipping / NaN / spectral centroid,
 * check distinctness between SFX spectra, and draw spectrogram sheets.
 */
import { SFX_IDS, VOICE_EMOTIONS, type MusicMood, type SfxId } from '../../shared/audioIds';
import { analyzeChannels, cosineSimilarity, envelopeFluctuation, mixdown, modulationCentroid, spectrogram, type SignalStats } from '../analysis';
import { MOOD_IDS } from '../music/moods';
import { factoryInto, loopInto, musicInto, recipeInto, renderOffline, sfxInto, voiceInto } from '../offline';
import { AMBIENT_EXTRAS, MAX_DURATION, SFX_TABLE } from '../sfx/table';
import type { LoopFactory, OneShot } from '../synth/types';
import { SCENES, measureScene, type SceneEntry } from './scenes';

export interface Entry {
  kind: 'sfx' | 'loop' | 'voice' | 'music';
  id: string;
  cat: string;
  renderSec: number;
  stats: Omit<SignalStats, 'bands'> & { bands?: number[]; modulationHz?: number; slowStd?: number; fastStd?: number };
  checks: Record<string, boolean>;
  pass: boolean;
  notes: string[];
  ms: number;
}

export interface Report {
  generatedAt: string;
  sampleRate: number;
  userAgent: string;
  totals: { entries: number; passed: number; failed: number };
  failures: string[];
  warnings: string[];
  similarPairs: { a: string; b: string; similarity: number }[];
  minPairDistance: number;
  entries: Entry[];
  /** Engine-in-the-loop mixes through the real master chain at default volumes. */
  scenes: SceneEntry[];
}

export const LOOP_IDS: SfxId[] = ['shower', 'sinkWater', 'fireLoop', 'cook', 'tvChatter', 'tvStatic', 'stereoMusic', 'computerTyping', 'arcadeBlips', 'flies', 'snore', 'crickets', 'wind', 'groanAmbient', 'microwave', 'espresso', 'phoneRing', 'footstep'];

/** Internal ambience voices (not SfxIds) rendered with the trims the Ambience controller uses. */
const EXTRA_ONESHOTS: readonly (readonly [string, OneShot])[] = [
  ['amb:howl', AMBIENT_EXTRAS.howl],
  ['amb:crow', AMBIENT_EXTRAS.crow],
];
const EXTRA_LOOPS: readonly (readonly [string, LoopFactory, number])[] = [
  ['bed:dayWind', AMBIENT_EXTRAS.windLoop, 0.5],
  ['bed:crickets', AMBIENT_EXTRAS.cricketsLoop, 0.6],
  ['bed:rain', AMBIENT_EXTRAS.rainLoop, 0.65],
  ['bed:moon', AMBIENT_EXTRAS.moonLoop, 0.7],
];
/**
 * Beds rendered long enough (8 s) for slow gusts/swells to show in the envelope measures (informational: noise
 * beds have broadband envelope jitter of their own, so pass/fail for LFO rates lives in the unit tests).
 */
const SLOW_BEDS: ReadonlySet<string> = new Set(['wind', 'shower', 'sinkWater', 'fireLoop', 'cook', 'bed:dayWind', 'bed:rain', 'bed:moon']);

const round = (x: number, d = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);

function evaluate(kind: Entry['kind'], id: string, cat: string, renderSec: number, buf: AudioBuffer, ms: number): Entry {
  const chans: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
  const st = analyzeChannels(chans, buf.sampleRate);
  const notes: string[] = [];
  const checks: Record<string, boolean> = {
    nonSilent: st.peak > 0.001 && st.activeDuration >= 0.01,
    peakOk: st.peak <= 0.98,
    noNaN: st.nanCount === 0,
    noClip: st.clipCount === 0,
    dcOk: st.dcOffset < 0.02,
  };
  if (kind === 'sfx') {
    const lim = MAX_DURATION[cat as keyof typeof MAX_DURATION] ?? 1.2;
    checks.durationOk = st.activeEnd <= lim + 0.35 && st.activeDuration >= 0.01;
    if (st.activeEnd > lim + 0.35) notes.push(`audible until ${st.activeEnd.toFixed(2)}s (limit ${lim}s)`);
  } else if (kind === 'loop') {
    checks.durationOk = st.activeDuration >= renderSec * 0.8;
  } else if (kind === 'music') {
    checks.durationOk = st.activeDuration >= renderSec * 0.85;
  } else {
    checks.durationOk = st.activeDuration >= 0.12 && st.activeEnd <= renderSec;
  }
  if (st.activeRmsDb > -6) notes.push(`very loud (active RMS ${st.activeRmsDb.toFixed(1)} dB)`);
  if (st.activeRmsDb < -48 && checks.nonSilent) notes.push(`very quiet (active RMS ${st.activeRmsDb.toFixed(1)} dB)`);
  const pass = Object.values(checks).every(Boolean);
  const { bands, ...rest } = st;
  const stats = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v])) as unknown as Entry['stats'];
  stats.bands = bands.map((b) => round(b, 5));
  if (kind === 'loop') {
    const mono = mixdown(chans);
    stats.modulationHz = round(modulationCentroid(mono, buf.sampleRate), 3);
    const fl = envelopeFluctuation(mono, buf.sampleRate);
    stats.slowStd = round(fl.slowStd, 3);
    stats.fastStd = round(fl.fastStd, 3);
  }
  return { kind, id, cat, renderSec, stats, checks, pass, notes, ms };
}

// ───────────────────────────── spectrogram sheets ─────────────────────────────

function colour(v: number): [number, number, number] {
  // night plum -> grave slate -> moss -> toxic glow -> bone
  const stops: [number, [number, number, number]][] = [
    [0, [18, 14, 26]], [0.3, [43, 47, 70]], [0.55, [70, 120, 110]], [0.78, [159, 232, 112]], [1, [240, 232, 210]],
  ];
  const x = Math.min(1, Math.max(0, v));
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const k = (x - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}

export interface Tile {
  label: string;
  buf: AudioBuffer;
  seconds: number;
}

/** Draw labelled spectrogram tiles (log-frequency, -96..0 dB) with an amplitude envelope strip. */
export function drawSheet(title: string, tiles: Tile[], cols: number, tileW: number, tileH: number): string {
  const pad = 6;
  const labelH = 14;
  const envH = 16;
  const rows = Math.ceil(tiles.length / cols);
  const W = cols * (tileW + pad) + pad;
  const H = 28 + rows * (tileH + labelH + envH + pad) + pad;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#1d1726';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#e8e0c8';
  g.font = 'bold 15px Georgia, serif';
  g.fillText(title, pad, 19);
  tiles.forEach((tile, i) => {
    const cx = pad + (i % cols) * (tileW + pad);
    const cy = 28 + Math.floor(i / cols) * (tileH + labelH + envH + pad);
    const mono = mixdown([tile.buf.getChannelData(0), tile.buf.getChannelData(Math.min(1, tile.buf.numberOfChannels - 1))]);
    const sg = spectrogram(mono, tile.buf.sampleRate, { fftSize: 1024, hop: Math.max(64, Math.floor(mono.length / tileW)), bins: tileH });
    const img = g.createImageData(tileW, tileH);
    for (let x = 0; x < tileW; x++) {
      const f = Math.min(sg.frames - 1, Math.floor((x / tileW) * sg.frames));
      for (let y = 0; y < tileH; y++) {
        const b = tileH - 1 - y;
        const db = sg.db[f * sg.bins + Math.min(sg.bins - 1, b)];
        const [r, gg, bb] = colour((db + 96) / 96);
        const o = (y * tileW + x) * 4;
        img.data[o] = r;
        img.data[o + 1] = gg;
        img.data[o + 2] = bb;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, cx, cy + labelH);
    // envelope strip (peak per column)
    const ey = cy + labelH + tileH;
    g.fillStyle = '#2b2f3a';
    g.fillRect(cx, ey, tileW, envH);
    g.fillStyle = '#ffb35a';
    const per = Math.max(1, Math.floor(mono.length / tileW));
    for (let x = 0; x < tileW; x++) {
      let p = 0;
      for (let k = x * per; k < Math.min(mono.length, (x + 1) * per); k++) p = Math.max(p, Math.abs(mono[k]));
      const h = Math.min(envH, Math.round(p * envH));
      g.fillRect(cx + x, ey + envH - h, 1, h);
    }
    g.fillStyle = '#e8e0c8';
    g.font = '11px ui-monospace, monospace';
    g.fillText(`${tile.label} (${tile.seconds.toFixed(1)}s)`, cx + 1, cy + 11);
  });
  return canvas.toDataURL('image/png');
}

// ───────────────────────────── run ─────────────────────────────

export interface VerifyOptions {
  musicSeconds?: number;
  loopSeconds?: number;
  onProgress?: (msg: string) => void;
  images?: boolean;
  /** Engine-in-the-loop scene mixes (default true). */
  scenes?: boolean;
}

export async function runVerification(opts: VerifyOptions = {}): Promise<{ report: Report; images: Record<string, string> }> {
  const musicSec = opts.musicSeconds ?? 8;
  const loopSec = opts.loopSeconds ?? 4;
  const progress = opts.onProgress ?? (() => undefined);
  const entries: Entry[] = [];
  const sfxTiles: Tile[] = [];
  const voiceTiles: Tile[] = [];
  const musicTiles: Tile[] = [];
  const loopTiles: Tile[] = [];
  const time = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  for (const id of SFX_IDS) {
    const def = SFX_TABLE[id];
    const sec = Math.min(4.2, MAX_DURATION[def.cat] + 0.6);
    const t0 = time();
    const buf = await renderOffline(sec, (ctx, dest) => void sfxInto(ctx, dest, id, 1234));
    entries.push(evaluate('sfx', id, def.cat, sec, buf, Math.round(time() - t0)));
    sfxTiles.push({ label: id, buf, seconds: sec });
    progress(`sfx ${id}`);
  }
  for (const [id, recipe] of EXTRA_ONESHOTS) {
    const sec = MAX_DURATION.ambient + 0.6;
    const t0 = time();
    const buf = await renderOffline(sec, (ctx, dest) => void recipeInto(ctx, dest, recipe, 1234));
    entries.push(evaluate('sfx', id, 'ambient', sec, buf, Math.round(time() - t0)));
    sfxTiles.push({ label: id, buf, seconds: sec });
    progress(`extra ${id}`);
  }
  // beds need longer windows than event loops so slow gusts/swells show up in the modulation measure
  const bedSec = Math.max(loopSec, 8);
  for (const id of LOOP_IDS) {
    const sec = SLOW_BEDS.has(id) ? bedSec : loopSec;
    const t0 = time();
    const buf = await renderOffline(sec, (ctx, dest) => loopInto(ctx, dest, id, sec, 77));
    entries.push(evaluate('loop', id, SFX_TABLE[id].cat, sec, buf, Math.round(time() - t0)));
    loopTiles.push({ label: `loop:${id}`, buf, seconds: sec });
    progress(`loop ${id}`);
  }
  for (const [id, factory, trim] of EXTRA_LOOPS) {
    const t0 = time();
    const buf = await renderOffline(bedSec, (ctx, dest) => factoryInto(ctx, dest, factory, trim, bedSec, 77));
    entries.push(evaluate('loop', id, 'ambient', bedSec, buf, Math.round(time() - t0)));
    loopTiles.push({ label: id, buf, seconds: bedSec });
    progress(`bed ${id}`);
  }
  const voiceSec = 1.6;
  for (let i = 0; i < VOICE_EMOTIONS.length; i++) {
    const emo = VOICE_EMOTIONS[i];
    const pitch = [0.2, 0.5, 0.8][i % 3];
    const t0 = time();
    const buf = await renderOffline(voiceSec, (ctx, dest) => void voiceInto(ctx, dest, 1000 + i * 17, pitch, emo, 1300, 1));
    entries.push(evaluate('voice', emo, `pitch ${pitch}`, voiceSec, buf, Math.round(time() - t0)));
    voiceTiles.push({ label: `${emo} p${pitch}`, buf, seconds: voiceSec });
    progress(`voice ${emo}`);
  }
  for (const mood of MOOD_IDS as MusicMood[]) {
    const t0 = time();
    const buf = await renderOffline(musicSec, (ctx, dest) => void musicInto(ctx, dest, mood, musicSec));
    entries.push(evaluate('music', mood, 'music', musicSec, buf, Math.round(time() - t0)));
    musicTiles.push({ label: mood, buf, seconds: musicSec });
    progress(`music ${mood}`);
  }

  // distinctness between one-shot SFX spectra
  const sfx = entries.filter((e) => e.kind === 'sfx');
  const pairs: { a: string; b: string; similarity: number }[] = [];
  for (let i = 0; i < sfx.length; i++) {
    for (let j = i + 1; j < sfx.length; j++) {
      pairs.push({ a: sfx[i].id, b: sfx[j].id, similarity: round(cosineSimilarity(sfx[i].stats.bands ?? [], sfx[j].stats.bands ?? []), 5) });
    }
  }
  pairs.sort((x, y) => y.similarity - x.similarity);
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const e of entries) {
    if (!e.pass) failures.push(`${e.kind}:${e.id} failed ${Object.entries(e.checks).filter(([, v]) => !v).map(([k]) => k).join(',')}`);
    for (const n of e.notes) warnings.push(`${e.kind}:${e.id} ${n}`);
  }
  // engine-in-the-loop scenes: what the player hears through the real mix chain
  const scenes: SceneEntry[] = [];
  const sceneTiles: Tile[] = [];
  if (opts.scenes !== false) {
    for (const spec of SCENES) {
      const { entry, mixBuf } = await measureScene(spec, spec.id !== 'stress');
      scenes.push(entry);
      sceneTiles.push({ label: `${spec.id} peak ${entry.peak} · ${entry.mix.rmsDb} dB`, buf: mixBuf, seconds: spec.seconds });
      if (!entry.pass) failures.push(`scene:${spec.id} failed ${Object.entries(entry.checks).filter(([, v]) => !v).map(([k]) => k).join(',')}`);
      for (const n of entry.notes) warnings.push(`scene:${spec.id} ${n}`);
      progress(`scene ${spec.id}`);
    }
  }
  const identical = pairs.filter((p) => p.similarity > 0.999);
  for (const p of identical) failures.push(`indistinct spectra: ${p.a} ~ ${p.b} (${p.similarity})`);

  const report: Report = {
    generatedAt: new Date().toISOString(),
    sampleRate: 44100,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
    totals: { entries: entries.length, passed: entries.filter((e) => e.pass).length, failed: entries.filter((e) => !e.pass).length },
    failures,
    warnings,
    similarPairs: pairs.slice(0, 15),
    minPairDistance: pairs.length ? round(1 - pairs[0].similarity, 5) : 1,
    entries,
    scenes,
  };
  const images: Record<string, string> = {};
  if (opts.images !== false) {
    progress('drawing spectrograms');
    images['spectrogram-sfx.png'] = drawSheet('One-shot SFX (log freq 40 Hz - 16 kHz, -96..0 dB; orange = peak envelope)', sfxTiles, 8, 150, 72);
    images['spectrogram-loops.png'] = drawSheet(`Loops and ambience beds (${loopSec}-${bedSec} s each)`, loopTiles, 6, 200, 90);
    images['spectrogram-voice.png'] = drawSheet('Groanish voice — one emotion per tile', voiceTiles, 4, 260, 110);
    images['spectrogram-music.png'] = drawSheet(`Music moods (${musicSec}s each)`, musicTiles, 3, 420, 130);
    if (sceneTiles.length) images['spectrogram-scenes.png'] = drawSheet('Engine-in-the-loop scene mixes (full master chain, default volumes)', sceneTiles, 2, 620, 140);
  }
  return { report, images };
}

export interface LongMusicEntry {
  mood: string;
  seconds: number;
  peak: number;
  rmsDb: number;
  /** Loudest 2 s window RMS (dB) — catches dense later sections. */
  maxWindowDb: number;
  notes: number;
  droppedNotes: number;
  clipCount: number;
  nanCount: number;
  pass: boolean;
}

/**
 * Peak/loudness over one full pass of every cue's form plus the first section of the second pass
 * (variation layers), rendered at 22.05 kHz to keep CPU modest.
 */
export async function runLongMusic(onProgress?: (m: string) => void): Promise<LongMusicEntry[]> {
  const { MOODS } = await import('../music/moods');
  const { formLength } = await import('../music/composer');
  const out: LongMusicEntry[] = [];
  for (const mood of MOOD_IDS as MusicMood[]) {
    const m = MOODS[mood];
    const barSec = (60 / m.bpm) * m.beatsPerBar;
    const seconds = Math.min(120, (formLength(m) + m.form[0].bars.length) * barSec);
    let section: ReturnType<typeof musicInto> | null = null;
    const buf = await renderOffline(seconds, (ctx, dest) => {
      section = musicInto(ctx, dest, mood, seconds);
    }, 22050);
    const ch = [buf.getChannelData(0), buf.getChannelData(1)];
    const st = analyzeChannels(ch, buf.sampleRate);
    const mono = mixdown(ch);
    const win = buf.sampleRate * 2;
    let maxW = 0;
    for (let i = 0; i + win <= mono.length; i += win / 2) {
      let s = 0;
      for (let k = i; k < i + win; k++) s += mono[k] * mono[k];
      maxW = Math.max(maxW, Math.sqrt(s / win));
    }
    const sec = section as unknown as { notes: number; droppedNotes: number } | null;
    out.push({
      mood,
      seconds: round(seconds, 1),
      peak: round(st.peak),
      rmsDb: round(st.rmsDb, 1),
      maxWindowDb: round(20 * Math.log10(maxW + 1e-12), 1),
      notes: sec?.notes ?? 0,
      droppedNotes: sec?.droppedNotes ?? 0,
      clipCount: st.clipCount,
      nanCount: st.nanCount,
      pass: st.peak <= 0.98 && st.nanCount === 0 && st.clipCount === 0,
    });
    onProgress?.(`long ${mood}`);
  }
  return out;
}
