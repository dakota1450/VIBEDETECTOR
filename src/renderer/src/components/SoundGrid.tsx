import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, MouseEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { KeyMode, LibraryFilter, Sound } from '@shared/types'
import { PITCH_CLASSES } from '@shared/keyColors'
import { withSymbol } from '@shared/format'
import { useStore } from '../store/useStore'
import { applyFilter } from '../lib/filter'
import { SoundRow } from './SoundRow'
import { EmptyState, NoResults } from './EmptyState'

const SORT_OPTIONS: { value: LibraryFilter['sort']; label: string }[] = [
  { value: 'added', label: 'Date added' },
  { value: 'name', label: 'Name' },
  { value: 'key', label: 'Key' },
  { value: 'bpm', label: 'Tempo' },
  { value: 'duration', label: 'Duration' }
]

export function SoundGrid(): JSX.Element {
  const sounds = useStore((s) => s.sounds)
  const filter = useStore((s) => s.filter)
  const selection = useStore((s) => s.selection)
  const playingId = useStore((s) => s.player.playingId)
  const isPlaying = useStore((s) => s.player.isPlaying)
  const sourcesCount = useStore((s) => s.sources.length)
  const patchFilter = useStore((s) => s.patchFilter)
  const clearSelection = useStore((s) => s.clearSelection)
  const [batchTonic, setBatchTonic] = useState('C')
  const [batchMode, setBatchMode] = useState<KeyMode>('major')

  const parentRef = useRef<HTMLDivElement>(null)
  const filtered = useMemo(() => applyFilter(sounds, filter), [sounds, filter])
  const selectedIds = useMemo(() => selection.filter((id) => sounds.some((s) => s.id === id)), [selection, sounds])

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 62,
    overscan: 12
  })

  // Keyboard navigation + audition.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (filtered.length === 0) return
      const { selection: sel, select, play } = useStore.getState()
      const activeId = sel[sel.length - 1]
      const idx = filtered.findIndex((s) => s.id === activeId)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = filtered[Math.min(filtered.length - 1, idx < 0 ? 0 : idx + 1)]
        if (next) {
          select(next.id, false)
          rowVirtualizer.scrollToIndex(filtered.indexOf(next), { align: 'auto' })
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const prev = filtered[Math.max(0, idx < 0 ? 0 : idx - 1)]
        if (prev) {
          select(prev.id, false)
          rowVirtualizer.scrollToIndex(filtered.indexOf(prev), { align: 'auto' })
        }
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (activeId != null) play(activeId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filtered, rowVirtualizer])

  const onSelect = (e: MouseEvent, id: number): void => {
    useStore.getState().select(id, e.metaKey || e.ctrlKey)
  }
  const onDragStart = (e: DragEvent, sound: Sound): void => {
    e.preventDefault()
    const { selection: sel } = useStore.getState()
    const ids = sel.includes(sound.id) && sel.length > 1 ? sel : [sound.id]
    const byId = new Map(sounds.map((s) => [s.id, s]))
    const paths = ids
      .map((i) => byId.get(i))
      .filter((s): s is Sound => !!s && !s.missing)
      .map((s) => s.path)
    window.api.startDrag(paths)
  }

  if (sourcesCount === 0) return <EmptyState />

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
        <div className="text-sm text-white/55">
          <span className="font-semibold text-white/85 tabular-nums">{filtered.length.toLocaleString()}</span> sound
          {filtered.length === 1 ? '' : 's'}
          {selection.length > 1 && <span className="ml-2 text-vibe">· {selection.length} selected</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={filter.sort}
            onChange={(e) => patchFilter({ sort: e.target.value as LibraryFilter['sort'] })}
            className="no-drag rounded-md bg-white/5 px-2 py-1 text-xs text-white/70 outline-none border border-white/8"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} className="bg-ink-800">
                {o.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => patchFilter({ sortDir: filter.sortDir === 'asc' ? 'desc' : 'asc' })}
            className="no-drag rounded-md bg-white/5 px-2 py-1 text-xs text-white/70 border border-white/8 hover:bg-white/10"
            title="Toggle sort direction"
          >
            {filter.sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

      {selectedIds.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-white/5 bg-white/[0.025] px-4 py-2 text-xs">
          <span className="font-medium text-white/65">{selectedIds.length} selected</span>
          <select
            value={batchTonic}
            onChange={(e) => setBatchTonic(e.target.value)}
            className="no-drag rounded-md bg-white/5 px-2 py-1 text-white/70 outline-none border border-white/8"
          >
            {PITCH_CLASSES.map((t) => (
              <option key={t} value={t} className="bg-ink-800">
                {withSymbol(t)}
              </option>
            ))}
          </select>
          <select
            value={batchMode}
            onChange={(e) => setBatchMode(e.target.value as KeyMode)}
            className="no-drag rounded-md bg-white/5 px-2 py-1 text-white/70 outline-none border border-white/8"
          >
            <option value="major" className="bg-ink-800">Major</option>
            <option value="minor" className="bg-ink-800">Minor</option>
          </select>
          <button
            onClick={() => void useStore.getState().batchOverride(selectedIds, { keyTonic: batchTonic, keyMode: batchMode })}
            className="no-drag rounded-md bg-vibe/20 px-2.5 py-1 font-medium text-[#c9b6ff] border border-vibe/40 hover:bg-vibe/25"
          >
            Set key
          </button>
          <button
            onClick={() => void useStore.getState().batchOverride(selectedIds, { keyTonic: null, keyMode: null })}
            className="no-drag rounded-md bg-white/5 px-2.5 py-1 font-medium text-white/60 border border-white/8 hover:bg-white/8"
          >
            Clear key
          </button>
          <button
            onClick={() => void useStore.getState().batchOverride(selectedIds, { type: 'melodic', subtype: null })}
            className="no-drag rounded-md bg-white/5 px-2.5 py-1 font-medium text-white/60 border border-white/8 hover:bg-white/8"
          >
            Melodic
          </button>
          <button
            onClick={() => void useStore.getState().batchOverride(selectedIds, { type: 'drum', subtype: null })}
            className="no-drag rounded-md bg-white/5 px-2.5 py-1 font-medium text-white/60 border border-white/8 hover:bg-white/8"
          >
            Drums
          </button>
          <button
            onClick={() => void Promise.all(selectedIds.map((id) => useStore.getState().setFavorite(id, true)))}
            className="no-drag rounded-md bg-white/5 px-2.5 py-1 font-medium text-white/60 border border-white/8 hover:bg-white/8"
          >
            Favorite
          </button>
          <button
            onClick={clearSelection}
            className="no-drag ml-auto rounded-md bg-white/5 px-2.5 py-1 font-medium text-white/45 border border-white/8 hover:bg-white/8"
          >
            Clear selection
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <NoResults />
      ) : (
        <div ref={parentRef} className="flex-1 overflow-y-auto px-2 py-2">
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const sound = filtered[vi.index]
              return (
                <div
                  key={sound.id}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: vi.size, transform: `translateY(${vi.start}px)` }}
                >
                  <SoundRow
                    sound={sound}
                    selected={selection.includes(sound.id)}
                    playing={playingId === sound.id && isPlaying}
                    onPlay={(id) => useStore.getState().play(id)}
                    onSelect={onSelect}
                    onToggleFav={(id, fav) => void useStore.getState().setFavorite(id, fav)}
                    onDragStart={onDragStart}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
