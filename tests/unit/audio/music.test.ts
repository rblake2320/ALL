import { describe, expect, it } from 'vitest';
import { MOODS, MOOD_IDS } from '../../../src/audio/music/moods';
import { clearComposerCache, composeSection, formLength, generateBar, locateBar, parseBars } from '../../../src/audio/music/composer';
import { chordPcs, chordScale, parseRoman, pc, scaleStep, voiceLead, SCALES, CHORD_INTERVALS } from '../../../src/audio/music/theory';
import { UNPITCHED } from '../../../src/audio/music/types';
import type { MusicMood } from '../../../src/shared/audioIds';

const ALL_MOODS: MusicMood[] = ['menu', 'live', 'night', 'build', 'tense', 'party', 'sad', 'romance', 'caz'];

describe('music theory', () => {
  it('parses roman numerals relative to key and mode', () => {
    // D minor
    expect(parseRoman('i', 2, 'minor')).toMatchObject({ root: 2, quality: 'min' });
    expect(parseRoman('V', 2, 'minor')).toMatchObject({ root: 9, quality: 'maj' });
    expect(parseRoman('VI', 2, 'minor')).toMatchObject({ root: 10, quality: 'maj' });
    expect(parseRoman('iiø7', 2, 'minor')).toMatchObject({ root: 4, quality: 'hdim7' });
    // G minor jazz
    expect(parseRoman('VII7', 7, 'minor')).toMatchObject({ root: 5, quality: 'dom7' });
    expect(parseRoman('IIImaj7', 7, 'minor')).toMatchObject({ root: 10, quality: 'maj7' });
    expect(parseRoman('V7b9', 7, 'minor')).toMatchObject({ root: 2, quality: 'dom7b9' });
    // C minor phrygian II
    expect(parseRoman('bII', 0, 'minor')).toMatchObject({ root: 1, quality: 'maj' });
    // Eb major
    expect(parseRoman('vi7', 3, 'major')).toMatchObject({ root: 0, quality: 'min7' });
    expect(() => parseRoman('X', 0, 'major')).toThrow();
    expect(() => parseRoman('Iwat', 0, 'major')).toThrow();
  });

  it('chordScale substitutes chord tones (harmonic minor over V)', () => {
    const A = parseRoman('V', 2, 'minor'); // A major in D minor
    const s = chordScale(A, 2, SCALES.minor);
    expect(s).toContain(1); // C#
    expect(s).not.toContain(0); // C removed
    expect(s).toContain(2); // tonic kept
    const bII = parseRoman('bII', 0, 'minor');
    const s2 = chordScale(bII, 0, SCALES.minor);
    expect(s2).toContain(1);
    expect(s2).toContain(0);
    expect(s2).not.toContain(2);
  });

  it('scaleStep walks the scale', () => {
    const cMaj = [0, 2, 4, 5, 7, 9, 11];
    expect(scaleStep(60, 1, cMaj)).toBe(62);
    expect(scaleStep(60, 2, cMaj)).toBe(64);
    expect(scaleStep(60, -1, cMaj)).toBe(59);
    expect(scaleStep(61, 0, cMaj)).toBe(60); // snaps
    expect(scaleStep(64, 1, cMaj)).toBe(65);
  });

  it('voiceLead keeps voices close, ascending, in range and covers guide tones', () => {
    const key = 7;
    const prog = ['iv7', 'VII7', 'IIImaj7', 'VImaj7', 'iiø7', 'V7', 'i7'].map((r) => parseRoman(r, key, 'minor'));
    let v: number[] | null = null;
    for (const ch of prog) {
      const next = voiceLead(v, ch, 3, 58, 74, { rootless: true });
      expect(next.length).toBe(3);
      for (let i = 1; i < next.length; i++) expect(next[i]).toBeGreaterThan(next[i - 1]);
      for (const m of next) {
        expect(m).toBeGreaterThanOrEqual(58);
        expect(m).toBeLessThanOrEqual(74);
        expect(chordPcs(ch)).toContain(pc(m));
      }
      const pcs = next.map(pc);
      const iv = CHORD_INTERVALS[ch.quality];
      const third = (ch.root + (iv.includes(3) ? 3 : 4)) % 12;
      expect(pcs).toContain(third);
      if (v) {
        let moved = 0;
        for (let i = 0; i < 3; i++) moved += Math.abs(next[i] - v[i]);
        expect(moved).toBeLessThanOrEqual(12);
      }
      v = next;
    }
  });
});

