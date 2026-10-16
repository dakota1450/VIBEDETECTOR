import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { CIRCLE_OF_FIFTHS, keyColor } from '@shared/keyColors'
import { formatKey, withSymbol } from '@shared/format'
import { keyToCamelot } from '@shared/camelot'
import type { KeyMode } from '@shared/types'
import { effectiveKeys } from '../lib/filter'

const SIZE = 232
const C = SIZE / 2
const R_OUT = 110
const R_MID = 72
const R_IN = 40

function polar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [C + r * Math.cos(a), C + r * Math.sin(a)]
}

function sector(rIn: number, rOut: number, a0: number, a1: number): string {
  const [x0o, y0o] = polar(rOut, a0)
  const [x1o, y1o] = polar(rOut, a1)
  const [x1i, y1i] = polar(rIn, a1)
  const [x0i, y0i] = polar(rIn, a0)
  return `M ${x0o} ${y0o} A ${rOut} ${rOut} 0 0 1 ${x1o} ${y1o} L ${x1i} ${y1i} A ${rIn} ${rIn} 0 0 0 ${x0i} ${y0i} Z`
}

/**
 * The circle-of-fifths key filter, doubling as a map of the library: each segment's
 * brightness shows how many sounds sit in that key, so where a collection lives
 * harmonically is visible at a glance. Tonic-only sounds (single notes, 808s) count
 * toward both the major and minor key on their root — they fit either.
 */
export function KeyWheel(): JSX.Element {
  const filter = useStore((s) => s.filter)
  const keys = filter.keys
  const sounds = useStore((s) => s.sounds)
  const toggleKey = useStore((s) => s.toggleKey)
  const patchFilter = useStore((s) => s.patchFilter)
  const [hover, setHover] = useState<{ tonic: string; mode: KeyMode } | null>(null)

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of sounds) {
      if (!s.keyTonic || s.missing) continue
      const modes: KeyMode[] = s.keyMode ? [s.keyMode] : ['major', 'minor']
      for (const md of modes) m.set(`${s.keyTonic}|${md}`, (m.get(`${s.keyTonic}|${md}`) ?? 0) + 1)
    }
    return m
  }, [sounds])
  const maxCount = useMemo(() => Math.max(1, ...counts.values()), [counts])

  const isSel = (tonic: string, mode: KeyMode): boolean => keys.some((k) => k.tonic === tonic && k.mode === mode)
  const widened = useMemo(() => effectiveKeys(filter), [filter])
  const isCompatible = (tonic: string, mode: KeyMode): boolean =>
    !isSel(tonic, mode) && widened.some((k) => k.tonic === tonic && k.mode === mode)

  const renderRing = (mode: KeyMode, rIn: number, rOut: number): JSX.Element[] =>
    CIRCLE_OF_FIFTHS.map((tonic, i) => {
      const center = i * 30 - 90
      const a0 = center - 14
      const a1 = center + 14
      const col = keyColor(tonic, mode)
      const selected = isSel(tonic, mode)
      const compatible = isCompatible(tonic, mode)
      const hovered = hover?.tonic === tonic && hover.mode === mode
      const n = counts.get(`${tonic}|${mode}`) ?? 0
      const density = n > 0 ? 0.42 + 0.58 * Math.sqrt(n / maxCount) : 0.16
      const [lx, ly] = polar((rIn + rOut) / 2, center)
      const label = mode === 'minor' ? `${withSymbol(tonic)}m` : withSymbol(tonic)
      return (
        <g
          key={`${mode}-${tonic}`}
          className="cursor-pointer no-drag"
          onClick={() => toggleKey(tonic, mode)}
          onMouseEnter={() => setHover({ tonic, mode })}
          onMouseLeave={() => setHover((h) => (h?.tonic === tonic && h.mode === mode ? null : h))}
        >
          <path
            d={sector(rIn, rOut, a0, a1)}
            fill={col.solid}
            stroke={selected ? '#fff' : compatible ? 'rgba(255,255,255,0.75)' : 'rgba(8,8,13,0.55)'}
            strokeWidth={selected ? 2 : compatible ? 1.5 : 1}
            strokeDasharray={compatible ? '3 2' : undefined}
            style={{
              opacity: selected || hovered ? 1 : compatible ? Math.max(0.8, density) : density,
              filter: selected ? 'saturate(1.2)' : 'none',
              transition: 'opacity 140ms ease'
            }}
          />
          <text
            x={lx}
            y={ly}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={mode === 'minor' ? 10 : 12}
            fontWeight={700}
            fill="#0b0b11"
            style={{ pointerEvents: 'none', opacity: selected || hovered ? 1 : n > 0 ? 0.85 : 0.55 }}
          >
            {label}
          </text>
        </g>
      )
    })

  const hoverCount = hover ? counts.get(`${hover.tonic}|${hover.mode}`) ?? 0 : 0
  const hoverCamelot = hover ? keyToCamelot(hover.tonic, hover.mode) : null

  return (
    <div className="flex flex-col items-center">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="select-none">
        <circle cx={C} cy={C} r={R_OUT + 6} fill="rgba(255,255,255,0.02)" />
        {renderRing('major', R_MID, R_OUT)}
        {renderRing('minor', R_IN, R_MID)}
        <circle
          cx={C}
          cy={C}
          r={R_IN - 4}
          fill="rgba(11,11,17,0.92)"
          stroke="rgba(255,255,255,0.08)"
          className="cursor-pointer no-drag"
          onClick={() => patchFilter({ keys: [] })}
        />
        {hover ? (
          <>
            <text x={C} y={C - 7} textAnchor="middle" fontSize={13} fontWeight={700} fill={keyColor(hover.tonic, hover.mode).text} style={{ pointerEvents: 'none' }}>
              {formatKey(hover.tonic, hover.mode)}
              {hoverCamelot ? <tspan fontSize={9} fontWeight={600} fill="#8a8aa0">{` ${hoverCamelot}`}</tspan> : null}
            </text>
            <text x={C} y={C + 9} textAnchor="middle" fontSize={9} fill="#8a8aa0" style={{ pointerEvents: 'none' }}>
              {hoverCount.toLocaleString()} sound{hoverCount === 1 ? '' : 's'}
            </text>
          </>
        ) : (
          <>
            <text x={C} y={C - 6} textAnchor="middle" fontSize={11} fill="#9aa" style={{ pointerEvents: 'none' }}>
              {keys.length ? `${keys.length} key${keys.length > 1 ? 's' : ''}` : 'KEY'}
            </text>
            <text x={C} y={C + 9} textAnchor="middle" fontSize={9} fill="#667" style={{ pointerEvents: 'none' }}>
              {keys.length ? 'clear' : 'detector'}
            </text>
          </>
        )}
      </svg>
      <div className="mt-1 flex items-center gap-3 text-[10px] uppercase tracking-wide text-white/35">
        <span>outer · major</span>
        <span>inner · minor</span>
      </div>
    </div>
  )
}
