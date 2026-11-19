/** Settings: Graphics, Audio, Gameplay, Controls, Accessibility, Help (report a bug, W-110). Every change applies immediately. */
import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_SETTINGS, type Settings } from '../../../game/contracts';
import type { GraphicsInfo } from '../../../render/contracts';
import type { AudioVolumes } from '../../../audio/contracts';
import { t } from '../../../i18n';
import { useGame } from '../../hooks';
import { Button } from '../../common/Button';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { Modal } from '../../common/Modal';
import { NeedBar } from '../../common/NeedBar';
import { ScrollArea } from '../../common/ScrollArea';
import { Segmented } from '../../common/Segmented';
import { Select } from '../../common/Select';
import { SettingRow, settingIds } from '../../common/SettingRow';
import { Slider } from '../../common/Slider';
import { TabPanel, Tabs } from '../../common/Tabs';
import { Toggle } from '../../common/Toggle';
import { Icon, type IconName } from '../../icons';
import { KeyMapTable } from '../KeyMapTable';
import { detectBrowserZoom, effectiveUiScale, touchFloorMatches } from '../../theme/scale';
import { openChildDialog } from '../nav';
import { ft } from '../../feedback/strings';
import { openFeedback } from '../../feedback/FeedbackLayer';
import { slt } from '../../feedback/sessionLogStrings';

