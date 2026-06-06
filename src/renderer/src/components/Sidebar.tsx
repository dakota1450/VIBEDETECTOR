import type { ReactNode } from 'react'
import type { LibraryFilter } from '@shared/types'
import { useStore } from '../store/useStore'
import { KeyWheel } from './KeyWheel'
import { Drum, Folder, Music, Plus, Star, Trash } from './icons'

const TEMPO_PRESETS: { label: string; min: number | null; max: number | null }[] = [
  { label: '< 90', min: null, max: 89 },
  { label: '90–110', min: 90, max: 110 },
  { label: '110–140', min: 110, max: 140 },
  { label: '140+', min: 140, max: null }
]
const BPM_MIN = 40
const BPM_MAX = 300

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }): JSX.Element {
  return (
    <div className="px-4 py-3 border-b border-white/5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-white/40">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  )
}

function Pill({
  active,
  onClick,
  children,
  color
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  color?: string
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className="no-drag rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
      style={{
        background: active ? color ?? 'rgba(139,92,255,0.9)' : 'rgba(255,255,255,0.05)',
        color: active ? '#0b0b11' : 'rgba(255,255,255,0.7)',
        border: '1px solid',
        borderColor: active ? 'transparent' : 'rgba(255,255,255,0.08)'
      }}
    >
      {children}
    </button>
  )
}

