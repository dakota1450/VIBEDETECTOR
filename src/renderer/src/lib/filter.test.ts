import { describe, expect, it } from 'vitest'
import type { Sound } from '@shared/types'
import { applyFilter, defaultFilter } from './filter'

function sound(id: number, patch: Partial<Sound>): Sound {
  return {
    id,
    sourceId: 1,
    path: `/tmp/${id}.wav`,
    filename: `${id}.wav`,
    folder: 'samples',
    size: 1,
    mtimeMs: 1,
    durationSec: 1,
    sampleRate: 44100,
    channels: 2,
    format: 'WAVE',
    keyTonic: null,
    keyMode: null,
    keyConfidence: 0,
    keySource: null,
    bpm: null,
    bpmConfidence: 0,
    bpmSource: null,
    type: 'unknown',
    subtype: null,
    typeSource: null,
    isFavorite: false,
    tags: [],
    notes: null,
    analyzedAt: null,
    analysisVersion: null,
    needsAudioAnalysis: false,
    missing: false,
    ...patch
  }
}

describe('key trust filters', () => {
  const sounds = [
    sound(1, { keyTonic: 'C', keyMode: 'major', keyConfidence: 0.9, keySource: 'filename' }),
    sound(2, { keyTonic: 'D', keyMode: 'minor', keyConfidence: 0.8, keySource: 'filename' }),
    sound(3, { keyTonic: 'E', keyMode: 'minor', keyConfidence: 0.74, keySource: 'analysis' }),
    sound(4, { keyTonic: null, keyMode: null, keyConfidence: 0, keySource: null })
  ]

  it('uses store-aligned thresholds for verified keys', () => {
    const result = applyFilter(sounds, { ...defaultFilter, keyStatus: 'verified' })
    expect(result.map((s) => s.id)).toEqual([1])
  })

  it('surfaces detected keys below verified thresholds as low confidence', () => {
    const result = applyFilter(sounds, { ...defaultFilter, keyStatus: 'low' })
    expect(result.map((s) => s.id)).toEqual([2, 3])
  })

  it('filters unknown keys separately', () => {
    const result = applyFilter(sounds, { ...defaultFilter, keyStatus: 'unknown' })
    expect(result.map((s) => s.id)).toEqual([4])
  })

  it('builds a review queue from weak, pending, unknown, and failed analysis states', () => {
    const result = applyFilter(
      [
        ...sounds,
        sound(5, { keyTonic: 'F', keyMode: 'major', keyConfidence: 0.95, keySource: 'filename' }),
        sound(6, { keyTonic: 'G', keyMode: 'major', keyConfidence: 0.95, keySource: 'filename', needsAudioAnalysis: true }),
        sound(7, { analysisError: 'decode_failed' })
      ],
      { ...defaultFilter, reviewStatus: 'needs_review' }
    )
    expect(result.map((s) => s.id)).toEqual([2, 3, 4, 6, 7])
  })

  it('filters analysis failures directly', () => {
    const result = applyFilter([...sounds, sound(7, { analysisError: 'decode_failed' })], {
      ...defaultFilter,
      reviewStatus: 'analysis_failed'
    })
    expect(result.map((s) => s.id)).toEqual([7])
  })
})

describe('key filter', () => {
  const sounds = [
    sound(1, { keyTonic: 'C', keyMode: 'major', keyConfidence: 0.9, keySource: 'filename' }),
    sound(2, { keyTonic: 'C', keyMode: 'minor', keyConfidence: 0.9, keySource: 'filename' }),
    sound(3, { keyTonic: 'C', keyMode: null, keyConfidence: 0.8, keySource: 'analysis' }),
    sound(4, { keyTonic: 'D', keyMode: 'minor', keyConfidence: 0.9, keySource: 'filename' })
  ]

  it('lets a tonic-only sound (a single note or 808) match both modes on its root', () => {
    expect(applyFilter(sounds, { ...defaultFilter, keys: [{ tonic: 'C', mode: 'minor' }] }).map((s) => s.id)).toEqual([2, 3])
    expect(applyFilter(sounds, { ...defaultFilter, keys: [{ tonic: 'C', mode: 'major' }] }).map((s) => s.id)).toEqual([1, 3])
  })

  it('matches any mode on the root when asked', () => {
    expect(applyFilter(sounds, { ...defaultFilter, keys: [{ tonic: 'C', mode: 'major' }], matchKeyAnyMode: true }).map((s) => s.id)).toEqual([1, 2, 3])
  })
})

describe('harmonic (Camelot) key matching', () => {
  const sounds = [
    sound(1, { keyTonic: 'A', keyMode: 'minor', keyConfidence: 0.9, keySource: 'filename' }),
    sound(2, { keyTonic: 'C', keyMode: 'major', keyConfidence: 0.9, keySource: 'filename' }),
    sound(3, { keyTonic: 'E', keyMode: 'minor', keyConfidence: 0.9, keySource: 'filename' }),
    sound(4, { keyTonic: 'F#', keyMode: 'major', keyConfidence: 0.9, keySource: 'filename' })
  ]
  it('widens a key selection to its relative and neighbouring keys', () => {
    const f = { ...defaultFilter, keys: [{ tonic: 'A', mode: 'minor' as const }] }
    expect(applyFilter(sounds, f).map((s) => s.id)).toEqual([1])
    expect(applyFilter(sounds, { ...f, harmonicMatch: true }).map((s) => s.id)).toEqual([1, 2, 3])
  })
})
