import { useId } from 'react'

// The Vibe Detector mark: a radar sweeping the circle of fifths. Twelve key dots sit
// where they sit on the app's key wheel (C at the top, fifths clockwise) in the same
// key colours; the keys under the sweep are "detected" — larger and lit.
const FIFTHS = 12
const LIT = new Set([0, 1, 2]) // C, G, D — under the sweep

export function BrandMark({ size = 28, animated = false, plate = true }: { size?: number; animated?: boolean; plate?: boolean }): JSX.Element {
  const id = useId().replace(/:/g, '')
  const small = size < 40
  const dotR = small ? 6.6 : 4.4
  const ringR = small ? 37 : 39
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className="shrink-0">
      <defs>
        <radialGradient id={`bg${id}`} cx="50%" cy="28%" r="85%">
          <stop offset="0" stopColor="#1f1f31" />
          <stop offset="1" stopColor="#09090f" />
        </radialGradient>
        <linearGradient id={`sw${id}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#d9ccff" stopOpacity={small ? 0.5 : 0.42} />
        </linearGradient>
      </defs>
      {plate && <rect width="100" height="100" rx="23" fill={`url(#bg${id})`} />}
      {!small && (
        <g fill="none" stroke="#fff" strokeOpacity="0.1" strokeWidth="0.9">
          <circle cx="50" cy="50" r="29" />
          <circle cx="50" cy="50" r="19" />
          <circle cx="50" cy="50" r="9" />
        </g>
      )}
      <g className={animated ? 'origin-center animate-sweep' : undefined} style={{ transformOrigin: '50px 50px' }}>
        <path d={`M50 50 L50 ${50 - (small ? 31 : 30)} A${small ? 31 : 30} ${small ? 31 : 30} 0 0 1 ${50 + (small ? 31 : 30) * Math.sin(Math.PI / 3)} ${50 - (small ? 31 : 30) * Math.cos(Math.PI / 3)} Z`} fill={`url(#sw${id})`} />
      </g>
      {Array.from({ length: FIFTHS }, (_, i) => {
        const a = ((i * 30 - 90) * Math.PI) / 180
        const lit = LIT.has(i)
        const hue = i * 30
        return (
          <circle
            key={i}
            cx={50 + ringR * Math.cos(a)}
            cy={50 + ringR * Math.sin(a)}
            r={lit ? dotR * 1.22 : dotR}
            fill={`hsl(${hue} ${lit ? 88 : 72}% ${lit ? 62 : 52}%)`}
            opacity={lit ? 1 : 0.78}
          />
        )
      })}
      <circle cx="50" cy="50" r={small ? 7.5 : 4.6} fill="#fff" />
    </svg>
  )
}
