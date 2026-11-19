/** Help & Controls: a quick guide to the zombie economy plus the full key map. */
import { useState } from 'preact/hooks';
import { t } from '../../../i18n';
import { Icon, type IconName } from '../../icons';
import { Button } from '../../common/Button';
import { Modal } from '../../common/Modal';
import { ScrollArea } from '../../common/ScrollArea';
import { TabPanel, Tabs } from '../../common/Tabs';
import { KeyMapTable } from '../KeyMapTable';

const GUIDE: { id: string; icon: IconName }[] = [
  { id: 'needs', icon: 'hunger' },
  { id: 'decay', icon: 'freshness' },
  { id: 'limbs', icon: 'limb' },
  { id: 'bills', icon: 'bills' },
  { id: 'careers', icon: 'career' },
  { id: 'building', icon: 'build' },
];

export function HelpDialog({ onClose, initialTab = 'guide' }: { onClose: () => void; initialTab?: 'guide' | 'keys' }) {
  const [tab, setTab] = useState<'guide' | 'keys'>(initialTab);
  return (
    <Modal
      onClose={onClose}
      title={t('help.title')}
      subtitle={t('help.subtitle')}
      size="lg"
      tall
      bodyFlush
      tabs={
        <Tabs
          idBase="help"
          ariaLabel={t('help.title')}
          value={tab}
          onChange={(v) => setTab(v as 'guide' | 'keys')}
          items={[
            { id: 'guide', icon: 'book', label: t('help.tab.guide') },
            { id: 'keys', icon: 'keyboard', label: t('help.tab.keys') },
          ]}
          autoFocusSelected
        />
      }
      footer={
        <>
          <span class="ui-modal__footer-spacer" />
          <Button variant="primary" onClick={onClose}>
            {t('common.done')}
          </Button>
        </>
      }
    >
      <ScrollArea class="sh-dialog-scroll">
        <TabPanel idBase="help" value={tab}>
          {tab === 'guide' ? (
            <>
              <p class="sh-help__mouse">
                <Icon name="info" size="1rem" />
                {t('help.mouse')}
              </p>
              <div class="sh-help__grid">
                {GUIDE.map((g) => (
                  <article key={g.id} class="sh-help__card">
                    <header class="sh-help__head">
                      <span class="sh-help__icon" aria-hidden="true">
                        <Icon name={g.icon} size="1.25rem" />
                      </span>
                      <h3 class="sh-help__title">{t(`help.${g.id}.title`)}</h3>
                    </header>
                    <p class="sh-help__text">{t(`help.${g.id}.text`)}</p>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <KeyMapTable columns={2} />
          )}
        </TabPanel>
      </ScrollArea>
    </Modal>
  );
}
