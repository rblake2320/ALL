/** `npm run e2e` entry point (kept for the existing package.json script): runs the full E2E suite. */
import { main } from './run.mjs';

main(process.argv.slice(2)).then((code) => process.exit(code));
