import { Creator, contract } from './core.mjs';
const [command, ...args] = process.argv.slice(2);
const usage = 'node scripts/creator/cli.mjs contract | <init|build|verify|gate> --workspace <absolute existing directory> --json <JSON object>';
try {
  if (command === 'contract' && args.length === 0) console.log(JSON.stringify(contract(), null, 2));
  else {
    if (!['init', 'build', 'verify', 'gate'].includes(command) || args.length !== 4 || args[0] !== '--workspace' || args[2] !== '--json') throw new Error(usage);
    if (Buffer.byteLength(args[3]) > 16 * 1024) throw new Error('CLI arguments exceed 16 KiB');
    const creator = new Creator(args[1]);
    console.log(JSON.stringify(await creator[command](JSON.parse(args[3])), null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Creator command failed' }));
  process.exitCode = 1;
}