export function Sidebar(): JSX.Element {
  const { sources, filter, patchFilter, setType, addSources, removeSource } = useStore()

  const parseTempoInput = (value: string): number | null => {
    if (!value.trim()) return null
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return null
    return Math.round(parsed)
  }

  const clampTempo = (value: number | null): number | null =>
    value == null ? null : Math.max(BPM_MIN, Math.min(BPM_MAX, value))

  const setTempo = (min: number | null, max: number | null): void => {
    const same = filter.bpmMin === min && filter.bpmMax === max
    patchFilter({ bpmMin: same ? null : min, bpmMax: same ? null : max })
  }

  const toggleSource = (id: number): void => {
    const active = filter.sourceIds.includes(id)
    patchFilter({ sourceIds: active ? filter.sourceIds.filter((sourceId) => sourceId !== id) : [...filter.sourceIds, id] })
  }

  const confirmRemoveSource = (id: number, label: string): void => {
    if (!window.confirm(`Remove "${label}" from Vibe Detector? Your files stay on disk.`)) return
    void removeSource(id)
  }

  return (
    <aside className="w-[300px] shrink-0 h-full overflow-y-auto border-r border-white/5 bg-black/20">
      <Section title="Key — circle of fifths">
        <KeyWheel />
        <label className="mt-3 flex items-center gap-1.5 text-xs text-white/55 cursor-pointer no-drag">
          <input
            type="checkbox"
            checked={filter.matchKeyAnyMode}
            onChange={(e) => patchFilter({ matchKeyAnyMode: e.target.checked })}
            className="accent-[#8b5cff]"
          />
          Root only
        </label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(['unknown', 'low', 'verified'] as LibraryFilter['keyStatus'][]).map((status) => (
            <Pill
              key={status}
              active={filter.keyStatus === status}
              onClick={() => patchFilter({ keyStatus: filter.keyStatus === status ? 'all' : status })}
            >
              {status === 'unknown' ? 'Unknown' : status === 'low' ? 'Low' : 'Verified'}
            </Pill>
          ))}
        </div>
      </Section>

      <Section title="Review">
        <div className="flex flex-wrap gap-1.5">
          {(['needs_review', 'analysis_failed'] as LibraryFilter['reviewStatus'][]).map((status) => (
            <Pill
              key={status}
              active={filter.reviewStatus === status}
              onClick={() => patchFilter({ reviewStatus: filter.reviewStatus === status ? 'all' : status })}
            >
              {status === 'needs_review' ? 'Needs review' : 'Failed analysis'}
            </Pill>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <div className="flex gap-2">
          {(['all', 'melodic', 'drum'] as LibraryFilter['type'][]).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className="no-drag flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors"
              style={{
                background: filter.type === t ? 'rgba(139,92,255,0.18)' : 'rgba(255,255,255,0.04)',
                color: filter.type === t ? '#c9b6ff' : 'rgba(255,255,255,0.6)',
                border: `1px solid ${filter.type === t ? 'rgba(139,92,255,0.5)' : 'rgba(255,255,255,0.06)'}`
              }}
            >
              {t === 'drum' ? <Drum width={15} height={15} /> : t === 'melodic' ? <Music width={15} height={15} /> : null}
              {t === 'all' ? 'All' : t === 'melodic' ? 'Melodic' : 'Drums'}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Tempo (BPM)">
        <div className="flex flex-wrap gap-1.5 mb-3">
          {TEMPO_PRESETS.map((p) => (
            <Pill key={p.label} active={filter.bpmMin === p.min && filter.bpmMax === p.max} onClick={() => setTempo(p.min, p.max)}>
              {p.label}
            </Pill>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input
            type="number"
            min={BPM_MIN}
            max={BPM_MAX}
            placeholder="min"
            value={filter.bpmMin ?? ''}
            onChange={(e) => patchFilter({ bpmMin: parseTempoInput(e.target.value) })}
            onBlur={() => patchFilter({ bpmMin: clampTempo(filter.bpmMin) })}
            className="no-drag w-16 rounded-md bg-white/5 px-2 py-1 text-center tabular-nums outline-none border border-white/8 focus:border-vibe/60"
          />
          <span className="text-white/30">–</span>
          <input
            type="number"
            min={BPM_MIN}
            max={BPM_MAX}
            placeholder="max"
            value={filter.bpmMax ?? ''}
            onChange={(e) => patchFilter({ bpmMax: parseTempoInput(e.target.value) })}
            onBlur={() => patchFilter({ bpmMax: clampTempo(filter.bpmMax) })}
            className="no-drag w-16 rounded-md bg-white/5 px-2 py-1 text-center tabular-nums outline-none border border-white/8 focus:border-vibe/60"
          />
          <label className="ml-auto flex items-center gap-1.5 text-xs text-white/55 cursor-pointer no-drag">
            <input
              type="checkbox"
              checked={filter.halfDoubleTime}
              onChange={(e) => patchFilter({ halfDoubleTime: e.target.checked })}
              className="accent-[#8b5cff]"
            />
            ½×/2×
          </label>
        </div>
        <label className="mt-2 flex items-center gap-1.5 text-xs text-white/55 cursor-pointer no-drag">
          <input
            type="checkbox"
            checked={filter.hasTempoOnly}
            onChange={(e) => patchFilter({ hasTempoOnly: e.target.checked })}
            className="accent-[#8b5cff]"
          />
          Only sounds with a detected tempo
        </label>
      </Section>

      <Section
        title="Sources"
        right={
          <button onClick={() => void addSources()} className="no-drag flex items-center gap-1 rounded-md bg-vibe/90 px-2 py-1 text-xs font-semibold text-[#0b0b11] hover:bg-vibe">
            <Plus width={13} height={13} /> Add
          </button>
        }
      >
        <label className="mb-2 flex items-center gap-1.5 text-xs text-white/55 cursor-pointer no-drag">
          <input
            type="checkbox"
            checked={filter.favoritesOnly}
            onChange={(e) => patchFilter({ favoritesOnly: e.target.checked })}
            className="accent-[#8b5cff]"
          />
          <Star width={13} height={13} /> Favorites only
        </label>
        {sources.length > 0 && filter.sourceIds.length > 0 && (
          <button
            onClick={() => patchFilter({ sourceIds: [] })}
            className="no-drag mb-2 rounded-md bg-white/6 px-2 py-1 text-[11px] font-medium text-white/60 hover:bg-white/10"
          >
            Show all sources
          </button>
        )}
        {sources.length === 0 ? (
          <p className="text-xs text-white/35 leading-relaxed">No folders yet. Add a sample folder to detect the vibe of your sounds.</p>
        ) : (
          <ul className="space-y-1">
            {sources.map((s) => (
              <li
                key={s.id}
                className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/5"
                style={{
                  background: filter.sourceIds.includes(s.id) ? 'rgba(139,92,255,0.12)' : undefined,
                  boxShadow: filter.sourceIds.includes(s.id) ? 'inset 0 0 0 1px rgba(139,92,255,0.35)' : undefined
                }}
              >
                <input
                  type="checkbox"
                  checked={filter.sourceIds.includes(s.id)}
                  onChange={() => toggleSource(s.id)}
                  className="no-drag accent-[#8b5cff]"
                  title="Filter by this source"
                />
                <button onClick={() => toggleSource(s.id)} className="no-drag flex min-w-0 flex-1 items-center gap-2 text-left">
                  <Folder width={15} height={15} className="text-white/40 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-white/80" title={s.path}>{s.label}</div>
                    <div className="text-[10px] text-white/35 tabular-nums">{s.soundCount} sounds</div>
                  </div>
                </button>
                <button
                  onClick={() => confirmRemoveSource(s.id, s.label)}
                  className="no-drag opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-400 transition"
                  title="Remove source"
                >
                  <Trash width={14} height={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </aside>
  )
}
