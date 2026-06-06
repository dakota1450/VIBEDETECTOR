import type { LibraryFilter, Sound } from '@shared/types'
import { CIRCLE_OF_FIFTHS } from '@shared/keyColors'
import { bpmMatches } from '@shared/bpmDetect'

export const defaultFilter: LibraryFilter = {
  search: '',
  type: 'all',
  subtypes: [],
  keys: [],
  matchKeyAnyMode: false,
  keyStatus: 'all',
  reviewStatus: 'all',
  bpmMin: null,
  bpmMax: null,
  halfDoubleTime: true,
  favoritesOnly: false,
  sourceIds: [],
  hasTempoOnly: false,
  sort: 'added',
  sortDir: 'asc'
}

function cofIndex(tonic: string | null): number {
  if (!tonic) return 99
  const i = CIRCLE_OF_FIFTHS.indexOf(tonic as (typeof CIRCLE_OF_FIFTHS)[number])
  return i < 0 ? 99 : i
}

function hasVerifiedKey(s: Sound): boolean {
  if (!s.keyTonic) return false
  if (s.keySource === 'manual') return true
  if (s.keySource === 'metadata') return s.keyConfidence >= 0.9
  if (s.keySource === 'filename') return s.keyConfidence >= 0.85
  if (s.keySource === 'analysis') return s.keyConfidence >= 0.75
  return false
}

function needsReview(s: Sound): boolean {
  if (s.analysisError) return true
  if (s.needsAudioAnalysis) return true
  if (!s.keyTonic) return s.type !== 'drum'
  return !hasVerifiedKey(s)
}

function matchesFilter(s: Sound, f: LibraryFilter): boolean {
  if (f.favoritesOnly && !s.isFavorite) return false
  if (f.sourceIds.length && !f.sourceIds.includes(s.sourceId)) return false
  if (f.reviewStatus === 'analysis_failed' && !s.analysisError) return false
  if (f.reviewStatus === 'needs_review' && !needsReview(s)) return false
  if (f.type === 'melodic' && s.type !== 'melodic') return false
  if (f.type === 'drum' && s.type !== 'drum') return false
  if (f.subtypes.length) {
    if (!s.subtype || !f.subtypes.includes(s.subtype)) return false
  }
  if (f.keys.length) {
    if (!s.keyTonic) return false
    const ok = f.keys.some((k) =>
      f.matchKeyAnyMode ? k.tonic === s.keyTonic : k.tonic === s.keyTonic && k.mode === s.keyMode
    )
    if (!ok) return false
  }
  if (f.keyStatus === 'unknown' && s.keyTonic) return false
  if (f.keyStatus === 'low') {
    if (!s.keyTonic || hasVerifiedKey(s)) return false
  }
  if (f.keyStatus === 'verified') {
    if (!hasVerifiedKey(s)) return false
  }
  if (f.hasTempoOnly && s.bpm == null) return false
  if (f.bpmMin != null || f.bpmMax != null) {
    if (s.bpm == null) return false
    if (!bpmMatches(s.bpm, f.bpmMin, f.bpmMax, f.halfDoubleTime)) return false
  }
  if (f.search.trim()) {
    const hay = `${s.filename} ${s.folder} ${s.path} ${s.tags.join(' ')} ${s.notes ?? ''}`.toLowerCase()
    const tokens = f.search.toLowerCase().split(/\s+/).filter(Boolean)
    if (!tokens.every((t) => hay.includes(t))) return false
  }
  return true
}

function compare(a: Sound, b: Sound, f: LibraryFilter): number {
  let r = 0
  switch (f.sort) {
    case 'name':
      r = a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' })
      break
    case 'bpm':
      r = (a.bpm ?? Number.POSITIVE_INFINITY) - (b.bpm ?? Number.POSITIVE_INFINITY)
      break
    case 'duration':
      r = (a.durationSec ?? Number.POSITIVE_INFINITY) - (b.durationSec ?? Number.POSITIVE_INFINITY)
      break
    case 'key': {
      r = cofIndex(a.keyTonic) - cofIndex(b.keyTonic)
      if (r === 0) r = (a.keyMode ?? '').localeCompare(b.keyMode ?? '')
      break
    }
    case 'added':
    default:
      r = a.id - b.id
      break
  }
  if (r === 0) r = a.id - b.id
  return f.sortDir === 'desc' ? -r : r
}

export function applyFilter(sounds: Sound[], f: LibraryFilter): Sound[] {
  return sounds.filter((s) => matchesFilter(s, f)).sort((a, b) => compare(a, b, f))
}
