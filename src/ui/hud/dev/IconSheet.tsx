/** Dev-only contact sheet of every HUD glyph (art review). */
import { ICON_NAMES, Icon } from '../parts/icons';
import { BUBBLE_ICONS } from '../../../sim/contracts';

export function IconSheet() {
  const bubble = new Set<string>(BUBBLE_ICONS);
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'auto', padding: '1.5rem', background: '#1d1726', color: '#ece5cf', fontFamily: 'var(--font-ui)' }}>
      <h1 class="u-display" style={{ fontSize: '1.6rem', marginBottom: '1rem' }}>
        HUD glyphs ({ICON_NAMES.length})
      </h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(7.2rem, 1fr))', gap: '0.5rem' }}>
        {ICON_NAMES.map((n) => (
          <div
            key={n}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.6rem 0.25rem',
              borderRadius: '0.6rem',
              background: bubble.has(n) ? 'rgba(159,232,112,0.06)' : 'rgba(232,224,200,0.04)',
              border: '1px solid rgba(232,224,200,0.1)',
            }}
          >
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              <Icon name={n} size="2.25rem" />
              <Icon name={n} size="1.125rem" />
            </div>
            <div style={{ fontSize: '0.7rem', color: '#bdb4a0' }}>{n}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
