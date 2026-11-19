/**
 * "Copy session log" (W-117): the compact playtest report of `game.sessionLog` in a scrollable monospace block with
 * Copy (navigator.clipboard, textarea-select fallback — the primary path; the claude.ai artifact viewer blocks file
 * downloads) and, where the page may save files (desktop app / top-level page, 13+), Save file. Opened from the Pause
 * menu as a nested modal — no new DialogId, and the pause hold stays on while it is up.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { SessionListEntry, SessionLogFacade } from '../../game/sessionLog';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { Select } from '../common/Select';
import { copyText } from '../shell/clipboard';
import { slt } from './sessionLogStrings';

function minutes(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function SessionLogDialog({ log, onClose }: { log: SessionLogFacade; onClose: () => void }) {
  const [sessions, setSessions] = useState<SessionListEntry[] | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [status, setStatus] = useState<'copied' | 'copyFailed' | 'saved' | 'saveFailed' | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let live = true;
    void log.list().then((l) => {
      if (!live) return;
      setSessions(l);
      setId(l[0]?.id ?? null);
    });
    return () => {
      live = false;
    };
  }, [log]);

  useEffect(() => {
    let live = true;
    if (sessions === null) return undefined;
    if (id === null) {
      setText('');
      return undefined;
    }
    setText(null);
    void log.summary(id).then((s) => {
      if (live) setText(s ?? '');
    });
    return () => {
      live = false;
    };
  }, [log, id, sessions]);

  const copy = async () => {
    if (!text) return;
    const ok = await copyText(text);
    if (!ok && area.current) {
      // last resort: leave the text selected for a manual Ctrl+C
      area.current.focus();
      area.current.select();
    }
    setStatus(ok ? 'copied' : 'copyFailed');
  };
  const save = async () => setStatus((await log.saveFile(id ?? undefined)) ? 'saved' : 'saveFailed');

  const notice = sessions !== null && sessions.length === 0 && !log.enabled ? slt('off') : text === null ? slt('loading') : text === '' ? slt('empty') : null;
  return (
    <Modal
      onClose={onClose}
      title={slt('title')}
      subtitle={slt('subtitle')}
      size="lg"
      class="fb-slog"
      footer={
        <>
          {sessions && sessions.length > 1 ? (
            <Select
              value={id ?? ''}
              onChange={(v) => setId(String(v))}
              ariaLabel={slt('session')}
              options={sessions.map((s) => ({ value: s.id, label: s.current ? slt('session.current') : slt('session.previous', { date: s.date, duration: minutes(s.durationMs) }) }))}
            />
          ) : null}
          <span class="ui-modal__footer-spacer" />
          <span class="u-small" role="status" aria-live="polite" data-testid="session-log-status">
            {status === 'copied' || status === 'saved' ? <span class="u-accent">{slt(status)}</span> : status ? <span class="u-danger">{slt(status)}</span> : null}
          </span>
          {log.canSaveFile && text ? (
            <Button variant="ghost" icon="export" onClick={save} data-testid="session-log-save">
              {slt('save')}
            </Button>
          ) : null}
          <Button variant="primary" icon={status === 'copied' ? 'check' : 'copy'} onClick={copy} disabled={!text} data-autofocus data-testid="session-log-copy">
            {slt('copy')}
          </Button>
        </>
      }
    >
      {notice !== null ? (
        <p class="sh-hint" data-testid="session-log-empty">
          {notice}
        </p>
      ) : (
        <textarea
          ref={area}
          class="sh-diag fb-slog__text"
          readOnly
          spellcheck={false}
          aria-label={slt('title')}
          data-testid="session-log-text"
          value={text ?? ''}
          rows={18}
          style={{ width: '100%', minHeight: '40vh', resize: 'vertical', whiteSpace: 'pre', fontSize: '0.75rem', color: 'inherit' }}
        />
      )}
    </Modal>
  );
}
