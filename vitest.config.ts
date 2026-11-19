import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  define: {
    __AFTERLIFE_VERSION__: JSON.stringify(pkg.version),
  },
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/adversarial/**/*.test.ts'],
    environment: 'node',
    // Vitest 3.2.7 forks time out task RPC during long synchronous sim tests. Threads use MessagePort transport.
    // Same 2x40s control: forks exit 1 with RPC error; threads exit 0; wrong-assertion thread control still exit 1.
    pool: 'threads',
    testTimeout: 60000,
    hookTimeout: 60000,
    reporters: ['default'],
  },
});
