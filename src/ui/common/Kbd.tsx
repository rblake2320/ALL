import { Fragment } from 'preact';
import { comboLabels } from './hotkeys';
import { cx } from './cx';

/** Keyboard combo chip(s): <Kbd combo="ctrl+KeyZ" /> → [Ctrl] + [Z]. Or explicit keys: <Kbd keys={['Q']} />. */
export function Kbd({ combo, keys, class: cls }: { combo?: string; keys?: string[]; class?: string }) {
  const parts = keys ?? (combo ? comboLabels(combo) : []);
  if (parts.length === 0) return null;
  // aria-label on a generic <span> is ignored by most screen readers (and the chips are aria-hidden), so the
  // spoken form is real, visually hidden text.
  return (
    <span class={cx('ui-kbd-combo', cls)}>
      <span class="u-sr-only">{parts.join(' + ')}</span>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <span class="ui-kbd-combo__plus" aria-hidden="true">
              +
            </span>
          ) : null}
          <kbd class="ui-kbd" aria-hidden="true">
            {p}
          </kbd>
        </Fragment>
      ))}
    </span>
  );
}
