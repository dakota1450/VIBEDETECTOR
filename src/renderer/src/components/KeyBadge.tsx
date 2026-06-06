import type { DetectionSource, KeyMode } from '@shared/types'
import { keyColor } from '@shared/keyColors'
import { formatKey, formatKeyLong } from '@shared/format'
import { keyToCamelot } from '@shared/camelot'

function sourceLabel(source: DetectionSource | null | undefined): string {
  if (source === 'manual') return 'Manual'
  if (source === 'metadata') return 'Metadata'
  if (source === 'analysis') return 'Audio'
  if (source === 'filename') return 'Filename'
  return 'Unknown'
}

export function keyTrustLabel(
  source: DetectionSource | null | undefined,
  confidence: number | null | undefined,
  pending = false
): string {
  const pct = confidence != null && confidence > 0 ? ` ${Math.round(confidence * 100)}%` : ''
  return `${sourceLabel(source)}${pct}${pending ? ' · checking audio' : ''}`
}

function trustColor(source: DetectionSource | null | undefined, confidence: number | null | undefined, pending: boolean): string {
  if (pending) return '#f5c75c'
  if (source === 'manual') return '#ffd24a'
  if (source === 'metadata') return '#7cf0bd'
  if (source === 'filename') return confidence != null && confidence < 0.75 ? '#f5c75c' : '#9fe6ff'
  if (source === 'analysis') return confidence != null && confidence < 0.65 ? '#ff9f6e' : '#c9b6ff'
  return 'rgba(255,255,255,0.35)'
}

export function KeyBadge({
  tonic,
  mode,
  size = 'md',
  dim = false,
  source,
  confidence,
  pending = false
}: {
  tonic: string | null
  mode: KeyMode | null
  size?: 'sm' | 'md' | 'lg'
  dim?: boolean
  source?: DetectionSource | null
  confidence?: number
  pending?: boolean
}): JSX.Element {
  const c = keyColor(tonic, mode)
  const camelot = keyToCamelot(tonic, mode)
  const pad = size === 'lg' ? 'px-2.5 py-1 text-sm' : size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-0.5 text-xs'
  const trust = keyTrustLabel(source, confidence, pending)
  const title = tonic ? `${formatKeyLong(tonic, mode)}${camelot ? ` · ${camelot}` : ''} · ${trust}` : `Unknown key · ${trust}`
  return (
    <span
      className={`relative inline-flex items-center justify-center rounded-md font-semibold tabular-nums ${pad}`}
      style={{
        background: c.soft,
        color: c.text,
        border: `1px solid ${c.ring}`,
        opacity: dim ? 0.55 : 1,
        minWidth: size === 'sm' ? 30 : 38
      }}
      title={title}
    >
      {formatKey(tonic, mode)}
      {(tonic || pending) && (
        <span
          className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full"
          style={{ background: trustColor(source, confidence, pending), boxShadow: '0 0 0 1px rgba(11,11,17,0.6)' }}
        />
      )}
    </span>
  )
}