describe('music composer', () => {
  it('defines all nine moods with 8/16-bar phrase structure', () => {
    expect(MOOD_IDS.sort()).toEqual([...ALL_MOODS].sort());
    for (const id of ALL_MOODS) {
      const m = MOODS[id];
      for (const sec of m.form) expect(sec.bars.length === 8 || sec.bars.length === 16).toBe(true);
      expect([16, 32]).toContain(formLength(m));
      expect(m.bpm).toBeGreaterThan(50);
      expect(m.bpm).toBeLessThan(140);
    }
    expect(MOODS.menu.beatsPerBar).toBe(3);
    expect(MOODS.romance.beatsPerBar).toBe(3);
    expect(MOODS.live.bpm).toBe(96);
    expect(MOODS.party.bpm).toBe(124);
    expect(MOODS.menu.tonic).toBe(2); // D minor
    expect(MOODS.menu.mode).toBe('minor');
    expect(MOODS.live.swing).toBeGreaterThan(0.55);
  });

  it('every chord tone of every progression is inside the mood key', () => {
    for (const id of ALL_MOODS) {
      const m = MOODS[id];
      m.form.forEach((_s, fi) => {
        for (const bar of parseBars(m, fi)) for (const bc of bar) for (const p of chordPcs(bc.chord)) expect(m.allowedPcs).toContain(p);
      });
    }
  });

  it('is deterministic per mood (cold cache vs warm cache vs re-generation)', () => {
    for (const id of ALL_MOODS) {
      clearComposerCache();
      const a = Array.from({ length: 40 }, (_, i) => JSON.stringify(generateBar(id, i)));
      clearComposerCache();
      const b = Array.from({ length: 40 }, (_, i) => JSON.stringify(generateBar(id, 39 - i))).reverse();
      expect(a).toEqual(b);
    }
  });

  it('all pitched notes are in key; bars have correct lengths and sane events', () => {
    for (const id of ALL_MOODS) {
      const m = MOODS[id];
      const bars = formLength(m) * 3;
      for (let i = 0; i < bars; i++) {
        const plan = generateBar(id, i);
        expect(plan.index).toBe(i);
        expect(plan.beats).toBe(m.beatsPerBar);
        expect(plan.events.length).toBeGreaterThan(0);
        for (const ev of plan.events) {
          expect(ev.beat).toBeGreaterThanOrEqual(0);
          expect(ev.beat).toBeLessThan(m.beatsPerBar);
          expect(ev.dur).toBeGreaterThan(0);
          expect(ev.beat + ev.dur).toBeLessThanOrEqual(m.beatsPerBar + 1e-9);
          expect(ev.vel).toBeGreaterThan(0);
          expect(ev.vel).toBeLessThanOrEqual(1);
          expect(Number.isFinite(ev.midi)).toBe(true);
          if (!UNPITCHED.has(ev.inst)) {
            expect(m.allowedPcs, `${id} bar ${i} ${ev.inst} midi ${ev.midi}`).toContain(pc(ev.midi));
            expect(ev.midi).toBeGreaterThanOrEqual(24);
            expect(ev.midi).toBeLessThanOrEqual(100);
          }
        }
        // events are time-ordered for the sequencer
        for (let k = 1; k < plan.events.length; k++) expect(plan.events[k].beat).toBeGreaterThanOrEqual(plan.events[k - 1].beat);
      }
    }
  });

  it('melodies cadence on the tonic chord root at the end of the form', () => {
    for (const id of ALL_MOODS) {
      if (id === 'tense') continue; // underscore cue: celesta plays dissonant stings, not a melody
      const m = MOODS[id];
      const lastBar = generateBar(id, formLength(m) - 1);
      const leads = lastBar.events.filter((e) => ['musicBox', 'celesta', 'marimba', 'xylo', 'theremin'].includes(e.inst));
      if (leads.length === 0) continue;
      const finalLead = leads[leads.length - 1];
      expect(pc(finalLead.midi)).toBe(lastBar.chords[lastBar.chords.length - 1].chord.root);
    }
  });

  it('varies between loops of the form but keeps the harmony', () => {
    for (const id of ALL_MOODS) {
      const m = MOODS[id];
      const L = formLength(m);
      let differs = 0;
      for (let i = 0; i < L; i++) {
        const a = generateBar(id, i);
        const b = generateBar(id, i + L);
        expect(b.chords.map((c) => c.chord.symbol)).toEqual(a.chords.map((c) => c.chord.symbol));
        if (JSON.stringify(a.events) !== JSON.stringify(b.events)) differs++;
      }
      expect(differs).toBeGreaterThan(L / 2);
    }
  });

  it('live mood has a walking bass (4 notes/bar) and swung ride; party has four-on-the-floor kick', () => {
    for (let i = 0; i < 16; i++) {
      const bar = generateBar('live', i);
      expect(bar.events.filter((e) => e.inst === 'bass').length).toBe(4);
      expect(bar.events.some((e) => e.inst === 'ride' && e.beat % 1 === 0.5)).toBe(true);
      const p = generateBar('party', i);
      expect(p.events.filter((e) => e.inst === 'kick').map((e) => e.beat)).toEqual([0, 1, 2, 3]);
    }
  });

  it('locateBar maps bars to sections and tolerates junk', () => {
    const m = MOODS.live;
    expect(locateBar(m, 0)).toEqual({ sectionIndex: 0, barInSection: 0 });
    expect(locateBar(m, 9)).toEqual({ sectionIndex: 1, barInSection: 1 });
    expect(locateBar(m, 32)).toEqual({ sectionIndex: 4, barInSection: 0 });
    expect(locateBar(m, -5)).toEqual({ sectionIndex: 0, barInSection: 0 });
    expect(locateBar(m, NaN)).toEqual({ sectionIndex: 0, barInSection: 0 });
    expect(composeSection('menu', NaN).length).toBe(8);
    expect(generateBar('night', 1e7).events.length).toBeGreaterThan(0);
  });
});
