import type { KeyMode } from './types'

export interface KeyId {
  tonic: string
  mode: KeyMode
}

// Standard Camelot wheel mapping (A = minor, B = major), canonical sharp spelling.
export const CAMELOT_TO_KEY: Record<string, KeyId> = {
  '1A': { tonic: 'G#', mode: 'minor' },
  '1B': { tonic: 'B', mode: 'major' },
  '2A': { tonic: 'D#', mode: 'minor' },
  '2B': { tonic: 'F#', mode: 'major' },
  '3A': { tonic: 'A#', mode: 'minor' },
  '3B': { tonic: 'C#', mode: 'major' },
  '4A': { tonic: 'F', mode: 'minor' },
  '4B': { tonic: 'G#', mode: 'major' },
  '5A': { tonic: 'C', mode: 'minor' },
  '5B': { tonic: 'D#', mode: 'major' },
  '6A': { tonic: 'G', mode: 'minor' },
  '6B': { tonic: 'A#', mode: 'major' },
  '7A': { tonic: 'D', mode: 'minor' },
  '7B': { tonic: 'F', mode: 'major' },
  '8A': { tonic: 'A', mode: 'minor' },
  '8B': { tonic: 'C', mode: 'major' },
  '9A': { tonic: 'E', mode: 'minor' },
  '9B': { tonic: 'G', mode: 'major' },
  '10A': { tonic: 'B', mode: 'minor' },
  '10B': { tonic: 'D', mode: 'major' },
  '11A': { tonic: 'F#', mode: 'minor' },
  '11B': { tonic: 'A', mode: 'major' },
  '12A': { tonic: 'C#', mode: 'minor' },
  '12B': { tonic: 'E', mode: 'major' }
}

export const KEY_TO_CAMELOT: Record<string, string> = Object.fromEntries(
  Object.entries(CAMELOT_TO_KEY).map(([code, k]) => [`${k.tonic}|${k.mode}`, code])
)

export function keyToCamelot(tonic: string | null, mode: KeyMode | null): string | null {
  if (!tonic || !mode) return null
  return KEY_TO_CAMELOT[`${tonic}|${mode}`] ?? null
}
