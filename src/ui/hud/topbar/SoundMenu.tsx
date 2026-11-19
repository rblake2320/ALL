/**
 * The HUD speaker: always reachable, one click away from mute and the master volume (the same two settings as Settings →
 * Audio and the M key; Settings.muted and Settings.volumes.master, stored per profile). The popover closes on Esc and on a
 * click elsewhere, and returns focus to the button.
 */
import { useRef, useState } from 'preact/hooks';
import type { GameController } from '../../../game/contracts';
import { Slider } from '../../common/Slider';
import { IconButton, Toggle } from '../parts/controls';
import { useEscape, useOutsidePointer } from '../parts/hooks';
import { ht } from '../strings';
import './topbar.css';

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function SoundMenu({ game }: { game: GameController }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const muted = game.settings.muted === true;
  const master = game.settings.volumes.master;
  useOutsidePointer([wrap], () => setOpen(false), open);
  useEscape(() => {
    setOpen(false);
    wrap.current?.querySelector<HTMLElement>('button')?.focus();
  }, open);
  const setMuted = (v: boolean) => {
    game.updateSettings({ muted: v });
    if (!v) game.playUi('uiToggle');
  };
  return (
    <div class="hud-sound" ref={wrap}>
      <IconButton
        icon={muted ? 'volumeOff' : 'volume'}
        label={muted ? ht('sound.off') : ht('sound.title')}
        size="sm"
        pressed={muted}
        aria-haspopup="true"
        aria-expanded={open ? 'true' : 'false'}
        data-testid="hud-sound-button"
        onClick={() => {
          setOpen(!open);
          game.playUi(open ? 'uiClose' : 'uiOpen');
        }}
        tipSpec={{ title: muted ? ht('sound.off') : ht('sound.title'), body: ht('sound.body'), keys: 'mute', place: 'bottom' }}
      />
      {open && (
        <div class="hud-sound__pop ui-panel ui-interactive" role="group" aria-label={ht('sound.title')} data-testid="hud-sound-popover">
          <Slider
            label={ht('sound.volume')}
            value={master}
            min={0}
            max={1}
            step={0.01}
            format={pct}
            onChange={(v) => game.updateSettings({ volumes: { ...game.settings.volumes, master: v } })}
            onCommit={() => game.playUi('uiToggle')}
          />
          <label class="hud-sound__mute">
            <span>{ht('sound.mute')}</span>
            <Toggle checked={muted} onChange={setMuted} label={muted ? ht('sound.unmute') : ht('sound.mute')} />
          </label>
        </div>
      )}
    </div>
  );
}
