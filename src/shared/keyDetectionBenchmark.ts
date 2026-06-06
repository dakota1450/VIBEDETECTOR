import { detectKeyFromName } from './keyDetect'
import type { DetectedKey, KeyMode } from './types'

export interface KeyBenchmarkFixture {
  name: string
  expected: {
    tonic: string | null
    mode: KeyMode | null
  }
  note?: string
}

export interface KeyBenchmarkCaseResult {
  fixture: KeyBenchmarkFixture
  actual: DetectedKey
  status: 'correct' | 'false_positive' | 'false_negative' | 'tonic_mismatch' | 'mode_mismatch'
}

export interface KeyBenchmarkMetrics {
  total: number
  expectedKeys: number
  expectedNoKey: number
  detected: number
  correct: number
  correctTonic: number
  falsePositives: number
  falseNegatives: number
  tonicMismatches: number
  modeMismatches: number
  accuracy: number
  keyCoverage: number
  precision: number
  falsePositiveRate: number
}

export interface KeyBenchmarkResult {
  metrics: KeyBenchmarkMetrics
  cases: KeyBenchmarkCaseResult[]
}

export type KeyDetector = (filename: string) => DetectedKey

export const KEY_DETECTION_FIXTURES: KeyBenchmarkFixture[] = [
  { name: 'Sample_Cmin_140bpm.wav', expected: { tonic: 'C', mode: 'minor' } },
  { name: 'Lo-Fi Piano Fmaj 90 BPM.wav', expected: { tonic: 'F', mode: 'major' } },
  { name: 'F#min_loop.wav', expected: { tonic: 'F#', mode: 'minor' } },
  { name: 'F# minor loop.wav', expected: { tonic: 'F#', mode: 'minor' } },
  { name: 'Bbmaj chord.wav', expected: { tonic: 'A#', mode: 'major' }, note: 'Enharmonic normalization' },
  { name: 'C Major piano.wav', expected: { tonic: 'C', mode: 'major' } },
  { name: 'A minor vocal.wav', expected: { tonic: 'A', mode: 'minor' } },
  { name: 'vocal_chop_Am.wav', expected: { tonic: 'A', mode: 'minor' } },
  { name: 'Moog_Bass_Am7.wav', expected: { tonic: 'A', mode: 'minor' } },
  { name: 'Reese_Bass_Gm.wav', expected: { tonic: 'G', mode: 'minor' } },
  { name: 'Em_guitar.wav', expected: { tonic: 'E', mode: 'minor' } },
  { name: 'Db_chord_stab.wav', expected: { tonic: 'C#', mode: null }, note: 'Accidental without mode' },
  { name: 'Piano_C4.wav', expected: { tonic: 'C', mode: null }, note: 'Octave one-shot' },
  { name: '808 F#.wav', expected: { tonic: 'F#', mode: null } },
  { name: 'Guitar_in_A.wav', expected: { tonic: 'A', mode: null } },
  { name: 'Kick_C.wav', expected: { tonic: 'C', mode: null } },
  { name: 'melody 8A.wav', expected: { tonic: 'A', mode: 'minor' }, note: 'Camelot minor' },
  { name: '11B sample.wav', expected: { tonic: 'A', mode: 'major' }, note: 'Camelot major' },
  { name: 'loop_5A_vibes.wav', expected: { tonic: 'C', mode: 'minor' }, note: 'Camelot with separators' },
  { name: 'Snare A.wav', expected: { tonic: null, mode: null }, note: 'Bare drum letter should not be a key' },
  { name: 'Kick.wav', expected: { tonic: null, mode: null } },
  { name: 'Clap_03.wav', expected: { tonic: null, mode: null } },
  { name: 'track_2024_export.wav', expected: { tonic: null, mode: null }, note: 'Year should not be a key' },
  { name: 'A_Guitar_Loop.wav', expected: { tonic: null, mode: null }, note: 'Leading bare letter is too ambiguous' },
  { name: 'Hat_05.wav', expected: { tonic: null, mode: null } },
  { name: 'Crash_Cymbal_Bright.wav', expected: { tonic: null, mode: null } },
  { name: 'field_recording_long.wav', expected: { tonic: null, mode: null } }
]

