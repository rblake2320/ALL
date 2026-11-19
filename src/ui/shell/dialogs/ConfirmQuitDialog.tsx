/** Quit confirmation (desktop builds): Stay / Save & quit (in game) / Quit game. */
import { useState } from 'preact/hooks';
import { t } from '../../../i18n';
import { useGame } from '../../hooks';
import { Icon } from '../../icons';
import { Button } from '../../common/Button';
import { Modal } from '../../common/Modal';
import { cx } from '../../common/cx';
import { saveStatus } from '../saveText';

export function ConfirmQuitDialog({ onClose }: { onClose: () => void }) {
  const game = useGame();
  const inGame = game.screen === 'game' && game.sim !== null;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The controller autosaves (best effort) on the way out; "Save & quit" is the guaranteed path.
  const text = inGame ? t('quit.textInGame') : t('quit.text');
  const saved = inGame ? saveStatus({ label: game.lastSaveLabel, savedAt: game.lastSavedAt, failed: game.lastSaveFailed }) : null;

  const saveAndQuit = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await game.saveGame();
      if (!r.ok) {
        setError(t('saveLoad.error', { error: r.error }));
        return;
      }
      game.quitApp();
    } catch (err) {
      setError(t('saveLoad.error', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={t('quit.title')}
      size={inGame ? 'md' : 'sm'}
      role="alertdialog"
      showClose={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} data-autofocus>
            {t('quit.stay')}
          </Button>
          <span class="ui-modal__footer-spacer" />
          {inGame ? (
            <Button variant="secondary" icon="save" loading={saving} onClick={saveAndQuit}>
              {t('quit.saveQuit')}
            </Button>
          ) : null}
          <Button variant="danger" icon="quit" disabled={saving} onClick={() => game.quitApp()}>
            {t('quit.ok')}
          </Button>
        </>
      }
    >
      <div class="u-row u-gap-4" style={{ alignItems: 'flex-start' }}>
        <span class="ui-confirm__icon" aria-hidden="true">
          <Icon name="moon" size="1.375rem" />
        </span>
        <div class="u-col u-gap-2" style={{ paddingTop: '0.25rem' }}>
          <p class="ui-confirm__text">{text}</p>
          {saved ? (
            <p class={cx('sh-quit__saved', saved.tone !== 'ok' && 'is-warn')}>
              <Icon name={saved.tone === 'ok' ? 'clock' : 'warning'} size="0.875rem" />
              {saved.text}
            </p>
          ) : null}
          {error ? (
            <p class="u-danger u-small" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
