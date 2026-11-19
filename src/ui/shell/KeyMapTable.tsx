/** Read-only key binding reference generated from KEYMAP (shared by Help and Settings → Controls). */
import { Fragment } from 'preact';
import { KEYMAP } from '../../game/contracts';
import { t } from '../../i18n';
import { Kbd } from '../common/Kbd';
import { cx } from '../common/cx';

export type KeyAction = keyof typeof KEYMAP;

export const KEY_GROUPS: { id: string; actions: KeyAction[] }[] = [
  { id: 'time', actions: ['pause', 'speed1', 'speed2', 'speed3', 'speedUltra'] },
  { id: 'modes', actions: ['modeLive', 'modeBuy', 'modeBuild', 'wallMode'] },
  { id: 'camera', actions: ['perspective', 'rotateCamLeft', 'rotateCamRight', 'panUp', 'panDown', 'panLeft', 'panRight', 'zoomIn', 'zoomOut', 'focusSelected'] },
  { id: 'building', actions: ['rotateObject', 'sell', 'undo', 'redo'] },
  { id: 'general', actions: ['cycleZombie', 'focusHud', 'help', 'quickSave', 'mute', 'store', 'feedback', 'menu'] },
];

/** Every KEYMAP action appears exactly once across groups (guarded by a unit test). */
export function groupedActions(): KeyAction[] {
  return KEY_GROUPS.flatMap((g) => g.actions);
}

export function KeyMapTable({ columns = 2, class: cls }: { columns?: 1 | 2; class?: string }) {
  return (
    <div class={cx('sh-keymap', columns === 2 && 'sh-keymap--2col', cls)}>
      {KEY_GROUPS.map((g) => (
        <section key={g.id} class="sh-keymap__group" aria-labelledby={`keys-${g.id}`}>
          <h3 class="ui-section-title" id={`keys-${g.id}`}>
            {t(`keys.group.${g.id}`)}
          </h3>
          <dl class="sh-keymap__list">
            {g.actions.map((a) => (
              <Fragment key={a}>
                <dt class="sh-keymap__action">{t(`keys.${a}`)}</dt>
                <dd class="sh-keymap__keys">
                  {KEYMAP[a].map((combo, i) => (
                    <Fragment key={combo}>
                      {i > 0 ? <span class="sh-keymap__or">{t('common.or')}</span> : null}
                      <Kbd combo={combo} />
                    </Fragment>
                  ))}
                </dd>
              </Fragment>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
