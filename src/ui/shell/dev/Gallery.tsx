/** DEV ONLY — icon contact sheet, component gallery and portrait matrix for visual review. */
import { useState } from 'preact/hooks';
import { BUBBLE_ICONS } from '../../../sim/contracts';
import { ACCESSORIES, EYE_STYLES, HAIR_STYLES, SKIN_TONES, TOP_STYLES, defaultAppearance } from '../../../shared/appearance';
import { Icon, iconNames } from '../../icons';
import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  IconButton,
  Kbd,
  NeedBar,
  Panel,
  Portrait,
  ProgressBar,
  Segmented,
  Select,
  Slider,
  Spinner,
  SwatchPicker,
  Tabs,
  TextInput,
  ToastCard,
  Toggle,
  Tooltip,
} from '../../common';
import { HAIR_COLORS } from '../data';

export function IconSheet() {
  const bubble = new Set<string>(BUBBLE_ICONS);
  const groups = [
    { title: `Bubble icons (${BUBBLE_ICONS.length})`, names: [...BUBBLE_ICONS] },
    { title: 'UI icons', names: iconNames.filter((n) => !bubble.has(n)) },
  ];
  return (
    <div class="dev-sheet ui-interactive">
      {groups.map((g) => (
        <section key={g.title}>
          <h2 class="dev-sheet__title">{g.title}</h2>
          <div class="dev-icons">
            {g.names.map((n) => (
              <div key={n} class="dev-icon">
                <div class="dev-icon__big">
                  <Icon name={n} size={40} />
                </div>
                <div class="dev-icon__row">
                  <Icon name={n} size={24} />
                  <Icon name={n} size={16} />
                </div>
                <span>{n}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
      <section>
        <h2 class="dev-sheet__title">Fallback</h2>
        <div class="dev-icons">
          <div class="dev-icon">
            <div class="dev-icon__big">
              <Icon name="definitely-not-an-icon" size={40} />
            </div>
            <span>unknown → fallback</span>
          </div>
        </div>
      </section>
    </div>
  );
}

export function ComponentGallery() {
  const [tab, setTab] = useState('one');
  const [seg, setSeg] = useState<'a' | 'b' | 'c'>('b');
  const [sel, setSel] = useState('high');
  const [vol, setVol] = useState(0.62);
  const [on, setOn] = useState(true);
  const [text, setText] = useState('Mortimer');
  const [color, setColor] = useState<string>(HAIR_COLORS[2].value);
  return (
    <div class="dev-sheet dev-gallery ui-interactive">
      <Panel title="Buttons" subtitle="primary · secondary · danger · ghost · sizes · icons · hotkeys · loading" ornate>
        <div class="dev-row">
          <Button variant="primary" icon="coffin">
            Start the Afterlife
          </Button>
          <Button variant="secondary" icon="save" hotkey="F5">
            Save
          </Button>
          <Button variant="danger" icon="trash">
            Delete forever
          </Button>
          <Button variant="ghost" icon="chevronLeft">
            Back
          </Button>
          <Button variant="primary" loading>
            Saving…
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
        </div>
        <div class="dev-row">
          <Button size="sm" variant="secondary">
            Small
          </Button>
          <Button size="md">Medium</Button>
          <Button size="lg" variant="primary" iconRight="chevronRight">
            Large
          </Button>
          <IconButton icon="settings" label="Settings" />
          <IconButton icon="pause" label="Pause" hotkey="Space" variant="glass" />
          <IconButton icon="speed2" label="Fast" pressed />
          <IconButton icon="bell" label="Notifications" variant="glass" badge={<Badge count={3} label="3 unread" />} />
          <IconButton icon="trash" label="Delete" variant="danger" />
          <Tooltip content="Tooltips follow focus too" hotkey="ctrl+KeyZ" description="Smart placement flips at screen edges.">
            <Button variant="ghost" icon="info">
              Hover me
            </Button>
          </Tooltip>
        </div>
      </Panel>
      <Panel title="Inputs">
        <div class="dev-grid">
          <Slider label="Music" value={vol} onChange={setVol} format={(v) => `${Math.round(v * 100)}%`} minLabel="Silent" maxLabel="Loud" />
          <TextInput label="First name" value={text} onInput={setText} maxLength={16} error={text ? null : 'Every zombie needs a first name.'} trailing={<IconButton icon="dice" size="sm" label="Random name" />} />
          <div class="u-row u-gap-3">
            <Toggle checked={on} onChange={setOn} ariaLabel="Toggle" />
            <Select value={sel} onChange={setSel} ariaLabel="Quality" options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' }]} />
          </div>
          <Segmented value={seg} onChange={setSeg} ariaLabel="Difficulty" options={[{ value: 'a', label: 'Relaxed', icon: 'coffee' }, { value: 'b', label: 'Normal', icon: 'coffin' }, { value: 'c', label: 'Grim', icon: 'skull' }]} />
          <SwatchPicker ariaLabel="Hair colour" colors={HAIR_COLORS.map((c) => ({ value: c.value, label: c.id }))} value={color} onChange={setColor} />
          <Tabs idBase="g" ariaLabel="Demo tabs" value={tab} onChange={setTab} items={[{ id: 'one', label: 'Needs', icon: 'hunger' }, { id: 'two', label: 'Skills', icon: 'skills' }, { id: 'three', label: 'Career', icon: 'career', badge: <Badge dot tone="warm" /> }]} />
        </div>
      </Panel>
      <Panel title="Meters">
        <div class="dev-grid">
          <NeedBar label="Appetite" icon="hunger" value={8} trend={-14} />
          <NeedBar label="Rest" icon="energy" value={46} trend={-5} />
          <NeedBar label="Freshness" icon="freshness" value={58} cap={72} trend={-1.3} showValue />
          <NeedBar label="Company" icon="social" value={88} trend={6} />
          <NeedBar label="Amusement" icon="fun" value={24} trend={0} colorblind />
          <NeedBar label="Odor Control" icon="hygiene" value={64} trend={2} colorblind />
          <ProgressBar value={0.42} label="Progress" />
          <ProgressBar value={0.7} tone="candle" label="Candle" />
          <ProgressBar value={0.55} stitched label="Stitched" />
          <ProgressBar value={null} tone="cryo" label="Indeterminate" />
        </div>
      </Panel>
      <Panel title="Feedback">
        <div class="dev-row" style={{ alignItems: 'flex-start' }}>
          <ToastCard kind="bad" title="Bartholomew lost an arm" text="It rolled under the sofa. Pick it up and stitch it back on within 48 hours." time="Mon 2:30 PM" onDismiss={() => {}} remaining={0.4} />
          <ToastCard kind="career" title="Promoted!" text="Ophelia is now an Embalmer's Assistant ($22/h)." onDismiss={() => {}} />
          <div class="u-col u-gap-2">
            <div class="dev-row">
              <Badge>Neutral</Badge>
              <Badge tone="accent">Accent</Badge>
              <Badge tone="warm" caps>
                Autosave
              </Badge>
              <Badge tone="danger">Overdue</Badge>
              <Badge tone="info">Info</Badge>
              <Badge count={12} />
              <Badge dot tone="danger" />
            </div>
            <div class="dev-row">
              <Kbd combo="ctrl+shift+KeyZ" />
              <Kbd combo="Space" />
              <Kbd combo="F10" />
              <Spinner />
            </div>
            <Divider variant="ornament" />
            <Divider variant="label" label="Section" />
          </div>
        </div>
        <div class="dev-row">
          <Card selected onClick={() => {}} style={{ width: '14rem' }}>
            <strong>Selected card</strong>
            <span class="u-muted u-small">Glows toxic green.</span>
          </Card>
          <Card onClick={() => {}} style={{ width: '14rem' }}>
            <strong>Interactive card</strong>
            <span class="u-muted u-small">Lifts on hover.</span>
          </Card>
          <EmptyState icon="tombstone" title="No saves yet" text="Your household’s story is safe the moment you save it." />
        </div>
      </Panel>
    </div>
  );
}

export function PortraitSheet() {
  const base = defaultAppearance();
  return (
    <div class="dev-sheet ui-interactive">
      <h2 class="dev-sheet__title">Hair styles × skin tones</h2>
      <div class="dev-portraits">
        {HAIR_STYLES.map((h, i) => (
          <div key={h} class="dev-portrait">
            <Portrait appearance={{ ...base, hairStyle: h, skinTone: i % SKIN_TONES.length, hairColor: HAIR_COLORS[i % HAIR_COLORS.length].value, build: (i % 4) / 3 }} size="5.5rem" ring={['#9fe870', '#55d6be', '#d9cfb8', '#ff9a4a', '#e2566a'][i % 5]} />
            <span>{h}</span>
          </div>
        ))}
      </div>
      <h2 class="dev-sheet__title">Eyes · tops · accessories</h2>
      <div class="dev-portraits">
        {EYE_STYLES.map((e, i) => (
          <div key={e} class="dev-portrait">
            <Portrait appearance={{ ...base, eyeStyle: e, skinTone: (i * 3) % 10, hairStyle: 'buzz' }} size="5.5rem" ring={null} />
            <span>{e}</span>
          </div>
        ))}
        {TOP_STYLES.map((tp, i) => (
          <div key={tp} class="dev-portrait">
            <Portrait appearance={{ ...base, topStyle: tp, topColor: ['#6b4f8a', '#3f5a4a', '#a5532f', '#6e2a35', '#4a6a7a', '#b8963e', '#3a3f55'][i], hairStyle: 'messy' }} size="5.5rem" ring={null} />
            <span>{tp}</span>
          </div>
        ))}
        {ACCESSORIES.map((a, i) => (
          <div key={a} class="dev-portrait">
            <Portrait appearance={{ ...base, accessory: a, skinTone: (i * 7) % 10, hairStyle: i % 2 ? 'bob' : 'messy' }} size="5.5rem" ring="#9fe870" alert={i === 3} />
            <span>{a}</span>
          </div>
        ))}
        <div class="dev-portrait">
          <Portrait appearance={null} size="5.5rem" />
          <span>null</span>
        </div>
        <div class="dev-portrait">
          <Portrait appearance={{ hairStyle: 'nope' as never, skinTone: 99, eyeColor: 'garbage', build: NaN }} size="5.5rem" dimmed />
          <span>garbage</span>
        </div>
        <div class="dev-portrait">
          <Portrait appearance={base} size="2.5rem" />
          <Portrait appearance={{ ...base, hairStyle: 'afro', skinTone: 4 }} size="2rem" />
          <span>small</span>
        </div>
      </div>
    </div>
  );
}
