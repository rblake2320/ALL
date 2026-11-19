import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createFileLogger } from '../../../electron/logger';
import { computePlacement, parseWindowState, readWindowState, writeWindowState, writeWindowStateSync } from '../../../electron/windowState';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afterlife-log-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('rotating logger', () => {
  it('writes one record per line, escaping injected newlines', async () => {
    const log = createFileLogger({ dir, now: () => new Date('2026-11-05T00:00:00.000Z') });
    log.info('hello');
    log.error('evil\n2026-01-01T00:00:00.000Z [INFO] forged record\r\nmore');
    await log.flush();
    const lines = fs.readFileSync(path.join(dir, 'main.log'), 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('2026-11-05T00:00:00.000Z [INFO] hello');
    expect(lines[1]).toMatch(/^2026-11-05T00:00:00.000Z \[ERROR\] evil\\n2026/);
  });

  it('rotates at the size cap and keeps N old files', async () => {
    const log = createFileLogger({ dir, maxBytes: 200, keep: 2 });
    for (let i = 0; i < 40; i++) log.info(`line ${i} ${'x'.repeat(30)}`);
    await log.flush();
    const files = fs.readdirSync(dir).sort();
    expect(files).toEqual(['main.1.log', 'main.2.log', 'main.log']);
    for (const f of files) expect(fs.statSync(path.join(dir, f)).size).toBeLessThanOrEqual(200);
    expect(fs.readFileSync(path.join(dir, 'main.log'), 'utf8')).toContain('line 39');
  });

  it('never throws, even when the disk refuses every write', async () => {
    const log = createFileLogger({
      dir,
      fs: {
        appendFile: async () => {
          throw new Error('EACCES');
        },
        stat: async () => {
          throw new Error('EACCES');
        },
        rename: async () => {
          throw new Error('EACCES');
        },
        unlink: async () => {
          throw new Error('EACCES');
        },
        mkdir: async () => {
          throw new Error('EACCES');
        },
      },
      echo: () => {
        throw new Error('echo broken');
      },
    });
    expect(() => log.error('x')).not.toThrow();
    await expect(log.flush()).resolves.toBeUndefined();
  });
});

describe('window placement', () => {
  const fullHd = { x: 0, y: 0, width: 1920, height: 1040 };
  const laptop = { x: 0, y: 0, width: 1366, height: 728 };
  const second = { x: 1920, y: 0, width: 2560, height: 1400 };

  it('defaults to 1600x900 centred on the primary display', () => {
    expect(computePlacement(parseWindowState(null), [fullHd])).toEqual({ width: 1600, height: 900, x: 160, y: 70, maximized: false, fullscreen: false });
  });

  it('never exceeds a small display and keeps the minimum when possible', () => {
    const p = computePlacement(parseWindowState(null), [laptop]);
    expect(p.width).toBe(1366);
    expect(p.height).toBe(728);
    const tiny = computePlacement(parseWindowState(null), [{ x: 0, y: 0, width: 1024, height: 600 }]);
    expect(tiny.width).toBe(1024);
    expect(tiny.height).toBe(600);
  });

  it('restores a saved placement on a secondary display', () => {
    const st = parseWindowState(JSON.stringify({ bounds: { x: 2000, y: 100, width: 1700, height: 1000 }, maximized: true, fullscreen: false }));
    expect(computePlacement(st, [fullHd, second])).toEqual({ x: 2000, y: 100, width: 1700, height: 1000, maximized: true, fullscreen: false });
  });

  it('recovers a window saved on a monitor that is now unplugged', () => {
    const st = parseWindowState(JSON.stringify({ bounds: { x: 3000, y: 200, width: 1600, height: 900 } }));
    const p = computePlacement(st, [fullHd]);
    expect(p.x).toBe(160);
    expect(p.y).toBe(70);
  });

  it('pulls a mostly-visible window fully onto the screen', () => {
    const st = parseWindowState(JSON.stringify({ bounds: { x: 900, y: -50, width: 1600, height: 900 } }));
    const p = computePlacement(st, [fullHd]);
    expect((p.x ?? 0) + p.width).toBeLessThanOrEqual(1920);
    expect(p.y).toBe(0);
  });

  it('garbage state files are ignored', () => {
    for (const t of ['', '{', 'null', '[]', '{"bounds":{"x":"a"}}', '{"bounds":{"x":1,"y":2,"width":NaN}}']) {
      expect(parseWindowState(t).bounds).toBeNull();
    }
  });

  it('state persists atomically (async and sync writers) and reads back', async () => {
    const file = path.join(dir, 'window-state.json');
    await writeWindowState(file, { bounds: { x: 1, y: 2, width: 1300, height: 800 }, maximized: false, fullscreen: true });
    expect(await readWindowState(file)).toEqual({ bounds: { x: 1, y: 2, width: 1300, height: 800 }, maximized: false, fullscreen: true });
    writeWindowStateSync(file, { bounds: null, maximized: true, fullscreen: false });
    expect(await readWindowState(file)).toEqual({ bounds: null, maximized: true, fullscreen: false });
    expect(fs.readdirSync(dir)).toEqual(['window-state.json']);
    expect(await readWindowState(path.join(dir, 'missing.json'))).toEqual({ bounds: null, maximized: false, fullscreen: false });
  });
});

describe('window state — crash leftovers', () => {
  it('reading the state removes temp files of an interrupted write (and nothing else)', async () => {
    const file = path.join(dir, 'window-state.json');
    fs.writeFileSync(file, JSON.stringify({ bounds: { x: 1, y: 2, width: 1300, height: 800 }, maximized: false, fullscreen: false }));
    fs.writeFileSync(`${file}.tmp-123-1730000000000`, '{"half');
    fs.writeFileSync(`${file}.tmp-notours`, 'keep');
    fs.writeFileSync(path.join(dir, 'other.json.tmp-1-2'), 'keep');
    const s = await readWindowState(file);
    expect(s.bounds).toEqual({ x: 1, y: 2, width: 1300, height: 800 });
    expect(fs.readdirSync(dir).sort()).toEqual(['other.json.tmp-1-2', 'window-state.json', 'window-state.json.tmp-notours']);
  });
});

describe('renderer log budget', () => {
  it('caps lines per window, then reports how many were suppressed when the next window opens', async () => {
    const { createLogBudget } = await import('../../../electron/logger');
    const b = createLogBudget(3, 1000);
    expect([0, 1, 2, 3, 4].map((t) => b.take(t))).toEqual(['ok', 'ok', 'ok', 'drop', 'drop']);
    expect(b.take(1000)).toBe('resume');
    expect(b.suppressedSinceLast()).toBe(2);
    expect([b.take(1001), b.take(1002), b.take(1003)]).toEqual(['ok', 'ok', 'drop']); // 'resume' used one slot
    expect(b.take(5000)).toBe('resume');
    expect(b.take(9000)).toBe('ok'); // nothing dropped in the previous window
  });
});
