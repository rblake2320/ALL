import { STARTER_ZOMBIES, starterZombiePatch } from '../../../../game/starterZombies';
import { t } from '../../../../i18n';
import { castThumbUrl } from '../../../common/castArt';
import { Portrait } from '../../../common/Portrait';
import { useState } from 'preact/hooks';
import { useUid } from '../../../common/uid';
import type { MemberEditorProps } from './CazLookTabs';

/** Action buttons apply a complete look/personality through the existing, validated controller API. */
export function CazStarterPicker({ update, traits, aspirations }: Pick<MemberEditorProps, 'update' | 'traits' | 'aspirations'>) {
  const labelId = useUid('starter-zombies');
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const [applied, setApplied] = useState<string | null>(null);
  return (
    <section class="sh-starters" aria-labelledby={labelId}>
      <h3 class="ui-section-title" id={labelId}>{t('caz.starters.title')}</h3>
      <p class="sh-hint">{t('caz.starters.hint')}</p>
      <div class="sh-starters__grid">
        {STARTER_ZOMBIES.map((preset) => {
          const patch = starterZombiePatch(preset.id)!;
          const title = t(`caz.starter.${preset.id}`);
          return (
            <button type="button" class="sh-starter" key={preset.id} data-starter={preset.id}
              aria-label={t('caz.starters.choose', { name: title })}
              aria-describedby={`${labelId}-${preset.id}`}
              onClick={() => { update(starterZombiePatch(preset.id)!); setApplied(title); }}>
              {broken.has(preset.id) ? <Portrait appearance={patch.appearance} size="3rem" /> : (
                <img src={castThumbUrl(preset.body)} width={64} height={64} alt="" decoding="async"
                  onError={() => setBroken((previous) => new Set([...previous, preset.id]))} />
              )}
              <span class="sh-starter__copy" id={`${labelId}-${preset.id}`}>
                <strong>{title}</strong>
                <span>{t(`caz.starter.${preset.id}.blurb`)}</span>
                <span class="sh-starter__traits">{preset.traits.map((id) => traits.find((trait) => trait.id === id)?.name ?? id).join(' · ')}</span>
                <span class="sh-starter__goal">{aspirations.find((aspiration) => aspiration.id === preset.aspiration)?.name ?? preset.aspiration}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p class="sh-hint sh-starters__status" role="status">{applied ? t('caz.starters.applied', { name: applied }) : t('caz.starters.more')}</p>
    </section>
  );
}
