import type { KeyMode } from './types'

// Canonical chromatic pitch classes (sharp spelling).
export const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
export type PitchClass = (typeof PITCH_CLASSES)[number]

// Order of the keys around the circle of fifths (used to lay out the wheel).
export const CIRCLE_OF_FIFTHS: PitchClass[] = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'F']

const FLAT_TO_SHARP: Record<string, string> = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#',
  Cb: 'B',
  Fb: 'E',
  'E#': 'F',
  'B#': 'C'
}

/** Normalize any tonic spelling (flats, unicode accidentals) to a canonical sharp pitch class. */
export function normalizeTonic(input: string | null | undefined): PitchClass | null {
  if (!input) return null
  let s = input.trim().replace(/♯/g, '#').replace(/♭/g, 'b')
  if (!s) return null
  s = s[0].toUpperCase() + s.slice(1).toLowerCase()
  // collapse things like "c#" -> "C#", "bb" -> "Bb"
  s = s.replace(/^([A-G])([#b]?).*/, '$1$2')
  if (FLAT_TO_SHARP[s]) return FLAT_TO_SHARP[s] as PitchClass
  if ((PITCH_CLASSES as readonly string[]).includes(s)) return s as PitchClass
  // bare letter
  const bare = s[0]
  if ((PITCH_CLASSES as readonly string[]).includes(bare)) return bare as PitchClass
  return null
}

export function pitchIndex(tonic: string | null | undefined): number {
  const n = normalizeTonic(tonic)
  return n ? PITCH_CLASSES.indexOf(n) : -1
}

/**
 * Hue (degrees) for a pitch class, laid out around the circle of fifths so that
 * musically-related keys get visually-related colors. 7 is its own inverse mod 12,
 * so position-on-circle == (pc * 7) % 12.
 */
export function hueForTonic(tonic: string | null | undefined): number {
  const pc = pitchIndex(tonic)
  if (pc < 0) return 0
  return ((pc * 7) % 12) * 30
}

export interface KeyColor {
  hue: number
  /** vivid fill for badges / wheel segments */
  solid: string
  /** translucent fill for chips and row accents */
  soft: string
  /** readable text color on dark backgrounds */
  text: string
  /** ring / border color */
  ring: string
}

const UNKNOWN_COLOR: KeyColor = {
  hue: 0,
  solid: 'hsl(240 4% 46%)',
  soft: 'hsl(240 6% 60% / 0.16)',
  text: 'hsl(240 6% 72%)',
  ring: 'hsl(240 5% 50%)'
}

export function keyColor(tonic: string | null | undefined, mode: KeyMode | null | undefined): KeyColor {
  if (!tonic || pitchIndex(tonic) < 0) return UNKNOWN_COLOR
  const hue = hueForTonic(tonic)
  const minor = mode === 'minor'
  const sat = minor ? 58 : 82
  const lightSolid = minor ? 50 : 60
  const lightText = minor ? 74 : 80
  return {
    hue,
    solid: `hsl(${hue} ${sat}% ${lightSolid}%)`,
    soft: `hsl(${hue} ${sat}% ${lightSolid}% / 0.18)`,
    text: `hsl(${hue} ${Math.min(sat + 10, 95)}% ${lightText}%)`,
    ring: `hsl(${hue} ${sat}% ${lightSolid}% / 0.7)`
  }
}
