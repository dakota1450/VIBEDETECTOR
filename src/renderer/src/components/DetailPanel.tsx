import { useEffect, useMemo, useState } from 'react'
import type { KeyMode, Sound, SoundType } from '@shared/types'
import { useStore } from '../store/useStore'
import { PITCH_CLASSES, keyColor, pitchIndex } from '@shared/keyColors'
import { formatBytes, formatDuration, formatKeyLong } from '@shared/format'
import { keyToCamelot } from '@shared/camelot'
import { bpmMatches } from '@shared/bpmDetect'
import { KeyBadge, keyTrustLabel } from './KeyBadge'
import { Play, Reveal, Star, StarFilled, X } from './icons'

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex justify-between gap-2 text-xs">
      <span className="text-white/35">{label}</span>
      <span className="text-white/70 tabular-nums truncate" title={value}>
        {value}
      </span>
    </div>
  )
}

function keyAffinity(a: Sound, b: Sound): { score: number; label: string | null } {
  const ai = pitchIndex(a.keyTonic)
  const bi = pitchIndex(b.keyTonic)
  if (ai < 0 || bi < 0) return { score: 0, label: null }
  let score = 0
  let label: string | null = null
  if (a.keyTonic === b.keyTonic && a.keyMode === b.keyMode) {
    score = 5
    label = 'same key'
  } else if (a.keyTonic === b.keyTonic) {
    score = 4
    label = 'same root'
  }

  const relative = a.keyMode === 'major' ? (ai + 9) % 12 : a.keyMode === 'minor' ? (ai + 3) % 12 : -1
  if (!label && relative === bi) {
    score = 3
    label = 'relative key'
  }

  const diff = (bi - ai + 12) % 12
  if (!label && (diff === 5 || diff === 7)) {
    score = 2
    label = 'nearby key'
  }
  if (!label) return { score: 0, label: null }

  const trust = Math.min(keyReliability(a), keyReliability(b))
  return { score: score * (0.55 + trust * 0.45), label: trust < 0.65 ? `possible ${label}` : label }
}

function keyReliability(s: Sound): number {
  if (!s.keyTonic) return 0
  if (s.keySource === 'manual') return 1
  if (s.keySource === 'metadata') return Math.max(0.9, s.keyConfidence)
  if (s.keySource === 'filename') return Math.max(0.72, s.keyConfidence)
  return Math.max(0.25, Math.min(1, s.keyConfidence))
}

