/** DEV ONLY — stand-in for the renderer's 3D diorama behind the menu/game UI (original SVG night scene). */
export function Backdrop({ variant = 'menu' }: { variant?: 'menu' | 'game' }) {
  return (
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" style={{ position: 'fixed', inset: 0, display: 'block' }} aria-hidden="true">
      <defs>
        <linearGradient id="bd-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={variant === 'game' ? '#3a4a5a' : '#141024'} />
          <stop offset="0.55" stop-color={variant === 'game' ? '#6a7480' : '#2d2442'} />
          <stop offset="1" stop-color={variant === 'game' ? '#8a948a' : '#4a3a55'} />
        </linearGradient>
        <radialGradient id="bd-moon" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#fff2d0" stop-opacity="0.9" />
          <stop offset="0.3" stop-color="#ffd08f" stop-opacity="0.25" />
          <stop offset="1" stop-color="#ffd08f" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="bd-fog" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#9aa39a" stop-opacity="0" />
          <stop offset="1" stop-color="#9aa39a" stop-opacity="0.35" />
        </linearGradient>
        <radialGradient id="bd-win" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#ffe2a8" />
          <stop offset="1" stop-color="#ffb35a" />
        </radialGradient>
      </defs>
      <rect width="1600" height="900" fill="url(#bd-sky)" />
      {variant === 'menu' ? (
        <>
          <circle cx="1240" cy="190" r="190" fill="url(#bd-moon)" />
          <circle cx="1240" cy="190" r="62" fill="#f7e8c4" />
          <circle cx="1222" cy="176" r="9" fill="#e6d3a5" />
          <circle cx="1262" cy="206" r="6" fill="#e6d3a5" />
          {[
            [900, 80], [1010, 140], [1420, 90], [1500, 260], [820, 230], [1100, 300], [960, 380], [1380, 360],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 2 : 1.3} fill="#efe6cf" opacity="0.7" />
          ))}
        </>
      ) : null}
      <path d="M0 640 C200 610 380 630 560 612 S900 600 1100 618 S1450 606 1600 600 V900 H0Z" fill={variant === 'game' ? '#4b5a44' : '#231b2e'} />
      <g transform="translate(980 330) rotate(-2)">
        <path d="M0 330 V140 L170 20 L350 140 V330Z" fill={variant === 'game' ? '#5f5168' : '#2e2438'} stroke="#140f1a" stroke-width="5" />
        <path d="M-22 150 L170 6 L372 150" fill="none" stroke="#1c1522" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" />
        <rect x="250" y="20" width="34" height="80" fill="#1c1522" />
        <rect x="52" y="170" width="78" height="64" rx="6" fill="url(#bd-win)" opacity={variant === 'game' ? 0.45 : 0.95} />
        <rect x="222" y="170" width="78" height="64" rx="6" fill="#9fe870" opacity={variant === 'game' ? 0.3 : 0.75} />
        <path d="M91 170v64M52 202h78M261 170v64M222 202h78" stroke="#1c1522" stroke-width="6" />
        <path d="M150 330 V262 a26 26 0 0 1 52 0 V330Z" fill="#1a1320" />
        <circle cx="170" cy="96" r="22" fill="#ffd08f" opacity={variant === 'game' ? 0.4 : 0.85} />
      </g>
      <path d="M760 640 C764 560 744 500 772 450 M772 520 C800 500 816 480 820 450 M766 560 C740 548 728 530 726 506" stroke="#120d17" stroke-width="10" fill="none" stroke-linecap="round" />
      {Array.from({ length: 30 }, (_, i) => (
        <path key={i} d={`M${640 + i * 32} 700 v-44 l8 -10 l8 10 v44`} fill="#120d17" opacity="0.85" transform={`rotate(${(i % 4) - 1.5} ${648 + i * 32} 680)`} />
      ))}
      <path d="M620 668 H1600" stroke="#120d17" stroke-width="6" />
      <ellipse cx="1150" cy="700" rx="260" ry="26" fill="#9fe870" opacity={variant === 'game' ? 0.05 : 0.08} />
      <rect y="520" width="1600" height="380" fill="url(#bd-fog)" />
      <rect y="780" width="1600" height="120" fill="#0c0911" opacity="0.55" />
    </svg>
  );
}
