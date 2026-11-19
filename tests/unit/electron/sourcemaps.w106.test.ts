/** Security review 2026-11-05 L-3: release builds ship no public source maps; development builds keep them. */
import { describe, expect, it } from 'vitest';
import config from '../../../vite.config';

type Build = { build?: { sourcemap?: unknown } };
const resolve = (mode: string) => (config as unknown as (e: { mode: string; command: string }) => Build)({ mode, command: 'build' }).build?.sourcemap;

describe('L-3 source maps', () => {
  it('production and single-file release builds: no source maps; development builds: full maps', () => {
    const prev = process.env.AFTERLIFE_SOURCEMAP;
    delete process.env.AFTERLIFE_SOURCEMAP;
    try {
      expect(resolve('production')).toBe(false);
      expect(resolve('single')).toBe(false);
      expect(resolve('development')).toBe(true);
      process.env.AFTERLIFE_SOURCEMAP = 'hidden';
      expect(resolve('production')).toBe('hidden'); // maps for symbolication, no sourceMappingURL in the shipped JS
      expect(resolve('single')).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.AFTERLIFE_SOURCEMAP;
      else process.env.AFTERLIFE_SOURCEMAP = prev;
    }
  });
});
