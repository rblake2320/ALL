/** Create-a-Zombie tabs: Identity, Body, Hair, Outfit. */
import { useState } from 'preact/hooks';
import type { NewMemberSpec } from '../../../../sim/contracts';
import {
  ACCESSORIES,
  BOTTOM_STYLES,
  EYE_STYLES,
  HAIR_STYLES,
  SKIN_TONES,
  TOP_STYLES,
  type ZombieAppearance,
} from '../../../../shared/appearance';
import { t } from '../../../../i18n';
import { Icon } from '../../../icons';
import { IconButton } from '../../../common/IconButton';
import { Portrait } from '../../../common/Portrait';
import { SettingRow } from '../../../common/SettingRow';
import { Slider } from '../../../common/Slider';
import { SwatchPicker } from '../../../common/Swatch';
import { TextInput } from '../../../common/TextInput';
import { PresetNameField, useFreeTextNames } from '../../PresetNameField';
import { Toggle } from '../../../common/Toggle';
import { displayName } from '../../../common/format';
import { useUid } from '../../../common/uid';
import { eyeShapes, portraitDims, portraitPalette } from '../../../common/portraitParts';
import { CLOTHES_COLORS, EYE_COLORS, HAIR_COLORS, NAME_MAX, SHOE_COLORS, type AspirationInfo, type TraitInfo } from '../../data';
import type { CazIssue } from '../../cazIssues';
import { ChoiceGrid } from './ChoiceGrid';
import { CazBodyPicker } from './CazBodyPicker';
import { Button } from '../../../common/Button';
import { castBodyOf, lookOptionApplies } from '../../../common/castArt';
import { SCULPTED_BODIES, type CastBodyId } from '../../../../shared/cast';
import { isPremiumBodyId, type PremiumBodyId } from '../../../../shared/premiumBodies';
import { castThumbUrl } from '../../../common/castArt';
import { useEconomy } from '../../../store/useEconomy';

export interface MemberEditorProps {
  member: NewMemberSpec;
  index: number;
  householdName: string;
  update: (patch: Partial<NewMemberSpec>) => void;
  updateLook: (patch: Partial<ZombieAppearance>) => void;
  randomize: (what: 'all' | 'look' | 'traits' | 'name') => void;
  traits: TraitInfo[];
  aspirations: AspirationInfo[];
  /** Controller validation issues for this member. */
  issues: CazIssue[];
  /** Reveal inline errors (after a Start attempt). */
  showErrors: boolean;
  /** The locked premium body on the turntable as a preview (never part of the member), if any. */
  tryOn?: PremiumBodyId | null;
  setTryOn?: (v: PremiumBodyId | null) => void;
  /** Open the Body tab (the Identity tab's "browse all zombies" card). */
  openBodies?: () => void;
}

