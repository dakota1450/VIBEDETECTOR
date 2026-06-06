import { memo } from 'react'
import type { DragEvent, MouseEvent } from 'react'
import type { Sound } from '@shared/types'
import { keyColor } from '@shared/keyColors'
import { formatBpm, formatDuration } from '@shared/format'
import { KeyBadge } from './KeyBadge'
import { WaveBars } from './WaveBars'
import { Play, Pause, Star, StarFilled } from './icons'

interface Props {
  sound: Sound
  selected: boolean
  playing: boolean
  onPlay: (id: number) => void
  onSelect: (e: MouseEvent, id: number) => void
  onToggleFav: (id: number, fav: boolean) => void
  onDragStart: (e: DragEvent, sound: Sound) => void
}

function typeChip(s: Sound): { label: string; cls: string } {
  if (s.type === 'drum') return { label: 'Drums', cls: 'bg-amber-400/12 text-amber-200/90 border-amber-300/20' }
  if (s.type === 'melodic') return { label: 'Melodic', cls: 'bg-violet-400/12 text-violet-200/90 border-violet-300/20' }
  return { label: 'Unknown', cls: 'bg-white/5 text-white/45 border-white/10' }
}

export const SoundRow = memo(function SoundRow({
  sound,
  selected,
  playing,
  onPlay,
  onSelect,
  onToggleFav,
  onDragStart
}: Props): JSX.Element {
  const col = keyColor(sound.keyTonic, sound.keyMode)
  const chip = typeChip(sound)

  return (
    <div
      draggable={!sound.missing}
      onDragStart={(e) => {
        if (sound.missing) {
          e.preventDefault()
          return
        }
        onDragStart(e, sound)
      }}
      onClick={(e) => onSelect(e, sound.id)}
      className={`group flex h-[58px] items-center gap-3 rounded-lg px-2.5 transition-colors ${
        sound.missing ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
      }`}
      style={{
        background: selected ? 'rgba(139,92,255,0.13)' : 'transparent',
        boxShadow: selected ? 'inset 0 0 0 1px rgba(139,92,255,0.45)' : 'inset 0 0 0 1px transparent',
        opacity: sound.missing ? 0.45 : 1
      }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation()
          if (sound.missing) return
          onPlay(sound.id)
        }}
        disabled={sound.missing}
        className="no-drag grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors disabled:cursor-not-allowed"
        style={{ background: playing ? col.solid : 'rgba(255,255,255,0.07)', color: playing ? '#0b0b11' : '#fff' }}
        title={sound.missing ? 'File missing' : 'Preview'}
      >
        {playing ? <Pause width={16} height={16} /> : <Play width={15} height={15} />}
      </button>

      <KeyBadge
        tonic={sound.keyTonic}
        mode={sound.keyMode}
        source={sound.keySource}
        confidence={sound.keyConfidence}
        pending={sound.needsAudioAnalysis}
        dim={sound.keySource === 'analysis' && sound.keyConfidence < 0.65}
      />

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-white/90" title={sound.filename}>
          {sound.filename}
        </div>
        <div className={`truncate text-[11px] ${sound.analysisError ? 'text-rose-300/70' : 'text-white/35'}`} title={sound.analysisError ?? sound.folder}>
          {sound.analysisError ? `Analysis failed: ${sound.analysisError.replace(/_/g, ' ')}` : sound.folder || '—'}
        </div>
      </div>

      <div className="hidden md:flex h-7 w-28 items-center justify-center">
        <WaveBars seed={sound.filename} color={col.solid} peaks={sound.waveformPeaks} className="h-7 w-full" />
      </div>

      <span className={`hidden sm:inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${chip.cls}`}>
        {chip.label}
      </span>

      <div className="w-12 shrink-0 text-right">
        {sound.bpm != null ? (
          <span className="font-mono text-xs text-white/70 tabular-nums" title={sound.bpmSource ? `${sound.bpmSource} BPM` : ''}>
            {formatBpm(sound.bpm)}
          </span>
        ) : (
          <span className="text-xs text-white/20">—</span>
        )}
      </div>

      <div className="w-12 shrink-0 text-right text-xs text-white/45 tabular-nums">{formatDuration(sound.durationSec)}</div>

      <button
        onClick={(e) => {
          e.stopPropagation()
          onToggleFav(sound.id, !sound.isFavorite)
        }}
        className="no-drag shrink-0 p-1 transition-colors"
        style={{ color: sound.isFavorite ? '#ffd24a' : 'rgba(255,255,255,0.25)' }}
        title={sound.isFavorite ? 'Unfavorite' : 'Favorite'}
      >
        {sound.isFavorite ? <StarFilled width={16} height={16} /> : <Star width={16} height={16} />}
      </button>
    </div>
  )
})
