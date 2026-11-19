/**
 * Portal without preact/compat: renders children into a fixed layer under <body> so overlays escape
 * overflow clipping and backdrop-filter containing blocks. GameContext is re-provided inside.
 * Layers: 'dialog' (modals), 'toast' (above dialogs), 'popover' (menus/listboxes above dialogs), 'tooltip'
 * (topmost, non-interactive).
 *
 * Error containment: a portal is a separate render tree, so a crash inside a dialog/tooltip would bypass the App's
 * error boundary. Each portal tree gets its own boundary that forwards the error to `UiErrorContext` (App provides
 * it and shows the fatal screen); without a provider the overlay just disappears and the error is logged.
 */
import { Component, createContext, render, type ComponentChildren } from 'preact';
import { useContext, useLayoutEffect, useRef } from 'preact/hooks';
import { GameContext } from '../hooks';

export type PortalLayer = 'dialog' | 'toast' | 'popover' | 'tooltip';

const Z: Record<PortalLayer, string> = { dialog: 'var(--z-dialog)', toast: 'var(--z-toast)', popover: '85', tooltip: 'var(--z-tooltip)' };

/** Receives render errors from portal trees (App wires it to the fatal screen). */
export const UiErrorContext = createContext<((err: unknown) => void) | null>(null);

export function getPortalLayer(layer: PortalLayer): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  const id = `ui-portal-${layer}`;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = `ui-portal ui-portal--${layer}`;
    el.style.zIndex = Object.prototype.hasOwnProperty.call(Z, layer) ? Z[layer] : Z.dialog;
    document.body.appendChild(el);
  }
  return el;
}

class PortalBoundary extends Component<{ report: ((err: unknown) => void) | null; children: ComponentChildren }, { failed: boolean }> {
  override state = { failed: false };

  static override getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(err: unknown) {
    const report = this.props.report;
    if (report) {
      try {
        report(err);
        return;
      } catch {
        /* fall through to logging */
      }
    }
    if (typeof console !== 'undefined') console.error('[ui] overlay render error', err);
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function Portal({ children, layer = 'dialog' }: { children: ComponentChildren; layer?: PortalLayer }) {
  const game = useContext(GameContext);
  const report = useContext(UiErrorContext);
  const hostRef = useRef<HTMLDivElement | null>(null);
  if (hostRef.current === null && typeof document !== 'undefined') {
    const host = document.createElement('div');
    host.className = 'ui-portal__host';
    hostRef.current = host;
  }

  useLayoutEffect(() => {
    const host = hostRef.current;
    const parent = getPortalLayer(layer);
    if (!host || !parent) return;
    parent.appendChild(host);
    return () => {
      render(null, host);
      host.remove();
    };
  }, [layer]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !host.isConnected) return;
    render(
      <GameContext.Provider value={game}>
        <UiErrorContext.Provider value={report}>
          <PortalBoundary report={report}>{children}</PortalBoundary>
        </UiErrorContext.Provider>
      </GameContext.Provider>,
      host,
    );
  });

  return null;
}
