/** Original lot illustrations for the New Game cards (inline SVG, 320×150). */
import { useUid } from '../../common/uid';

function Sky({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`sky${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#1b1530" />
          <stop offset="0.6" stop-color="#3b2d52" />
          <stop offset="1" stop-color="#5b4466" />
        </linearGradient>
        <radialGradient id={`moon${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#fff1cf" />
          <stop offset="0.6" stop-color="#ffd08f" stop-opacity="0.35" />
          <stop offset="1" stop-color="#ffd08f" stop-opacity="0" />
        </radialGradient>
        <linearGradient id={`fog${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#9aa39a" stop-opacity="0" />
          <stop offset="1" stop-color="#9aa39a" stop-opacity="0.28" />
        </linearGradient>
      </defs>
      <rect width="320" height="150" fill={`url(#sky${id})`} />
      <circle cx="262" cy="34" r="34" fill={`url(#moon${id})`} />
      <circle cx="262" cy="34" r="13" fill="#f6e7c2" />
      <circle cx="257" cy="31" r="2.2" fill="#e2cf9f" />
      <circle cx="266" cy="38" r="1.6" fill="#e2cf9f" />
      {[
        [30, 22, 1],
        [72, 40, 0.7],
        [128, 18, 0.9],
        [190, 30, 0.6],
        [300, 70, 0.7],
        [228, 12, 0.8],
      ].map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="#efe6cf" opacity="0.8" />
      ))}
      <path d="M0 112 C40 104 70 108 110 103 S190 100 230 106 S300 104 320 100 V150 H0Z" fill="#241b2f" />
    </>
  );
}

export function StarterLotArt() {
  const id = useUid().replace(/[^A-Za-z0-9_-]/g, '');
  return (
    <svg viewBox="0 0 320 150" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <Sky id={id} />
      <path d="M34 112 C36 90 30 72 40 60 M40 74 C48 70 52 64 54 56 M38 86 C30 82 26 76 26 70" stroke="#17111e" stroke-width="3" fill="none" stroke-linecap="round" />
      <path d="M0 120 C60 112 120 116 180 112 S280 110 320 114 V150 H0Z" fill="#33402c" />
      <g transform="rotate(-1.5 160 100)">
        <path d="M112 118 V78 L160 46 L210 78 V118Z" fill="#4a3a52" stroke="#1a1320" stroke-width="2" stroke-linejoin="round" />
        <path d="M104 82 L160 42 L218 82" fill="none" stroke="#2a1f30" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M104 82 L160 42 L218 82" fill="none" stroke="#6e2a35" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        <rect x="184" y="44" width="10" height="20" fill="#2a1f30" />
        <path d="M188 40 c-4 -6 4 -8 0 -14" stroke="#9aa39a" stroke-opacity="0.5" stroke-width="3" fill="none" stroke-linecap="round" />
        <rect x="124" y="86" width="20" height="16" rx="2" fill="#9fe870" />
        <rect x="124" y="86" width="20" height="16" rx="2" fill="#ffd08f" opacity="0.35" />
        <path d="M134 86v16M124 94h20" stroke="#2a1f30" stroke-width="2" />
        <rect x="176" y="86" width="20" height="16" rx="2" fill="#ffb35a" />
        <path d="M186 86v16M176 94h20" stroke="#2a1f30" stroke-width="2" />
        <path d="M154 118 V96 a6 6 0 0 1 12 0 V118Z" fill="#231a29" stroke="#1a1320" stroke-width="1.5" />
        <circle cx="163.5" cy="108" r="1.2" fill="#ffb35a" />
        <circle cx="160" cy="68" r="6" fill="#ffd08f" opacity="0.85" />
        <path d="M160 62v12M154 68h12" stroke="#2a1f30" stroke-width="1.6" />
      </g>
      <rect x="0" y="0" width="320" height="150" fill="#9fe870" opacity="0.025" />
      <ellipse cx="134" cy="128" rx="30" ry="6" fill="#9fe870" opacity="0.12" />
      {Array.from({ length: 13 }, (_, i) => (
        <path key={i} d={`M${16 + i * 22} 132 v-12 l3 -3 l3 3 v12`} fill="#d9cfb8" opacity="0.65" transform={`rotate(${(i % 3) - 1} ${19 + i * 22} 126)`} />
      ))}
      <path d="M10 126 H310" stroke="#d9cfb8" stroke-opacity="0.5" stroke-width="2" />
      <rect x="0" y="100" width="320" height="50" fill={`url(#fog${id})`} />
    </svg>
  );
}

export function EmptyLotArt() {
  const id = useUid().replace(/[^A-Za-z0-9_-]/g, '');
  return (
    <svg viewBox="0 0 320 150" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <Sky id={id} />
      <path d="M0 120 C60 114 120 118 180 114 S280 112 320 116 V150 H0Z" fill="#4a3a2c" />
      <path d="M0 132 C70 126 150 130 220 127 S300 128 320 126 V150 H0Z" fill="#3a2d22" />
      <ellipse cx="96" cy="124" rx="22" ry="5" fill="#5a4634" />
      <ellipse cx="214" cy="130" rx="26" ry="5.5" fill="#5a4634" />
      <path d="M86 124 c4 -6 16 -6 20 0" fill="#6a5440" />
      <path d="M202 130 c5 -7 19 -7 24 0" fill="#6a5440" />
      <g transform="rotate(4 248 100)">
        <rect x="245" y="84" width="5" height="44" fill="#3a2a22" />
        <path d="M222 70 h50 v22 h-50z" fill="#d9cfb8" stroke="#2a1f30" stroke-width="2" />
        <path d="M228 78 h38 M228 85 h24" stroke="#6e2a35" stroke-width="3" stroke-linecap="round" />
      </g>
      <g transform="rotate(-24 150 106)">
        <rect x="148" y="84" width="4" height="34" rx="1" fill="#6b4a35" />
        <path d="M143 118 h14 l-2 14 q-5 4 -10 0z" fill="#8a8f7a" stroke="#2a1f30" stroke-width="1.5" />
        <rect x="144" y="80" width="12" height="4" rx="2" fill="#6b4a35" />
      </g>
      <path d="M40 120 v-10 m-4 4 l4 -4 4 4" stroke="#6f8f5e" stroke-width="2" fill="none" stroke-linecap="round" />
      <path d="M290 122 v-8 m-3 3 l3 -3 3 3" stroke="#6f8f5e" stroke-width="2" fill="none" stroke-linecap="round" />
      <path d="M60 136 q4 -6 8 0 M180 140 q4 -6 8 0 M270 138 q3 -5 6 0" stroke="#7f8f76" stroke-width="1.6" fill="none" stroke-linecap="round" />
      <rect x="0" y="96" width="320" height="54" fill={`url(#fog${id})`} />
    </svg>
  );
}

/** The derelict claim (W-113 story start): a small, sagging two-room shack — boarded window, dead tree, one candle. */
export function DerelictLotArt() {
  const id = useUid().replace(/[^A-Za-z0-9_-]/g, '');
  return (
    <svg viewBox="0 0 320 150" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <Sky id={id} />
      <path d="M0 120 C60 114 120 118 180 114 S280 112 320 116 V150 H0Z" fill="#2c3326" />
      <path d="M52 118 C54 98 48 84 56 70 M56 82 C64 78 68 70 70 62 M54 94 C44 90 40 82 40 76 M62 72 l8 -6" stroke="#17111e" stroke-width="3" fill="none" stroke-linecap="round" />
      <g transform="rotate(2.5 170 100)">
        <path d="M128 118 V86 L166 64 L214 84 V118Z" fill="#3b3140" stroke="#17111e" stroke-width="2" stroke-linejoin="round" />
        <path d="M120 88 L166 60 L222 86" fill="none" stroke="#211a26" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M150 70 l8 -4 l3 7 z" fill="#17111e" />
        <rect x="186" y="92" width="18" height="14" fill="#140f18" />
        <path d="M184 94 l22 8 M184 103 l22 -7" stroke="#6b5a4a" stroke-width="3" stroke-linecap="round" />
        <path d="M146 118 V96 h14 v22" fill="#17111e" />
        <path d="M160 96 l5 2 v20 l-5 0" fill="#5e4430" />
        <rect x="134" y="94" width="8" height="9" rx="1" fill="#ffb35a" opacity="0.8" />
        <path d="M196 112 h12 M130 110 h8" stroke="#17111e" stroke-width="2" />
      </g>
      <path d="M152 150 C154 136 150 126 156 118 h8 C160 128 166 138 166 150Z" fill="#4a3a2c" opacity="0.8" />
      <path d="M232 120 V100" stroke="#2a1f30" stroke-width="3" />
      <rect x="224" y="92" width="18" height="10" rx="3" fill="#5b4466" transform="rotate(-8 233 97)" />
      <rect x="0" y="96" width="320" height="54" fill={`url(#fog${id})`} />
    </svg>
  );
}
