import type { DetectedTempo } from './types'

function stripExt(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, '')
}
function normalizeName(name: string): string {
  return ' ' + stripExt(name).replace(/[_\-.()[\]{}+,~!@]+/g, ' ').replace(/\s+/g, ' ').trim() + ' '
}

/**
 * Detect tempo from a filename. Prefers an explicit "<n>bpm" tag, then falls back
 * to a standalone plausible tempo number. Guards against sample rates (44100),
 * bit depths (16/24), 808s, and years.
 */
export function detectBpmFromName(filename: string): DetectedTempo {
  const s = normalizeName(filename).toLowerCase()

  // 1. explicit bpm tag
  const tag = s.match(/(\d{2,3}(?:\.\d+)?)\s*bpm/) || s.match(/bpm\s*[:#]?\s*(\d{2,3}(?:\.\d+)?)/)
  if (tag) {
    const v = Math.round(parseFloat(tag[1]))
    if (v >= 40 && v <= 300) return { bpm: v, confidence: 0.98, source: 'filename' }
  }

  // 2. standalone plausible tempo numbers
  const cands: number[] = []
  for (const t of s.matchAll(/(?<![\d.])(\d{2,3})(?![\d.])/g)) {
    const v = parseInt(t[1], 10)
    if (v >= 60 && v <= 200) cands.push(v)
  }
  if (cands.length === 1) return { bpm: cands[0], confidence: 0.72, source: 'filename' }
  if (cands.length > 1) {
    const pref = cands.filter((v) => v >= 70 && v <= 180)
    const pick = (pref.length ? pref : cands).sort((a, b) => a - b)[0]
    return { bpm: pick, confidence: 0.5, source: 'filename' }
  }

  return { bpm: null, confidence: 0, source: null }
}

/** Whether a tempo matches a filter range, optionally allowing half/double time. */
export function bpmMatches(
  value: number,
  min: number | null,
  max: number | null,
  halfDouble: boolean
): boolean {
  const inRange = (v: number): boolean => (min == null || v >= min) && (max == null || v <= max)
  if (inRange(value)) return true
  if (!halfDouble) return false
  return inRange(value * 2) || inRange(value / 2)
}
