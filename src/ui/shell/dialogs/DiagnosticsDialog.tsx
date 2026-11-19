/** Diagnostics: game.diagnostics() in a scrollable monospace block with Copy + Refresh. */
import { useState } from 'preact/hooks';
import { t } from '../../../i18n';
import { useGameController } from '../../hooks';
import { Button } from '../../common/Button';
import { Modal } from '../../common/Modal';
import { copyText } from '../clipboard';

export function readDiagnostics(fn: () => string): string {
  try {
    const r = fn();
    return typeof r === 'string' ? r : JSON.stringify(r, null, 2);
  } catch (err) {
    return t('diag.unavailable', { error: err instanceof Error ? err.message : String(err) });
  }
}

export function DiagnosticsDialog({ onClose }: { onClose: () => void }) {
  const game = useGameController();
  const [text, setText] = useState(() => readDiagnostics(() => game.diagnostics()));
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const copy = async () => {
    const ok = await copyText(text);
    setCopied(ok ? 'ok' : 'fail');
    setTimeout(() => setCopied(null), 2200);
  };
  return (
    <Modal
      onClose={onClose}
      title={t('diag.title')}
      subtitle={t('diag.subtitle')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" icon="refresh" onClick={() => setText(readDiagnostics(() => game.diagnostics()))}>
            {t('diag.refresh')}
          </Button>
          <span class="ui-modal__footer-spacer" />
          <span class="u-small" role="status" aria-live="polite">
            {copied === 'ok' ? <span class="u-accent">{t('diag.copied')}</span> : copied === 'fail' ? <span class="u-danger">{t('diag.copyFailed')}</span> : null}
          </span>
          <Button variant="primary" icon={copied === 'ok' ? 'check' : 'copy'} onClick={copy} data-autofocus>
            {t('diag.copy')}
          </Button>
        </>
      }
    >
      <pre class="sh-diag" tabIndex={0}>
        {text}
      </pre>
    </Modal>
  );
}