export function DetailPanel(): JSX.Element | null {
  const sounds = useStore((s) => s.sounds)
  const selection = useStore((s) => s.selection)
  const override = useStore((s) => s.override)
  const setFavorite = useStore((s) => s.setFavorite)
  const setTags = useStore((s) => s.setTags)
  const reveal = useStore((s) => s.reveal)
  const select = useStore((s) => s.select)
  const play = useStore((s) => s.play)
  const [tagInput, setTagInput] = useState('')
  const [bpmInput, setBpmInput] = useState('')
  const [notesInput, setNotesInput] = useState('')

  const activeId = selection[selection.length - 1]
  const s = sounds.find((x) => x.id === activeId)

  useEffect(() => {
    setTagInput('')
    setBpmInput(s?.bpm != null ? String(Math.round(s.bpm)) : '')
    setNotesInput(s?.notes ?? '')
  }, [s?.id, s?.bpm, s?.notes])

  const matches = useMemo(() => {
    if (!s) return []
    return sounds
      .filter((candidate) => candidate.id !== s.id && !candidate.missing)
      .map((candidate) => {
        let score = 0
        const reasons: string[] = []
        const key = keyAffinity(s, candidate)
        if (key.score > 0 && key.label) {
          score += key.score
          reasons.push(key.label)
        }
        if (s.bpm != null && candidate.bpm != null && bpmMatches(candidate.bpm, s.bpm - 4, s.bpm + 4, true)) {
          score += 3
          reasons.push('tempo fit')
        }
        if (s.type !== 'unknown' && candidate.type !== 'unknown' && s.type !== candidate.type) {
          score += 1
          reasons.push(candidate.type === 'drum' ? 'drum layer' : 'melodic layer')
        }
        return score > 0 ? { sound: candidate, score, reasons } : null
      })
      .filter((match): match is { sound: Sound; score: number; reasons: string[] } => match != null)
      .sort((a, b) => b.score - a.score || Number(b.sound.isFavorite) - Number(a.sound.isFavorite) || a.sound.filename.localeCompare(b.sound.filename))
      .slice(0, 5)
  }, [s, sounds])

  if (!s) return null

  const addTag = (): void => {
    const t = tagInput.trim().toLowerCase()
    if (t && !s.tags.includes(t)) void setTags(s.id, [...s.tags, t])
    setTagInput('')
  }

  const saveBpm = (): void => {
    const raw = bpmInput.trim()
    if (!raw) {
      void override(s.id, { bpm: null })
      return
    }
    const bpm = Number(raw)
    if (!Number.isFinite(bpm) || bpm < 40 || bpm > 300) {
      setBpmInput(s.bpm != null ? String(Math.round(s.bpm)) : '')
      return
    }
    void override(s.id, { bpm: Math.round(bpm) })
  }

  const seg = (active: boolean): string =>
    `flex-1 rounded-md py-1.5 text-xs font-medium transition ${
      active ? 'bg-vibe/20 text-[#c9b6ff] border border-vibe/50' : 'bg-white/4 text-white/55 border border-white/8 hover:bg-white/8'
    }`

  return (
    <aside className="w-[332px] shrink-0 h-full overflow-y-auto border-l border-white/5 bg-black/20">
      <div className="p-4 space-y-5">
        {/* Header */}
        <div>
          <div className="flex items-start gap-2">
            <h2 className="flex-1 text-sm font-semibold text-white/90 break-words">{s.filename}</h2>
            <button
              onClick={() => void setFavorite(s.id, !s.isFavorite)}
              className="p-1"
              style={{ color: s.isFavorite ? '#ffd24a' : 'rgba(255,255,255,0.3)' }}
            >
              {s.isFavorite ? <StarFilled width={18} height={18} /> : <Star width={18} height={18} />}
            </button>
          </div>
          <p className="mt-0.5 text-xs text-white/35 break-words">{s.folder}</p>
          {s.missing && <p className="mt-1 text-xs text-red-400">File is missing from disk</p>}
        </div>

        {/* Drag to DAW */}
        <div
          draggable={!s.missing}
          onDragStart={(e) => {
            e.preventDefault()
            if (s.missing) return
            const ids = selection.includes(s.id) && selection.length > 1 ? selection : [s.id]
            const byId = new Map(sounds.map((x) => [x.id, x]))
            window.api.startDrag(
              ids
                .map((i) => byId.get(i))
                .filter((sound): sound is Sound => !!sound && !sound.missing)
                .map((sound) => sound.path)
            )
          }}
          className={`flex items-center justify-center gap-2 rounded-lg border border-dashed py-3 text-xs font-medium ${
            s.missing
              ? 'cursor-not-allowed border-white/10 bg-white/3 text-white/35'
              : 'cursor-grab border-vibe/30 bg-vibe/5 text-vibe/90 active:cursor-grabbing'
          }`}
        >
          Drag into your DAW
        </div>

        {/* Key */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Key</h3>
            <span className="text-[10px] text-white/35">
              {s.keyTonic
                ? `${formatKeyLong(s.keyTonic, s.keyMode)}${keyToCamelot(s.keyTonic, s.keyMode) ? ` · ${keyToCamelot(s.keyTonic, s.keyMode)}` : ''} · ${keyTrustLabel(s.keySource, s.keyConfidence, s.needsAudioAnalysis)}`
                : `Unknown · ${keyTrustLabel(s.keySource, s.keyConfidence, s.needsAudioAnalysis)}`}
            </span>
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {PITCH_CLASSES.map((t) => {
              const c = keyColor(t, s.keyMode ?? 'major')
              const sel = s.keyTonic === t
              return (
                <button
                  key={t}
                  onClick={() => void override(s.id, { keyTonic: t, keyMode: s.keyMode ?? 'major' })}
                  className="rounded-md py-1.5 text-xs font-bold transition"
                  style={{
                    background: sel ? c.solid : 'rgba(255,255,255,0.05)',
                    color: sel ? '#0b0b11' : c.text,
                    border: `1px solid ${sel ? '#fff' : c.ring}`
                  }}
                >
                  {t.replace('#', '♯')}
                </button>
              )
            })}
          </div>
          <div className="mt-2 flex gap-1.5">
            {(['major', 'minor'] as KeyMode[]).map((m) => (
              <button
                key={m}
                disabled={!s.keyTonic}
                onClick={() => void override(s.id, { keyTonic: s.keyTonic, keyMode: m })}
                className={seg(s.keyMode === m)}
                style={{ opacity: s.keyTonic ? 1 : 0.4 }}
              >
                {m === 'major' ? 'Major' : 'Minor'}
              </button>
            ))}
            <button onClick={() => void override(s.id, { keyTonic: null, keyMode: null })} className={seg(false)} style={{ flex: '0 0 auto', paddingInline: 10 }}>
              Clear
            </button>
          </div>
          {s.keyDiagnostics?.decision?.reason && (
            <p className="mt-2 text-[11px] leading-relaxed text-white/38">{s.keyDiagnostics.decision.reason}</p>
          )}
        </div>

        {/* Tempo */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Tempo</h3>
            <span className="text-[10px] text-white/35">{s.bpmSource ? `${s.bpmSource}${s.bpm != null ? ` · ${s.bpm} BPM` : ''}` : '—'}</span>
          </div>
          <div className="flex gap-1.5">
            <input
              type="number"
              min={40}
              max={300}
              value={bpmInput}
              onChange={(e) => setBpmInput(e.target.value)}
              onBlur={saveBpm}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.currentTarget.blur()
                }
              }}
              placeholder="BPM"
              className="min-w-0 flex-1 rounded-md bg-white/5 px-2 py-1.5 text-xs outline-none border border-white/8 focus:border-vibe/60 placeholder:text-white/30"
            />
            <button onClick={saveBpm} className="rounded-md bg-vibe/20 px-3 py-1.5 text-xs font-medium text-[#c9b6ff] border border-vibe/40 hover:bg-vibe/25">
              Save
            </button>
            <button
              onClick={() => {
                setBpmInput('')
                void override(s.id, { bpm: null })
              }}
              className="rounded-md bg-white/5 px-2.5 py-1.5 text-xs font-medium text-white/55 border border-white/8 hover:bg-white/8"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Type */}
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">Type</h3>
          <div className="flex gap-1.5">
            {(['melodic', 'drum', 'unknown'] as SoundType[]).map((t) => (
              <button
                key={t}
                onClick={() => void override(s.id, { type: t, subtype: null })}
                className={seg(s.type === t)}
              >
                {t === 'melodic' ? 'Melodic' : t === 'drum' ? 'Drums' : 'Unknown'}
              </button>
            ))}
          </div>
        </div>

        {/* Tags */}
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">Tags</h3>
          {s.tags.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {s.tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-white/8 px-2 py-0.5 text-xs text-white/70">
                  {t}
                  <button onClick={() => void setTags(s.id, s.tags.filter((x) => x !== t))} className="text-white/40 hover:text-white/80">
                    <X width={11} height={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                addTag()
              }
            }}
            placeholder="Add a tag…"
            className="w-full rounded-md bg-white/5 px-2 py-1.5 text-xs outline-none border border-white/8 focus:border-vibe/60 placeholder:text-white/30"
          />
        </div>

        {/* Notes */}
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">Notes</h3>
          <textarea
            value={notesInput}
            onChange={(e) => setNotesInput(e.target.value)}
            onBlur={() => void override(s.id, { notes: notesInput || null })}
            rows={2}
            placeholder="Notes…"
            className="w-full resize-none rounded-md bg-white/5 px-2 py-1.5 text-xs outline-none border border-white/8 focus:border-vibe/60 placeholder:text-white/30"
          />
        </div>

        {/* Vibe matches */}
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">Vibe Match</h3>
          {matches.length === 0 ? (
            <p className="text-xs text-white/35">No nearby matches yet.</p>
          ) : (
            <div className="space-y-1.5">
              {matches.map((match) => (
                <button
                  key={match.sound.id}
                  onClick={() => {
                    select(match.sound.id)
                    play(match.sound.id)
                  }}
                  className="flex w-full items-center gap-2 rounded-md bg-white/4 px-2 py-1.5 text-left hover:bg-white/8"
                >
                  <Play width={13} height={13} className="shrink-0 text-white/45" />
                  <KeyBadge
                    tonic={match.sound.keyTonic}
                    mode={match.sound.keyMode}
                    source={match.sound.keySource}
                    confidence={match.sound.keyConfidence}
                    pending={match.sound.needsAudioAnalysis}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-white/75" title={match.sound.filename}>
                      {match.sound.filename}
                    </div>
                    <div className="truncate text-[10px] text-white/35">{match.reasons.slice(0, 2).join(' · ')}</div>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-white/45">{match.sound.bpm != null ? `${match.sound.bpm}` : '—'}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="space-y-1.5 rounded-lg bg-white/3 p-3">
          <div className="flex justify-between gap-2 text-xs">
            <span className="text-white/35">Analysis</span>
            <span className="flex min-w-0 items-center gap-2 text-white/70">
              <span className="truncate tabular-nums" title={s.analysisError ?? undefined}>
                {s.analysisError
                  ? `Failed: ${s.analysisError.replace(/_/g, ' ')}`
                  : s.needsAudioAnalysis
                    ? 'Queued'
                    : s.analyzedAt
                      ? 'Analyzed'
                      : 'Pending'}
              </span>
              {s.analysisError && (
                <button
                  onClick={() => void override(s.id, { retryAnalysis: true })}
                  className="rounded bg-white/6 px-1.5 py-0.5 text-[10px] font-medium text-white/60 hover:bg-white/10"
                >
                  Retry
                </button>
              )}
            </span>
          </div>
          <Field label="Tempo" value={s.bpm != null ? `${s.bpm} BPM (${s.bpmSource ?? '—'})` : '—'} />
          <Field label="Duration" value={formatDuration(s.durationSec)} />
          <Field label="Sample rate" value={s.sampleRate ? `${(s.sampleRate / 1000).toFixed(1)} kHz` : '—'} />
          <Field label="Channels" value={s.channels === 1 ? 'Mono' : s.channels === 2 ? 'Stereo' : s.channels ? String(s.channels) : '—'} />
          <Field label="Format" value={(s.format ?? '—').toUpperCase()} />
          <Field label="Size" value={formatBytes(s.size)} />
        </div>

        <button
          onClick={() => {
            if (!s.missing) reveal(s.path)
          }}
          disabled={s.missing}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/6 py-2 text-xs font-medium text-white/75 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Reveal width={15} height={15} /> Reveal in Finder
        </button>
      </div>
    </aside>
  )
}
