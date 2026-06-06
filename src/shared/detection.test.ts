import { describe, it, expect } from 'vitest'
import { detectKeyFromName } from './keyDetect'
import { detectBpmFromName, bpmMatches } from './bpmDetect'
import { classify } from './classify'
import { normalizeTonic, hueForTonic, keyColor, pitchIndex } from './keyColors'
import { keyToCamelot } from './camelot'
import { formatKey } from './format'

describe('detectKeyFromName', () => {
  const cases: [string, string | null, string | null][] = [
    ['Sample_Cmin_140bpm.wav', 'C', 'minor'],
    ['Lo-Fi Piano Fmaj 90 BPM.wav', 'F', 'major'],
    ['F#min_loop.wav', 'F#', 'minor'],
    ['F# minor loop.wav', 'F#', 'minor'],
    ['Bbmaj chord.wav', 'A#', 'major'],
    ['C Major piano.wav', 'C', 'major'],
    ['A minor vocal.wav', 'A', 'minor'],
    ['vocal_chop_Am.wav', 'A', 'minor'],
    ['Reese_Bass_Gm.wav', 'G', 'minor'],
    ['Em_guitar.wav', 'E', 'minor'],
    ['Guitar_in_A.wav', 'A', null],
    ['Kick_C.wav', 'C', null],
    ['808 F.wav', 'F', null],
    ['Moog_Bass_Am7.wav', 'A', 'minor'],
    ['Cmaj7_chord.wav', 'C', 'major'],
    ['Db_chord_stab.wav', 'C#', null],
    ['808 F#.wav', 'F#', null],
    ['Piano_C4.wav', 'C', null]
  ]
  for (const [name, tonic, mode] of cases) {
    it(`reads "${name}" as ${tonic} ${mode}`, () => {
      const r = detectKeyFromName(name)
      expect(r.tonic).toBe(tonic)
      expect(r.mode).toBe(mode)
      if (tonic) expect(r.source).toBe('filename')
    })
  }

  it('parses Camelot notation', () => {
    expect(detectKeyFromName('melody 8A.wav')).toMatchObject({ tonic: 'A', mode: 'minor' })
    expect(detectKeyFromName('11B sample.wav')).toMatchObject({ tonic: 'A', mode: 'major' })
    expect(detectKeyFromName('loop_5A_vibes.wav')).toMatchObject({ tonic: 'C', mode: 'minor' })
  })

  const noKey = ['Snare A.wav', 'Kick.wav', 'Clap_03.wav', 'track_2024_export.wav', 'A_Guitar_Loop.wav', 'Hat_05.wav']
  for (const name of noKey) {
    it(`emits no key for "${name}"`, () => {
      expect(detectKeyFromName(name).tonic).toBeNull()
    })
  }
})

describe('detectBpmFromName', () => {
  it('reads explicit bpm tags', () => {
    expect(detectBpmFromName('beat_140bpm.wav').bpm).toBe(140)
    expect(detectBpmFromName('loop 90 BPM.wav').bpm).toBe(90)
    expect(detectBpmFromName('808_C_120_loop.wav').bpm).toBe(120)
  })
  it('reads a standalone tempo number', () => {
    expect(detectBpmFromName('sample_174.wav').bpm).toBe(174)
  })
  it('ignores sample rates, bit depths, 808 and years', () => {
    expect(detectBpmFromName('drums_44100_16bit.wav').bpm).toBeNull()
    expect(detectBpmFromName('vox_2024.wav').bpm).toBeNull()
    expect(detectBpmFromName('808.wav').bpm).toBeNull()
    expect(detectBpmFromName('kick.wav').bpm).toBeNull()
  })
})

describe('bpmMatches (half/double time)', () => {
  it('matches in range', () => expect(bpmMatches(140, 130, 150, false)).toBe(true))
  it('matches half-time when enabled', () => expect(bpmMatches(70, 130, 150, true)).toBe(true))
  it('matches double-time when enabled', () => expect(bpmMatches(280, 130, 150, true)).toBe(true))
  it('does not match unrelated tempo', () => expect(bpmMatches(95, 130, 150, true)).toBe(false))
  it('respects disabled half/double', () => expect(bpmMatches(70, 130, 150, false)).toBe(false))
})

