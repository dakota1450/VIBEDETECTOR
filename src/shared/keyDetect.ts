import type { DetectedKey, KeyMode } from './types'
import { normalizeTonic } from './keyColors'
import { CAMELOT_TO_KEY } from './camelot'

function stripExt(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, '')
}

/** Replace separators with spaces and pad, so tokens are space-delimited. */
function normalizeName(name: string): string {
  return ' ' + stripExt(name).replace(/[_\-.()[\]{}+,~!@]+/g, ' ').replace(/\s+/g, ' ').trim() + ' '
}

function accidental(raw: string | undefined): string {
  if (!raw) return ''
  if (raw === '♯') return '#'
  if (raw === '♭') return 'b'
  return raw
}

const SCORE_CONFIDENCE: Record<number, number> = { 6: 0.97, 5: 0.9, 4: 0.8, 3: 0.7, 2: 0.6 }

const BARE_KEY_CONTEXT =
  /(?<![a-z])(?:808s?|kicks?|toms?|bass(?:line)?s?|subs?|reese|guitars?|gtrs?|pianos?|keys?|rhodes|wurli|organs?|synths?|pads?|plucks?|leads?|melod(?:y|ic|ies)|chords?|arps?|strings?|violins?|cellos?|brass|horns?|flutes?|sax(?:es|ophones?)?|vocals?|vox)(?![a-z])/

const NOISY_DRUM_CONTEXT =
  /(?<![a-z])(?:snares?|claps?|snaps?|hats?|hi\s?hats?|cymbals?|rides?|crashes?|shakers?|tambourines?|percs?|percussions?)(?![a-z])/

interface Cand {
  tonic: string
  mode: KeyMode | null
  score: number
}

function modeFrom(raw: string | undefined): KeyMode | null {
  if (!raw) return null
  return raw.startsWith('maj') ? 'major' : 'minor'
}

/**
 * Detect a musical key from a filename. Conservative by design: bare single note
 * letters (e.g. the "A" in "Snare A") are intentionally ignored to avoid false
 * positives — a key is only emitted when there is an accidental, an explicit
 * maj/min word, an uppercase "Xm" minor token, an octave, or Camelot notation.
 */
export function detectKeyFromName(filename: string): DetectedKey {
  const sLower = normalizeName(filename).toLowerCase()
  const sOrig = normalizeName(filename)
  const cands: Cand[] = []
  const push = (tonicRaw: string, mode: KeyMode | null, score: number): void => {
    const tonic = normalizeTonic(tonicRaw)
    if (tonic) cands.push({ tonic, mode, score })
  }

  // 1. Camelot wheel notation (e.g. 8A, 11B)
  for (const m of sLower.matchAll(/(?<![a-z0-9])(1[0-2]|[1-9])([ab])(?![a-z0-9])/g)) {
    const k = CAMELOT_TO_KEY[m[1] + m[2].toUpperCase()]
    if (k) cands.push({ tonic: k.tonic, mode: k.mode, score: 6 })
  }

  // 2. note + accidental (+ optional mode), e.g. F#min, F# minor, Bbmaj, Eb, C#m
  for (const m of sLower.matchAll(/(?<![a-z0-9])([a-g])([#♯b♭])\s*(maj(?:or)?|min(?:or)?|m)?(?![a-z])/g)) {
    const mp = m[3]
    let mode: KeyMode | null = null
    let score = 3
    if (mp) {
      mode = mp.startsWith('maj') ? 'major' : 'minor'
      score = 5
    }
    push(m[1] + accidental(m[2]), mode, score)
  }

  // 3. note + explicit mode word, no accidental, e.g. Cmaj, C major, Amin, A minor
  for (const m of sLower.matchAll(/(?<![a-z0-9])([a-g])\s*(maj(?:or)?|min(?:or)?)(?![a-z])/g)) {
    push(m[1], m[2].startsWith('maj') ? 'major' : 'minor', 5)
  }

  // 4. uppercase note + lowercase m => minor (e.g. Am, Cm, Am7) — uppercase avoids the word "am"
  for (const m of sOrig.matchAll(/(?<![A-Za-z0-9])([A-G])m(?:7|9|11|13)?(?![A-Za-z])/g)) {
    push(m[1], 'minor', 4)
  }

  // 5. contextual bare-key phrases, e.g. "guitar in A", "Kick C", "808 F".
  const safeBareKeyContext = BARE_KEY_CONTEXT.test(sLower) && !NOISY_DRUM_CONTEXT.test(sLower)
  if (safeBareKeyContext) {
    for (const m of sLower.matchAll(/(?<![a-z0-9])(?:in|key\s*(?:of)?|root(?:\s*note)?)\s+([a-g])([#♯b♭]?)(?:\s*(maj(?:or)?|min(?:or)?))?(?![a-z])/g)) {
      push(m[1] + accidental(m[2]), modeFrom(m[3]), m[3] ? 4 : 3)
    }
    for (const m of sOrig.matchAll(/(?<![A-Za-z0-9])([A-G])([#♯b♭]?)(?![A-Za-z0-9])/g)) {
      const before = sOrig.slice(0, m.index ?? 0).toLowerCase()
      if (BARE_KEY_CONTEXT.test(before)) push(m[1] + accidental(m[2]), null, m[2] ? 3 : 2)
    }
  }

  // 6. note + optional accidental + octave digit => pitched one-shot (mode unknown)
  for (const m of sLower.matchAll(/(?<![a-z0-9])([a-g])([#♯b♭]?)([0-8])(?![a-z0-9])/g)) {
    push(m[1] + accidental(m[2]), null, m[2] ? 3 : 2)
  }

  if (cands.length === 0) return { tonic: null, mode: null, confidence: 0, source: null }

  const byKey = new Map<string, Cand>()
  for (const c of cands) {
    const key = `${c.tonic}|${c.mode}`
    const prev = byKey.get(key)
    if (!prev || c.score > prev.score) byKey.set(key, c)
  }
  const best = [...byKey.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return (b.mode ? 1 : 0) - (a.mode ? 1 : 0)
  })[0]

  return {
    tonic: best.tonic,
    mode: best.mode,
    confidence: SCORE_CONFIDENCE[best.score] ?? 0.6,
    source: 'filename'
  }
}
