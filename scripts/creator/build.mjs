import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const base = fileURLToPath(new URL('./', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const result = await build({ absWorkingDir: base, entryPoints: [base + 'engine.ts'], outfile: base + 'generated/engine.mjs', bundle: true,
  platform: 'node', format: 'esm', target: 'node22', metafile: true, logLevel: 'silent' });
const inputs = {};
for (const path of Object.keys(result.metafile.inputs).sort()) {
  const data = await readFile(resolve(base, path));
  inputs[path.replaceAll('\\', '/')] = createHash('sha256').update(data).digest('hex');
}
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const bundleSha256 = createHash('sha256').update(await readFile(base + 'generated/engine.mjs')).digest('hex');
const kitInputs = {};
for (const name of ['build.mjs', 'engine.ts', 'core.mjs', 'cli.mjs', 'mcp.mjs', 'checks.mjs', 'privacy.mjs', 'demo.mjs', 'package.json', 'package-lock.json']) {
  kitInputs[name] = createHash('sha256').update(await readFile(base + name)).digest('hex');
}
await writeFile(base + 'generated/provenance.json', JSON.stringify({ head, bundleSha256, inputs, kitInputs }, null, 2) + '\n');
console.log(JSON.stringify({ built: true, head, bundleSha256, sourceFiles: Object.keys(inputs).length }));
