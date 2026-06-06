import { useStore } from '../store/useStore'
import { CIRCLE_OF_FIFTHS, keyColor } from '@shared/keyColors'
import { withSymbol } from '@shared/format'
import type { KeyMode } from '@shared/types'

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

export function KeyWheel(): JSX.Element {
  const keys = useStore((s) => s.filter.keys)
  const toggleKey = useStore((s) => s.toggleKey)
  const patchFilter = useStore((s) => s.patchFilter)

  const isSel = (tonic: string, mode: KeyMode): boolean =>
    keys.some((k) => k.tonic === tonic && k.mode === mode)

  const renderRing = (mode: KeyMode, rIn: number, rOut: number): JSX.Element[] =>
    CIRCLE_OF_FIFTHS.map((tonic, i) => {
      const center = i * 30 - 90
      const a0 = center - 14
      const a1 = center + 14
      const col = keyColor(tonic, mode)
      const selected = isSel(tonic, mode)
      const [lx, ly] = polar((rIn + rOut) / 2, center)
      const label = mode === 'minor' ? `${withSymbol(tonic)}m` : withSymbol(tonic)
      return (
        <g
          key={`${mode}-${tonic}`}
          className="cursor-pointer no-drag"
          onClick={() => toggleKey(tonic, mode)}
          style={{ transition: 'opacity 120ms' }}
        >
          <path
            d={sector(rIn, rOut, a0, a1)}
            fill={col.solid}
            stroke={selected ? '#fff' : 'rgba(8,8,13,0.55)'}
            strokeWidth={selected ? 2 : 1}
            style={{ opacity: selected ? 1 : 0.6, filter: selected ? 'saturate(1.2)' : 'none' }}
          />
          <text
            x={lx}
            y={ly}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={mode === 'minor' ? 10 : 12}
            fontWeight={700}
            fill="#0b0b11"
            style={{ pointerEvents: 'none', opacity: selected ? 1 : 0.82 }}
          >
            {label}
          </text>
        </g>
      )
    })

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
          fill="rgba(11,11,17,0.9)"
          stroke="rgba(255,255,255,0.08)"
          className="cursor-pointer no-drag"
          onClick={() => patchFilter({ keys: [] })}
        />
        <text x={C} y={C - 6} textAnchor="middle" fontSize={11} fill="#9aa" style={{ pointerEvents: 'none' }}>
          {keys.length ? `${keys.length} key${keys.length > 1 ? 's' : ''}` : 'KEY'}
        </text>
        <text x={C} y={C + 9} textAnchor="middle" fontSize={9} fill="#667" style={{ pointerEvents: 'none' }}>
          {keys.length ? 'clear' : 'detector'}
        </text>
      </svg>
      <div className="mt-1 flex items-center gap-3 text-[10px] uppercase tracking-wide text-white/35">
        <span>outer · major</span>
        <span>inner · minor</span>
      </div>
    </div>
  )
}
