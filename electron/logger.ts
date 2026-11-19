/**
 * Size-capped rotating log for the main process (userData/logs/main.log, main.1.log ... main.N.log).
 * PURE Node. A logger must never take the app down: every failure is swallowed, writes are queued so
 * lines never interleave, and rotation happens before a write would exceed the cap.
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  log(level: LogLevel, msg: string): void;
  /** Resolves when everything queued so far is on disk. */
  flush(): Promise<void>;
  readonly file: string;
}

export interface LoggerFs {
  appendFile(p: string, data: string): Promise<void>;
  stat(p: string): Promise<{ size: number }>;
  rename(a: string, b: string): Promise<void>;
  unlink(p: string): Promise<void>;
  mkdir(p: string): Promise<void>;
}

const nodeLoggerFs: LoggerFs = {
  appendFile: (p, d) => fsp.appendFile(p, d, 'utf8'),
  stat: (p) => fsp.stat(p),
  rename: (a, b) => fsp.rename(a, b),
  unlink: (p) => fsp.unlink(p),
  mkdir: async (p) => {
    await fsp.mkdir(p, { recursive: true });
  },
};

export interface LoggerOptions {
  dir: string;
  fileName?: string;
  maxBytes?: number;
  keep?: number;
  fs?: LoggerFs;
  now?: () => Date;
  echo?: (line: string) => void;
}

export function createFileLogger(opts: LoggerOptions): Logger {
  const fs = opts.fs ?? nodeLoggerFs;
  const fileName = opts.fileName ?? 'main.log';
  const file = path.join(opts.dir, fileName);
  const maxBytes = opts.maxBytes ?? 1_000_000;
  const keep = Math.max(1, opts.keep ?? 3);
  const now = opts.now ?? (() => new Date());
  const stem = fileName.replace(/\.log$/, '');
  let size: number | null = null;
  let tail: Promise<void> = Promise.resolve();
  let dirReady = false;

  const rotate = async () => {
    try {
      await fs.unlink(path.join(opts.dir, `${stem}.${keep}.log`));
    } catch {
      // may not exist
    }
    for (let i = keep - 1; i >= 1; i--) {
      try {
        await fs.rename(path.join(opts.dir, `${stem}.${i}.log`), path.join(opts.dir, `${stem}.${i + 1}.log`));
      } catch {
        // gap in the sequence
      }
    }
    try {
      await fs.rename(file, path.join(opts.dir, `${stem}.1.log`));
    } catch {
      // nothing to rotate
    }
    size = 0;
  };

  const write = (line: string) => {
    tail = tail.then(async () => {
      try {
        if (!dirReady) {
          await fs.mkdir(opts.dir);
          dirReady = true;
        }
        if (size === null) {
          try {
            size = (await fs.stat(file)).size;
          } catch {
            size = 0;
          }
        }
        const bytes = Buffer.byteLength(line, 'utf8');
        if (size + bytes > maxBytes && size > 0) await rotate();
        await fs.appendFile(file, line);
        size += bytes;
      } catch {
        // Logging is best effort.
      }
    });
  };

  const log = (level: LogLevel, msg: string) => {
    // One record per line: CR/LF in messages are escaped so a hostile renderer cannot forge records.
    const clean = String(msg).replace(/\r?\n|\r/g, '\\n').slice(0, 4000);
    const line = `${now().toISOString()} [${level.toUpperCase()}] ${clean}\n`;
    try {
      opts.echo?.(line.trimEnd());
    } catch {
      // ignore echo failures
    }
    write(line);
  };

  return {
    file,
    log,
    info: (m) => log('info', m),
    warn: (m) => log('warn', m),
    error: (m) => log('error', m),
    flush: () => tail,
  };
}

/**
 * Fixed-window rate limiter for log lines. take(): 'ok' (log it), 'drop' (over budget), or 'resume' (first
 * line of a new window after drops — log a "suppressed N" note first). PURE (unit tested).
 */
export function createLogBudget(perWindow: number, windowMs: number) {
  let windowStart = -Infinity;
  let used = 0;
  let dropped = 0;
  let reported = 0;
  return {
    take(now: number): 'ok' | 'drop' | 'resume' {
      if (now - windowStart >= windowMs) {
        windowStart = now;
        used = 0;
        if (dropped > 0) {
          reported = dropped;
          dropped = 0;
          used++;
          return 'resume';
        }
      }
      if (used >= perWindow) {
        dropped++;
        return 'drop';
      }
      used++;
      return 'ok';
    },
    suppressedSinceLast(): number {
      return reported;
    },
  };
}
