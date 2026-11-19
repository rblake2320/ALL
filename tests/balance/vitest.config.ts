/**
 * Balance harness config (`npm run balance` = full sweep; `npx vitest run --config tests/balance/vitest.config.ts`
 * = fast subset only). Extends the root config; `--mode full` sets BALANCE_FULL=1 (cross-platform, no shell env).
 */
import { defineConfig, mergeConfig } from 'vitest/config';
import root from '../../vitest.config';

export default defineConfig(({ mode }) => {
  const merged = mergeConfig(root, {
    test: {
      env: mode === 'full' || process.env.BALANCE_FULL === '1' ? { BALANCE_FULL: '1' } : {},
      // one world at a time: the sweep is CPU-bound and the machine is shared
      fileParallelism: false,
      testTimeout: 3_600_000,
    },
  });
  // mergeConfig concatenates arrays: replace the root include (tests/unit/**) instead of extending it
  merged.test = { ...merged.test, include: ['tests/balance/**/*.test.ts'] };
  return merged;
});
