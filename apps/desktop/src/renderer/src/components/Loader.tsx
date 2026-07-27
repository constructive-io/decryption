const KEYFRAMES = [0, 1, 2, 3, 4, 5]
  .map(
    (i) => `
@keyframes dcrypt-cube${i} {
  0%, ${(i * 8.57).toFixed(1)}% {
    transform: translateY(${-220 - i * 40}px);
    opacity: 0;
  }
  ${(35.7 + i * 8.57).toFixed(1)}%, 100% {
    transform: translateY(0);
    opacity: 1;
  }
}
.dcrypt-cube-${i} {
  animation: dcrypt-cube${i} 1.4s cubic-bezier(0.65, 0, 0.35, 1) infinite alternate;
  transform-origin: center;
}`
  )
  .join('\n');

const CUBES: [string, string, string][] = [
  [
    'M103.923 300 L207.846 360 L207.846 480 L103.923 420 Z',
    'M311.769 300 L207.846 360 L207.846 480 L311.769 420 Z',
    'M207.846 240 L311.769 300 L207.846 360 L103.923 300 Z',
  ],
  [
    'M0 360 L103.923 420 L103.923 540 L0 480 Z',
    'M207.846 360 L103.923 420 L103.923 540 L207.846 480 Z',
    'M103.923 300 L207.846 360 L103.923 420 L0 360 Z',
  ],
  [
    'M103.923 -60 L207.846 0 L207.846 120 L103.923 60 Z',
    'M311.769 -60 L207.846 0 L207.846 120 L311.769 60 Z',
    'M207.846 -120 L311.769 -60 L207.846 0 L103.923 -60 Z',
  ],
  [
    'M-103.923 300 L0 360 L0 480 L-103.923 420 Z',
    'M103.923 300 L0 360 L0 480 L103.923 420 Z',
    'M0 240 L103.923 300 L0 360 L-103.923 300 Z',
  ],
  [
    'M0 0 L103.923 60 L103.923 180 L0 120 Z',
    'M207.846 0 L103.923 60 L103.923 180 L207.846 120 Z',
    'M103.923 -60 L207.846 0 L103.923 60 L0 0 Z',
  ],
  [
    'M-103.923 180 L0 240 L0 360 L-103.923 300 Z',
    'M103.923 180 L0 240 L0 360 L103.923 300 Z',
    'M0 120 L103.923 180 L0 240 L-103.923 180 Z',
  ],
];

/** The animated dcrypt cube-stack loader. */
export const Loader = ({ className }: { className?: string }) => (
  <svg viewBox="-125 -140 460 700" fill="none" className={className} role="status" aria-label="Loading">
    <style>{KEYFRAMES}</style>
    {CUBES.map((paths, i) => (
      <g key={i} className={`dcrypt-cube-${i}`}>
        {paths.map((d, j) => (
          <path
            key={j}
            d={d}
            fill={j === 1 ? '#01A1FF' : '#FFFFFF'}
            stroke="#01A1FF"
            strokeWidth={10}
            strokeLinejoin="round"
          />
        ))}
      </g>
    ))}
  </svg>
);
