#!/usr/bin/env node
/** Manual, isolated Spark verification. Never records the shared feature ledger. */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateInputs(commit, host) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Expected a full 40-character lowercase commit SHA');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(host)) throw new Error('Expected a simple SSH host alias');
}

export function parseArguments(args) {
  const [commit, ...rest] = args;
  const nightly = rest.includes('--nightly');
  if (rest.filter(x => x === '--nightly').length > 1) throw new Error('Duplicate --nightly');
  const positional = rest.filter(x => x !== '--nightly');
  if (positional.length > 1 || positional.some(x => x.startsWith('--'))) throw new Error('Usage: spark-runner.mjs <full-sha> [host] [--nightly]');
  const host = positional[0] ?? 'spark2';
  validateInputs(commit, host);
  return { commit, host, nightly };
}

export function bundleHead(output) {
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) throw new Error('Bundle must contain exactly one advertised ref');
  const match = /^([0-9a-f]{40}) refs\/remotes\/origin\/ship\/final-phase$/.exec(lines[0]);
  if (!match) throw new Error('Bundle has an unexpected ref');
  return match[1];
}

export function requireAncestor(commit, tip, cwd) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, tip], { cwd, stdio: 'ignore' });
  } catch {
    throw new Error('Requested commit is not an available ancestor of the fetched integration tip');
  }
}

export function run(args) {
  const { commit, host, nightly } = parseArguments(args);
  const git = (...argv) => execFileSync('git', argv, { encoding: 'utf8' }).trim();
  const root = git('rev-parse', '--show-toplevel');
  process.chdir(root);
  const tip = git('rev-parse', 'refs/remotes/origin/ship/final-phase');
  requireAncestor(commit, tip, root);
  const id = `${commit.slice(0, 12)}-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`;
  const output = resolve(root, 'dev/out/spark-verification', id);
  mkdirSync(output, { recursive: true });
  const bundle = join(output, 'source.bundle');
  const receiptFile = join(output, 'receipt.json');
  const receipt = { commit, host, remoteDirectory: null, command: `npm ci; node scripts/verify-features.mjs --dry-run --gates${nightly ? '; npm run balance; npm run clip:gate' : ''}`,
    stage: 'bundle', sshExit: null, stdout: '', stderr: '', error: null };
  const save = () => writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + '\n');
  try {
  git('bundle', 'create', bundle, 'refs/remotes/origin/ship/final-phase');
  if (bundleHead(git('bundle', 'list-heads', bundle)) !== tip) throw new Error('Bundle ref changed while preparing it');
  // Only generated lowercase hex/digits/hyphens enter remote shell commands.
  const remote = `terra-w111-${id}`;
  receipt.remoteDirectory = `~/${remote}`;
  receipt.stage = 'remote-directory';
  execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, `mkdir -- ${remote}`], { stdio: 'inherit' });
  receipt.stage = 'transfer';
  execFileSync('scp', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', bundle, `${host}:${remote}/source.bundle`], { stdio: 'inherit' });
  receipt.stage = 'remote-verification';
  const remoteScript = `set -u
export PATH="$HOME/.nvm/versions/node/v22.22.1/bin:$PATH"
export npm_config_jobs=2
cd "$HOME/${remote}" || exit 1
git init -q checkout || exit 1
git -C checkout fetch ../source.bundle refs/remotes/origin/ship/final-phase:refs/remotes/bundle/ship >fetch.log 2>&1 || exit 1
git -C checkout checkout --detach ${commit} >checkout.log 2>&1 || exit 1
[ "$(git -C checkout rev-parse HEAD)" = "${commit}" ] || exit 1
cd checkout || exit 1
printf 'commit=%s\\nnode=%s\\nnpm=%s\\n' "$(git rev-parse HEAD)" "$(node -v)" "$(npm -v)" > ../summary.txt
start=$(date +%s)
nice -n 10 npm ci > ../npm-ci.log 2>&1
result=$?
printf 'npm ci exit=%s elapsed_seconds=%s\\n' "$result" "$(( $(date +%s) - start ))" >> ../summary.txt
if [ "$result" -ne 0 ]; then cat ../summary.txt; tail -30 ../npm-ci.log; exit "$result"; fi
start=$(date +%s)
nice -n 10 node scripts/verify-features.mjs --dry-run --gates > ../verify-features.log 2>&1
result=$?
printf 'verify-features --dry-run --gates exit=%s elapsed_seconds=%s\\n' "$result" "$(( $(date +%s) - start ))" >> ../summary.txt
cat ../summary.txt
grep -E '^(PASS|FAIL|MISSING|REGRESSED|All built| Test Files|      Tests)' ../verify-features.log || true
if [ "$result" -ne 0 ]; then exit "$result"; fi
${nightly ? `
if ! node -e "const p=require('./package.json'); process.exit(typeof p.scripts?.['clip:gate'] === 'string' ? 0 : 1)"; then
  printf 'nightly BLOCKED: clip:gate is not defined at this commit\\n' | tee -a ../summary.txt
  exit 2
fi
nightly_result=0
start=$(date +%s)
nice -n 10 npm run balance > ../balance.log 2>&1
balance_result=$?
printf 'npm run balance exit=%s elapsed_seconds=%s\\n' "$balance_result" "$(( $(date +%s) - start ))" | tee -a ../summary.txt
tail -12 ../balance.log
if [ "$balance_result" -ne 0 ]; then nightly_result=1; fi
start=$(date +%s)
nice -n 10 npm run clip:gate > ../clip-gate.log 2>&1
clip_result=$?
printf 'npm run clip:gate exit=%s elapsed_seconds=%s\\n' "$clip_result" "$(( $(date +%s) - start ))" | tee -a ../summary.txt
tail -15 ../clip-gate.log
if [ "$clip_result" -ne 0 ]; then nightly_result=1; fi
exit "$nightly_result"` : 'exit 0'}
`;
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, 'bash -s'], { input: remoteScript, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  receipt.sshExit = result.status; receipt.stdout = result.stdout ?? ''; receipt.stderr = result.stderr ?? '';
  receipt.error = result.error?.message ?? null;
  process.stdout.write(receipt.stdout); process.stderr.write(receipt.stderr);
  console.log(`Local receipt: ${receiptFile}; remote logs: ${host}:~/${remote}/`);
  if (result.error || result.status !== 0) throw new Error('Remote verification failed; inspect the retained receipt');
  receipt.stage = 'complete';
  save();
  } catch (error) {
    receipt.error = error instanceof Error ? error.message : String(error);
    save();
    console.error(`Failure receipt: ${receiptFile}`);
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
