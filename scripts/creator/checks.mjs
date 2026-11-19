// Fixed local baseline checks. Contributor artifacts are verified separately;
// no pack is injected into the repository suites. Explicit CLI only, never MCP.
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { Creator, repo, sha } from './core.mjs';
import { pathScrubber } from './privacy.mjs';

export function minimalEnvironment(source = process.env) {
  const allowed = new Set(['path', 'pathext', 'systemroot', 'windir', 'comspec', 'temp', 'tmp', 'tmpdir', 'home', 'userprofile', 'localappdata', 'appdata', 'lang', 'lc_all', 'tz']);
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key.toLowerCase())));
  return { ...env, CI: 'true' };
}

export async function runRepositoryCommand(argv, fd, timeoutMs = 60 * 60 * 1000, workspaces = []) {
  return new Promise(resolve => {
    let error = null, timedOut = false;
    const roots=[{path:repo,label:'repo'},...workspaces.map(path=>({path,label:'workspace'})),{path:os.homedir(),label:'home'}];
    const emit=text=>fs.writeFileSync(fd,text,{encoding:'utf8'});
    const stdout=pathScrubber(roots,emit),stderr=pathScrubber(roots,emit);
    const child = spawn(process.execPath, argv, { cwd: repo, shell: false, windowsHide: true,
      env: minimalEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    const consume=(sink,chunk)=>{if(error==='LOG_WRITE_FAILED')return;try{sink.write(chunk);}catch{error='LOG_WRITE_FAILED';child.kill();}};
    child.stdout.on('data',chunk=>consume(stdout,chunk));child.stderr.on('data',chunk=>consume(stderr,chunk));
    child.on('error', e => { error = e.code ?? 'spawn-error'; });
    child.on('close', (code, signal) => { clearTimeout(timer);
      try{if(error!=='LOG_WRITE_FAILED'){stdout.end();stderr.end();}}catch{error='LOG_WRITE_FAILED';}
      resolve({ code, signal, error, timedOut }); });
  });
}

export function repositoryReceipt({ before, stableInputs, results, verified, afterPack }) {
  const stablePack = afterPack.packSha256 === verified.packSha256;
  return { format: 'afterlife-creator-repository-checks-v2',
    repositoryChecks: { scope: 'repository baseline only; contributor pack is not loaded by these suites',
      repository: before, stableInputs, steps: results,
      outcome: !stableInputs ? 'Blocked' : results.some(r => r.outcome === 'Failed') ? 'Failed' : results.some(r => r.outcome === 'Blocked') ? 'Blocked' : 'Worked' },
    artifactVerification: { scope: 'local Creator verifier and registry only; no contributor-pack CI, clipping or balance evaluation',
      artifact: verified.artifact, beforeSha256: verified.packSha256, afterSha256: afterPack.packSha256, stablePack,
      engine: verified.engine, outcome: stablePack ? 'Worked' : 'Blocked' },
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    publicationReady: false,
    remaining: 'Contributor-pack CI is not implemented. Publisher admission requires pack-aware CI and applicable clipping/balance/rights/age/art review (W-084); repository baseline results do not admit this artifact.' };
}

async function main(args) {
  if (args.length !== 4 || args[0] !== '--workspace' || args[2] !== '--artifact') throw new Error('Usage: node scripts/creator/checks.mjs --workspace <absolute existing directory> --artifact <artifact id>');
  const creator = new Creator(args[1]);
  const artifact = args[3];
  const verified = await creator.verify({ artifact });
  const git = argv => execFileSync('git', argv, { cwd: repo, env: minimalEnvironment(), encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  const identity = () => ({ head: git(['rev-parse', 'HEAD']).trim(),
    files: Object.fromEntries(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
      .split('\0').filter(Boolean).sort().map(name => [name, fs.existsSync(path.join(repo, name)) ? sha(fs.readFileSync(path.join(repo, name))) : 'deleted'])),
  });
  const before = identity();
  const steps = [
    ['typecheck-renderer', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--noEmit']],
    ['typecheck-electron', ['node_modules/typescript/bin/tsc', '-p', 'electron/tsconfig.json', '--noEmit']],
    ['unit-and-adversarial', ['node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=2', '--fileParallelism=false']],
    ['web-build', ['node_modules/vite/bin/vite.js', 'build']],
    ['single-file-build', ['scripts/inline-build.mjs']],
    ['source-assets', ['scripts/verify-assets.mjs']],
    ['built-assets', ['scripts/verify-assets.mjs', '--root', 'dist/assets']],
    ['clipping-regression', ['node_modules/vitest/vitest.mjs', 'run', 'tests/unit/clip-audit', '--maxWorkers=1', '--fileParallelism=false']],
    ['balance-full', ['node_modules/vitest/vitest.mjs', 'run', '--config', 'tests/balance/vitest.config.ts', '--mode', 'full', '--maxWorkers=1', '--fileParallelism=false']],
  ];
  const receiptId = `${artifact}-checks-${Date.now()}`;
  const results = [];
  for (const [name, argv] of steps) {
    console.error(`[creator repository baseline] ${name}`);
    const target = path.join(creator.root, 'receipts', `${receiptId}-${name}.txt`);
    const fd = fs.openSync(target, 'wx'), started = Date.now();
    let result;
    try { result = await runRepositoryCommand(argv, fd, undefined, [creator.root]); } finally { fs.closeSync(fd); }
    results.push({ name, command: ['node', ...argv], scope: 'repository baseline; no contributor pack injected', ...result, elapsedMs: Date.now() - started,
      outcome: result.timedOut || result.error ? 'Blocked' : result.code === 0 ? 'Worked' : 'Failed',
      log: path.basename(target), logSha256: sha(fs.readFileSync(target)) });
  }
  const stableInputs = JSON.stringify(before) === JSON.stringify(identity());
  const afterPack = await creator.verify({ artifact });
  const receipt = repositoryReceipt({ before, stableInputs, results, verified, afterPack });
  const output = `receipts/${receiptId}.json`;
  fs.writeFileSync(path.join(creator.root, ...output.split('/')), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ receipt: output, repositoryChecks: { scope: receipt.repositoryChecks.scope, outcome: receipt.repositoryChecks.outcome, stableInputs,
    steps: results.map(({ name, outcome, elapsedMs }) => ({ name, outcome, elapsedMs })) }, artifactVerification: { scope: receipt.artifactVerification.scope, outcome: receipt.artifactVerification.outcome }, publicationReady: false }, null, 2));
  if (receipt.repositoryChecks.outcome !== 'Worked' || receipt.artifactVerification.outcome !== 'Worked') process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
