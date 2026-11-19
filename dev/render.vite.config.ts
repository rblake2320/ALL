/**
 * RENDER dev-server config for automated screenshots: the project config with HMR off, so edits by other agents
 * working in parallel never full-reload a page in the middle of a capture (each page load still gets the latest
 * code). Usage: npx vite --config dev/render.vite.config.ts --port 5174 --strictPort
 */
import { defineConfig, mergeConfig, type ConfigEnv, type UserConfig } from 'vite';
import base from '../vite.config';

export default defineConfig(async (env: ConfigEnv) => {
  const resolved = (typeof base === 'function' ? await base(env) : await base) as UserConfig;
  return mergeConfig(resolved, { server: { hmr: false, port: 5174, strictPort: true } });
});