/** Palette with the current (possibly custom) colour appended so it stays selectable. */
function withCurrent(list: readonly { id: string; value: string }[], current: string | null | undefined) {
  const items = list.map((c) => ({ value: c.value, label: t(`color.${c.id}`) }));
  const cur = typeof current === 'string' ? current.toLowerCase() : null;
  if (cur && /^#[0-9a-f]{6}$/i.test(cur) && !items.some((i) => i.value.toLowerCase() === cur)) items.push({ value: cur, label: cur.toUpperCase() });
  return items;
}

/**
 * The zombie this member is, with a way to the full list: the body choice lives on its own tab, and a player who
 * never opened it never learned there are other zombies.
 */
function ZombieCard({ member, openBodies }: { member: NewMemberSpec; openBodies: () => void }) {
  const body = castBodyOf(member.appearance);
  const [broken, setBroken] = useState(false);
  return (
    <div class="sh-zcard" data-testid="caz-zombie-card">
      <span class="sh-zcard__art" aria-hidden="true">
        {body && !broken ? <img src={castThumbUrl(body)} alt="" width={96} height={96} decoding="async" draggable={false} onError={() => setBroken(true)} /> : <Portrait appearance={member.appearance} size="3.25rem" />}
      </span>
      <span class="sh-zcard__text">
        <span class="sh-zcard__name">
          {t('caz.zombieCard')}: {t(`cast.${body ?? 'classic'}`)}
        </span>
        <span class="sh-zcard__hint">{t('caz.zombieCardHint', { count: SCULPTED_BODIES.length + 1 })}</span>
      </span>
      <Button size="sm" variant="secondary" onClick={openBodies}>
        {t('caz.zombieCardBrowse')}
      </Button>
    </div>
  );
}

export function IdentityTab({ member, index, householdName, update, randomize, traits, aspirations, issues, showErrors, openBodies }: MemberEditorProps) {
  const [touched, setTouched] = useState(false);
  const freeText = useFreeTextNames();
  const first = member.firstName ?? '';
  const reveal = touched || showErrors;
  const firstIssue = issues.find((i) => i.field === 'firstName')?.message ?? (first.trim().length === 0 ? t('caz.nameRequired') : null);
  const lastIssue = issues.find((i) => i.field === 'lastName')?.message ?? null;
  const nameError = reveal ? firstIssue : null;
  const asp = aspirations.find((a) => a.id === member.aspiration) ?? null;
  const chosen = member.traits.map((id) => traits.find((x) => x.id === id)).filter((x): x is TraitInfo => !!x);
  return (
    <div class="sh-tab sh-tab--identity">
      <div class="sh-name-grid">
        {freeText ? null : (
          <>
            <PresetNameField label={t('caz.firstName')} kind="first" value={first} onChange={(v) => update({ firstName: v })} />
            <PresetNameField label={t('caz.lastName')} kind="last" value={member.lastName ?? ''} onChange={(v) => update({ lastName: v })} />
          </>
        )}
        {freeText ? <TextInput
          label={t('caz.firstName')}
          value={first}
          maxLength={NAME_MAX}
          placeholder={t('caz.firstNamePlaceholder')}
          error={nameError}
          onInput={(v) => update({ firstName: v })}
          onBlur={() => setTouched(true)}
          trailing={<IconButton icon="dice" size="sm" label={t('caz.randomNameTip')} onClick={() => randomize('name')} />}
        /> : null}
        {freeText ? <TextInput label={t('caz.lastName')} value={member.lastName ?? ''} maxLength={NAME_MAX} placeholder={t('caz.lastNamePlaceholder')} error={reveal ? lastIssue : null} onInput={(v) => update({ lastName: v })} /> : null}
      </div>
      <p class="sh-hint">{t('caz.identityHint')}</p>
      {openBodies ? <ZombieCard member={member} openBodies={openBodies} /> : null}
      <div class="sh-cert" aria-label={t('caz.certificate')}>
        <div class="sh-cert__border" aria-hidden="true" />
        <div class="sh-cert__eyebrow">{t('caz.certificate')}</div>
        <Portrait appearance={member.appearance} size="5.25rem" ring="#6e2a35" class="sh-cert__portrait" />
        <div class="sh-cert__name">{displayName(member.firstName, member.lastName)}</div>
        <div class="sh-cert__of">{householdName.trim() ? t('caz.certificateOf', { household: householdName.trim() }) : t('caz.certificateHouseholdless')}</div>
        <div class="sh-cert__traits">
          {chosen.length ? (
            chosen.map((tr) => (
              <span key={tr.id} class="sh-cert__trait">
                <Icon name={tr.icon} size="0.875rem" />
                {tr.name}
              </span>
            ))
          ) : (
            <span class="sh-cert__muted">{t('caz.noTraits')}</span>
          )}
        </div>
        <div class="sh-cert__asp">
          {asp ? (
            <>
              <Icon name={asp.icon} size="0.9375rem" />
              {asp.name}
            </>
          ) : (
            <span class="sh-cert__muted">{t('caz.noAspiration')}</span>
          )}
        </div>
        <svg class="sh-cert__seal" viewBox="0 0 40 40" aria-hidden="true">
          <path d="M20 2.5l3.4 3.1 4.5-.9 1.6 4.3 4.3 1.6-.9 4.5 3.1 3.4-3.1 3.4.9 4.5-4.3 1.6-1.6 4.3-4.5-.9L20 37.5l-3.4-3.1-4.5.9-1.6-4.3-4.3-1.6.9-4.5L4 20l3.1-3.4-.9-4.5 4.3-1.6 1.6-4.3 4.5.9z" fill="#7a2e3b" />
          <circle cx="20" cy="20" r="10.5" fill="#8c3644" stroke="#5a1d27" stroke-width="1.2" />
          <path d="M20 13.5v13M15 18h10" stroke="#e8c8b8" stroke-width="2" stroke-linecap="round" opacity="0.8" />
        </svg>
        <div class="sh-cert__no u-num">№ {String(index + 1).padStart(3, '0')}</div>
      </div>
    </div>
  );
}

function EyePreview({ app, style }: { app: ZombieAppearance; style: string }) {
  const d = portraitDims(app);
  const pal = portraitPalette(app);
  const e = eyeShapes(style, d);
  return (
    <svg viewBox={`34 ${d.cy - 7} 32 16`} width="3.25rem" height="1.625rem" aria-hidden="true">
      <rect x="34" y={d.cy - 7} width="32" height="16" rx="3" fill={pal.skin} />
      {e.sockets.map(([x, y, rx, ry], i) => (
        <ellipse key={`s${i}`} cx={x} cy={y} rx={rx} ry={ry} fill={pal.skinDeep} opacity="0.3" />
      ))}
      {e.whites.map(([x, y, rx, ry], i) => (
        <ellipse key={`w${i}`} cx={x} cy={y} rx={rx} ry={ry} fill="#efe8cf" />
      ))}
      {e.irises.map(([x, y, r], i) => (
        <circle key={`i${i}`} cx={x} cy={y} r={r} fill={e.whites.length ? pal.eye : '#22182a'} />
      ))}
      {e.pupils.map(([x, y, r], i) => (
        <circle key={`p${i}`} cx={x} cy={y} r={r} fill="#22182a" />
      ))}
      {e.lids.map((p, i) => (
        <path key={`l${i}`} d={p} fill={pal.skin} />
      ))}
      {e.lines.map((p, i) => (
        <path key={`ll${i}`} d={p} fill="none" stroke="#22182a" stroke-width="1" stroke-linecap="round" />
      ))}
    </svg>
  );
}

/** Inline issues for one field (shown after a refused Start). */
function FieldIssues({ issues, field, show }: { issues: CazIssue[]; field: CazIssue['field']; show: boolean }) {
  if (!show) return null;
  return (
    <>
      {issues
        .filter((i) => i.field === field)
        .map((i, k) => (
          <p key={k} class="sh-inline-issue" role="alert">
            <Icon name="warning" size="0.875rem" />
            {i.message}
          </p>
        ))}
    </>
  );
}

/** The procedural look of an appearance (no cast body): option previews must show the option, not the cast art. */
function classicLook(app: ZombieAppearance): ZombieAppearance {
  const out = { ...app };
  delete out.body;
  return out;
}

/** Why the options below are greyed out for a cast body, with a one-click way back to Classic. */
function CastLockNotice({ body, id, onClassic }: { body: CastBodyId; id: string; onClassic: () => void }) {
  return (
    <div class="sh-cast-lock" role="note">
      <Icon name="info" size="1rem" />
      <p id={id}>{t('caz.castLocked', { name: t(`cast.${body}`) })}</p>
      <Button size="sm" variant="ghost" onClick={onClassic}>
        {t('caz.castUseClassic')}
      </Button>
    </div>
  );
}

/**
 * Options that don't apply to a cast body: natively disabled (a disabled fieldset takes every control inside out
 * of the tab order and the accessibility tree's "enabled" state) and described by the lock notice.
 */
function Applies({ ok, noteId, children }: { ok: boolean; noteId: string; children: preact.ComponentChildren }) {
  if (ok) return <>{children}</>;
  return (
    <fieldset class="sh-na" disabled aria-describedby={noteId} title={t('caz.castLockedShort')}>
      {children}
    </fieldset>
  );
}

/** Shown while a locked premium body is on the turntable: says it is a preview and that nothing was changed. */
function TryOnNotice({ body, member, onStop }: { body: PremiumBodyId; member: NewMemberSpec; onStop: () => void }) {
  return (
    <div class="sh-cast-lock sh-tryon" role="status" aria-live="polite" data-testid="caz-tryon-notice">
      <Icon name="info" size="1rem" />
      <p>{t('caz.tryOnNotice', { name: t(`cast.${body}`), member: (member.firstName ?? '').trim() || t('caz.zombieCard') })}</p>
      <Button size="sm" variant="ghost" onClick={onStop}>
        {t('caz.tryOnStop')}
      </Button>
    </div>
  );
}

export function BodyTab({ member, updateLook, issues, showErrors, tryOn = null, setTryOn }: MemberEditorProps) {
  const economy = useEconomy();
  const app = member.appearance;
  const body = castBodyOf(app);
  const look = classicLook(app);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const noteId = 'caz-body-lock';
  const ok = (o: Parameters<typeof lookOptionApplies>[1]) => lookOptionApplies(body, o);
  return (
    <div class="sh-tab">
      <FieldIssues issues={issues} field="appearance" show={showErrors} />
      <h3 class="ui-section-title" id="caz-bodytype">
        {t('caz.bodyType')}
      </h3>
      <p class="sh-hint">{t('caz.bodyTypeHint')}</p>
      {tryOn && setTryOn ? <TryOnNotice body={tryOn} member={member} onStop={() => setTryOn(null)} /> : null}
      <CazBodyPicker
        labelledBy="caz-bodytype"
        value={body ?? 'classic'}
        economy={economy}
        tryOn={tryOn}
        onTryOn={setTryOn ? (v) => setTryOn(isPremiumBodyId(v) ? v : null) : undefined}
        onChange={(v) => {
          setTryOn?.(null);
          updateLook({ body: v });
        }}
      />
      {body ? <CastLockNotice body={body} id={noteId} onClassic={() => updateLook({ body: 'classic' })} /> : null}
      <Slider label={t('caz.height')} value={app.height} min={0} max={1} step={0.01} format={pct} minLabel={t('caz.heightMin')} maxLabel={t('caz.heightMax')} onChange={(v) => updateLook({ height: v })} />
      {body ? <p class="sh-hint sh-hint--tight">{t('caz.castHeightHint')}</p> : null}
      <Slider label={t('caz.build')} value={app.build} min={0} max={1} step={0.01} format={pct} minLabel={t('caz.buildMin')} maxLabel={t('caz.buildMax')} disabled={!ok('build')} onChange={(v) => updateLook({ build: v })} />
      <Applies ok={ok('skinTone')} noteId={noteId}>
        <h3 class="ui-section-title" id="caz-skin">
          {t('caz.skinTone')}
        </h3>
        <SwatchPicker
          labelledBy="caz-skin"
          size="lg"
          colors={SKIN_TONES.map((c, i) => ({ value: c, label: t(`caz.skin.${i}`) }))}
          value={SKIN_TONES[Math.min(SKIN_TONES.length - 1, Math.max(0, Math.floor(app.skinTone) || 0))]}
          onChange={(v) => updateLook({ skinTone: Math.max(0, SKIN_TONES.findIndex((c) => c.toLowerCase() === v.toLowerCase())) })}
        />
      </Applies>
      <Applies ok={ok('eyeStyle')} noteId={noteId}>
        <h3 class="ui-section-title" id="caz-eyes">
          {t('caz.eyes')}
        </h3>
        <ChoiceGrid
          labelledBy="caz-eyes"
          min="4.75rem"
          value={app.eyeStyle}
          onChange={(v) => updateLook({ eyeStyle: v })}
          items={EYE_STYLES.map((s) => ({ value: s, label: t(`caz.eye.${s}`), preview: <EyePreview app={look} style={s} /> }))}
        />
      </Applies>
      <Applies ok={ok('eyeColor')} noteId={noteId}>
        <h3 class="ui-section-title" id="caz-eyecolor">
          {t('caz.eyeColor')}
        </h3>
        <SwatchPicker labelledBy="caz-eyecolor" colors={withCurrent(EYE_COLORS, app.eyeColor)} value={app.eyeColor} onChange={(v) => updateLook({ eyeColor: v })} />
      </Applies>
      <Applies ok={ok('stitches')} noteId={noteId}>
        <SettingRow id="caz-stitches" label={t('caz.stitches')} description={t('caz.stitchesDesc')} onLabelClick={() => ok('stitches') && updateLook({ stitches: !app.stitches })}>
          <Toggle checked={app.stitches} disabled={!ok('stitches')} onChange={(v) => updateLook({ stitches: v })} labelledBy="caz-stitches-label" describedBy="caz-stitches-desc" />
        </SettingRow>
      </Applies>
    </div>
  );
}

export function HairTab({ member, updateLook }: MemberEditorProps) {
  const app = classicLook(member.appearance);
  const body = castBodyOf(member.appearance);
  const noteId = 'caz-hair-lock';
  return (
    <div class="sh-tab">
      {body ? <CastLockNotice body={body} id={noteId} onClassic={() => updateLook({ body: 'classic' })} /> : null}
      <Applies ok={lookOptionApplies(body, 'hair')} noteId={noteId}>
      <h3 class="ui-section-title" id="caz-hairstyle">
        {t('caz.hairStyle')}
      </h3>
      <ChoiceGrid
        labelledBy="caz-hairstyle"
        min="4.5rem"
        value={app.hairStyle}
        onChange={(v) => updateLook({ hairStyle: v })}
        items={HAIR_STYLES.map((s) => ({ value: s, label: t(`caz.hair.${s}`), preview: <Portrait appearance={{ ...app, hairStyle: s, accessory: 'none' }} size="3.25rem" ring={null} zoom={1.42} focusY={40} /> }))}
      />
      <h3 class="ui-section-title" id="caz-haircolor">
        {t('caz.hairColor')}
      </h3>
      <SwatchPicker labelledBy="caz-haircolor" colors={withCurrent(HAIR_COLORS, app.hairColor)} value={app.hairColor} onChange={(v) => updateLook({ hairColor: v })} />
      </Applies>
    </div>
  );
}

export function OutfitTab({ member, updateLook }: MemberEditorProps) {
  const app = classicLook(member.appearance);
  const body = castBodyOf(member.appearance);
  const noteId = 'caz-outfit-lock';
  return (
    <div class="sh-tab">
      {body ? <CastLockNotice body={body} id={noteId} onClassic={() => updateLook({ body: 'classic' })} /> : null}
      <Applies ok={lookOptionApplies(body, 'outfit')} noteId={noteId}>
      <h3 class="ui-section-title" id="caz-top">
        {t('caz.top')}
      </h3>
      <ChoiceGrid
        labelledBy="caz-top"
        min="4.5rem"
        value={app.topStyle}
        onChange={(v) => updateLook({ topStyle: v })}
        items={TOP_STYLES.map((s) => ({
          value: s,
          label: t(`caz.topStyle.${s}`),
          // Neckline crop: the bust zoomed onto chin, neck and shoulders so collars, hoods and lapels read.
          preview: <Portrait appearance={{ ...app, topStyle: s, accessory: 'none' }} size="3.25rem" ring={null} zoom={2.45} focusY={100} />,
        }))}
      />
      <SwatchPicker ariaLabel={t('caz.topColor')} colors={withCurrent(CLOTHES_COLORS, app.topColor)} value={app.topColor} onChange={(v) => updateLook({ topColor: v })} class="sh-swatch-row" />
      <h3 class="ui-section-title" id="caz-bottom">
        {t('caz.bottom')}
      </h3>
      <ChoiceGrid
        labelledBy="caz-bottom"
        min="5rem"
        value={app.bottomStyle}
        onChange={(v) => updateLook({ bottomStyle: v })}
        items={BOTTOM_STYLES.map((s) => ({ value: s, label: t(`caz.bottomStyle.${s}`), preview: <BottomGlyph style={s} color={app.bottomColor} /> }))}
      />
      {app.topStyle === 'dress' ? <p class="sh-hint">{t('caz.bottomHiddenByDress')}</p> : null}
      <SwatchPicker ariaLabel={t('caz.bottomColor')} colors={withCurrent(CLOTHES_COLORS, app.bottomColor)} value={app.bottomColor} onChange={(v) => updateLook({ bottomColor: v })} class="sh-swatch-row" />
      <h3 class="ui-section-title" id="caz-shoes">
        {t('caz.shoes')}
      </h3>
      <SwatchPicker labelledBy="caz-shoes" colors={withCurrent(SHOE_COLORS, app.shoeColor)} value={app.shoeColor} onChange={(v) => updateLook({ shoeColor: v })} />
      <h3 class="ui-section-title" id="caz-acc">
        {t('caz.accessory')}
      </h3>
      <ChoiceGrid
        labelledBy="caz-acc"
        min="4.5rem"
        value={app.accessory}
        onChange={(v) => updateLook({ accessory: v })}
        items={ACCESSORIES.map((s) => ({ value: s, label: t(`caz.acc.${s}`), preview: <Portrait appearance={{ ...app, accessory: s }} size="3.25rem" ring={null} zoom={1.3} focusY={46} /> }))}
      />
      </Applies>
    </div>
  );
}

/** Garment silhouette in the chosen colour; a bone rim + soft highlight keep dark colours readable on dark tiles. */
function BottomGlyph({ style, color }: { style: string; color: string }) {
  const sheen = `${useUid('garment')}-sheen`;
  const c = /^#[0-9a-f]{6}$/i.test(color) ? color : '#3a3f55';
  const body =
    style === 'skirt'
      ? 'M12.5 6.5h15l5.5 19.5Q20 28.5 7 26z'
      : style === 'shorts'
        ? 'M12.5 6.5h15l2 13.5h-8L20 12.5 18.5 20h-8z'
        : 'M12.5 6.5h15l1.5 23.5h-7L20 13l-2 17h-7z';
  return (
    <svg class="sh-garment" viewBox="0 0 40 32" width="2.75rem" height="2.2rem" aria-hidden="true">
      <path d={body} fill={c} stroke="#e8e0c8" stroke-opacity="0.42" stroke-width="1.1" stroke-linejoin="round" />
      <rect x="12" y="2.5" width="16" height="4.25" rx="1.3" fill={c} stroke="#e8e0c8" stroke-opacity="0.42" stroke-width="1.1" />
      <path d="M13.5 4.6h13" stroke="#000" stroke-opacity="0.28" stroke-width="0.9" stroke-dasharray="1.6 1.4" />
      <path d={body} fill={`url(#${sheen})`} stroke="none" />
      <defs>
        <linearGradient id={sheen} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#fff" stop-opacity="0.16" />
          <stop offset="0.45" stop-color="#fff" stop-opacity="0" />
          <stop offset="1" stop-color="#000" stop-opacity="0.18" />
        </linearGradient>
      </defs>
    </svg>
  );
}
