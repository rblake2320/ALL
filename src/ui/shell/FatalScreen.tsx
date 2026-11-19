/**
 * Fatal error screen (render crash or controller.fatalError). Deliberately self-contained: no game hooks,
 * every controller call guarded, so it still works when the rest of the UI is broken.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameController } from '../../game/contracts';
import { t } from '../../i18n';
import { Icon } from '../icons';
import { Button } from '../common/Button';
import { copyText } from './clipboard';
import { FeedbackDialog } from '../feedback/FeedbackDialog';
import { ft } from '../feedback/strings';
import { fatalKind } from '../../shared/fatalKinds';

function diagnosticsText(game: GameController | null, message: string, stack?: string | null): string {
  let diag = '';
  try {
    diag = game ? game.diagnostics() : '';
  } catch (err) {
    diag = `diagnostics() failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  return [`Fatal: ${message}`, stack ? `\n${stack}` : '', diag ? `\n\n${diag}` : ''].join('');
}

export function FatalScreen({ game, message, stack }: { game: GameController | null; message: string; stack?: string | null }) {
  const [copied, setCopied] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  // An alertdialog must take focus: keyboard players land on Reload instead of a dead <body>.
  useEffect(() => {
    try {
      cardRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }, []);
  const [saveState, setSaveState] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'fail'; text?: string }>({ kind: 'idle' });
  const [reporting, setReporting] = useState(false);
  let feedback: GameController['feedback'] = null;
  try {
    feedback = game?.feedback ?? null;
  } catch {
    feedback = null;
  }
  // W-110: a manual report only (never automatic). capture() takes what screenshot it can and the crash text.
  const report = () => {
    try {
      feedback?.capture('crash', { message, stack: stack ?? null });
      setReporting(true);
    } catch {
      setReporting(false);
    }
  };

  const copy = async () => {
    const ok = await copyText(diagnosticsText(game, message, stack));
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2400);
  };

  const emergencySave = async () => {
    if (!game) return;
    setSaveState({ kind: 'busy' });
    try {
      const r = await game.saveGame(undefined, t('fatal.emergencyName'));
      setSaveState(r.ok ? { kind: 'ok' } : { kind: 'fail', text: r.error });
    } catch (err) {
      setSaveState({ kind: 'fail', text: err instanceof Error ? err.message : String(err) });
    }
  };

  // W-149: no WebGL is an ordinary situation with things the player can do, not an unexplained crash.
  const no3d = fatalKind(message) === 'no3d';

  let canSave = false;
  try {
    canSave = !!game && !!game.sim;
  } catch {
    canSave = false;
  }

  return (
    <div class="ui-root sh-fatal-root">
      <div class="sh-screen sh-fatal ui-interactive" role="alertdialog" aria-labelledby="fatal-title" aria-describedby="fatal-text" data-fatal-kind={no3d ? 'no3d' : 'generic'}>
        <div class="sh-fatal__card" ref={cardRef}>
          <div class="sh-fatal__icon" aria-hidden="true">
            <Icon name="skull" size="2.5rem" strokeWidth={1.5} />
          </div>
          <div class="u-eyebrow">{t(no3d ? 'fatal.no3d.eyebrow' : 'fatal.eyebrow')}</div>
          <h1 class="sh-fatal__title" id="fatal-title">
            {t(no3d ? 'fatal.no3d.title' : 'fatal.title')}
          </h1>
          <p class="sh-fatal__text" id="fatal-text">
            {t(no3d ? 'fatal.no3d.text' : 'fatal.text')}
          </p>
          {no3d ? (
            <div class="sh-fatal__steps" data-testid="fatal-no3d-steps">
              <h2 class="ui-section-title" id="fatal-steps-title">
                {t('fatal.no3d.tryTitle')}
              </h2>
              <ol aria-labelledby="fatal-steps-title">
                <li>{t('fatal.no3d.try1')}</li>
                <li>{t('fatal.no3d.try2')}</li>
                <li>{t('fatal.no3d.try3')}</li>
              </ol>
            </div>
          ) : null}
          <details class="sh-fatal__details">
            <summary>{t('fatal.details')}</summary>
            <pre>{[message, stack].filter(Boolean).join('\n\n')}</pre>
          </details>
          <div class="sh-fatal__actions">
            <Button variant="secondary" icon={copied ? 'check' : 'copy'} onClick={copy}>
              {copied ? t('fatal.copied') : t('fatal.copy')}
            </Button>
            {canSave ? (
              <Button variant="secondary" icon="save" loading={saveState.kind === 'busy'} disabled={saveState.kind === 'ok'} onClick={emergencySave}>
                {saveState.kind === 'busy' ? t('fatal.saving') : saveState.kind === 'ok' ? t('fatal.saved') : t('fatal.emergencySave')}
              </Button>
            ) : null}
            {feedback ? (
              <Button variant="secondary" icon="flag" onClick={report} data-testid="fatal-report">
                {ft('crash.entry')}
              </Button>
            ) : null}
            <Button variant="primary" icon="refresh" onClick={() => location.reload()} data-autofocus>
              {t(no3d ? 'fatal.no3d.retry' : 'fatal.reload')}
            </Button>
          </div>
          <p class="sh-fatal__status" role="status" aria-live="polite">
            {saveState.kind === 'ok' ? <span class="u-accent">{t('fatal.saved')}</span> : null}
            {saveState.kind === 'fail' ? <span class="u-danger">{t('fatal.saveFailed', { error: saveState.text ?? '' })}</span> : null}
          </p>
          <p class="sh-fatal__hint">{t(no3d ? 'fatal.no3d.hint' : 'fatal.hint')}</p>
        </div>
        {reporting && feedback ? <FeedbackDialog service={feedback} onClose={() => setReporting(false)} /> : null}
      </div>
    </div>
  );
}
