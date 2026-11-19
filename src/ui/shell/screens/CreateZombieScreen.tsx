/**
 * Create-a-Zombie. Left: household (name + 1–4 member portraits). Centre: turntable preview (game.createCazPreview).
 * Right: binder-tab editor (Identity, Body, Hair, Outfit, Personality, Voice) with validation + Start.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ZombieAppearance } from '../../../shared/appearance';
import type { NewMemberSpec } from '../../../sim/contracts';
import { t } from '../../../i18n';
import { useGame, useHotkey } from '../../hooks';
import { Icon, type IconName } from '../../icons';
import { Badge } from '../../common/Badge';
import { Button } from '../../common/Button';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { IconButton } from '../../common/IconButton';
import { Portrait } from '../../common/Portrait';
import { ScrollArea } from '../../common/ScrollArea';
import { Spinner } from '../../common/Spinner';
import { TabPanel, Tabs } from '../../common/Tabs';
import { TextInput } from '../../common/TextInput';
import { Tooltip } from '../../common/Tooltip';
import { Truncate } from '../../common/Truncate';
import { cx } from '../../common/cx';
import { displayName, formatMoney } from '../../common/format';
import { aspirationList, HOUSEHOLD_NAME_MAX, lotInfo, MAX_MEMBERS, startingFunds, traitList } from '../data';
import { collectCazIssues, firstIssue, generalHouseholdIssues, tabForField } from '../cazIssues';
import { CazStage } from './caz/CazStage';
import { BodyTab, HairTab, IdentityTab, OutfitTab, type MemberEditorProps } from './caz/CazLookTabs';
import { PersonalityTab } from './caz/CazPersonality';
import { VoiceTab } from './caz/CazVoice';
import { PresetNameField, useFreeTextNames } from '../PresetNameField';

type TabId = 'identity' | 'body' | 'hair' | 'outfit' | 'personality' | 'voice';
const TABS: { id: TabId; icon: IconName }[] = [
  { id: 'identity', icon: 'edit' },
  { id: 'body', icon: 'user' },
  { id: 'hair', icon: 'sparkle' },
  { id: 'outfit', icon: 'buy' },
  { id: 'personality', icon: 'mood' },
  { id: 'voice', icon: 'voice' },
];


export function CreateZombieScreen() {
  const game = useGame();
  const freeTextNames = useFreeTextNames(); // under-13 / unanswered: preset names (D-3)
  const caz = game.caz;
  const [tab, setTab] = useState<TabId>('identity');
  const [removeIdx, setRemoveIdx] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [nameTouched, setNameTouched] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const content = game.content ?? game.sim?.content ?? null;
  const traits = useMemo(() => traitList(content), [content]);
  const aspirations = useMemo(() => aspirationList(content), [content]);

  useEffect(() => {
    if (!game.caz) game.beginNewGame();
  }, []);
  useHotkey('Escape', () => game.goto('newGame'), { enabled: game.dialog === null && removeIdx === null && !starting, capture: true });

  if (!caz || !Array.isArray(caz.members) || caz.members.length === 0) {
    return (
      <div class="sh-screen sh-caz sh-caz--loading ui-interactive">
        <Spinner size="2rem" label={t('caz.loadingCaz')} />
        <p class="u-muted">{t('caz.loadingCaz')}</p>
      </div>
    );
  }

  const members = caz.members;
  const active = Math.min(members.length - 1, Math.max(0, Math.floor(caz.activeIndex) || 0));
  const member = members[active];
  const issues = collectCazIssues(game);
  const errors = issues.all;
  const householdIssue = issues.household.find((i) => i.field === 'householdName')?.message ?? (!caz.householdName.trim() ? t('caz.householdNameError') : null);
  const householdError = nameTouched || showErrors ? householdIssue : null;
  const generalIssues = showErrors ? generalHouseholdIssues(issues) : [];

  const update = (patch: Partial<NewMemberSpec>) => game.updateCazMember(active, patch);
  const updateLook = (patch: Partial<ZombieAppearance>) => game.updateCazMember(active, { appearance: { ...member.appearance, ...patch } });
  const randomize = (what: 'all' | 'look' | 'traits' | 'name') => game.randomizeCazMember(active, what);
  const editorProps: MemberEditorProps = {
    member,
    index: active,
    householdName: caz.householdName,
    update,
    updateLook,
    randomize,
    traits,
    aspirations,
    issues: issues.byMember[active] ?? [],
    showErrors,
  };

  const start = async () => {
    if (starting) return;
    setStartError(null);
    const now = collectCazIssues(game);
    if (now.all.length > 0) {
      // Don't dead-end on a disabled button: reveal inline errors and jump to the first problem.
      setShowErrors(true);
      const first = firstIssue(now);
      if (first?.memberIndex !== null && first?.memberIndex !== undefined && first.memberIndex !== active && first.memberIndex < members.length) game.updateCaz({ activeIndex: first.memberIndex });
      const fixTab = first && first.memberIndex !== null ? tabForField(first.field) : null;
      if (fixTab) setTab(fixTab);
      if (first?.field === 'householdName') document.getElementById('caz-household-name')?.focus();
      const chip = document.querySelector<HTMLElement>('.sh-status--warn');
      if (chip) {
        chip.classList.remove('is-refused');
        void chip.offsetWidth;
        chip.classList.add('is-refused');
      }
      return;
    }
    setStarting(true);
    try {
      await game.startGame();
    } catch (err) {
      setStartError(t('caz.startFailed', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setStarting(false);
    }
  };

  const removing = removeIdx !== null ? members[removeIdx] : null;

  return (
    <div class="sh-screen sh-caz ui-interactive">
      <header class="sh-caz__top">
        <Button variant="ghost" icon="chevronLeft" onClick={() => game.goto('newGame')} hotkey="Escape">
          {t('caz.back')}
        </Button>
        <div class="sh-caz__heading">
          <div class="u-eyebrow">{t('caz.eyebrow')}</div>
          <h1 class="sh-caz__title">{t('caz.title')}</h1>
        </div>
        <div class="sh-caz__summary">
          <Badge tone="neutral" icon={caz.lotTemplate === 'empty' ? 'plot' : 'house'}>
            {t('caz.lotSummary', { lot: lotInfo(caz.lotTemplate, game.lotTemplates).name ?? t(`newGame.lot.${caz.lotTemplate}.name`), difficulty: t(`newGame.difficulty.${caz.difficulty}`) })}
          </Badge>
        </div>
      </header>

      <aside class="sh-caz__household ui-panel" aria-label={t('caz.household')}>
        <div class="sh-caz__section">
          {freeTextNames ? (
            <TextInput
              label={t('caz.householdName')}
              value={caz.householdName}
              maxLength={HOUSEHOLD_NAME_MAX}
              placeholder={t('caz.householdNamePlaceholder')}
              error={householdError}
              id="caz-household-name"
              icon="house"
              onInput={(v) => game.updateCaz({ householdName: v })}
              onBlur={() => setNameTouched(true)}
            />
          ) : (
            <PresetNameField label={t('caz.householdName')} kind="household" id="caz-household-name" value={caz.householdName} onChange={(v) => game.updateCaz({ householdName: v })} />
          )}
        </div>
        <div class="sh-caz__members-head">
          <span class="ui-section-title" id="caz-members">
            {t('caz.membersLabel')}
          </span>
          {generalIssues.map((msg, k) => (
            <p key={k} class="sh-inline-issue sh-inline-issue--household" role="alert">
              <Icon name="warning" size="0.875rem" />
              {msg}
            </p>
          ))}
        </div>
        <ScrollArea class="sh-caz__members">
          <ul class="sh-members" aria-labelledby="caz-members">
            {members.map((m, i) => {
              const name = displayName(m.firstName, m.lastName);
              const isActive = i === active;
              const tr = (m.traits ?? []).map((id) => traits.find((x) => x.id === id)).filter(Boolean);
              const memberIssues = issues.byMember[i] ?? [];
              const incomplete = issues.detailed ? memberIssues.length > 0 : !m.firstName?.trim() || (m.traits?.length ?? 0) !== 3 || !m.aspiration;
              return (
                <li key={i} class={cx('sh-member', isActive && 'is-active')}>
                  <button type="button" class="sh-member__btn" aria-pressed={isActive ? 'true' : 'false'} onClick={() => game.updateCaz({ activeIndex: i })}>
                    <span class="sh-member__portrait">
                      <Portrait appearance={m.appearance} size="3.25rem" ring={isActive ? '#9fe870' : 'rgba(232,224,200,0.28)'} />
                      {incomplete ? <Badge dot tone="warm" label={memberIssues.length ? memberIssues.map((x) => x.message).join(' ') : t('caz.memberIncomplete', { name })} class="sh-member__dot" /> : null}
                    </span>
                    <span class="sh-member__text">
                      <Truncate text={name} class="sh-member__name" />
                      <span class="sh-member__traits">
                        {tr.length ? tr.map((x) => <Icon key={x!.id} name={x!.icon} size="0.8125rem" title={x!.name} />) : <span class="u-faint">{t('caz.noTraits')}</span>}
                      </span>
                    </span>
                  </button>
                  {members.length > 1 ? (
                    <IconButton class="sh-member__remove" icon="trash" size="xs" variant="danger" label={t('caz.removeMember', { name })} onClick={() => setRemoveIdx(i)} />
                  ) : null}
                </li>
              );
            })}
          </ul>
          {members.length < MAX_MEMBERS ? (
            <button type="button" class="sh-member-add" onClick={() => game.addCazMember()}>
              <span class="sh-member-add__plus" aria-hidden="true">
                <Icon name="plus" size="1.125rem" />
              </span>
              <span class="sh-member-add__text">
                <span>{t('caz.addMember')}</span>
                <span class="sh-member-add__hint">{t('caz.addMemberHint', { max: MAX_MEMBERS })}</span>
              </span>
            </button>
          ) : (
            <p class="sh-hint sh-member-full">{t('caz.fullHousehold', { max: MAX_MEMBERS })}</p>
          )}
        </ScrollArea>
        <div class="sh-caz__funds">
          <span class="u-muted">{t('caz.fundsPreview')}</span>
          <span class="sh-caz__fundsvalue u-num">{formatMoney(startingFunds(caz.lotTemplate, members.length, lotInfo(caz.lotTemplate, game.lotTemplates).startingFunds))}</span>
        </div>
      </aside>

      <main class="sh-caz__stage">
        <div class="sh-random" role="group" aria-label={t('caz.randomize')}>
          <span class="sh-random__label" aria-hidden="true">
            <Icon name="dice" size="1rem" />
            <span class="sh-random__word">{t('caz.randomize')}</span>
          </span>
          {(['look', 'traits', 'name', 'all'] as const).map((w) => (
            <Tooltip key={w} content={t(`caz.random.${w}Tip`)}>
              <Button size="sm" variant={w === 'all' ? 'secondary' : 'ghost'} onClick={() => randomize(w)}>
                {t(`caz.random.${w}`)}
              </Button>
            </Tooltip>
          ))}
        </div>
        <CazStage appearance={member.appearance} memberKey={active} />
      </main>

      <section class="sh-caz__editor ui-panel" aria-label={t('caz.editor')}>
        <div class="sh-editor">
          <Tabs
            idBase="caz"
            ariaLabel={t('caz.editor')}
            orientation="vertical"
            value={tab}
            onChange={(v) => setTab(v as TabId)}
            items={TABS.map((tb) => ({
              id: tb.id,
              icon: tb.icon,
              label: t(`caz.tab.${tb.id}`),
              badge: tb.id === 'personality' && (member.traits?.length ?? 0) < 3 ? <Badge dot tone="warm" label={t('caz.traitsCount', { count: member.traits?.length ?? 0 })} /> : undefined,
            }))}
            class="sh-editor__tabs"
          />
          <ScrollArea class="sh-editor__body">
            <TabPanel idBase="caz" value={tab}>
              {tab === 'identity' ? <IdentityTab {...editorProps} /> : null}
              {tab === 'body' ? <BodyTab {...editorProps} /> : null}
              {tab === 'hair' ? <HairTab {...editorProps} /> : null}
              {tab === 'outfit' ? <OutfitTab {...editorProps} /> : null}
              {tab === 'personality' ? <PersonalityTab {...editorProps} /> : null}
              {tab === 'voice' ? <VoiceTab {...editorProps} /> : null}
            </TabPanel>
          </ScrollArea>
        </div>
        <footer class="sh-editor__foot">
          {/* W-118: the compact (phone) layout shows the funds in this sticky footer; hidden on desktop, where the
              household column shows them */}
          <div class="sh-editor__funds" aria-hidden="true">
            <span class="u-muted">{t('caz.fundsPreview')}</span>
            <span class="sh-caz__fundsvalue u-num">{formatMoney(startingFunds(caz.lotTemplate, members.length, lotInfo(caz.lotTemplate, game.lotTemplates).startingFunds))}</span>
          </div>
          <div class="sh-editor__status" aria-live="polite">
            {startError ? (
              <span class="sh-status sh-status--bad" role="alert">
                <Icon name="warning" size="1rem" />
                {startError}
              </span>
            ) : errors.length > 0 ? (
              <Tooltip
                content={t('caz.issuesTitle')}
                description={
                  <ul class="sh-issues">
                    {errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                }
                placement="top"
              >
                <button type="button" class="sh-status sh-status--warn" id="caz-issues-count" onClick={() => setShowErrors(true)}>
                  <Icon name="warning" size="1rem" />
                  {t('caz.issues', { count: errors.length })}
                </button>
              </Tooltip>
            ) : (
              <span class="sh-status sh-status--ok">
                <Icon name="check" size="1rem" />
                {t('caz.ready')}
              </span>
            )}
          </div>
          <Button variant="primary" size="lg" icon="coffin" onClick={start} loading={starting} aria-describedby={errors.length ? 'caz-issues-count' : undefined} class={errors.length ? 'sh-editor__start is-blocked' : 'sh-editor__start'}>
            {starting ? t('caz.starting') : t('caz.start')}
          </Button>
        </footer>
      </section>

      {removing ? (
        <ConfirmDialog
          danger
          icon="trash"
          title={t('caz.removeConfirmTitle', { name: displayName(removing.firstName, removing.lastName) })}
          text={t('caz.removeConfirmText')}
          confirmLabel={t('caz.removeConfirmOk')}
          onCancel={() => setRemoveIdx(null)}
          onConfirm={() => {
            const i = removeIdx;
            setRemoveIdx(null);
            if (i !== null) game.removeCazMember(i);
          }}
        />
      ) : null}
    </div>
  );
}
