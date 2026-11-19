/**
 * Start the shared-town server from the command line.
 *
 *   npm run town:server                       local testing: port 8787, this machine only, any web page may connect
 *   TOWN_ORIGINS=https://example.org PORT=8080 HOST=0.0.0.0 node dist-server/town-server.mjs     a real host
 *
 * On a real host TOWN_ORIGINS is required: it lists the web sites whose pages may connect. Without it the server
 * refuses to listen on anything but this machine. Set TOWN_TRUST_PROXY=1 when the host puts its own proxy in front of
 * the server (most do): otherwise every player appears to come from the proxy and shares one address limit.
 */
import { startTownServer } from './townServer';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
const origins = (process.env.TOWN_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const local = host === '127.0.0.1' || host === 'localhost' || host === '::1';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be a whole number from 1 to 65535');
  process.exit(2);
}
if (!local && origins.length === 0) {
  console.error('Refusing to start: HOST is not this machine and TOWN_ORIGINS is empty. Set TOWN_ORIGINS to the web site(s) that may connect.');
  process.exit(2);
}
for (const o of origins) {
  if (!/^https?:\/\/[^/\s]+$/.test(o)) {
    console.error(`TOWN_ORIGINS entry is not an origin (scheme://host[:port], no path): ${o}`);
    process.exit(2);
  }
}

const server = await startTownServer({ port, host, allowedOrigins: origins, trustProxy: process.env.TOWN_TRUST_PROXY === '1', log: (l) => console.log(l) });
const stop = (): void => {
  void server.close().then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
