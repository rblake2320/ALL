/**
 * HUD portrait: the shell's procedural zombie portrait (so a zombie looks identical in Create-a-Zombie and the
 * HUD) with the HUD's mood-band ring colours and mood-driven expression.
 */
import type { ZombieAppearance } from '../../../shared/appearance';
import type { MoodView } from '../../../sim/contracts';
import { Portrait as ShellPortrait } from '../../common/Portrait';

export type MoodBand = MoodView['band'];

export const MOOD_RING: Record<MoodBand, string> = {
  miserable: 'var(--mood-miserable)',
  uneasy: 'var(--mood-uneasy)',
  fine: 'var(--mood-fine)',
  good: 'var(--mood-good)',
  great: 'var(--mood-great)',
};

const EXPRESSION: Record<MoodBand, string> = {
  great: 'happy',
  good: 'happy',
  fine: 'neutral',
  uneasy: 'angry',
  miserable: 'sad',
};

export interface PortraitProps {
  appearance: ZombieAppearance | null | undefined;
  band?: MoodBand;
  /** CSS size, e.g. "3.5rem". */
  size: string;
  ring?: boolean;
  alert?: boolean;
  dimmed?: boolean;
  selected?: boolean;
  /** Overrides the mood-driven expression (e.g. 'shocked'). */
  expression?: string;
  class?: string;
  label?: string;
}

export function Portrait({ appearance, band = 'fine', size, ring = true, alert, dimmed, selected, expression, class: cls, label }: PortraitProps) {
  const b: MoodBand = MOOD_RING[band] ? band : 'fine';
  return (
    <ShellPortrait
      appearance={appearance}
      size={size}
      ring={ring ? MOOD_RING[b] : null}
      alert={alert}
      dimmed={dimmed}
      expression={expression ?? EXPRESSION[b]}
      name={label}
      class={['hud-portrait', selected ? 'is-selected' : '', cls ?? ''].filter(Boolean).join(' ')}
    />
  );
}
