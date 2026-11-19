/** Credits: original game, built with Claude Code multi-agent workflows; open-source tech; procedural art & audio. */
import { t } from '../../../i18n';
import { Icon, type IconName } from '../../icons';
import { Button } from '../../common/Button';
import { Modal } from '../../common/Modal';
import { ScrollArea } from '../../common/ScrollArea';
import { Ornament } from '../../common/Divider';
import { Emblem, Wordmark } from '../Brand';
import { APP_VERSION } from '../version';
import { useGameController } from '../../hooks';

const TECH: { key: string; icon: IconName }[] = [
  { key: 'three', icon: 'camera' },
  { key: 'preact', icon: 'monitor' },
  { key: 'vite', icon: 'lightning' },
  { key: 'blender', icon: 'paint' },
  { key: 'typescript', icon: 'edit' },
];

export function CreditsDialog({ onClose }: { onClose: () => void }) {
  const game = useGameController();
  return (
    <Modal
      onClose={onClose}
      title={t('credits.title')}
      subtitle={t('credits.subtitle')}
      size="md"
      footer={
        <>
          <span class="u-faint u-small u-num">{t('app.version', { version: game.appVersion || APP_VERSION })}</span>
          <span class="ui-modal__footer-spacer" />
          <Button variant="primary" onClick={onClose} data-autofocus>
            {t('common.close')}
          </Button>
        </>
      }
    >
      <ScrollArea class="sh-credits" maxHeight="58vh">
        <div class="sh-credits__brand">
          <Emblem size="4rem" />
          <Wordmark size="sm" />
        </div>
        <section class="sh-credits__feature">
          <span class="sh-credits__featureicon" aria-hidden="true">
            <Icon name="sparkle" size="1.25rem" />
          </span>
          <div>
            <h3 class="sh-credits__featuretitle">{t('credits.built')}</h3>
            <p class="sh-credits__text">{t('credits.builtText')}</p>
          </div>
        </section>
        <h3 class="ui-section-title">{t('credits.section.tech')}</h3>
        <ul class="sh-credits__tech">
          {TECH.map((x) => (
            <li key={x.key}>
              <Icon name={x.icon} size="1rem" />
              <span class="sh-credits__techname">{t(`credits.${x.key}`)}</span>
              <span class="sh-credits__techrole">{t(`credits.${x.key}Role`)}</span>
            </li>
          ))}
        </ul>
        <h3 class="ui-section-title">{t('credits.section.art')}</h3>
        <p class="sh-credits__text">{t('credits.artText')}</p>
        <h3 class="ui-section-title">{t('credits.section.thanks')}</h3>
        <p class="sh-credits__text">{t('credits.thanksText')}</p>
        <Ornament width={60} class="sh-credits__orn" />
        <p class="sh-credits__legal">{t('credits.legal')}</p>
      </ScrollArea>
    </Modal>
  );
}
