/**
 * Household ledger: rename, funds / lot value / outstanding, bills list with how-to-pay + mailbox locator,
 * utilities status, member summary, and the free-will (autonomy) setting.
 */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { GameController } from '../../../game/contracts';
import { formatMoney, num } from '../lib/format';
import { renameHousehold } from '../lib/commands';
import { safe } from '../lib/safe';
import { HOUSEHOLD_NAME_MAX, validateHouseholdName } from '../lib/validation';
import { PresetNameField, useFreeTextNames } from '../../shell/PresetNameField';
import { Button, IconButton, ProgressBar, Segmented } from '../parts/controls';
import { HudDialog } from '../parts/Dialog';
import { useGame } from '../parts/hooks';
import { Icon } from '../parts/icons';
import { Portrait } from '../parts/Portrait';
import { tip } from '../parts/tooltip';
import { ht } from '../strings';
import { memberState } from '../household/HouseholdBar';
import { MOOD_ICON } from '../agent/AgentPanel';
import './dialogs.css';
import { hearthView } from '../../../game/homeView';
import { PET_VARIANTS_LIVE, petVariantId } from '../../../economy/catalog';
import { autoBuySetting, autoSpentToday, DEFAULT_AUTO_BUY_CAP } from '../../../shared/autoBuy';

type Autonomy = 'full' | 'limited' | 'off';
type AutoBuyMode = 'off' | 'cap' | 'unlimited';
/** Daily allowance presets offered in the household ledger (W-116). */
export const AUTO_BUY_CAPS = [25, 50, 100, 200] as const;

function findMailbox(game: GameController): string | null {
  const objs = safe('household.objects', () => Object.values(game.sim?.state.objects ?? {}), []);
  const mb = objs.find((o) => o && typeof o.defId === 'string' && (o.defId === 'mailbox_crooked' || o.defId.includes('mailbox')));
  return mb?.id ?? null;
}

