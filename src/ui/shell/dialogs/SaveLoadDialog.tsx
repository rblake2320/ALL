/**
 * Save / Load: slot list (thumbnail, household, day/time, funds, saved-ago, autosave + recovered badges),
 * Save with a name (new or overwrite), Load, Delete (confirm), Export, Import file.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { SaveSlotInfo } from '../../../persistence/contracts';
import { t } from '../../../i18n';
import { useGame, useNow } from '../../hooks';
import { Icon } from '../../icons';
import { Badge } from '../../common/Badge';
import { Button } from '../../common/Button';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { EmptyState } from '../../common/EmptyState';
import { IconButton } from '../../common/IconButton';
import { Modal } from '../../common/Modal';
import { ScrollArea } from '../../common/ScrollArea';
import { Spinner } from '../../common/Spinner';
import { TabPanel, Tabs } from '../../common/Tabs';
import { TextInput, clampText } from '../../common/TextInput';
import { Tooltip } from '../../common/Tooltip';
import { Truncate } from '../../common/Truncate';
import { cx } from '../../common/cx';
import { formatDurationMinutes, formatMoney, formatNumber, formatSavedAgo } from '../../common/format';
import { SAVE_NAME_MAX } from '../data';
import { closeAllShellDialogs, requestedSaveLoadMode, type SaveLoadMode } from '../nav';
import { dayLabel, newSaveSlotId, slotDisplayName } from '../saveText';
import { PresetNameField, useFreeTextNames } from '../PresetNameField';

/** Newest first; tolerates garbage entries and invalid dates (they sink to the bottom, stable order). */
export function sortSlots(slots: readonly SaveSlotInfo[] | null | undefined): SaveSlotInfo[] {
  if (!Array.isArray(slots)) return [];
  return slots
    .map((s, i) => ({ s, i, ms: s && typeof s.savedAt === 'string' ? Date.parse(s.savedAt) : NaN }))
    .filter((x) => x.s && typeof x.s === 'object' && typeof x.s.slotId === 'string')
    .sort((a, b) => {
      const am = Number.isFinite(a.ms) ? a.ms : -Infinity;
      const bm = Number.isFinite(b.ms) ? b.ms : -Infinity;
      return bm - am || a.i - b.i;
    })
    .map((x) => x.s);
}

/** Default name for a new save: "The Grimsbys — Day 12". */
export function defaultSaveName(household: string | null | undefined, day: number | null | undefined): string {
  const h = (typeof household === 'string' ? household : '').replace(/\s+/g, ' ').trim();
  const d = Number.isFinite(day) ? t('saveLoad.day', { day: formatNumber(Math.floor(day as number)) }) : '';
  return clampText([h, d].filter(Boolean).join(' — ') || t('saveLoad.newSave'), SAVE_NAME_MAX);
}

type Pending =
  | { kind: 'delete'; slot: SaveSlotInfo }
  | { kind: 'overwrite'; slot: SaveSlotInfo }
  | { kind: 'load'; slot: SaveSlotInfo }
  | null;

