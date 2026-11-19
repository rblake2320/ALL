/** Dev-only contact sheet of portrait variants (art review). */
import { ACCESSORIES, EYE_STYLES, HAIR_STYLES, SKIN_TONES, TOP_STYLES, defaultAppearance } from '../../../shared/appearance';
import { Portrait, type MoodBand } from '../parts/Portrait';
import { Portrait as ShellPortrait } from '../../common/Portrait';

const BANDS: MoodBand[] = ['great', 'good', 'fine', 'uneasy', 'miserable'];
const HAIR_COLORS = ['#3b2f2f', '#c9b9a0', '#6e2a35', '#2b2f3a', '#8a6a4a', '#9fb88a', '#e8e0c8', '#5b3f6e', '#a5532f', '#1f1f24'];
const TOP_COLORS = ['#6b4f8a', '#3f5a4a', '#6e3b3b', '#4a4a5e', '#7a6a3a', '#5e4030', '#2b2f3a'];

export function PortraitSheet() {
  const cells = HAIR_STYLES.map((hair, i) => ({
    ...defaultAppearance(),
    hairStyle: hair,
    hairColor: HAIR_COLORS[i % HAIR_COLORS.length],
    skinTone: i % SKIN_TONES.length,
    eyeStyle: EYE_STYLES[i % EYE_STYLES.length],
    accessory: ACCESSORIES[i % ACCESSORIES.length],
    topStyle: TOP_STYLES[i % TOP_STYLES.length],
    topColor: TOP_COLORS[i % TOP_COLORS.length],
    eyeColor: ['#f2e86d', '#9fe870', '#7fe0ff', '#ff8f7a'][i % 4],
    stitches: i % 3 !== 1,
  }));
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'auto', padding: '1.5rem', background: '#1d1726', color: '#ece5cf' }}>
      <h1 class="u-display" style={{ fontSize: '1.6rem', marginBottom: '1rem' }}>Portraits</h1>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem' }}>
        {cells.map((a, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem', fontSize: '0.7rem', color: '#bdb4a0' }}>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <Portrait size="6.5rem" appearance={a} band={BANDS[i % BANDS.length]} />
              <ShellPortrait size="6.5rem" appearance={a} ring="#9fe870" />
            </div>
            <div>{a.hairStyle} · {a.eyeStyle} · {a.accessory}</div>
            <div>{a.topStyle} · {BANDS[i % BANDS.length]}</div>
          </div>
        ))}
      </div>
      <h2 class="u-display" style={{ fontSize: '1.2rem', margin: '1.5rem 0 0.75rem' }}>Moods · small sizes · states</h2>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
        {BANDS.map((b) => (
          <Portrait key={b} size="3.5rem" appearance={cells[0]} band={b} />
        ))}
        <Portrait size="3.5rem" appearance={cells[3]} band="fine" />
        <Portrait size="3.5rem" appearance={cells[4]} band="fine" dimmed />
        <Portrait size="3.5rem" appearance={cells[5]} band="uneasy" alert />
        <Portrait size="2rem" appearance={cells[6]} band="good" />
        <Portrait size="1.6rem" appearance={cells[7]} band="great" />
      </div>
    </div>
  );
}