describe('classify', () => {
  const drums: [string, string][] = [
    ['Kick_01.wav', 'kick'],
    ['Acoustic_Snare.wav', 'snare'],
    ['ClosedHat.wav', 'hihat'],
    ['OpenHat_02.wav', 'openhat'],
    ['808_F.wav', '808'],
    ['Crash_Cymbal.wav', 'cymbal'],
    ['Perc_Shaker.wav', 'perc'],
    ['Clap_Hard.wav', 'clap']
  ]
  for (const [name, sub] of drums) {
    it(`classifies "${name}" as drum/${sub}`, () => {
      expect(classify({ filename: name })).toEqual({ type: 'drum', subtype: sub })
    })
  }

  it('classifies melodic content', () => {
    expect(classify({ filename: 'Piano_Loop_Cmaj.wav' }).type).toBe('melodic')
    expect(classify({ filename: 'Vocal_Chop.wav' }).type).toBe('melodic')
    expect(classify({ filename: 'Synth_Riser.wav' }).type).toBe('melodic')
  })

  it('treats a bare riser/fx as a drum fx', () => {
    expect(classify({ filename: 'Riser_FX.wav' })).toEqual({ type: 'drum', subtype: 'fx' })
  })

  it('defers to audio (Unknown) when there are no naming signals, rather than guessing from duration', () => {
    // Guessing drum-vs-melodic from duration is what mislabels brass stabs / tuned
    // hits — so with no keyword and no key tag, classification is left to the sound.
    expect(classify({ filename: 'oneshot_01.wav', durationSec: 0.4 })).toEqual({ type: 'unknown', subtype: null })
    expect(classify({ filename: 'thing.wav', durationSec: 5 })).toEqual({ type: 'unknown', subtype: null })
  })

  it('uses the folder name as a hint', () => {
    expect(classify({ filename: '01.wav', folder: 'Drum Kit/Kicks' })).toEqual({ type: 'drum', subtype: 'kick' })
  })

  it('uses a detected key as a melodic hint', () => {
    expect(classify({ filename: 'untitled.wav', durationSec: 1, hasMusicalKey: true }).type).toBe('melodic')
  })
})

describe('melodic subtypes', () => {
  const cases: [string, string][] = [
    ['Piano_Loop_Cmaj.wav', 'piano'],
    ['Lush_Pad_Fmaj.wav', 'pad'],
    ['Vocal_Chop_Am.wav', 'vocal'],
    ['Reese_Bass_Gm.wav', 'bass'],
    ['dusty_chords_take2.wav', 'chord'],
    ['Piano_Stab_C.wav', 'stab'],
    ['synth_one_shot.wav', 'one_shot'],
    ['Arp_Sequence_Dm.wav', 'arp'],
    ['Pluck_Melody.wav', 'pluck'],
    ['Clean_Guitar_Loop_A.wav', 'guitar'],
    ['Analog_Synth_Lead.wav', 'lead'],
    ['Warm_Synth_Loop.wav', 'synth'],
    ['String_Section_Fmaj.wav', 'strings'],
    ['Brass_Stab.wav', 'stab'],
    ['Flute_Riff.wav', 'winds'],
    ['Mallet_Bells_C.wav', 'mallet']
  ]
  for (const [name, sub] of cases) {
    it(`classifies "${name}" → melodic/${sub}`, () => {
      const r = classify({ filename: name })
      expect(r.type).toBe('melodic')
      expect(r.subtype).toBe(sub)
    })
  }

  it('falls back to loop/one-shot by duration once content is known to be melodic', () => {
    // A bare unknown name with no key defers to audio...
    expect(classify({ filename: 'mystery.wav', durationSec: 4 })).toEqual({ type: 'unknown', subtype: null })
    // ...but an explicit key tag marks it tonal, so duration picks the subtype.
    expect(classify({ filename: 'mystery.wav', durationSec: 0.5, hasMusicalKey: true })).toEqual({
      type: 'melodic',
      subtype: 'one_shot'
    })
  })
})

describe('keyColors & camelot', () => {
  it('normalizes enharmonics', () => {
    expect(normalizeTonic('Db')).toBe('C#')
    expect(normalizeTonic('bb')).toBe('A#')
    expect(normalizeTonic('Cb')).toBe('B')
    expect(normalizeTonic('F#')).toBe('F#')
    expect(normalizeTonic('H')).toBeNull()
  })
  it('maps tonics to deterministic hues around the circle of fifths', () => {
    expect(hueForTonic('C')).toBe(0)
    expect(hueForTonic('G')).toBe(30)
    expect(hueForTonic('A')).toBe(90)
    expect(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => hueForTonic(['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][i]))).size).toBe(12)
  })
  it('gives unknown keys a neutral color', () => {
    expect(keyColor(null, null).hue).toBe(0)
    expect(keyColor('C', 'major').solid).toContain('hsl')
    expect(pitchIndex('A')).toBe(9)
  })
  it('round-trips camelot codes', () => {
    expect(keyToCamelot('A', 'minor')).toBe('8A')
    expect(keyToCamelot('C', 'major')).toBe('8B')
    expect(keyToCamelot('F#', 'minor')).toBe('11A')
  })
  it('formats keys with unicode accidentals', () => {
    expect(formatKey('C#', 'minor')).toBe('C♯m')
    expect(formatKey('F', 'major')).toBe('F')
    expect(formatKey(null, null)).toBe('—')
  })
})
