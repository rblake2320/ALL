/** Dev-only: shell icon set vs HUD icon set side by side (cohesion review). */
import { Icon as ShellIcon, iconNames } from '../../icons';
import { ICON_NAMES, HudGlyph as Icon } from '../parts/icons';

export function CompareSheet() {
  const shared = ICON_NAMES.filter((n) => iconNames.includes(n));
  const shellOnly = iconNames.filter((n) => !ICON_NAMES.includes(n as never));
  const cell = (n: string, both: boolean) => (
    <div key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem', padding: '0.5rem', borderRadius: '0.5rem', background: 'rgba(232,224,200,0.04)' }}>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <ShellIcon name={n} size="2rem" />
        {both && <span style={{ color: "#9fe870" }}><Icon name={n as never} size="2rem" /></span>}
      </div>
      <div style={{ fontSize: '0.65rem', color: '#bdb4a0' }}>{n}</div>
    </div>
  );
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'auto', padding: '1rem', background: '#1d1726', color: '#ece5cf' }}>
      <h2 class="u-display">Shared names (shell bone · HUD green): {shared.length}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(6.5rem,1fr))', gap: '0.4rem', margin: '0.5rem 0 1rem' }}>{shared.map((n) => cell(n, true))}</div>
      <h2 class="u-display">Shell-only: {shellOnly.length}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(6.5rem,1fr))', gap: '0.4rem', marginTop: '0.5rem' }}>{shellOnly.map((n) => cell(n, false))}</div>
    </div>
  );
}
