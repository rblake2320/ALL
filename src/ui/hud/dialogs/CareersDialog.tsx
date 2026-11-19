/** Job listings (sim.careersAvailable()): name, starting title, wage, schedule, key skill → join via game.phone. */
import { formatMoney, num } from '../lib/format';
import { phoneOptionsFor, runPhone } from '../lib/phoneData';
import { safe } from '../lib/safe';
import { Button } from '../parts/controls';
import { HudDialog } from '../parts/Dialog';
import { useGame } from '../parts/hooks';
import { Icon } from '../parts/icons';
import { ht } from '../strings';
import './dialogs.css';

export function CareersDialog() {
  const game = useGame();
  const sim = game.sim;
  const id = game.selectedAgentId;
  const summary = id ? safe('careers.summary', () => sim?.summary(id) ?? null, null) : null;
  const list = safe('careers.available', () => sim?.careersAvailable() ?? [], []);
  const current = id ? safe('careers.current', () => sim?.career(id) ?? null, null) : null;
  const skills = id ? safe('careers.skills', () => sim?.skills(id) ?? [], []) : [];
  const canJoin = phoneOptionsFor(game, id).findJob.available;
  const close = () => {
    game.closeDialog();
    game.playUi('uiClose');
  };
  return (
    <HudDialog
      id="careers"
      title={ht('careers.title')}
      subtitle={summary ? ht('careers.subtitle', { name: summary.firstName || summary.name }) : undefined}
      icon="career"
      size="lg"
      onClose={close}
    >
      {current && (
        <p class="hud-dialog__note">
          <Icon name="info" size="0.9375rem" />
          {canJoin ? ht('careers.replace', { title: current.title }) : ht('careers.quitFirst', { title: current.title })}
        </p>
      )}
      {list.length === 0 ? (
        <div class="ui-empty">
          <div class="ui-empty__icon">
            <Icon name="career" size="1.5rem" />
          </div>
          <p class="ui-empty__text">{ht('careers.empty')}</p>
        </div>
      ) : (
        <ul class="hud-careers">
          {list.map((c) => {
            const def = safe('careers.def', () => sim?.content.careers[c.id], undefined);
            const skillId = def?.skill ?? null;
            const lvl = skillId ? num(skills.find((s) => s.id === skillId)?.level) : null;
            const isCurrent = current?.trackId === c.id;
            return (
              <li key={c.id} class={`hud-jobcard${isCurrent ? ' is-current' : ''}`}>
                <div class="hud-jobcard__head">
                  <span class="hud-jobcard__icon" aria-hidden="true">
                    <Icon name={c.icon || 'career'} size="1.375rem" />
                  </span>
                  <div class="hud-jobcard__titles">
                    <h3 class="hud-jobcard__name u-display">{c.name}</h3>
                    {isCurrent && <span class="ui-badge ui-badge--info ui-badge--caps">{ht('careers.current')}</span>}
                  </div>
                </div>
                <p class="hud-jobcard__desc">{c.description}</p>
                <dl class="hud-jobcard__facts">
                  <div>
                    <dt>{ht('careers.startsAs')}</dt>
                    <dd>{c.startTitle}</dd>
                  </div>
                  <div>
                    <dt>{ht('careers.wage')}</dt>
                    <dd class="u-num">{ht('career.wage', { wage: formatMoney(c.wage) })}</dd>
                  </div>
                  <div class="is-wide">
                    <dt>{ht('careers.hours')}</dt>
                    <dd>{c.schedule}</dd>
                  </div>
                  {skillId && (
                    <div>
                      <dt>{ht('careers.skill')}</dt>
                      <dd>
                        {ht(`skill.${skillId}`)}
                        {lvl !== null && summary && <span class="hud-jobcard__lvl">{ht('careers.yourLevel', { name: summary.firstName, level: lvl })}</span>}
                      </dd>
                    </div>
                  )}
                </dl>
                <div class="hud-jobcard__foot">
                  {isCurrent ? (
                    <span class="hud-jobcard__here">
                      <Icon name="check" size="0.875rem" strokeWidth={2.4} />
                      {ht('careers.here', { title: current?.title ?? c.startTitle })}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      icon="check"
                      label={ht('careers.join')}
                      disabled={!id || !canJoin}
                      onClick={() => {
                        runPhone(game, 'joinCareer', { careerId: c.id });
                        game.closeDialog();
                      }}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </HudDialog>
  );
}
