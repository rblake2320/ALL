/**
 * DEV ONLY — a stand-in for the 3D view so HUD contrast can be judged over a realistic scene: an isometric lot with
 * cutaway walls, floors, a few furniture blocks and zombie figures at the mock bubble anchors.
 */
import { ANCHORS } from './mockGame';

export function Backdrop({ night, moon, mode }: { night: boolean; moon: boolean; mode: string }) {
  const sky = night ? (moon ? ['#14202a', '#1d2a2a'] : ['#141225', '#231a34']) : ['#5f6b72', '#9aa39a'];
  const grass = night ? '#2b3a2c' : '#5f7d50';
  const fig = (id: string, skin: string, top: string) => {
    const a = ANCHORS[id];
    const s = a.scale;
    return (
      <g transform={`translate(${a.fx * 1600} ${a.fy * 900 + 25 * s}) scale(${s})`}>
        <ellipse cx="0" cy="58" rx="20" ry="6" fill="#000" opacity="0.35" />
        <path d="M-15 56 L-13 20 Q0 8 13 20 L15 56 Z" fill={top} />
        <rect x="-5" y="2" width="10" height="12" fill={skin} />
        <ellipse cx="0" cy="-8" rx="15" ry="17" fill={skin} />
        <circle cx="-5" cy="-9" r="3.2" fill="#efe6c8" />
        <circle cx="5" cy="-9" r="3.2" fill="#efe6c8" />
        <circle cx="-5" cy="-8.5" r="1.4" fill="#2a1d2c" />
        <circle cx="5" cy="-8.5" r="1.4" fill="#2a1d2c" />
      </g>
    );
  };
  return (
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%' }} aria-hidden="true">
      <defs>
        <linearGradient id="bd-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={sky[0]} />
          <stop offset="1" stop-color={sky[1]} />
        </linearGradient>
        <radialGradient id="bd-lamp" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#ffb35a" stop-opacity="0.5" />
          <stop offset="1" stop-color="#ffb35a" stop-opacity="0" />
        </radialGradient>
        <pattern id="bd-tiles" width="60" height="34.6" patternUnits="userSpaceOnUse" patternTransform="translate(0 0)">
          <path d="M0 17.3 L30 0 L60 17.3 L30 34.6 Z" fill="none" stroke="rgba(0,0,0,0.18)" stroke-width="1" />
        </pattern>
      </defs>
      <rect width="1600" height="900" fill="url(#bd-sky)" />
      {night && <circle cx="1320" cy="150" r={moon ? 58 : 40} fill={moon ? '#dff7c8' : '#e8e0c8'} opacity="0.9" />}
      {/* far houses */}
      <path d="M0 360 L120 300 L240 360 L240 430 L0 430 Z M1300 330 L1420 270 L1540 330 L1540 420 L1300 420 Z" fill={night ? '#1a1622' : '#4a5258'} />
      {/* ground */}
      <path d="M800 260 L1560 700 L800 1140 L40 700 Z" fill={grass} />
      <path d="M800 330 L1400 676 L800 1022 L200 676 Z" fill={night ? '#4a3a32' : '#7a5a3e'} />
      <path d="M800 330 L1400 676 L800 1022 L200 676 Z" fill="url(#bd-tiles)" />
      {/* cutaway walls */}
      <path d="M200 676 L800 330 L800 352 L200 698 Z" fill={night ? '#4a3f55' : '#8a7f95'} />
      <path d="M800 330 L1400 676 L1400 698 L800 352 Z" fill={night ? '#3a3046' : '#6f6680'} />
      <path d="M520 491 L1120 837 L1120 856 L520 510 Z" fill={night ? '#3a3046' : '#6f6680'} opacity="0.9" />
      {/* furniture */}
      <path d="M640 470 L720 424 L800 470 L720 516 Z" fill="#5b3f6e" />
      <path d="M640 470 L720 516 L720 540 L640 494 Z" fill="#4a3259" />
      <path d="M720 516 L800 470 L800 494 L720 540 Z" fill="#3a2848" />
      <path d="M980 520 L1030 491 L1080 520 L1030 549 Z" fill="#2b2f3a" />
      <path d="M980 520 L1030 549 L1030 600 L980 571 Z" fill="#1f222b" />
      <path d="M1030 549 L1080 520 L1080 571 L1030 600 Z" fill="#14161d" />
      <path d="M990 532 L1025 552 L1025 586 L990 566 Z" fill="#9fe870" opacity={night ? 0.8 : 0.5} />
      <circle cx="560" cy="600" r="120" fill="url(#bd-lamp)" opacity={night ? 1 : 0.4} />
      {mode === 'live' && (
        <>
          {fig('t2', '#8fa7a0', '#2b2f3a')}
          {fig('a1', '#9fb88a', '#5e4a7a')}
          {fig('t1', '#8f9fbf', '#3f5a4a')}
          {fig('a3', '#7f8f76', '#4a4a3a')}
        </>
      )}
    </svg>
  );
}
