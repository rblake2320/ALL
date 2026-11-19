/** Phone dialog: Invite Over, Throw a Party, Order Pizza, Find a Job, Quit Job, Call in Sick → game.phone(action, params). */
import { useState } from 'preact/hooks';
import type { GameController } from '../../../game/contracts';
import { formatMoney, num } from '../lib/format';
import type { PhoneAction, PhoneOption } from '../lib/phone';
import { phoneOptionsFor, runPhone } from '../lib/phoneData';
import { safe } from '../lib/safe';
import { hudStore } from '../lib/store';
import { HudDialog } from '../parts/Dialog';
import { useGame } from '../parts/hooks';
import { Icon } from '../parts/icons';
import { Portrait } from '../parts/Portrait';
import { ht } from '../strings';
import './dialogs.css';

const TILE_ICON: Record<PhoneAction, string> = {
  invite: 'envelopeHeart',
  party: 'party',
  pizza: 'pizza',
  findJob: 'search',
  quitJob: 'quit',
  callInSick: 'thermometer',
};

export function PhoneDialog() {
  const game = useGame();
  const id = game.selectedAgentId;
  const summary = id ? safe('phone.summary', () => game.sim?.summary(id) ?? null, null) : null;
  const opts = phoneOptionsFor(game, id);
  const career = id ? safe('phone.career', () => game.sim?.career(id) ?? null, null) : null;
  const sick = id ? num(safe('phone.sick', () => game.sim?.agent(id)?.career?.sickDaysUsed ?? 0, 0)) : 0;
  const [confirmQuit, setConfirmQuit] = useState(false);
  const close = () => {
    game.closeDialog();
    game.playUi('uiClose');
  };
  const desc: Record<PhoneAction, string> = {
    invite: ht('phone.invite.desc'),
    party: ht('phone.party.desc'),
    pizza: ht('phone.pizza.desc'),
    findJob: ht('phone.findJob.desc'),
    quitJob: confirmQuit ? ht('phone.quitJob.confirm') : career ? ht('phone.quitJob.desc', { title: career.title }) : ht('phone.quitJob.none'),
    callInSick: ht('phone.callInSick.desc', { left: Math.max(0, 3 - sick) }),
  };
  const act = (a: PhoneAction) => {
    switch (a) {
      case 'invite':
      case 'party':
        hudStore.set({ inviteMode: a === 'party' ? 'party' : 'invite' });
        game.playUi('uiOpen');
        game.openDialog('invite');
        return;
      case 'findJob':
        game.playUi('uiOpen');
        game.openDialog('careers');
        return;
      case 'quitJob':
        if (!confirmQuit) {
          setConfirmQuit(true);
          game.playUi('uiClick');
          return;
        }
        runPhone(game, 'quitJob');
        game.closeDialog();
        return;
      default:
        runPhone(game, a);
        game.closeDialog();
    }
  };
  const order: PhoneAction[] = ['invite', 'party', 'pizza', 'findJob', 'quitJob', 'callInSick'];
  return (
    <HudDialog
      id="phone"
      title={ht('phone.title')}
      eyebrow={summary ? ht('phone.caller', { name: summary.firstName || summary.name }) : undefined}
      icon="phone"
      size="md"
      onClose={close}
    >
      {summary && (
        <div class="hud-caller">
          <Portrait size="3rem" appearance={summary.appearance} band={summary.moodBand} />
          <div class="hud-caller__text">
            <span class="hud-caller__name u-display">{summary.name}</span>
            <span class="hud-caller__sub">{career ? career.title : ht('info.unemployed')}</span>
          </div>
          <span class="hud-caller__funds u-num">
            <Icon name="money" size="1rem" />
            {formatMoney(game.sim?.state.household.funds ?? 0)}
          </span>
        </div>
      )}
      <div class="hud-phone-grid" role="list">
        {order.map((a) => (
          <PhoneTile key={a} action={a} opt={opts[a]} label={a === 'findJob' && career && opts.findJob.available ? ht('phone.changeJob') : ht(`phone.${a}`)} desc={desc[a]} danger={a === 'quitJob' && confirmQuit} onAct={() => act(a)} game={game} />
        ))}
      </div>
    </HudDialog>
  );
}

function PhoneTile({ action, opt, label, desc, danger, onAct }: { action: PhoneAction; opt: PhoneOption; label: string; desc: string; danger: boolean; onAct: () => void; game: GameController }) {
  const reason = opt.available ? null : opt.reason ?? ht(opt.reasonKey ?? 'phone.reason.unavailable');
  return (
    <div role="listitem">
      <button type="button" class={`hud-ptile is-${action}${danger ? ' is-danger' : ''}`} disabled={!opt.available} onClick={onAct} aria-describedby={`hud-ptile-${action}`}>
        <span class="hud-ptile__icon" aria-hidden="true">
          <Icon name={TILE_ICON[action]} size="1.375rem" />
        </span>
        <span class="hud-ptile__text">
          <span class="hud-ptile__label">{label}</span>
          <span id={`hud-ptile-${action}`} class={`hud-ptile__desc${reason ? ' is-reason' : ''}`}>
            {reason ? (
              <>
                <Icon name="lock" size="0.6875rem" /> {reason}
              </>
            ) : (
              desc
            )}
          </span>
        </span>
        {opt.cost !== null && <span class="hud-ptile__cost u-num">{formatMoney(opt.cost)}</span>}
        <span class="hud-ptile__chev" aria-hidden="true">
          <Icon name="chevronRight" size="0.875rem" />
        </span>
      </button>
    </div>
  );
}
