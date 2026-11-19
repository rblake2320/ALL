#!/usr/bin/env node
/**
 * AUDIO verification runner (Playwright + Chromium).
 *   node dev/audio.verify.mjs            # starts Vite on :5179 if needed
 *   node dev/audio.verify.mjs --keep     # leave the dev server running
 *   node dev/audio.verify.mjs --long     # also render every music cue's full form (peak/loudness/budget)
 * Writes dev/out/audio/{report.json, board.png, spectrogram-*.png (sfx, loops, voice, music, scenes)} and exits
 * non-zero on failures.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dev', 'out', 'audio');
const PORT = 5179;
const URL = `http://localhost:${PORT}/dev/audio.html`;
const keep = process.argv.includes('--keep');
const long = process.argv.includes('--long');

async function up() {
  try {
    const r = await fetch(URL);
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await up()) return null;
  const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: false });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await up()) return proc;
  }
  proc.kill();
  throw new Error('vite did not start on ' + PORT);
}

function savePng(name, dataUrl) {
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  writeFileSync(join(OUT, name), Buffer.from(b64, 'base64'));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = await ensureServer();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pageErrors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
    await page.goto(URL);
    await page.waitForFunction(() => !!window.__audioDev, null, { timeout: 30000 });

    // ── live realtime check with a real user gesture ──
    await page.click('#unlock');
    await page.click('[data-mood="live"]');
    await page.click('[data-sfx="cash"]');
    await page.click('[data-voice="happy"]');
    await page.waitForTimeout(600);
    const live = await page.evaluate(async () => {
      const d = window.__audioDev;
      d.engine.setAmbience({ night: true, indoor: false, rain: true, moon: true });
      for (const id of ['doorbell', 'limbDrop', 'promotion', 'footstep', 'uiClick']) d.engine.sfx(id, { spatial: { pan: 0.3, gain: 0.9 } });
      for (let i = 0; i < 8; i++) d.engine.voice(i, i / 8, 'neutral', 1500);
      d.engine.loop('dev:shower', 'shower', true, { pan: -0.4, gain: 0.8 });
      d.engine.loop('dev:tv', 'tvChatter', true, { pan: 0.4, gain: 0.7 });
      for (let i = 0; i < 60; i++) d.engine.sfx('gymClank');
      const probe = await d.liveProbe();
      d.engine.setDucked(true);
      d.engine.music('party');
      d.engine.loop('dev:stereo', 'stereoMusic', true, { pan: 0.2, gain: 0.95 });
      await new Promise((r) => setTimeout(r, 2500));
      const probe2 = await d.liveProbe();
      // mute -> suspended -> unmute must bring the scheduler back (regression: unlock-while-muted)
      d.engine.setMuted(true);
      await new Promise((r) => setTimeout(r, 400));
      const mutedState = d.engine.stats().state;
      d.engine.setMuted(false);
      await new Promise((r) => setTimeout(r, 600));
      const probe3 = await d.liveProbe();
      probe3.mutedState = mutedState;
      d.engine.stopAllLoops();
      d.engine.music('none');
      d.engine.setAmbience({ night: false, indoor: true, rain: false });
      return { probe, probe2, probe3 };
    });
    await page.screenshot({ path: join(OUT, 'board.png'), fullPage: false });

    // ── offline objective verification ──
    const t0 = Date.now();
    const res = await page.evaluate(async () => window.__audioDev.verify({ musicSeconds: 8, loopSeconds: 4 }));
    const elapsed = (Date.now() - t0) / 1000;
    for (const [name, url] of Object.entries(res.images)) savePng(name, url);
    let musicLong = null;
    if (long) {
      musicLong = await page.evaluate(async () => window.__audioDev.verifyLongMusic());
      for (const m of musicLong) console.log(`long ${m.mood.padEnd(8)} ${m.seconds}s peak ${m.peak} rms ${m.rmsDb} dB loudest2s ${m.maxWindowDb} dB notes ${m.notes} dropped ${m.droppedNotes} ${m.pass ? 'ok' : 'FAIL'}`);
      for (const m of musicLong) if (!m.pass) res.report.failures.push(`musicLong:${m.mood} peak ${m.peak} clips ${m.clipCount}`);
    }
    const report = { ...res.report, musicLong, live, pageErrors, verifySeconds: elapsed };
    writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));

    const r = res.report;
    console.log(`entries ${r.totals.entries}  passed ${r.totals.passed}  failed ${r.totals.failed}  (${elapsed.toFixed(1)} s)`);
    console.log(`live probe: peak ${live.probe.peak.toFixed(3)} rms ${live.probe.rms.toFixed(4)} | after duck+party: peak ${live.probe2.peak.toFixed(3)}  stats ${JSON.stringify(live.probe.stats)}`);
    console.log(`after mute/unmute: state while muted ${live.probe3.mutedState}, peak ${live.probe3.peak.toFixed(3)} radioDuck ${live.probe3.stats.radioDuck} timer ok ${live.probe3.peak > 0.001}`);
    console.log(`min spectral distance ${r.minPairDistance}; most similar: ${r.similarPairs.slice(0, 5).map((p) => `${p.a}~${p.b} ${p.similarity}`).join(', ')}`);
    for (const e of r.entries.filter((x) => x.stats.modulationHz !== undefined)) {
      if (['wind', 'bed:dayWind', 'bed:rain', 'bed:moon', 'shower', 'fireLoop', 'cook', 'sinkWater'].includes(e.id)) console.log(`  bed ${e.id.padEnd(12)} envelope slow/fast std ${e.stats.slowStd}/${e.stats.fastStd}  active RMS ${e.stats.activeRmsDb} dB`);
    }
    for (const sc of r.scenes) {
      const b = Object.entries(sc.buses).map(([k, v]) => `${k} ${v.rmsDb}/${v.maxWindowDb}`).join('  ');
      console.log(`scene ${sc.id.padEnd(10)} peak ${sc.peak.toFixed(3)} mix ${sc.mix.rmsDb} dB (st-max ${sc.mix.maxWindowDb})  x${sc.realtimeFactor} realtime  ${sc.pass ? 'ok' : 'FAIL'}${b ? '\n    buses rms/st-max dB: ' + b : ''}  musicDropped ${sc.stats.musicDropped} radioDuck ${sc.stats.radioDuck}`);
    }
    if (r.failures.length) console.log('FAILURES:\n  ' + r.failures.join('\n  '));
    if (r.warnings.length) console.log('warnings:\n  ' + r.warnings.join('\n  '));
    if (pageErrors.length) console.log('page errors:\n  ' + pageErrors.join('\n  '));
    const liveOk = live.probe.peak > 0.001 && live.probe.peak <= 1.0 && live.probe.stats.errors === 0 && live.probe.stats.sfxVoices <= 24 && live.probe.stats.speechVoices <= 6
      && live.probe3.peak > 0.001 && live.probe3.stats.errors === 0 && live.probe3.stats.state === 'running';
    if (!liveOk) console.log('LIVE CHECK FAILED');
    process.exitCode = r.failures.length || pageErrors.length || !liveOk ? 1 : 0;
  } finally {
    await browser.close();
    if (server && !keep) server.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
