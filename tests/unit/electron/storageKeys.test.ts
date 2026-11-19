import { describe, expect, it } from 'vitest';
import { fileNameToKey, isReservedDeviceName, keyToFileName, TMP_RE, validateKey, validatePrefix } from '../../../electron/storageKeys';

describe('storage key validation', () => {
  it('accepts the keys the game uses', () => {
    for (const k of ['slot:autosave:primary', 'slot:my-slot_1:backup', 'slot:x:meta', 'profile:settings', 'profile:tutorialStage', 'profile:settings:bak']) {
      expect(validateKey(k)).toEqual({ ok: true, key: k });
    }
  });

  const bad: [string, unknown][] = [
    ['empty', ''],
    ['non-string', 42],
    ['null', null],
    ['too long', 'a'.repeat(121)],
    ['parent traversal', '../evil'],
    ['nested traversal', 'slot:..:primary'],
    ['slash', 'slot/x'],
    ['backslash', 'slot\\x'],
    ['drive letter', 'C:\\Windows\\win.ini'],
    ['absolute posix', '/etc/passwd'],
    ['NUL byte', 'slot\u0000x'],
    ['dot', 'slot.x'],
    ['space', 'slot x'],
    ['trailing colon', 'slot:'],
    ['leading colon', ':slot'],
    ['empty segment', 'slot::x'],
    ['unicode', 'slöt'],
    ['ADS stream', 'file:$DATA'],
    ['CON', 'con'],
    ['CON segment', 'slot:CON:primary'],
    ['nul segment', 'profile:nul'],
    ['COM1', 'COM1'],
    ['lpt9', 'x:lpt9'],
    ['COM superscript', 'com\u00b9'],
    ['AUX upper', 'AUX:x'],
    ['PRN', 'prn'],
    ['too long once encoded', 'A'.repeat(101)],
  ];
  for (const [name, k] of bad) {
    it(`rejects ${name}`, () => {
      const r = validateKey(k);
      expect(r.ok).toBe(false);
      expect(() => keyToFileName(k as string)).toThrow(/\[invalid\]/);
    });
  }

  it('device-name detection is exact (CONSOLE, com10, null are fine)', () => {
    expect(isReservedDeviceName('CONSOLE')).toBe(false);
    expect(isReservedDeviceName('com10')).toBe(false);
    expect(isReservedDeviceName('null')).toBe(false);
    expect(isReservedDeviceName('Com0')).toBe(true);
    expect(validateKey('slot:console:primary').ok).toBe(true);
  });

  it('prefixes allow trailing colons but nothing dangerous', () => {
    expect(validatePrefix('slot:').ok).toBe(true);
    expect(validatePrefix('').ok).toBe(true);
    for (const p of ['../', 'a/b', 'x\\', 5, 'a b']) expect(validatePrefix(p).ok).toBe(false);
  });
});

describe('key <-> file name encoding', () => {
  it('is readable, lossless and lowercase-only', () => {
    expect(keyToFileName('slot:autosave:primary')).toBe('slot.autosave.primary.dat');
    expect(keyToFileName('profile:tutorialStage')).toBe('profile.tutorial~stage.dat');
    for (const k of ['slot:a:primary', 'profile:ABCdef', 'x_y-z:Q', 'A']) {
      const f = keyToFileName(k);
      expect(f).toBe(f.toLowerCase());
      expect(fileNameToKey(f)).toBe(k);
    }
  });

  it('keys differing only by case never collide on case-insensitive file systems', () => {
    const a = keyToFileName('profile:Settings');
    const b = keyToFileName('profile:settings');
    expect(a.toLowerCase()).not.toBe(b.toLowerCase());
  });

  it('round-trips random valid keys (fuzz)', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const chars = 'abcXYZ019_-';
    for (let i = 0; i < 2000; i++) {
      const segs = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () =>
        Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => chars[Math.floor(rnd() * chars.length)]).join(''),
      );
      const k = segs.join(':');
      if (!validateKey(k).ok) continue;
      expect(fileNameToKey(keyToFileName(k))).toBe(k);
    }
  });

  it('foreign files, temp files and non-canonical names are ignored', () => {
    for (const n of [
      'desktop.ini',
      'Thumbs.db',
      'slot.a.primary.dat.tmp-123-4',
      'slot.a.primary.txt',
      'SLOT.A.PRIMARY.DAT',
      'slot.A.primary.dat', // uppercase must be ~-escaped
      'slot..primary.dat',
      'slot.~1.dat',
      'slot.~.dat',
      '.dat',
      'con.dat',
      'slot.con.primary.dat',
    ]) {
      expect(fileNameToKey(n), n).toBeNull();
    }
    expect(TMP_RE.test('slot.a.primary.dat.tmp-123-4')).toBe(true);
    expect(TMP_RE.test('slot.a.primary.dat')).toBe(false);
  });
});
