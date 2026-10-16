import type { DetectedTempo } from './types'

function stripExt(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, '')
}
function normalizeName(name: string): string {
  return ' ' + stripExt(name).replace(/[_\-.()[\]{}+,~!@]+/g, ' ').replace(/\s+/g, ' ').trim() + ' '
}

/** Does `bpm` divide the loop length into a whole number of beats (≥ 2)? */
export function fitsLoopLength(bpm: number, durationSec: number | null | undefined): boolean {
  if (!durationSec || durationSec < 1) return false
  const beats = (bpm * durationSec) / 60
  const whole = Math.round(beats)
  return whole >= 2 && Math.abs(beats - whole) < 0.04
}

/**
 * Detect tempo from a filename. Prefers an explicit "<n>bpm" tag, then falls back
 * to a standalone plausible tempo number. Guards against sample rates (44100),
 * bit depths (16/24), 808s, and years. When the file's length is known, a bare
 * number that cuts the loop into whole beats is almost certainly its tempo (loops
 * are trimmed to the bar grid), while one that doesn't is likely a take/variation
 * number — so the loop length confirms or demotes each candidate.
 */
export function detectBpmFromName(filename: string, durationSec?: number | null): DetectedTempo {
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
    if (v >= 60 && v <= 200 && !cands.includes(v)) cands.push(v)
  }
  if (cands.length === 0) return { bpm: null, confidence: 0, source: null }
  // Too short to hold a bar: a bare number on a one-shot is at most the kit's tempo.
  if (durationSec != null && durationSec < 1.2) {
    const pref = cands.filter((v) => v >= 70 && v <= 180)
    return { bpm: [...(pref.length ? pref : cands)].sort((a, b) => a - b)[0], confidence: 0.45, source: 'filename' }
  }
  const known = durationSec != null && durationSec >= 1
  const fitting = known ? cands.filter((v) => fitsLoopLength(v, durationSec)) : []
  if (cands.length === 1) {
    const v = cands[0]
    return { bpm: v, confidence: !known ? 0.72 : fitting.length ? 0.92 : 0.6, source: 'filename' }
  }
  if (fitting.length === 1) return { bpm: fitting[0], confidence: 0.88, source: 'filename' }
  const pool = fitting.length ? fitting : cands
  const pref = pool.filter((v) => v >= 70 && v <= 180)
  const pick = [...(pref.length ? pref : pool)].sort((a, b) => a - b)[0]
  return { bpm: pick, confidence: fitting.length ? 0.72 : 0.5, source: 'filename' }
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
