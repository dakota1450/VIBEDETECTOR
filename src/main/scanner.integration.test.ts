import { describe, it, expect, beforeAll } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { Store } from './store'
import { scanSource, scanSources } from './scanner'
import type { Sound } from '@shared/types'

let byName: Map<string, Sound>
let store: Store

beforeAll(async () => {
  store = new Store(join(tmpdir(), `vibe-test-${Date.now()}.json`))
  await store.load()
  const source = store.addSource(join(process.cwd(), 'fixtures'), 'fixtures')
  await scanSource(store, source)
  byName = new Map(store.getSounds().map((s) => [s.filename, s]))
})

describe('scanner integration (real WAV fixtures)', () => {
  it('finds every audio file', () => {
    expect(store.getSounds().length).toBe(17)
  })

  it('reads format metadata from real files', () => {
    const s = byName.get('Piano_Loop_Cmaj_120bpm.wav')!
    expect(s.durationSec).toBeGreaterThan(1.5)
    expect(s.sampleRate).toBe(22050)
    expect(s.channels).toBe(1)
  })

  const keyCases: [string, string | null, string | null, number | null, string][] = [
    ['Piano_Loop_Cmaj_120bpm.wav', 'C', 'major', 120, 'melodic'],
    ['Reese_Bass_Gm_140.wav', 'G', 'minor', 140, 'melodic'],
    ['Vocal_Chop_Am.wav', 'A', 'minor', null, 'melodic'],
    ['8A_melody_loop.wav', 'A', 'minor', null, 'melodic'],
    ['Lush_Pad_Fmaj.wav', 'F', 'major', null, 'melodic'],
    ['808_F#_140.wav', 'F#', null, 140, 'drum']
  ]
  for (const [name, tonic, mode, bpm, type] of keyCases) {
    it(`detects ${name} → ${tonic ?? '?'} ${mode ?? ''} ${bpm ?? ''} ${type}`, () => {
      const s = byName.get(name)!
      expect(s).toBeTruthy()
      expect(s.keyTonic).toBe(tonic)
      expect(s.keyMode).toBe(mode)
      expect(s.bpm).toBe(bpm)
      expect(s.type).toBe(type)
    })
  }

  const drumCases: [string, string][] = [
    ['Kick_01.wav', 'kick'],
    ['Snare_Acoustic.wav', 'snare'],
    ['Closed_Hat_03.wav', 'hihat'],
    ['OpenHat.wav', 'openhat'],
    ['Clap_Hard.wav', 'clap'],
    ['Crash_Cymbal.wav', 'cymbal'],
    ['Perc_Shaker_02.wav', 'perc']
  ]
  for (const [name, sub] of drumCases) {
    it(`classifies ${name} → drum/${sub}`, () => {
      const s = byName.get(name)!
      expect(s.type).toBe('drum')
      expect(s.subtype).toBe(sub)
      expect(s.keyTonic).toBeNull()
    })
  }

  it('flags unlabeled sounds for audio analysis', () => {
    const dusty = byName.get('dusty_chords_take2.wav')!
    const field = byName.get('field_recording_long.wav')!
    const keyedPad = byName.get('Lush_Pad_Fmaj.wav')!
    // 'chords' is a melodic keyword, so the type is known but the key is not.
    expect(dusty.type).toBe('melodic')
    expect(dusty.keyTonic).toBeNull()
    expect(dusty.needsAudioAnalysis).toBe(true)
    // No naming signal at all → Unknown, pending the audio classifier.
    expect(field.type).toBe('unknown')
    expect(field.needsAudioAnalysis).toBe(true)
    expect(keyedPad.keyTonic).toBe('F')
    expect(keyedPad.bpm).toBeNull()
    expect(keyedPad.needsAudioAnalysis).toBe(true)
    expect(store.getAnalysisQueue().length).toBeGreaterThanOrEqual(2)
  })

  it('reads "drum" context as a drum with a generic subtype (audio refines the family)', () => {
    // "Drum_Hit_Low/Bright" say "drum" but no specific kit piece — type is known (drum),
    // subtype stays generic ('other') for the audio classifier to refine to kick/hat/etc.
    for (const name of ['Drum_Hit_Low_01.wav', 'Drum_Hit_Bright_02.wav']) {
      const s = byName.get(name)!
      expect(s.type).toBe('drum')
      expect(s.subtype).toBe('other')
      expect(s.needsAudioAnalysis).toBe(true)
    }
  })

  it('incrementally skips unchanged files on re-scan (persistence)', async () => {
    const s2 = new Store(join(tmpdir(), `vibe-inc-${Date.now()}.json`))
    await s2.load()
    const src = s2.addSource(join(process.cwd(), 'fixtures'), 'fixtures')
    await scanSources(s2, [src])
    const p = join(process.cwd(), 'fixtures', 'Drum Kit', 'Kick_01.wav')
    const before = s2.getByPath(p)!
    expect(before).toBeTruthy()
    before.format = 'SENTINEL' // if a re-scan rebuilt this file, the sentinel would be overwritten
    await scanSources(s2, [src])
    expect(s2.getByPath(p)!.format).toBe('SENTINEL')
  })

  it('preserves manual overrides across a rescan', async () => {
    const kick = byName.get('Kick_01.wav')!
    store.applyOverride(kick.id, { keyTonic: 'D', keyMode: 'minor', bpm: 92 })
    const source = store.listSources()[0]
    await scanSource(store, { ...source })
    const after = store.getSounds().find((s) => s.id === kick.id)!
    expect(after.keyTonic).toBe('D')
    expect(after.keySource).toBe('manual')
    expect(after.bpm).toBe(92)
    expect(after.bpmSource).toBe('manual')
  })
})