export function HouseholdDialog() {
  const game = useGame();
  const sim = game.sim;
  const hh = sim?.state.household;
  const bills = safe('household.bills', () => sim?.bills() ?? null, null);
  const lotValue = safe('household.lotValue', () => sim?.lotValue() ?? 0, 0);
  const members = safe('household.members', () => sim?.household() ?? [], []).filter((m) => m.presence !== 'gone');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(hh?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const freeText = useFreeTextNames(); // child / unanswered profile: preset household names (D-3)
  const close = () => {
    game.closeDialog();
    game.playUi('uiClose');
  };
  const unpaid = (bills?.bills ?? []).filter((b) => b && !b.paid);
  const outstanding = unpaid.reduce((s, b) => s + num(b.amount), 0) || num(bills?.outstanding);
  const overdue = unpaid.filter((b) => b.overdue);
  const power = bills?.utilitiesOn !== false && hh?.utilitiesOn !== false;
  const mailbox = findMailbox(game);
  // Entering edit mode focuses the field; leaving it (save / cancel / Esc) puts focus back on the pencil, right after
  // the DOM commit, so keyboard focus never drops to <body> (where the next Esc would mean something else).
  const editToggled = useRef(false);
  useLayoutEffect(() => {
    if (!editToggled.current) return;
    editToggled.current = false;
    document.getElementById(editing ? 'hud-rename-input' : 'hud-rename-btn')?.focus();
  }, [editing]);
  const startEdit = () => {
    setDraft(hh?.name ?? '');
    editToggled.current = true;
    setEditing(true);
  };
  const endEdit = () => {
    editToggled.current = true;
    setEditing(false);
    setError(null);
  };
  const save = () => {
    const v = validateHouseholdName(draft);
    if (!v.ok) {
      setError(v.error === 'tooLong' ? ht('household.rename.tooLong', { max: HOUSEHOLD_NAME_MAX }) : v.error === 'noLetters' ? ht('household.rename.noLetters') : ht('household.rename.empty'));
      return;
    }
    const r = renameHousehold(game, v.value);
    if (r.ok) endEdit();
    else setError(r.reason ?? ht('household.rename.empty'));
  };
  const autonomy = (game.settings?.autonomy ?? 'full') as Autonomy;
  return (
    <HudDialog
      id="household"
      icon="house"
      size="lg"
      onClose={close}
      eyebrow={ht('household.title')}
      initialFocus="hud-rename-btn"
      title={
        editing ? (
          hh?.name ?? '—'
        ) : (
          <span class="hud-hhname">
            <span class="u-ellipsis">{hh?.name ?? '—'}</span>
            <IconButton id="hud-rename-btn" icon="edit" size="sm" label={ht('household.rename')} onClick={startEdit} />
          </span>
        )
      }
      titleEditor={
        editing ? (
          <div class="hud-rename">
            {freeText ? (
              <span class={`ui-input-wrap hud-rename__input${error ? ' has-error' : ''}`}>
                <input
                  id="hud-rename-input"
                  class="ui-input"
                  value={draft}
                  maxLength={HOUSEHOLD_NAME_MAX + 8}
                  autoComplete="off"
                  spellcheck={false}
                  aria-label={ht('household.name')}
                  aria-invalid={error ? 'true' : undefined}
                  aria-describedby={error ? 'hud-rename-error hud-rename-count' : 'hud-rename-count'}
                  data-esc-local=""
                  onInput={(e) => {
                    setDraft((e.currentTarget as HTMLInputElement).value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') save();
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      endEdit();
                    }
                  }}
                />
                <span id="hud-rename-count" class={`hud-rename__count u-num${Array.from(draft.trim()).length > HOUSEHOLD_NAME_MAX ? ' is-over' : ''}`}>
                  {Array.from(draft.trim()).length}/{HOUSEHOLD_NAME_MAX}
                </span>
              </span>
            ) : (
              // Child / unanswered profile: pick from the preset list, never type (D-3; the game layer enforces it too).
              <div
                class="hud-rename__input"
                data-esc-local=""
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return;
                  e.stopPropagation();
                  e.preventDefault();
                  endEdit();
                }}
              >
                <PresetNameField label={ht('household.name')} kind="household" id="hud-rename-input" value={draft} onChange={(v) => { setDraft(v); setError(null); }} />
              </div>
            )}
            <Button size="sm" variant="primary" icon="check" label={ht('household.rename.save')} onClick={save} />
            <Button size="sm" variant="ghost" label={ht('household.rename.cancel')} onClick={endEdit} />
          </div>
        ) : undefined
      }
      subtitle={error ? <span id="hud-rename-error" class="hud-rename__error" role="alert"><Icon name="warning" size="0.875rem" /> {error}</span> : undefined}
    >
      <div class="hud-ledger">
        <div class="hud-ledger__stats">
          <Stat icon="money" label={ht('household.funds')} value={formatMoney(hh?.funds ?? 0)} tone="money" />
          <Stat icon="house" label={ht('household.lotValue')} value={formatMoney(lotValue)} />
          <Stat icon="bills" label={ht('household.outstanding')} value={formatMoney(outstanding)} tone={overdue.length ? 'bad' : outstanding > 0 ? 'warm' : undefined} />
        </div>
        <div class="hud-ledger__cols">
          <section class="hud-ledger__section">
            <h3 class="hud-ledger__h u-caps">{ht('household.bills')}</h3>
            {(bills?.bills ?? []).length === 0 ? (
              <p class="hud-empty-line">{ht('household.bills.none')}</p>
            ) : (
              <ul class="hud-bills-list">
                {(bills?.bills ?? []).map((b) => (
                  <li key={b.id} class={`hud-billrow${b.paid ? ' is-paid' : b.overdue ? ' is-overdue' : ''}`}>
                    <Icon name={b.paid ? 'check' : b.overdue ? 'warning' : 'mail'} size="1rem" />
                    <span class="hud-billrow__due">{b.paid ? ht('household.bills.paid') : b.overdue ? ht('household.bills.overdue') : ht('household.bills.due', { when: b.dueLabel })}</span>
                    {b.overdue && !b.paid && <span class="hud-billrow__when">{b.dueLabel}</span>}
                    <span class="hud-billrow__amt u-num">{formatMoney(b.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div class={`hud-utilities${power ? '' : ' is-off'}`}>
              <Icon name={power ? 'plug' : 'plugOff'} size="1.125rem" />
              <div>
                <div class="hud-utilities__h">{ht('household.utilities')}</div>
                <div class="hud-utilities__t">{power ? ht('household.utilities.on') : ht('household.utilities.off')}</div>
              </div>
            </div>
            <p class="hud-ledger__pay">
              <Icon name="info" size="0.9375rem" />
              <span>
                {ht('household.bills.pay')} {overdue.length > 0 ? ht('household.bills.repo') : ''}
              </span>
            </p>
            {mailbox && unpaid.length > 0 && (
              <Button
                size="sm"
                icon="target"
                label={ht('household.bills.locate')}
                onClick={() => {
                  try {
                    game.focusObject(mailbox);
                  } catch {
                    /* camera not ready */
                  }
                  game.closeDialog();
                }}
              />
            )}
          </section>
          <section class="hud-ledger__section">
            <h3 class="hud-ledger__h u-caps">{ht('household.members')}</h3>
            <ul class="hud-members">
              {members.map((m) => {
                const st = memberState(game, m);
                const career = safe('household.career', () => sim?.career(m.id) ?? null, null);
                const ag = safe('household.agent', () => sim?.agent(m.id), undefined);
                const vit = num(ag?.vitality, 100);
                return (
                  <li key={m.id} class="hud-memrow">
                    <Portrait size="2.5rem" appearance={m.appearance} band={m.moodBand} dimmed={st === 'crumbled' || st === 'atWork'} />
                    <div class="hud-memrow__main">
                      <div class="hud-memrow__top">
                        <span class="hud-memrow__name u-ellipsis" {...(m.name.length > 26 ? tip({ title: m.name }) : {})}>
                          {m.name}
                        </span>
                        <span class={`hud-moodchip is-${m.moodBand} is-mini`}>
                          <Icon name={MOOD_ICON[m.moodBand] ?? 'moodFine'} size="0.8125rem" />
                        </span>
                      </div>
                      <div class="hud-memrow__sub u-ellipsis">{st === 'crumbled' ? ht('hh.crumbled') : st === 'atWork' ? ht('hh.atWork') : career?.title ?? ht('info.unemployed')}</div>
                      <div class="hud-memrow__vit" {...tip({ title: `${ht('info.vitality')} ${Math.round(vit)}`, body: ht('info.vitality.body') })} tabIndex={0}>
                        <Icon name="hourglass" size="0.6875rem" />
                        <ProgressBar value={vit / 100} tone="cryo" size="sm" label={ht('info.vitality')} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <h3 class="hud-ledger__h u-caps">{ht('household.autonomy')}</h3>
            <Segmented<Autonomy>
              label={ht('household.autonomy')}
              value={autonomy}
              block
              onChange={(v) => {
                game.updateSettings({ autonomy: v });
                game.playUi('uiToggle');
              }}
              options={(['full', 'limited', 'off'] as Autonomy[]).map((v) => ({
                value: v,
                label: ht(`household.autonomy.${v}`),
                tipSpec: { title: ht(`household.autonomy.${v}`), body: ht(`household.autonomy.${v}.body`) },
              }))}
            />
            <p class="hud-ledger__hint">{ht(`household.autonomy.${autonomy}.body`)}</p>
            <AutoPurchases game={game} />
            <PetsSection game={game} />
            <HomeBonusSection game={game} />
          </section>
        </div>
      </div>
    </HudDialog>
  );
}

/** What the home gives the household's life right now: furniture set bonuses and Hearth wards (home-build-system.md section 3). Hidden when there is none. */
function HomeBonusSection({ game }: { game: GameController }) {
  const w = game.sim?.state;
  const v = w ? safe('household.homeBonus', () => hearthView(w), null) : null;
  if (!v || (v.bonuses.length === 0 && v.sets.length === 0)) return null;
  return (
    <div class="hud-home" data-testid="household-home-bonuses">
      <h3 class="hud-ledger__h u-caps">{ht('home.bonuses')}</h3>
      {v.bonuses.length === 0 ? (
        <p class="hud-ledger__hint">{v.live ? ht('home.bonuses.none') : ht('home.bonuses.inactive')}</p>
      ) : (
        <ul class="hud-home__bonuses" data-home-bonuses>
          {v.bonuses.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {v.sets.length > 0 && (
        <ul class="hud-home__sets">
          {v.sets.map((s) => (
            <li key={s.name} data-set={s.name}>
              {s.nextAt === null ? ht('home.sets.done', { name: s.name, n: s.pieces }) : ht('home.sets.progress', { name: s.name, n: s.pieces, next: s.nextAt })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const PET_NEED_ORDER = ['appetite', 'fun', 'hygiene', 'affection'] as const;
const PET_ACTIONS = ['feed', 'play', 'cuddle'] as const;

/** W-013: the household's pets (needs + Feed / Play / Cuddle) and the strays hanging around. Reads the sim's pets block. */
function PetsSection({ game }: { game: GameController }) {
  const state = game.sim?.state ?? null;
  const ps = state?.pets ?? null;
  const pets = ps?.pets ?? [];
  const strays = ps?.strays ?? [];
  const actor = game.selectedAgentId ?? state?.household.memberIds[0] ?? null;
  return (
    <div class="hud-pets" data-testid="household-pets">
      <h3 class="hud-ledger__h u-caps">{ht('household.pets')}</h3>
      {pets.length === 0 && <p class="hud-ledger__hint">{ht('household.pets.none', { trust: 70 })}</p>}
      <ul class="hud-members">
        {pets.map((p) => (
          <li key={p.id} class="hud-memrow" data-testid={`pet-${p.id}`}>
            <div class="hud-memrow__main">
              <div class="hud-memrow__top">
                <span class="hud-memrow__name u-ellipsis">
                  {p.name} · {ht(`pets.species.${p.species}`)}
                </span>
                <span class="hud-moodchip is-mini">{ht(`pets.trait.${p.trait}`)}</span>
              </div>
              {PET_NEED_ORDER.map((n) => (
                <div key={n} class="hud-memrow__vit" tabIndex={0} {...tip({ title: `${ht(`pets.need.${n}`)} ${Math.round(num(p.needs[n]))}` })}>
                  <span class="hud-memrow__sub">{ht(`pets.need.${n}`)}</span>
                  <ProgressBar value={num(p.needs[n]) / 100} tone="cryo" size="sm" label={ht(`pets.need.${n}`)} />
                </div>
              ))}
              <div class="hud-pets__care" role="group" aria-label={ht('pets.look')}>
                {(['normal', 'undead'] as const).map((v) => {
                  const usable = v === 'normal' || !!game.economy?.isUsable(petVariantId(p.species));
                  const why = v === 'normal' ? '' : usable ? ht('pets.look.undead.body.ok') : PET_VARIANTS_LIVE ? ht('pets.look.undead.body.locked', { species: ht(`pets.species.${p.species}`) }) : ht('pets.look.undead.body.comingSoon');
                  return (
                    <Button
                      key={v}
                      size="sm"
                      variant={p.variant === v ? 'primary' : 'secondary'}
                      aria-pressed={p.variant === v}
                      data-testid={`pet-look-${v}`}
                      label={v === 'undead' && !usable && !PET_VARIANTS_LIVE ? `${ht('pets.look.undead')} · ${ht('pets.look.comingSoon')}` : ht(`pets.look.${v}`)}
                      onClick={() => {
                        game.pet({ action: 'look', petId: p.id, variant: v });
                      }}
                      {...(why ? tip({ title: ht(`pets.look.${v}`), body: why }) : {})}
                    />
                  );
                })}
              </div>
              <div class="hud-pets__care">
                {PET_ACTIONS.map((a) => (
                  <Button
                    key={a}
                    size="sm"
                    label={ht(`pets.care.${a}`)}
                    disabled={!actor}
                    onClick={() => {
                      if (actor) game.pet({ action: a, agentId: actor, petId: p.id });
                    }}
                    {...tip({ title: ht(`pets.care.${a}`), body: ht(`pets.care.${a}.body`) })}
                  />
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {strays.length > 0 && <p class="hud-ledger__hint">{ht(strays.length === 1 ? 'household.pets.stray' : 'household.pets.strays', { count: strays.length, names: strays.map((s) => s.name).join(', ') })}</p>}
    </div>
  );
}

/** W-116 (D-063): "Autonomous purchases" — Off / Daily cap / Unlimited, saved with the world (sim-owned). */
function AutoPurchases({ game }: { game: GameController }) {
  const state = game.sim?.state ?? null;
  const s = safe('household.autoBuy', () => autoBuySetting(state), { mode: 'unlimited' as const });
  const mode: AutoBuyMode = s.mode;
  const cap = s.mode === 'cap' ? s.cap : DEFAULT_AUTO_BUY_CAP;
  const spent = state ? safe('household.autoBuy.spent', () => autoSpentToday(state), 0) : 0;
  const set = (v: 'off' | 'unlimited' | number) => {
    game.setAutoPurchases(v);
    game.playUi('uiToggle');
  };
  return (
    <div class="hud-autobuy" data-testid="household-autobuy">
      <h3 class="hud-ledger__h u-caps">{ht('household.autoBuy')}</h3>
      <Segmented<AutoBuyMode>
        label={ht('household.autoBuy')}
        value={mode}
        block
        onChange={(v) => set(v === 'cap' ? cap : v)}
        options={(['off', 'cap', 'unlimited'] as AutoBuyMode[]).map((v) => ({
          value: v,
          label: ht(`household.autoBuy.${v}`),
          tipSpec: { title: ht(`household.autoBuy.${v}`), body: ht(`household.autoBuy.${v}.body`, { cap: formatMoney(cap) }) },
        }))}
      />
      {mode === 'cap' && (
        <Segmented<number>
          label={ht('household.autoBuy.capLabel')}
          value={(AUTO_BUY_CAPS as readonly number[]).includes(cap) ? cap : DEFAULT_AUTO_BUY_CAP}
          block
          onChange={(v) => set(v)}
          options={AUTO_BUY_CAPS.map((v) => ({ value: v, label: formatMoney(v) }))}
        />
      )}
      <p class="hud-ledger__hint">{ht(`household.autoBuy.${mode}.body`, { cap: formatMoney(cap) })}</p>
      {mode === 'cap' && <p class="hud-ledger__hint u-num">{ht('household.autoBuy.today', { spent: formatMoney(Math.min(spent, cap)), cap: formatMoney(cap) })}</p>}
    </div>
  );
}

function Stat({ icon, label, value, tone }: { icon: string; label: string; value: string; tone?: 'money' | 'bad' | 'warm' }) {
  return (
    <div class={`hud-stat${tone ? ` is-${tone}` : ''}`}>
      <span class="hud-stat__icon" aria-hidden="true">
        <Icon name={icon} size="1.125rem" />
      </span>
      <span class="hud-stat__text">
        <span class="hud-stat__label u-caps">{label}</span>
        <span class="hud-stat__value u-num">{value}</span>
      </span>
    </div>
  );
}
