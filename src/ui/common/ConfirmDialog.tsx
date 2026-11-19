import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { t } from '../../i18n';
import { Icon, type IconName } from '../icons';
import { Button } from './Button';
import { Modal } from './Modal';
import { useUid } from './uid';

export interface ConfirmDialogProps {
  title: ComponentChildren;
  text?: ComponentChildren;
  children?: ComponentChildren;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive: red confirm button, focus starts on Cancel. */
  danger?: boolean;
  icon?: IconName;
  /** Async confirm shows a spinner until it settles; errors keep the dialog open. */
  onConfirm: () => void | Promise<unknown>;
  onCancel: () => void;
}

export function ConfirmDialog({ title, text, children, confirmLabel, cancelLabel, danger, icon, onConfirm, onCancel }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const textId = useUid();
  const run = async () => {
    if (busy) return;
    try {
      const r = onConfirm();
      if (r && typeof (r as Promise<unknown>).then === 'function') {
        setBusy(true);
        await r;
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      onClose={() => !busy && onCancel()}
      title={title}
      size="sm"
      role="alertdialog"
      describedBy={text ? textId : undefined}
      showClose={false}
      footer={
        <>
          <span class="ui-modal__footer-spacer" />
          <Button variant="ghost" onClick={onCancel} disabled={busy} data-autofocus={danger ? true : undefined}>
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={run} loading={busy} data-autofocus={danger ? undefined : true}>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      <div class="u-row u-gap-4" style={{ alignItems: 'flex-start' }}>
        <span class={danger ? 'ui-confirm__icon ui-confirm__icon--danger' : 'ui-confirm__icon'} aria-hidden="true">
          <Icon name={icon ?? (danger ? 'warning' : 'help')} size="1.375rem" />
        </span>
        <div class="u-col u-gap-2" style={{ paddingTop: '0.25rem' }}>
          {text ? (
            <p class="ui-confirm__text" id={textId}>
              {text}
            </p>
          ) : null}
          {children}
        </div>
      </div>
    </Modal>
  );
}
