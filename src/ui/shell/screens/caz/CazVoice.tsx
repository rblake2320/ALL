/** Voice tab: pitch slider + Groanish samples through game.audio.voice() with a little live waveform. */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { VoiceEmotion } from '../../../../shared/audioIds';
import { t } from '../../../../i18n';
import { useGameController } from '../../../hooks';
import { Button } from '../../../common/Button';
import { Slider } from '../../../common/Slider';
import { cx } from '../../../common/cx';
import { voiceSeed } from '../../cazLogic';
import type { MemberEditorProps } from './CazLookTabs';

const SAMPLES: { emotion: VoiceEmotion; key: string; ms: number }[] = [
  { emotion: 'happy', key: 'happy', ms: 1100 },
  { emotion: 'laugh', key: 'laugh', ms: 1300 },
  { emotion: 'question', key: 'question', ms: 900 },
  { emotion: 'flirty', key: 'flirty', ms: 1100 },
  { emotion: 'angry', key: 'angry', ms: 1000 },
];

export function VoiceTab({ member, index, update, updateLook }: MemberEditorProps) {
  const game = useGameController();
  const [playing, setPlaying] = useState<VoiceEmotion | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pitch = member.appearance.voicePitch;
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const play = (emotion: VoiceEmotion, ms: number, p = pitch) => {
    // Use the member's own seed (the sim honours NewMemberSpec.voiceSeed) so the preview matches the in-game voice.
    const known = member.voiceSeed;
    const seed = typeof known === 'number' && Number.isFinite(known) ? known : voiceSeed(member.firstName, member.lastName, index);
    if (known !== seed) update({ voiceSeed: seed });
    const go = () => {
      try {
        game.audio.voice(seed, Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0.5)), emotion, ms);
      } catch (err) {
        console.warn('[caz] voice failed', err);
      }
    };
    try {
      const u = game.audio.unlocked ? null : game.audio.unlock();
      if (u && typeof u.then === 'function') u.then(go, go);
      else go();
    } catch {
      go();
    }
    setPlaying(emotion);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPlaying(null), ms + 120);
  };

  const pitchWord = (v: number) => (v < 0.34 ? t('caz.pitchMin') : v > 0.66 ? t('caz.pitchMax') : `${Math.round(v * 100)}%`);

  return (
    <div class="sh-tab sh-tab--voice">
      <p class="sh-hint">{t('caz.voiceHint')}</p>
      <Slider
        label={t('caz.pitch')}
        value={pitch}
        min={0}
        max={1}
        step={0.01}
        format={pitchWord}
        minLabel={t('caz.pitchMin')}
        maxLabel={t('caz.pitchMax')}
        onChange={(v) => updateLook({ voicePitch: v })}
        onCommit={(v) => play('neutral', 700, v)}
      />
      <div class="sh-voice">
        <Button variant="primary" size="lg" icon="voice" onClick={() => play('groan', 1400)} aria-describedby="caz-voice-wave">
          {t('caz.hearGroan')}
        </Button>
        <div id="caz-voice-wave" class={cx('sh-wave', playing && 'is-playing')} aria-live="polite" style={{ '--pitch': String(0.6 + pitch * 0.8) }}>
          {Array.from({ length: 18 }, (_, i) => (
            <span key={i} class="sh-wave__bar" style={{ '--i': String(i) }} />
          ))}
          <span class="u-sr-only">{playing ? t('caz.playing') : ''}</span>
        </div>
      </div>
      <h3 class="ui-section-title">{t('caz.voiceMore')}</h3>
      <div class="sh-voice__samples">
        {SAMPLES.map((s) => (
          <Button key={s.key} size="sm" variant="secondary" onClick={() => play(s.emotion, s.ms)} aria-pressed={playing === s.emotion ? 'true' : 'false'}>
            {t(`caz.voiceSample.${s.key}`)}
          </Button>
        ))}
      </div>
    </div>
  );
}
