/**
 * Pure verdict helpers for tests/desktop/electron-verify.mjs (unit-tested in tests/unit/desktop/verdict.test.ts).
 * A run passes only when every check passed AND no unexpected renderer error was seen AND every process query worked.
 */

/**
 * Resources known to be missing while the cast work is in progress (cloud-owned: public/assets/**). A 404 for one of
 * these is reported as "known" and does not fail the run; every other error does.
 */
export const KNOWN_MISSING = [
  /^app:\/\/game\/assets\/models\/characters\/cast\/[a-z0-9_-]+\.glb$/,
  /^app:\/\/game\/assets\/manifest\.cast\.json$/,
  /^app:\/\/game\/assets\/ui\/cast\/[a-z0-9_-]+\.webp$/,
];

export const isKnownMissing = (url) => typeof url === 'string' && KNOWN_MISSING.some((re) => re.test(url));

/**
 * Split recorded renderer problems into known (allow-listed missing cast assets) and unexpected.
 * A failed request is known ONLY when it is net::ERR_ABORTED for a URL that also has a recorded allow-listed 404
 * response; any other transport failure (connection reset, no response at all) is unexpected, even for a cast URL.
 * `events` items: { kind: 'response', url, status } | { kind: 'requestfailed', url, failure } |
 *                 { kind: 'pageerror', message } | { kind: 'console', message }
 * A bare "Failed to load resource ... 404" console line carries no URL, so it is only accounted for when the same
 * number of allow-listed 404 responses was seen; surplus lines are unexpected.
 */
export function classifyErrors(events) {
  const known = [];
  const unexpected = [];
  let known404 = 0;
  const got404 = new Set(events.filter((e) => e.kind === 'response' && e.status === 404 && isKnownMissing(e.url)).map((e) => e.url));
  for (const e of events) {
    if (e.kind === 'response' && e.status === 404 && isKnownMissing(e.url)) {
      known.push(e);
      known404++;
    } else if (e.kind === 'requestfailed' && e.failure === 'net::ERR_ABORTED' && got404.has(e.url)) {
      known.push(e); // Chromium also reports the 404'd fetch of the same allow-listed URL as an aborted request
    } else if (e.kind !== 'console') unexpected.push(e);
  }
  for (const e of events) {
    if (e.kind !== 'console') continue;
    if (/Failed to load resource: the server responded with a status of 404/.test(e.message) && known404 > 0) {
      known404--;
      known.push(e);
    } else unexpected.push(e);
  }
  return { known, unexpected };
}

/** Final verdict of a run. `functional` = every check passed; `clean` = additionally no unexpected renderer error. */
export function verdict({ checks, events }) {
  const { known, unexpected } = classifyErrors(events);
  const functional = checks.length > 0 && checks.every((c) => c.ok === true);
  return { functional, clean: functional && unexpected.length === 0, pass: functional && unexpected.length === 0, known, unexpected };
}

/** Lines of a process-query result; throws when the query itself failed (a failed query is NOT "no processes"). */
export function queryLines(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.status !== 0 || (res.stderr ?? '').trim() !== '') throw new Error(`${what}: exit ${res.status}; ${(res.stderr ?? '').trim().slice(0, 300)}`);
  return (res.stdout ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}

/** A second launch is correct only when it exits by itself with code 0. */
export const secondInstanceOk = (code) => code === 0;
