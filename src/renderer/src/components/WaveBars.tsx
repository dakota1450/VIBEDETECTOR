import { useMemo } from 'react'

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Compact waveform bars. Uses cached decoded peaks when available, otherwise a deterministic placeholder. */
export function WaveBars({
  seed,
  color,
  peaks,
  bars = 32,
  className = ''
}: {
  seed: string
  color: string
  peaks?: number[] | null
  bars?: number
  className?: string
}): JSX.Element {
  const heights = useMemo(() => {
    if (peaks && peaks.length > 0) {
      const arr: number[] = []
      for (let i = 0; i < bars; i++) {
        const src = Math.min(peaks.length - 1, Math.floor((i / bars) * peaks.length))
        arr.push(Math.max(0.04, Math.min(1, peaks[src] ?? 0)))
      }
      return arr
    }
    let x = hashStr(seed) || 1
    const arr: number[] = []
    for (let i = 0; i < bars; i++) {
      x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff
      const rnd = (x % 1000) / 1000
      // hump shape so the middle is louder, like a real one-shot/sample
      const hump = Math.sin((Math.PI * i) / (bars - 1))
      arr.push(Math.max(0.12, Math.min(1, 0.2 + rnd * 0.6 * (0.5 + hump))))
    }
    return arr
  }, [seed, peaks, bars])

  return (
    <div className={`flex items-center gap-[2px] ${className}`} aria-hidden>
      {heights.map((h, i) => (
        <span
          key={i}
          className="w-[2px] rounded-full"
          style={{ height: `${Math.round(h * 100)}%`, background: color, opacity: 0.45 + h * 0.45 }}
        />
      ))}
    </div>
  )
}
