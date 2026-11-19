/**
 * Dev sound board (dev/audio.html): buttons for every SFX (one-shot + loop toggle), every voice emotion,
 * every music mood, ambience/speed/volume/mute/duck controls, live meter, and the offline verification.
 * Exposes window.__audioDev for Playwright.
 */
import { SFX_IDS, VOICE_EMOTIONS, type MusicMood, type SfxId, type VoiceEmotion } from '../../shared/audioIds';
import { AudioEngine } from '../engine';
import { MOOD_IDS } from '../music/moods';
import { SFX_TABLE } from '../sfx/table';
import { VOLUME_KEYS } from '../volumes';
import { runLongMusic, runVerification, type LongMusicEntry, type Report } from './verify';

type Kids = (Node | string | null | undefined | false)[];

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: Kids): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'style' || k.startsWith('data-') || k.startsWith('aria-')) el.setAttribute(k, String(v));
    else (el as unknown as Record<string, unknown>)[k] = v;
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #1d1726; color: #e8e0c8; font: 13px system-ui, sans-serif; }
header { position: sticky; top: 0; z-index: 2; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding: 10px 16px;
  background: rgba(29,23,38,0.95); border-bottom: 1px solid rgba(232,224,200,0.15); }
h1 { font: 600 20px "Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif; margin: 0 8px 0 0; }
h2 { font: 600 15px Georgia, serif; margin: 18px 0 8px; color: #9fe870; }
main { padding: 0 16px 40px; max-width: 1400px; }
button { background: #2b2f3a; color: #e8e0c8; border: 1px solid rgba(232,224,200,0.18); border-radius: 10px; padding: 6px 10px;
  font: inherit; cursor: pointer; transition: background 120ms ease-out; }
button:hover { background: #3a3f4d; }
button.on { background: #6f8f5e; border-color: #9fe870; color: #1d1726; }
button.primary { background: #ffb35a; color: #1d1726; border-color: #ffb35a; font-weight: 600; }
.grid { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-flex; gap: 2px; }
.chip button:first-child { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.chip button:last-child { border-top-left-radius: 0; border-bottom-left-radius: 0; padding: 6px 7px; opacity: 0.8; }
.group { margin-bottom: 4px; color: #d9cfb8; opacity: 0.7; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
.row { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
label { display: inline-flex; gap: 6px; align-items: center; }
input[type=range] { width: 110px; accent-color: #9fe870; }
#meter { width: 160px; height: 10px; background: #2b2f3a; border-radius: 5px; overflow: hidden; }
#meter > div { height: 100%; width: 0; background: linear-gradient(90deg, #55d6be, #9fe870 70%, #ff9a4a); }
#status { font: 12px ui-monospace, monospace; opacity: 0.85; }
table { border-collapse: collapse; font: 11px ui-monospace, monospace; margin-top: 8px; }
td, th { padding: 2px 8px; border-bottom: 1px solid rgba(232,224,200,0.08); text-align: right; }
td:first-child, th:first-child { text-align: left; }
tr.fail td { color: #ff9a4a; }
img.sheet { max-width: 100%; border-radius: 10px; margin-top: 10px; border: 1px solid rgba(232,224,200,0.15); }
`;

export interface AudioDev {
  engine: AudioEngine;
  unlock(): Promise<void>;
  verify(opts?: { musicSeconds?: number; loopSeconds?: number }): Promise<{ report: Report; images: Record<string, string> }>;
  verifyLongMusic(): Promise<LongMusicEntry[]>;
  liveProbe(): Promise<{ peak: number; rms: number; stats: ReturnType<AudioEngine['stats']> }>;
}

declare global {
  interface Window {
    __audioDev?: AudioDev;
  }
}

export function mountBoard(root: HTMLElement): AudioDev {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const engine = new AudioEngine({ seed: 7 });
  let analyser: AnalyserNode | null = null;
  const status = h('span', { id: 'status' }, 'locked — click Unlock');
  const meterBar = h('div');
  const meter = h('div', { id: 'meter' }, meterBar);

  const ensureAnalyser = () => {
    const ctx = engine.context as AudioContext | null;
    const g = engine.mixGraph;
    if (!ctx || !g || analyser) return;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    // meter what reaches the speakers: after the safety ceiling
    (g.safety ?? g.comp).connect(analyser);
  };
  const unlock = async () => {
    await engine.unlock();
    ensureAnalyser();
  };
  const buf = new Float32Array(2048);
  const frame = () => {
    const s = engine.stats();
    status.textContent = `ctx ${s.state} · sfx ${s.sfxVoices}/24 · voices ${s.speechVoices}/6 · loops ${s.loops} (+${s.ambientLoops} amb) · music ${s.musicMood} (${s.musicSections}) · radio duck ${s.radioDuck} · speed ${s.gameSpeed} · dropped ${s.dropped}/${s.musicDropped} · interruptions ${s.interruptions} · errors ${s.errors}`;
    for (const b of moodBtns) b.classList.toggle('on', b.dataset.mood === s.musicMood);
    if (analyser) {
      analyser.getFloatTimeDomainData(buf);
      let p = 0;
      for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]));
      meterBar.style.width = `${Math.min(100, p * 100)}%`;
    }
    requestAnimationFrame(frame);
  };

  // ── header controls ──
  const muteBtn = h('button', { onclick: () => { const on = !muteBtn.classList.contains('on'); muteBtn.classList.toggle('on', on); engine.setMuted(on); } }, 'Mute');
  const duckBtn = h('button', { onclick: () => { const on = !duckBtn.classList.contains('on'); duckBtn.classList.toggle('on', on); engine.setDucked(on); } }, 'Duck');
  const speed = h('select', { onchange: () => engine.setGameSpeed(Number(speed.value)) }, ...['0 pause', '1 normal', '2 fast', '3 faster', '4 ultra'].map((l, i) => h('option', { value: String(i), selected: i === 1 }, l)));
  const volumes = VOLUME_KEYS.map((k) => {
    const r = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(engine.getVolumes()[k]), oninput: () => engine.setVolumes({ [k]: Number(r.value) }) });
    return h('label', {}, k, r);
  });
  const amb = { night: false, indoor: false, rain: false, moon: false };
  const ambBtns = (Object.keys(amb) as (keyof typeof amb)[]).map((k) => {
    const b = h('button', { onclick: () => { amb[k] = !amb[k]; b.classList.toggle('on', amb[k]); engine.setAmbience({ ...amb }); } }, k);
    return b;
  });
  const ambStart = h('button', { onclick: () => engine.setAmbience({ ...amb }) }, 'Ambience on');

  // ── SFX grid ──
  const cats = new Map<string, SfxId[]>();
  for (const id of SFX_IDS) {
    const c = SFX_TABLE[id].cat;
    cats.set(c, [...(cats.get(c) ?? []), id]);
  }
  const loopsOn = new Set<SfxId>();
  const sfxSection = h('section', {}, h('h2', {}, `Sound effects (${SFX_IDS.length})`));
  for (const [cat, ids] of cats) {
    sfxSection.append(h('div', { class: 'group' }, cat));
    const grid = h('div', { class: 'grid' });
    for (const id of ids) {
      const loopBtn: HTMLButtonElement = h('button', {
        title: 'toggle loop',
        onclick: async () => {
          await unlock();
          const on = !loopsOn.has(id);
          if (on) loopsOn.add(id);
          else loopsOn.delete(id);
          loopBtn.classList.toggle('on', on);
          engine.loop(`board:${id}`, id, on, { pan: 0, gain: 1 });
        },
      }, '⟳');
      grid.append(h('span', { class: 'chip' }, h('button', { 'data-sfx': id, onclick: async () => { await unlock(); engine.sfx(id); } }, id), loopBtn));
    }
    sfxSection.append(grid, h('div', { style: 'height:8px' }));
  }

  // ── voices ──
  const seed = h('input', { type: 'number', value: '42', style: 'width:70px' });
  const pitch = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: '0.5' });
  const dur = h('input', { type: 'range', min: '200', max: '4000', step: '50', value: '1200' });
  const pan = h('input', { type: 'range', min: '-1', max: '1', step: '0.05', value: '0' });
  const voiceGrid = h('div', { class: 'grid' }, ...VOICE_EMOTIONS.map((e: VoiceEmotion) =>
    h('button', { 'data-voice': e, onclick: async () => { await unlock(); engine.voice(Number(seed.value), Number(pitch.value), e, Number(dur.value), { pan: Number(pan.value), gain: 1 }); } }, e)));
  const chorus = h('button', {
    onclick: async () => {
      await unlock();
      VOICE_EMOTIONS.slice(0, 6).forEach((e, i) => setTimeout(() => engine.voice(i + 1, i / 6, e, 1400, { pan: -0.8 + i * 0.32, gain: 0.8 }), i * 180));
    },
  }, 'party chatter (6 zombies)');

  // ── music ──
  const moodBtns: HTMLButtonElement[] = [];
  const setMood = async (m: MusicMood | 'none') => {
    await unlock();
    engine.music(m);
    for (const b of moodBtns) b.classList.toggle('on', b.dataset.mood === m);
  };
  for (const m of [...(MOOD_IDS as MusicMood[]), 'none' as const]) moodBtns.push(h('button', { 'data-mood': m, onclick: () => setMood(m) }, m));

  // ── verification ──
  const verifyOut = h('div');
  const runBtn = h('button', {
    class: 'primary',
    onclick: async () => {
      runBtn.disabled = true;
      const prog = h('div', {}, 'rendering…');
      verifyOut.replaceChildren(prog);
      const res = await runVerification({ onProgress: (m) => (prog.textContent = `rendering… ${m}`) });
      verifyOut.replaceChildren(renderReport(res.report), ...Object.entries(res.images).map(([k, src]) => h('img', { class: 'sheet', src, alt: k })));
      runBtn.disabled = false;
    },
  }, 'Run offline verification');

  root.append(
    h('header', {},
      h('h1', {}, 'Afterlife Lease — sound board'),
      h('button', { class: 'primary', id: 'unlock', onclick: unlock }, 'Unlock audio'),
      muteBtn, duckBtn, h('button', { onclick: () => { engine.stopAllLoops(); loopsOn.clear(); document.querySelectorAll('.chip button.on').forEach((b) => b.classList.remove('on')); } }, 'Stop loops'),
      h('label', {}, 'speed', speed), meter, status),
    h('main', {},
      h('section', {}, h('h2', {}, 'Mix'), h('div', { class: 'row' }, ...volumes)),
      h('section', {}, h('h2', {}, 'Ambience'), h('div', { class: 'row' }, ambStart, ...ambBtns)),
      h('section', {}, h('h2', {}, 'Music'), h('div', { class: 'grid' }, ...moodBtns)),
      h('section', {}, h('h2', {}, 'Groanish voices'),
        h('div', { class: 'row' }, h('label', {}, 'seed', seed), h('label', {}, 'voicePitch', pitch), h('label', {}, 'duration', dur), h('label', {}, 'pan', pan), chorus),
        h('div', { style: 'height:8px' }), voiceGrid),
      sfxSection,
      h('section', {}, h('h2', {}, 'Objective verification'), runBtn, verifyOut)),
  );

  requestAnimationFrame(frame);

  const dev: AudioDev = {
    engine,
    unlock,
    verify: (o) => runVerification(o),
    verifyLongMusic: () => runLongMusic(),
    async liveProbe() {
      await unlock();
      ensureAnalyser();
      const a = analyser;
      let peak = 0;
      let sum = 0;
      let n = 0;
      if (a) {
        for (let k = 0; k < 20; k++) {
          await new Promise((r) => setTimeout(r, 50));
          a.getFloatTimeDomainData(buf);
          for (let i = 0; i < buf.length; i++) {
            peak = Math.max(peak, Math.abs(buf[i]));
            sum += buf[i] * buf[i];
            n++;
          }
        }
      }
      return { peak, rms: n ? Math.sqrt(sum / n) : 0, stats: engine.stats() };
    },
  };
  window.__audioDev = dev;
  return dev;
}

function renderReport(r: Report): HTMLElement {
  const rows = r.entries.map((e) =>
    h('tr', { class: e.pass ? '' : 'fail' },
      h('td', {}, `${e.kind}:${e.id}`), h('td', {}, e.cat), h('td', {}, e.stats.peak.toFixed(3)), h('td', {}, e.stats.activeRmsDb.toFixed(1)),
      h('td', {}, e.stats.activeDuration.toFixed(2)), h('td', {}, Math.round(e.stats.spectralCentroid).toString()), h('td', {}, e.stats.dcOffset.toFixed(4)),
      h('td', {}, String(e.stats.clipCount)), h('td', {}, e.pass ? 'ok' : Object.entries(e.checks).filter(([, v]) => !v).map(([k]) => k).join(' '))));
  return h('div', {},
    h('p', {}, `${r.totals.passed}/${r.totals.entries} passed · min spectral distance ${r.minPairDistance} · ${r.warnings.length} warnings`),
    h('table', {}, h('tr', {}, ...['entry', 'cat', 'peak', 'RMS dB', 'active s', 'centroid Hz', 'DC', 'clips', 'result'].map((t) => h('th', {}, t))), ...rows));
}

const root = document.getElementById('app');
if (root) mountBoard(root);