export function evaluateKeyDetection(
  fixtures: readonly KeyBenchmarkFixture[] = KEY_DETECTION_FIXTURES,
  detector: KeyDetector = detectKeyFromName
): KeyBenchmarkResult {
  const cases = fixtures.map((fixture): KeyBenchmarkCaseResult => {
    const actual = detector(fixture.name)
    const expected = fixture.expected
    let status: KeyBenchmarkCaseResult['status'] = 'correct'

    if (!expected.tonic && actual.tonic) status = 'false_positive'
    else if (expected.tonic && !actual.tonic) status = 'false_negative'
    else if (expected.tonic && actual.tonic !== expected.tonic) status = 'tonic_mismatch'
    else if (expected.tonic && actual.mode !== expected.mode) status = 'mode_mismatch'

    return { fixture, actual, status }
  })

  const total = cases.length
  const expectedKeys = cases.filter(({ fixture }) => fixture.expected.tonic).length
  const expectedNoKey = total - expectedKeys
  const detected = cases.filter(({ actual }) => actual.tonic).length
  const correct = cases.filter(({ status }) => status === 'correct').length
  const correctTonic = cases.filter(({ fixture, actual }) => fixture.expected.tonic && actual.tonic === fixture.expected.tonic).length
  const falsePositives = cases.filter(({ status }) => status === 'false_positive').length
  const falseNegatives = cases.filter(({ status }) => status === 'false_negative').length
  const tonicMismatches = cases.filter(({ status }) => status === 'tonic_mismatch').length
  const modeMismatches = cases.filter(({ status }) => status === 'mode_mismatch').length
  const correctDetectedKeys = cases.filter(({ fixture, status }) => fixture.expected.tonic && status === 'correct').length

  return {
    metrics: {
      total,
      expectedKeys,
      expectedNoKey,
      detected,
      correct,
      correctTonic,
      falsePositives,
      falseNegatives,
      tonicMismatches,
      modeMismatches,
      accuracy: ratio(correct, total),
      keyCoverage: ratio(correctDetectedKeys, expectedKeys),
      precision: ratio(correctDetectedKeys, detected),
      falsePositiveRate: ratio(falsePositives, expectedNoKey)
    },
    cases
  }
}

export function formatKeyBenchmark(result: KeyBenchmarkResult): string {
  const { metrics, cases } = result
  const lines = [
    'Key detection benchmark',
    `Fixtures: ${metrics.total} (${metrics.expectedKeys} labeled keys, ${metrics.expectedNoKey} expected unknown)`,
    `Accuracy: ${percent(metrics.accuracy)} | Coverage: ${percent(metrics.keyCoverage)} | Precision: ${percent(metrics.precision)} | False positive rate: ${percent(metrics.falsePositiveRate)}`,
    `Counts: correct=${metrics.correct}, detected=${metrics.detected}, false_positives=${metrics.falsePositives}, false_negatives=${metrics.falseNegatives}, tonic_mismatches=${metrics.tonicMismatches}, mode_mismatches=${metrics.modeMismatches}`
  ]

  const misses = cases.filter(({ status }) => status !== 'correct')
  if (misses.length === 0) {
    lines.push('Misses: none')
  } else {
    lines.push('Misses:')
    for (const { fixture, actual, status } of misses) {
      lines.push(
        `- ${status}: ${fixture.name} expected ${formatKey(fixture.expected.tonic, fixture.expected.mode)} got ${formatKey(actual.tonic, actual.mode)} (${actual.confidence.toFixed(2)})`
      )
    }
  }

  return lines.join('\n')
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function formatKey(tonic: string | null, mode: KeyMode | null): string {
  if (!tonic) return 'Unknown'
  return mode ? `${tonic} ${mode}` : tonic
}
