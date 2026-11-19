/**
 * Where do the game's assets come from? The installed desktop app serves them from files on disk through its own
 * app:// protocol (electron/appProtocol.ts), so they load with no network at all; a web build fetches them over
 * http(s) and an offline browser cannot. Decided by the URL scheme only — never by sniffing the user agent.
 */

/** Schemes that are read from local files and never need a connection. */
const LOCAL_SCHEMES: readonly string[] = ['app:', 'file:'];

/**
 * True when `url` (an asset URL or asset base; absolute, or relative to the page) is served from local files.
 * A relative URL with no page to resolve it against (unit tests, tools) is unknown and counts as network.
 */
export function isLocalAssetUrl(url: string): boolean {
  try {
    const page =
      typeof document !== 'undefined' && document.baseURI ? document.baseURI : typeof location !== 'undefined' ? location.href : undefined;
    return LOCAL_SCHEMES.includes(new URL(url, page).protocol);
  } catch {
    return false;
  }
}