/** Window size, refreshed on resize (for the "limited by this window" hint). */
function useViewport(): { w: number; h: number } {
  const read = () => ({ w: typeof window !== 'undefined' ? window.innerWidth : 1920, h: typeof window !== 'undefined' ? window.innerHeight : 1080 });
  const [vp, setVp] = useState(read);
  useEffect(() => {
    const on = () => setVp(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return vp;
}

export type SettingsTab = 'graphics' | 'audio' | 'gameplay' | 'controls' | 'accessibility' | 'help';
const TABS: { id: SettingsTab; icon: IconName }[] = [
  { id: 'graphics', icon: 'monitor' },
  { id: 'audio', icon: 'volume' },
  { id: 'gameplay', icon: 'dice' },
  { id: 'controls', icon: 'keyboard' },
  { id: 'accessibility', icon: 'accessibility' },
  { id: 'help', icon: 'help' },
];

const VOLUME_KEYS: (keyof AudioVolumes)[] = ['master', 'music', 'sfx', 'voice', 'ambient', 'ui'];
const PIXEL_RATIOS = [0, 1, 1.5, 2];
const AUTOSAVE = [0, 2, 5, 10, 15, 30];

/** Merge a volume change without dropping the other channels; clamps to 0..1 and survives garbage. */
export function mergeVolumes(current: Partial<AudioVolumes> | null | undefined, key: keyof AudioVolumes, value: number): AudioVolumes {
  const base = { ...DEFAULT_SETTINGS.volumes, ...(current ?? {}) };
  const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : base[key];
  return { ...base, [key]: v };
}

const QUALITY_OPTIONS = ['auto', 'low', 'medium', 'high', 'ultra'] as const;

/**
 * Live status under Render quality (W-039 / D-025): which level Auto runs at, and Ultra's internal resolution.
 * `g` is null while the renderer is not up (or in UI harness mocks).
 */
export function qualityStatus(s: Pick<Settings, 'quality'>, g: GraphicsInfo | null | undefined): string | null {
  if (s.quality === 'auto') {
    if (!g || !g.auto) return t('settings.quality.autoPending');
    const level = t(`settings.quality.${g.auto.level}`);
    return g.auto.phase === 'probe' ? t('settings.quality.autoProbing', { level }) : t('settings.quality.autoNow', { level });
  }
  if (s.quality === 'ultra' && g && g.level === 'ultra' && g.bufferWidth > 0 && g.bufferHeight > 0) {
    const p = { width: g.bufferWidth, height: g.bufferHeight };
    if (g.pixelRatioExplicit) return t('settings.quality.internalResExplicit', p);
    return t(g.supersampled ? 'settings.quality.internalResSuper' : 'settings.quality.internalRes', p);
  }
  return null;
}

export function SettingsDialog({ onClose, initialTab = 'graphics' }: { onClose: () => void; initialTab?: SettingsTab }) {
  const game = useGame();
  const s: Settings = game.settings;
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [confirmReset, setConfirmReset] = useState(false);
  const [slogCleared, setSlogCleared] = useState(false);
  const slog = game.sessionLog ?? null;
  // UI scale previews locally while dragging and applies on release: re-scaling the page mid-drag would move the
  // slider under the pointer (feedback loop). Keyboard steps apply on key-up.
  const [scaleDraft, setScaleDraft] = useState<number | null>(null);
  const vp = useViewport();
  const wantedScale = scaleDraft ?? s.uiScale;
  const win = typeof window !== 'undefined' ? window : null;
  const gotScale = effectiveUiScale(vp.w, vp.h, wantedScale, detectBrowserZoom(win), touchFloorMatches(win));
  const set = (patch: Partial<Settings>) => game.updateSettings(patch);
  const pct = (v: number) => (v <= 0.001 ? t('settings.volMuted') : `${Math.round(v * 100)}%`);
  const qStatus = qualityStatus(s, game.graphics);

  return (
    <Modal
      onClose={onClose}
      title={t('settings.title')}
      subtitle={t('settings.subtitle')}
      size="lg"
      tall
      bodyFlush
      tabs={
        <Tabs
          idBase="settings"
          ariaLabel={t('settings.title')}
          value={tab}
          onChange={(v) => setTab(v as SettingsTab)}
          items={TABS.map((x) => ({ id: x.id, icon: x.icon, label: t(`settings.tab.${x.id}`) }))}
          autoFocusSelected
        />
      }
      footer={
        <>
          <Button variant="ghost" icon="refresh" onClick={() => setConfirmReset(true)}>
            {t('settings.reset')}
          </Button>
          <span class="ui-modal__footer-spacer" />
          <Button variant="primary" onClick={onClose}>
            {t('common.done')}
          </Button>
        </>
      }
    >
      <ScrollArea class="sh-dialog-scroll">
        <TabPanel idBase="settings" value={tab} class="sh-settings">
          {tab === 'graphics' ? (
            <>
              <h3 class="ui-section-title">{t('settings.section.display')}</h3>
              <SettingRow
                id="set-quality"
                label={t('settings.quality')}
                description={
                  <>
                    {t('settings.qualityDesc')}
                    {qStatus ? (
                      <>
                        {' '}
                        <span class="sh-quality-status" data-testid="quality-status">
                          {qStatus}
                        </span>
                      </>
                    ) : null}
                  </>
                }
              >
                <Segmented
                  value={s.quality}
                  onChange={(v) => set({ quality: v })}
                  {...settingIds('set-quality')}
                  options={QUALITY_OPTIONS.map((q) => ({ value: q, label: t(`settings.quality.${q}`) }))}
                />
              </SettingRow>
              <SettingRow id="set-pr" label={t('settings.pixelRatio')} description={t('settings.pixelRatioDesc')}>
                <Select
                  value={PIXEL_RATIOS.includes(s.pixelRatio) ? s.pixelRatio : 0}
                  onChange={(v) => set({ pixelRatio: v })}
                  {...settingIds('set-pr')}
                  options={PIXEL_RATIOS.map((r) => ({ value: r, label: r === 0 ? t('settings.pixelRatio.auto') : t('settings.pixelRatio.value', { value: r }) }))}
                />
              </SettingRow>
              <h3 class="ui-section-title">{t('settings.section.performance')}</h3>
              <SettingRow id="set-fps" label={t('settings.showFps')} description={t('settings.showFpsDesc')} onLabelClick={() => set({ showFps: !s.showFps })}>
                <Toggle checked={s.showFps} onChange={(v) => set({ showFps: v })} {...settingIds('set-fps')} />
              </SettingRow>
            </>
          ) : null}

          {tab === 'audio' ? (
            <>
              <SettingRow id="set-muted" label={t('settings.muted')} description={t('settings.mutedDesc')} onLabelClick={() => set({ muted: !s.muted })}>
                <Toggle checked={s.muted === true} onChange={(v) => set({ muted: v })} {...settingIds('set-muted')} />
              </SettingRow>
              <SettingRow id="set-music" label={t('settings.music')} description={t('settings.musicDesc')} onLabelClick={() => set({ musicEnabled: !s.musicEnabled })}>
                <Toggle checked={s.musicEnabled === true} onChange={(v) => set({ musicEnabled: v })} {...settingIds('set-music')} />
              </SettingRow>
              <h3 class="ui-section-title">{t('settings.section.volume')}</h3>
              <div class="sh-volumes">
                {VOLUME_KEYS.map((k) => (
                  <div key={k} class={k === 'master' ? 'sh-volume sh-volume--master' : 'sh-volume'}>
                    <Icon name={k === 'master' ? 'volume' : k === 'music' ? 'music' : k === 'voice' ? 'voice' : k === 'ambient' ? 'moon' : k === 'ui' ? 'sparkle' : 'bell'} size="1.125rem" class="sh-volume__icon" />
                    <Slider
                      label={t(`settings.vol.${k}`)}
                      value={s.volumes?.[k] ?? DEFAULT_SETTINGS.volumes[k]}
                      min={0}
                      max={1}
                      step={0.01}
                      format={pct}
                      onChange={(v) => set({ volumes: mergeVolumes(s.volumes, k, v) })}
                      onCommit={() => game.playUi('uiToggle')}
                    />
                  </div>
                ))}
              </div>
              <SettingRow id="set-mute" label={t('settings.muteUnfocused')} description={t('settings.muteUnfocusedDesc')} onLabelClick={() => set({ muteWhenUnfocused: !s.muteWhenUnfocused })}>
                <Toggle checked={s.muteWhenUnfocused} onChange={(v) => set({ muteWhenUnfocused: v })} {...settingIds('set-mute')} />
              </SettingRow>
            </>
          ) : null}

          {tab === 'gameplay' ? (
            <>
              <h3 class="ui-section-title">{t('settings.section.zombies')}</h3>
              <SettingRow id="set-auto" label={t('settings.autonomy')} description={`${t('settings.autonomyDesc')} ${t(`settings.autonomy.${s.autonomy}.desc`)}`}>
                <Segmented
                  value={s.autonomy}
                  onChange={(v) => set({ autonomy: v })}
                  {...settingIds('set-auto')}
                  options={(['full', 'limited', 'off'] as const).map((a) => ({ value: a, label: t(`settings.autonomy.${a}`), tooltip: t(`settings.autonomy.${a}.desc`) }))}
                />
              </SettingRow>
              <SettingRow id="set-tut" label={t('settings.tutorial')} description={t('settings.tutorialDesc')} onLabelClick={() => set({ tutorialEnabled: !s.tutorialEnabled })}>
                <Toggle checked={s.tutorialEnabled} onChange={(v) => set({ tutorialEnabled: v })} {...settingIds('set-tut')} />
              </SettingRow>
              <SettingRow id="set-snap" label={t('settings.snapBuilding')} description={t('settings.snapBuildingDesc')} onLabelClick={() => set({ snapBuilding: !s.snapBuilding })}>
                <Toggle checked={s.snapBuilding} onChange={(v) => set({ snapBuilding: v })} {...settingIds('set-snap')} />
              </SettingRow>
              <h3 class="ui-section-title">{t('settings.section.behaviour')}</h3>
              <SettingRow id="set-ap" label={t('settings.autoPause')} description={t('settings.autoPauseDesc')} onLabelClick={() => set({ autoPauseOnEvents: !s.autoPauseOnEvents })}>
                <Toggle checked={s.autoPauseOnEvents} onChange={(v) => set({ autoPauseOnEvents: v })} {...settingIds('set-ap')} />
              </SettingRow>
              <SettingRow id="set-pu" label={t('settings.pauseUnfocused')} description={t('settings.pauseUnfocusedDesc')} onLabelClick={() => set({ pauseWhenUnfocused: !s.pauseWhenUnfocused })}>
                <Toggle checked={s.pauseWhenUnfocused} onChange={(v) => set({ pauseWhenUnfocused: v })} {...settingIds('set-pu')} />
              </SettingRow>
              <h3 class="ui-section-title">{t('settings.section.saving')}</h3>
              <SettingRow id="set-as" label={t('settings.autosave')} description={t('settings.autosaveDesc')}>
                <Select
                  value={AUTOSAVE.includes(s.autosaveMinutes) ? s.autosaveMinutes : 5}
                  onChange={(v) => set({ autosaveMinutes: v })}
                  {...settingIds('set-as')}
                  options={AUTOSAVE.map((m) => ({ value: m, label: m === 0 ? t('settings.autosave.off') : t('settings.autosave.every', { count: m }) }))}
                />
              </SettingRow>
            </>
          ) : null}

          {tab === 'controls' ? (
            <>
              <h3 class="ui-section-title">{t('settings.section.camera')}</h3>
              <div class="sh-settings__slider">
                <Slider
                  label={t('settings.cameraSpeed')}
                  value={s.cameraSpeed}
                  min={0.5}
                  max={2}
                  step={0.05}
                  format={(v) => `${v.toFixed(2)}×`}
                  minLabel={t('settings.cameraSpeedMin')}
                  maxLabel={t('settings.cameraSpeedMax')}
                  ticks={[1]}
                  onChange={(v) => set({ cameraSpeed: v })}
                />
              </div>
              <SettingRow id="set-iz" label={t('settings.invertZoom')} description={t('settings.invertZoomDesc')} onLabelClick={() => set({ invertZoom: !s.invertZoom })}>
                <Toggle checked={s.invertZoom} onChange={(v) => set({ invertZoom: v })} {...settingIds('set-iz')} />
              </SettingRow>
              <SettingRow id="set-es" label={t('settings.edgeScroll')} description={t('settings.edgeScrollDesc')} onLabelClick={() => set({ edgeScroll: !s.edgeScroll })}>
                <Toggle checked={s.edgeScroll} onChange={(v) => set({ edgeScroll: v })} {...settingIds('set-es')} />
              </SettingRow>
              <h3 class="ui-section-title">{t('settings.keybindings')}</h3>
              <p class="sh-hint">{t('settings.keybindingsDesc')}</p>
              <KeyMapTable columns={2} />
            </>
          ) : null}

          {tab === 'accessibility' ? (
            <>
              <h3 class="ui-section-title">{t('settings.section.readability')}</h3>
              <div class="sh-settings__slider">
                <Slider
                  label={t('settings.uiScale')}
                  value={scaleDraft ?? s.uiScale}
                  min={0.8}
                  max={1.4}
                  step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`}
                  minLabel="80%"
                  maxLabel="140%"
                  ticks={[1]}
                  onChange={setScaleDraft}
                  onCommit={(v) => {
                    setScaleDraft(null);
                    if (v !== s.uiScale) set({ uiScale: v });
                  }}
                />
                <p class="sh-hint">{t('settings.uiScaleDesc')}</p>
                {gotScale < wantedScale - 0.005 ? (
                  <p class="sh-hint sh-hint--warm" role="status">
                    <Icon name="info" size="0.875rem" />
                    {t('settings.uiScaleLimited', { pct: Math.round(gotScale * 100) })}
                  </p>
                ) : null}
              </div>
              <h3 class="ui-section-title">{t('settings.section.motion')}</h3>
              <SettingRow id="set-rm" label={t('settings.reduceMotion')} description={t('settings.reduceMotionDesc')} onLabelClick={() => set({ reduceMotion: !s.reduceMotion })}>
                <Toggle checked={s.reduceMotion} onChange={(v) => set({ reduceMotion: v })} {...settingIds('set-rm')} />
              </SettingRow>
              <SettingRow id="set-mini" label={t('settings.miniature')} description={t('settings.miniatureDesc')} onLabelClick={() => set({ miniatureFocus: !s.miniatureFocus })}>
                <Toggle checked={s.miniatureFocus} onChange={(v) => set({ miniatureFocus: v })} {...settingIds('set-mini')} />
              </SettingRow>
              <SettingRow id="set-cb" label={t('settings.colorblind')} description={t('settings.colorblindDesc')} onLabelClick={() => set({ colorblindNeeds: !s.colorblindNeeds })}>
                <Toggle checked={s.colorblindNeeds} onChange={(v) => set({ colorblindNeeds: v })} {...settingIds('set-cb')} />
              </SettingRow>
              <div class="sh-cb-preview" aria-label={t('settings.preview')}>
                <span class="u-eyebrow">{t('settings.preview')}</span>
                <div class="sh-cb-preview__bars">
                  <NeedBar label={t('need.hunger')} icon="hunger" value={12} trend={-6} colorblind={s.colorblindNeeds} />
                  <NeedBar label={t('need.social')} icon="social" value={52} trend={2} colorblind={s.colorblindNeeds} />
                  <NeedBar label={t('need.preservation')} icon="freshness" value={74} cap={86} trend={-1} colorblind={s.colorblindNeeds} />
                </div>
              </div>
            </>
          ) : null}

          {tab === 'help' ? (
            <>
              <h3 class="ui-section-title">{t('settings.tab.help')}</h3>
              <p class="sh-hint">{ft('subtitle')}</p>
              <div class="sh-settings__help">
                {game.feedback ? (
                  <Button variant="primary" icon="flag" hotkey="F8" onClick={() => openFeedback(game, 'settings')} data-testid="settings-feedback">
                    {ft('entry')}
                  </Button>
                ) : null}
                <Button variant="secondary" icon="help" onClick={() => openChildDialog(game, 'help')}>
                  {t('pause.help')}
                </Button>
                <Button variant="secondary" icon="log" onClick={() => openChildDialog(game, 'diagnostics')}>
                  {t('diag.title')}
                </Button>
              </div>
              {slog ? (
                <>
                  <SettingRow id="set-slog" label={slt('setting.label')} description={slog.teenOrAdult ? slt('setting.desc') : slt('setting.descKids')} onLabelClick={() => slog.setEnabled(!slog.enabled)}>
                    <Toggle checked={slog.enabled} onChange={(v) => slog.setEnabled(v)} {...settingIds('set-slog')} />
                  </SettingRow>
                  <div class="sh-settings__help">
                    <Button
                      variant="ghost"
                      icon="trash"
                      data-testid="session-log-clear"
                      onClick={async () => {
                        await slog.clear();
                        setSlogCleared(true);
                      }}
                    >
                      {slt('clear')}
                    </Button>
                    {slogCleared ? (
                      <span class="u-small u-accent" role="status">
                        {slt('cleared')}
                      </span>
                    ) : null}
                  </div>
                </>
              ) : null}
            </>
          ) : null}
        </TabPanel>
      </ScrollArea>
      {confirmReset ? (
        <ConfirmDialog
          danger
          icon="refresh"
          title={t('settings.resetConfirmTitle')}
          text={t('settings.resetConfirmText')}
          confirmLabel={t('settings.resetConfirmOk')}
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            game.resetSettings();
            setConfirmReset(false);
          }}
        />
      ) : null}
    </Modal>
  );
}
