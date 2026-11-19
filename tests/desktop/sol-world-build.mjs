// Production-bundle the real S11 components in a test-only page, using the game's Vite config/CSP/theme.
// No test port is imported by the shipping game. Never overwrite dist or empty an existing directory.
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { build, loadConfigFromFile, mergeConfig } from 'vite';
const loaded=await loadConfigFromFile({command:'build',mode:'production'},resolve('vite.config.ts'));
if(!loaded)throw Error('Game Vite configuration missing');
const at=process.argv.indexOf('--out');
const out=resolve(at>=0?process.argv[at+1]:'dev/out/sol-world-s11/components-dist');
if(existsSync(out))throw Error('Fixture output already exists; choose a fresh --out directory');
await build(mergeConfig(loaded.config,{
  configFile:false,publicDir:false,
  build:{outDir:out,emptyOutDir:false,
    rollupOptions:{input:resolve('tests/desktop/fixtures/sol-world-ui.html')}},
}));