function Thumb({ slot }: { slot: SaveSlotInfo }) {
  const src = slot.meta?.thumbnail;
  if (typeof src === 'string' && src.startsWith('data:image/')) {
    // Thumbnails are small inline data: URLs (≤ 64 KB, persistence contract): lazy-loading them only made rows
    // scrolled into view flash an empty box. Decode off the main thread instead.
    return <img class="sh-slot__thumb" src={src} alt="" decoding="async" draggable={false} />;
  }
  let h = 0;
  for (const ch of slot.slotId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = 250 + (h % 70);
  return (
    <div class="sh-slot__thumb sh-slot__thumb--empty" style={{ '--hue': String(hue) }} aria-hidden="true">
      <Icon name="house" size="1.75rem" strokeWidth={1.4} />
    </div>
  );
}

export function SaveLoadDialog({ onClose }: { onClose: () => void }) {
  const game = useGame();
  const inGame = game.screen === 'game' && game.sim !== null;
  const [mode, setMode] = useState<SaveLoadMode>(() => (inGame ? (requestedSaveLoadMode(game) ?? 'save') : 'load'));
  const [slots, setSlots] = useState<SaveSlotInfo[] | null>(null);
  const [listError, setListError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const now = useNow(30_000);

  const simInfo = useMemo(() => {
    try {
      return { household: game.sim?.state?.household?.name ?? null, day: game.sim?.time()?.day ?? null };
    } catch {
      return { household: null, day: null };
    }
  }, [game.sim]);
  const [name, setName] = useState(() => defaultSaveName(simInfo.household, simInfo.day));
  const freeText = useFreeTextNames();
  const nameError = name.trim().length === 0 ? t('saveLoad.saveNameError') : null;

  const refresh = async () => {
    setListError(false);
    try {
      const list = await game.listSaves();
      setSlots(sortSlots(list));
    } catch {
      setListError(true);
      setSlots([]);
    }
  };
  useEffect(() => {
    void refresh();
  }, [game]);

  const report = (ok: boolean, text: string) => setStatus({ tone: ok ? 'ok' : 'bad', text });

  const doSave = async (slotId?: string, saveName?: string) => {
    const n = (saveName ?? name).trim();
    if (!n) return;
    // "New save" gets its own slot: the controller's default target is the world's single manual slot.
    const target = slotId ?? newSaveSlotId((slots ?? []).map((x) => x.slotId), Date.now());
    setBusy(slotId ?? 'new');
    setStatus(null);
    try {
      const r = await game.saveGame(target, n);
      if (r.ok) {
        report(true, t('saveLoad.saved', { name: r.info?.name || n }));
        setFreshId(r.info?.slotId ?? target);
      } else report(false, t('saveLoad.error', { error: r.error }));
      await refresh();
    } catch (err) {
      report(false, t('saveLoad.error', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  };

  const doLoad = async (slot: SaveSlotInfo) => {
    setBusy(slot.slotId);
    setStatus(null);
    try {
      const r = await game.loadGame(slot.slotId);
      if (r.ok) {
        closeAllShellDialogs(game);
        return;
      }
      report(false, t('saveLoad.error', { error: r.error }));
    } catch (err) {
      report(false, t('saveLoad.error', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async (slot: SaveSlotInfo) => {
    setBusy(slot.slotId);
    try {
      await game.deleteSave(slot.slotId);
      await refresh();
    } catch (err) {
      report(false, t('saveLoad.error', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  };

  const doExport = async (slot: SaveSlotInfo) => {
    try {
      await game.exportSave(slot.slotId);
    } catch (err) {
      report(false, t('saveLoad.error', { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const onImportFile = async (file: File | null | undefined) => {
    if (!file) return;
    setBusy('import');
    setStatus(null);
    try {
      const r = await game.importSave(file);
      if (r.ok) report(true, t('saveLoad.importDone', { name: r.info?.name || file.name }));
      else report(false, t('saveLoad.error', { error: r.error }));
      await refresh();
    } catch (err) {
      report(false, t('saveLoad.error', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const list = slots ?? [];
  const title = inGame ? (mode === 'save' ? t('saveLoad.titleSave') : t('saveLoad.titleLoad')) : t('saveLoad.titleLoad');

  return (
    <Modal
      onClose={onClose}
      title={title}
      size="lg"
      tall
      bodyFlush
      tabs={
        inGame ? (
          <Tabs
            idBase="saves"
            ariaLabel={t('saveLoad.title')}
            value={mode}
            onChange={(v) => setMode(v as SaveLoadMode)}
            items={[
              { id: 'save', icon: 'save', label: t('saveLoad.tab.save') },
              { id: 'load', icon: 'load', label: t('saveLoad.tab.load') },
            ]}
            autoFocusSelected={mode === 'load'}
          />
        ) : undefined
      }
      footer={
        <>
          <input ref={fileRef} type="file" accept=".json,.alsave,application/json" class="u-sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void onImportFile(e.currentTarget.files?.[0])} />
          <Button variant="ghost" icon="import" loading={busy === 'import'} onClick={() => fileRef.current?.click()}>
            {busy === 'import' ? t('saveLoad.importing') : t('saveLoad.import')}
          </Button>
          <span class="ui-modal__footer-spacer" />
          <span class="sh-saves__count u-faint u-small">{slots && list.length > 0 ? `${t('saveLoad.count', { count: list.length })} · ${t('saveLoad.sorted')}` : ''}</span>
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      <TabPanel idBase="saves" value={inGame ? mode : 'load'} class="sh-saves">
        {inGame && mode === 'save' ? (
          <form
            class="sh-saves__new"
            onSubmit={(e) => {
              e.preventDefault();
              if (!nameError) void doSave(undefined, name);
            }}
          >
            {freeText ? (
              <TextInput label={t('saveLoad.newSave')} value={name} maxLength={SAVE_NAME_MAX} onInput={setName} error={nameError} icon="edit" autoFocus />
            ) : (
              <PresetNameField label={t('saveLoad.newSave')} kind="save" value={name} onChange={setName} extra={[defaultSaveName(simInfo.household, simInfo.day)]} />
            )}
            <Button type="submit" variant="primary" icon="save" loading={busy === 'new'} disabled={!!nameError || busy !== null} class="sh-saves__savebtn">
              {busy === 'new' ? t('saveLoad.saving') : t('saveLoad.save')}
            </Button>
          </form>
        ) : null}
        {/* Persistent live region (announcements need it to exist first); takes no space while empty. */}
        <div class={cx('sh-saves__status', status && `is-${status.tone}`)} role="status" aria-live="polite">
          {status ? (
            <span class="sh-saves__statusmsg" key={status.text}>
              <Icon name={status.tone === 'ok' ? 'check' : 'warning'} size="1rem" />
              {status.text}
            </span>
          ) : null}
        </div>
        <ScrollArea class="sh-saves__list">
          {slots === null ? (
            <div class="sh-saves__loading">
              <Spinner size="1.5rem" label={t('common.loading')} />
            </div>
          ) : listError ? (
            <EmptyState icon="warning" title={t('saveLoad.listFailed')} action={<Button icon="refresh" onClick={() => void refresh()}>{t('saveLoad.retry')}</Button>} />
          ) : list.length === 0 ? (
            <EmptyState icon="tombstone" title={t('saveLoad.empty')} text={inGame ? t('saveLoad.emptyText') : t('saveLoad.emptyMenuText')} />
          ) : (
            <ul class="sh-slots">
              {list.map((slot) => {
                const m = slot.meta ?? ({} as SaveSlotInfo['meta']);
                const isBusy = busy === slot.slotId;
                const members = Array.isArray(m.memberNames) ? m.memberNames.length : 0;
                const saving = inGame && mode === 'save';
                // Autosaves belong to the game: overwriting one with a manual save would be undone by the next autosave.
                const lockedAuto = saving && slot.isAutosave;
                const primaryLabel = saving ? t('saveLoad.overwrite') : t('saveLoad.load');
                const display = slotDisplayName(slot);
                const day = dayLabel(m.day);
                const goButton = (
                  <Button
                    size="sm"
                    variant="secondary"
                    class="sh-slot__go"
                    icon={saving ? 'save' : 'load'}
                    loading={isBusy}
                    disabled={lockedAuto || (busy !== null && !isBusy)}
                    aria-label={`${primaryLabel}: ${display}`}
                    onClick={() => {
                      if (saving) setPending({ kind: 'overwrite', slot });
                      else if (inGame) setPending({ kind: 'load', slot });
                      else void doLoad(slot);
                    }}
                  >
                    {primaryLabel}
                  </Button>
                );
                return (
                  <li key={slot.slotId} class={cx('sh-slot', freshId === slot.slotId && 'is-fresh')}>
                    <Thumb slot={slot} />
                    <div class="sh-slot__main">
                      <div class="sh-slot__titlerow">
                        <Truncate text={display} class="sh-slot__name" />
                        {slot.isAutosave ? (
                          <Badge tone="info" caps icon="refresh">
                            {t('saveLoad.autosave')}
                          </Badge>
                        ) : null}
                        {slot.recoveredFromBackup ? (
                          <Tooltip content={t('saveLoad.recovered')} description={t('saveLoad.recoveredHint')}>
                            <span tabIndex={0} class="sh-slot__recovered">
                              <Badge tone="warm" caps icon="warning">
                                {t('saveLoad.recovered')}
                              </Badge>
                            </span>
                          </Tooltip>
                        ) : null}
                      </div>
                      <div class="sh-slot__meta">
                        <span>
                          <Icon name="users" size="0.875rem" />
                          {m.householdName || '—'}
                          {members ? ` · ${t('saveLoad.members', { count: members })}` : ''}
                        </span>
                        <span>
                          <Icon name="clock" size="0.875rem" />
                          {day ?? '—'}
                          {m.timeLabel ? `, ${m.timeLabel}` : ''}
                        </span>
                        <span class="sh-slot__funds">
                          <Icon name="money" size="0.875rem" />
                          {formatMoney(m.funds)}
                        </span>
                      </div>
                      <div class="sh-slot__sub">
                        <span>{formatSavedAgo(slot.savedAt, now)}</span>
                        {Number.isFinite(slot.playMinutes) && slot.playMinutes > 0 ? <span> · {t('saveLoad.played', { time: formatDurationMinutes(slot.playMinutes) })}</span> : null}
                      </div>
                    </div>
                    <div class="sh-slot__actions" role="group" aria-label={t('saveLoad.slotActions', { name: display })}>
                      <IconButton icon="export" size="sm" label={t('saveLoad.export')} onClick={() => void doExport(slot)} />
                      <IconButton icon="trash" size="sm" variant="danger" label={t('saveLoad.delete')} onClick={() => setPending({ kind: 'delete', slot })} />
                      {lockedAuto ? (
                        <Tooltip content={t('saveLoad.autosaveLocked')} placement="left">
                          {goButton}
                        </Tooltip>
                      ) : (
                        goButton
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </TabPanel>

      {pending?.kind === 'delete' ? (
        <ConfirmDialog
          danger
          icon="trash"
          title={t('saveLoad.deleteTitle', { name: slotDisplayName(pending.slot) })}
          text={t('saveLoad.deleteText')}
          confirmLabel={t('saveLoad.deleteOk')}
          onCancel={() => setPending(null)}
          onConfirm={async () => {
            const s = pending.slot;
            setPending(null);
            await doDelete(s);
          }}
        />
      ) : null}
      {pending?.kind === 'overwrite' ? (
        <ConfirmDialog
          icon="save"
          title={t('saveLoad.overwriteTitle', { name: slotDisplayName(pending.slot) })}
          text={t('saveLoad.overwriteText')}
          confirmLabel={t('saveLoad.overwriteOk')}
          onCancel={() => setPending(null)}
          onConfirm={async () => {
            const s = pending.slot;
            setPending(null);
            await doSave(s.slotId, name.trim() || s.name);
          }}
        />
      ) : null}
      {pending?.kind === 'load' ? (
        <ConfirmDialog
          icon="load"
          title={t('saveLoad.loadConfirmTitle', { name: slotDisplayName(pending.slot) })}
          text={t('saveLoad.loadConfirmText')}
          confirmLabel={t('saveLoad.loadConfirmOk')}
          onCancel={() => setPending(null)}
          onConfirm={async () => {
            const s = pending.slot;
            setPending(null);
            await doLoad(s);
          }}
        />
      ) : null}
    </Modal>
  );
}
