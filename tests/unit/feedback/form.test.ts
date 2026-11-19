/** W-110 §5.1: form validation — length caps, the text filter, under-13 preset-only (fails closed). */
import { describe, expect, it } from 'vitest';
import { areaFor, defaultForm, filterText, reportBracket, rulesFor, togglePreset, validateForm, type FeedbackForm } from '../../../src/feedback/form';
import { PRESET_IDS, TEXT_MAX } from '../../../src/feedback/schema';

const form = (over: Partial<FeedbackForm> = {}): FeedbackForm => ({ ...defaultForm('live', false), ...over });

describe('age bracket fails closed', () => {
  it('only an answered 13+ bracket unlocks free text and save attachment', () => {
    expect(reportBracket('teen')).toBe('13plus');
    expect(reportBracket('adult')).toBe('13plus');
    for (const junk of ['under13', 'unknown', undefined, null, '', 'ADULT', 'adult ', 13, {}, ['adult'], Symbol.for('adult')]) expect(reportBracket(junk), String(junk?.toString?.())).toBe('under13');
    expect(rulesFor('under13')).toEqual({ freeText: false, attachSave: false });
    expect(rulesFor('13plus')).toEqual({ freeText: true, attachSave: true });
  });
});

describe('validateForm', () => {
  it('under-13: presets only — any text or save is refused', () => {
    expect(validateForm(form({ presets: ['stuck'] }), 'under13')).toEqual([]);
    expect(validateForm(form({ presets: ['stuck'], text: 'my name is Sam' }), 'under13')).toContain('presetsOnly');
    expect(validateForm(form({ presets: ['stuck'], attachSave: true }), 'under13')).toContain('saveNotAllowed');
    expect(validateForm(form({ text: 'hello' }), 'under13')).toEqual(expect.arrayContaining(['presetsOnly', 'empty']));
    expect(validateForm(form(), 'under13')).toContain('empty');
  });
  it('13+: text alone, presets alone or both; length cap counts code points', () => {
    expect(validateForm(form({ text: 'It froze.' }), '13plus')).toEqual([]);
    expect(validateForm(form({ presets: ['loveIt'] }), '13plus')).toEqual([]);
    expect(validateForm(form({ text: '   \n  ' }), '13plus')).toContain('empty');
    expect(validateForm(form({ text: 'a'.repeat(TEXT_MAX) }), '13plus')).toEqual([]);
    expect(validateForm(form({ text: 'a'.repeat(TEXT_MAX + 1) }), '13plus')).toContain('tooLong');
    expect(validateForm(form({ text: '🧟'.repeat(TEXT_MAX) }), '13plus')).toEqual([]); // 2 UTF-16 units each, 2000 chars
    expect(validateForm(form({ text: 'x', attachSave: true }), '13plus')).toEqual([]);
  });
  it('junk presets / type / area are refused', () => {
    expect(validateForm(form({ presets: ['nope' as never] }), '13plus')).toContain('badPreset');
    expect(validateForm(form({ text: 'x', type: 'safety' as never }), '13plus')).toContain('badType');
    expect(validateForm(form({ text: 'x', area: 'kitchen' as never }), '13plus')).toContain('badArea');
  });
});

