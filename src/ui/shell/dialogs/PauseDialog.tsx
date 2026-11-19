/** Pause menu: Resume, Save, Load, Settings, Help, Report a bug (W-110), Copy session log (W-117), Main Menu (confirm), Quit (desktop builds). */
import { useState } from 'preact/hooks';
import { t } from '../../../i18n';
import { useGame } from '../../hooks';
import { Icon, type IconName } from '../../icons';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { Kbd } from '../../common/Kbd';
import { Modal } from '../../common/Modal';
import { Truncate } from '../../common/Truncate';
import { cx } from '../../common/cx';
import { childKey, closeAllShellDialogs, openChildDialog, takeReturnFocus } from '../nav';
import { dayLabel, saveStatus } from '../saveText';
import { ft } from '../../feedback/strings';
import { openFeedback } from '../../feedback/FeedbackLayer';
import { SessionLogDialog } from '../../feedback/SessionLogDialog';
import { slt } from '../../feedback/sessionLogStrings';

function PauseItem({ icon, label, onClick, primary, hotkey, autofocus }: { icon: IconName; label: string; onClick: () => void; primary?: boolean; hotkey?: string; autofocus?: boolean }) {
  return (
    <li>
      <button type="button" class={cx('sh-pause__item', primary && 'is-primary')} onClick={onClick} data-autofocus={autofocus ? true : undefined}>
        <span class="sh-pause__icon" aria-hidden="true">
          <Icon name={icon} size="1.125rem" />
        </span>
        <span class="sh-pause__label">{label}</span>
        {hotkey ? <Kbd combo={hotkey} /> : null}
      </button>
    </li>
  );
}

export function PauseDialog({ onClose }: { onClose: () => void }) {
  const game = useGame();
  const [confirmMenu, setConfirmMenu] = useState(false);
  const [sessionLog, setSessionLog] = useState(false);
  // back from Settings / Save / Load / Help: focus the item that opened it, not Resume (W-064 focus restore)
  const [back] = useState(() => takeReturnFocus('pause'));
  const focusFirst = (key: string | null) => (back === null ? key === null : back === key);
  let where: { household: string; when: string } | null = null;
  try {
    const sim = game.sim;
    if (sim) {
      const time = sim.time();
      const household = typeof sim.state.household.name === 'string' ? sim.state.household.name.trim() : '';
      const when = [dayLabel(time.day), typeof time.label === 'string' ? time.label : null].filter(Boolean).join(' · ');
      if (household || when) where = { household, when };
    }
  } catch {
    where = null;
  }
  const saved = saveStatus({ label: game.lastSaveLabel, savedAt: game.lastSavedAt, failed: game.lastSaveFailed });
  return (
    <Modal
      onClose={onClose}
      title={t('pause.title')}
      subtitle={t('pause.subtitle')}
      eyebrow={
        where ? (
          <span class="sh-pause__where">
            {where.household ? <Truncate text={where.household} /> : null}
            {where.household && where.when ? <span aria-hidden="true">·</span> : null}
            {where.when ? <span class="sh-pause__when">{where.when}</span> : null}
          </span>
        ) : undefined
      }
      size="sm"
      class="sh-pause"
    >
      <ul class="sh-pause__list">
        <PauseItem icon="play" label={t('pause.resume')} primary autofocus={focusFirst(null)} hotkey="Escape" onClick={onClose} />
        <PauseItem icon="save" label={t('pause.save')} hotkey="F5" autofocus={focusFirst(childKey('saveLoad', 'save'))} onClick={() => openChildDialog(game, 'saveLoad', { saveLoadMode: 'save' })} />
        <PauseItem icon="load" label={t('pause.load')} autofocus={focusFirst(childKey('saveLoad', 'load'))} onClick={() => openChildDialog(game, 'saveLoad', { saveLoadMode: 'load' })} />
        <PauseItem icon="settings" label={t('pause.settings')} autofocus={focusFirst(childKey('settings'))} onClick={() => openChildDialog(game, 'settings')} />
        <PauseItem icon="help" label={t('pause.help')} hotkey="F10" autofocus={focusFirst(childKey('help'))} onClick={() => openChildDialog(game, 'help')} />
        {game.feedback ? <PauseItem icon="flag" label={ft('entry')} hotkey="F8" onClick={() => openFeedback(game, 'pause')} /> : null}
        {game.sessionLog ? <PauseItem icon="copy" label={slt('entry')} onClick={() => setSessionLog(true)} /> : null}
      </ul>
      <div class="sh-pause__sep" role="separator" />
      <ul class="sh-pause__list">
        <PauseItem icon="house" label={t('pause.mainMenu')} onClick={() => setConfirmMenu(true)} />
        {game.canQuitApp ? <PauseItem icon="quit" label={t('pause.quit')} autofocus={focusFirst(childKey('confirmQuit'))} onClick={() => openChildDialog(game, 'confirmQuit')} /> : null}
      </ul>
      <p class={cx('sh-pause__saved', saved.tone === 'failed' && 'is-failed')} role="status">
        <Icon name={saved.tone === 'failed' ? 'warning' : 'clock'} size="0.875rem" />
        {saved.text}
      </p>
      {sessionLog && game.sessionLog ? <SessionLogDialog log={game.sessionLog} onClose={() => setSessionLog(false)} /> : null}
      {confirmMenu ? (
        <ConfirmDialog
          icon="house"
          title={t('pause.confirmMenuTitle')}
          text={t('pause.confirmMenuText')}
          confirmLabel={t('pause.confirmMenuOk')}
          onCancel={() => setConfirmMenu(false)}
          onConfirm={async () => {
            setConfirmMenu(false);
            closeAllShellDialogs(game);
            await game.quitToMenu();
          }}
        />
      ) : null}
    </Modal>
  );
}
