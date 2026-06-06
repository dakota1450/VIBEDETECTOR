import { describe, expect, it } from 'vitest'
import { evaluateKeyDetection, formatKeyBenchmark, KEY_DETECTION_FIXTURES } from './keyDetectionBenchmark'
import type { DetectedKey } from './types'

const unknown: DetectedKey = { tonic: null, mode: null, confidence: 0, source: null }

describe('key detection benchmark', () => {
  it('scores the bundled synthetic filename fixtures with the current detector', () => {
    const result = evaluateKeyDetection()

    expect(result.metrics.total).toBe(KEY_DETECTION_FIXTURES.length)
    expect(result.metrics.expectedKeys).toBeGreaterThan(0)
    expect(result.metrics.expectedNoKey).toBeGreaterThan(0)
    expect(result.metrics.accuracy).toBe(1)
    expect(result.metrics.keyCoverage).toBe(1)
    expect(result.metrics.precision).toBe(1)
    expect(result.metrics.falsePositiveRate).toBe(0)
    expect(result.cases.every(({ status }) => status === 'correct')).toBe(true)
  })

  it('separates false positives, false negatives, tonic mismatches, and mode mismatches', () => {
    const fixtures = [
      { name: 'good.wav', expected: { tonic: 'C', mode: 'major' as const } },
      { name: 'unknown.wav', expected: { tonic: null, mode: null } },
      { name: 'miss.wav', expected: { tonic: 'D', mode: 'minor' as const } },
      { name: 'wrong-tonic.wav', expected: { tonic: 'E', mode: 'minor' as const } },
      { name: 'wrong-mode.wav', expected: { tonic: 'F', mode: 'major' as const } }
    ]
    const byName: Record<string, DetectedKey> = {
      'good.wav': { tonic: 'C', mode: 'major', confidence: 0.9, source: 'filename' },
      'unknown.wav': { tonic: 'A', mode: null, confidence: 0.7, source: 'filename' },
      'miss.wav': unknown,
      'wrong-tonic.wav': { tonic: 'G', mode: 'minor', confidence: 0.8, source: 'filename' },
      'wrong-mode.wav': { tonic: 'F', mode: 'minor', confidence: 0.8, source: 'filename' }
    }

    const result = evaluateKeyDetection(fixtures, (filename) => byName[filename] ?? unknown)

    expect(result.metrics).toMatchObject({
      total: 5,
      expectedKeys: 4,
      expectedNoKey: 1,
      detected: 4,
      correct: 1,
      correctTonic: 2,
      falsePositives: 1,
      falseNegatives: 1,
      tonicMismatches: 1,
      modeMismatches: 1,
      accuracy: 0.2,
      keyCoverage: 0.25,
      precision: 0.25,
      falsePositiveRate: 1
    })
    expect(result.cases.map(({ status }) => status)).toEqual([
      'correct',
      'false_positive',
      'false_negative',
      'tonic_mismatch',
      'mode_mismatch'
    ])
  })

  it('formats a compact report with miss details', () => {
    const result = evaluateKeyDetection(
      [{ name: 'Snare A.wav', expected: { tonic: null, mode: null } }],
      () => ({ tonic: 'A', mode: null, confidence: 0.7, source: 'filename' })
    )

    expect(formatKeyBenchmark(result)).toContain('False positive rate: 100.0%')
    expect(formatKeyBenchmark(result)).toContain('false_positive: Snare A.wav expected Unknown got A')
  })
})