describe('text filter', () => {
  it('caps, strips control/bidi characters and personal data', () => {
    const t = filterText(`Hi I'm Mortimer Grimsby, mail me at mort.g+1@example.co.uk or call +1 (555) 123-4567.\u202e\u0007 See C:\\Users\\Mortimer\\Desktop\\bug.png and https://u:p@host.example/x?token=abc#frag`, ['Mortimer', 'Grimsby']);
    expect(t).not.toMatch(/Mortimer|Grimsby|example\.co|555|token|u:p@|\u202e|\u0007/);
    expect(t).toContain('[email]');
    expect(t).toContain('[number]');
    expect(t).toContain('[name]');
    expect(t).toContain('C:\\Users\\[user]');
    expect(t).toContain('https://host.example/x');
    expect(Array.from(filterText('b'.repeat(5000), [])).length).toBe(TEXT_MAX);
  });
  // Folder names may contain spaces ("C:\Users\Jane Doe"): the scrubbers used to stop at the first one and leave "Doe".
  it('removes a Windows account folder that contains a space', () => {
    expect(filterText('see C:\\Users\\Jane Doe\\Desktop\\bug.png', [])).toBe('see C:\\Users\\[user]\\Desktop\\bug.png');
    // Node's own error text (quoted paths, both ends of a rename), as it reaches the error ring
    const e = filterText("replacing x.dat: ENOENT: no such file or directory, rename 'C:\\Users\\Jane Doe\\AppData\\Roaming\\Afterlife Lease\\saves\\x.tmp' -> 'C:\\Users\\Jane Doe\\AppData\\Roaming\\Afterlife Lease\\saves\\x.dat'", []);
    expect(e).not.toMatch(/Jane|Doe/);
    expect(e).toContain("-> 'C:\\Users\\[user]\\AppData\\Roaming\\Afterlife Lease\\saves\\x.dat'");
    // the path stops at the account folder: quoted, the name ends at the quote; unquoted, the rest of the line goes (fails closed)
    expect(filterText("scandir 'C:\\Users\\Jane Doe' failed", [])).toBe("scandir 'C:\\Users\\[user]' failed");
    expect(filterText('it is in C:\\Documents and Settings\\Jane van Doe\nnext line', [])).toBe('it is in C:\\Documents and Settings\\[user]\nnext line');
  });
  it('removes a macOS / Linux account folder that contains a space', () => {
    expect(filterText('see /Users/Jane Doe/Library/Application Support/Afterlife Lease/saves/x.dat', [])).toBe('see /Users/[user]/Library/Application Support/Afterlife Lease/saves/x.dat');
    expect(filterText("open '/home/Jane Doe/.config/Afterlife Lease/main.log'", [])).toBe("open '/home/[user]/.config/Afterlife Lease/main.log'");
    expect(filterText("scandir '/Users/Jane Doe' failed", [])).toBe("scandir '/Users/[user]' failed");
  });
  it('removes file:// URLs and network shares whose path contains a space', () => {
    expect(filterText('Error: boom\n    at file:///C:/Users/Jane Doe/game/index.js:1:2\n    at next', [])).toBe('Error: boom\n    at file://[path]\n    at next');
    expect(filterText('saved on \\\\nas\\home\\Jane Doe\\saves\\x.dat', [])).toBe('saved on [path]');
  });
  // pii.ts header: "any remaining absolute local path is cut down to its last segment" (folder names identify people too)
  it('cuts any other absolute local path down to its last segment', () => {
    expect(filterText('could not write D:\\Jane Doe\\Games\\Afterlife Lease\\saves\\x.dat today', [])).toBe('could not write x.dat today');
    expect(filterText("open '/Volumes/Jane Doe SSD/Afterlife Lease/saves/x.dat' failed", [])).toBe("open 'x.dat' failed");
    expect(filterText('at boot (/opt/janes-games/afterlife/main.js:10:5)', [])).toBe('at boot (main.js:10:5)');
    expect(filterText('the folder is E:\\Jane\\', [])).toBe('the folder is [path]');
    // the account rule already dealt with these: the rest of the path stays readable
    expect(filterText('C:\\Users\\Jane Doe\\Desktop\\bug.png and /home/jane/.config/Afterlife Lease/main.log', [])).toBe('C:\\Users\\[user]\\Desktop\\bug.png and /home/[user]/.config/Afterlife Lease/main.log');
    // not local paths: links, relative paths, slashes in prose
    const prose = 'https://host.example/a/b and ./assets/a/b.glb or ~/saves/x.dat, 1/2 and/or w/ it at 60 km/h';
    expect(filterText(prose, [])).toBe(prose);
  });
});

describe('chips and area', () => {
  it('togglePreset keeps order and caps at 4', () => {
    let l = togglePreset([], 'stuck');
    l = togglePreset(l, 'lookedWrong');
    expect(l).toEqual(['stuck', 'lookedWrong']);
    expect(togglePreset(l, 'stuck')).toEqual(['lookedWrong']);
    let full = [...PRESET_IDS].slice(0, 4);
    full = togglePreset(full, PRESET_IDS[5]);
    expect(full).toHaveLength(4);
  });
  it('areaFor maps screen/mode/dialog', () => {
    expect(areaFor('game', 'buy', null)).toBe('buy');
    expect(areaFor('game', 'build', 'pause')).toBe('build');
    expect(areaFor('game', 'live', null)).toBe('live');
    expect(areaFor('game', 'live', 'store')).toBe('store');
    expect(areaFor('caz', 'live', null)).toBe('caz');
    expect(areaFor('menu', 'live', 'settings')).toBe('menu');
    expect(defaultForm('buy', true).presets).toEqual(['stuck']);
    expect(defaultForm('buy', false)).toMatchObject({ type: 'bug', includeScreenshot: true, attachSave: false });
  });
});
