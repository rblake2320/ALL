/** Puts the owner's Afterlife Lease profile back after a crashed row9-upgrade-rollback run: node tests/desktop/row9-restore.mjs */
import { existsSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const real = join(process.env.APPDATA, 'Afterlife Lease');
const asides = readdirSync(process.env.APPDATA).filter((n) => n.startsWith('Afterlife Lease.row9-aside-'));
if (asides.length !== 1) {
  console.error(`expected exactly one aside folder, found ${asides.length}: ${asides.join(', ')}`);
  process.exit(1);
}
if (existsSync(real)) renameSync(real, `${real}.row9-run-${Date.now()}`);
renameSync(join(process.env.APPDATA, asides[0]), real);
console.log('restored', real);
