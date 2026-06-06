/// <reference lib="webworker" />
import { activeRegion, analyzeBpm, analyzeDrum, analyzeKey } from '@shared/audioAnalysis'
import type { AnalysisResult, Subtype } from '@shared/types'

// Save threshold for tonal content (melodic loops, one-shots). Drums use a lower bar
// so even a faint tuned fundamental (an 808, a tuned kick, a melodic perc hit) is kept
// — flagged as low-confidence in the UI — instead of being thrown away.
const KEY_SAVE_THRESHOLD = 0.38
const DRUM_KEY_SAVE_THRESHOLD = 0.2

interface JobMsg {
  id: number
  buffer: ArrayBuffer
  sampleRate: number
  needsKey: boolean
  needsBpm: boolean
  classifyDrum: boolean
  isDrum?: boolean
}

self.onmessage = (e: MessageEvent<JobMsg>): void => {
  const { id, buffer, sampleRate, needsKey, needsBpm, classifyDrum, isDrum } = e.data
  const samples = new Float32Array(buffer)
  const result: AnalysisResult = { id }
  try {
    const region = classifyDrum || needsKey ? activeRegion(samples) : undefined
    // Classify first so the key step knows whether it's looking at a drum.
    let drumish = !!isDrum
    if (classifyDrum) {
      const d = analyzeDrum(samples, sampleRate, region)
      result.cls = { type: d.type, subtype: (d.subtype as Subtype | null) ?? null, confidence: d.confidence }
      if (d.type === 'drum') drumish = true
    }
    if (needsKey) {
      // Attempt a key on everything, drums included. Tuned drums (808s, toms, melodic
      // perc, tuned kicks) carry a real pitch; genuine noise (hats/claps/cymbals) yields
      // no candidate from analyzeKey and stays keyless. Low-confidence results are saved
      // and shown dimmed rather than vetoed, so the user sees the best guess.
      const k = analyzeKey(samples, sampleRate, region)
      const threshold = drumish ? DRUM_KEY_SAVE_THRESHOLD : KEY_SAVE_THRESHOLD
      if (k.tonic && k.confidence >= threshold) {
        result.key = {
          tonic: k.tonic,
          mode: k.mode,
          confidence: k.confidence,
          diagnostics: {
            ...k.diagnostics,
            detector: {
              outcome: 'accepted',
              reason: drumish ? 'candidate met drum key threshold' : 'candidate met audio key threshold',
              confidence: k.confidence,
              threshold,
              evidence: [...(k.diagnostics?.evidence ?? []), { name: 'isDrum', value: drumish }]
            }
          }
        }
      } else {
        const reason = k.tonic ? 'below audio key threshold' : 'no reliable key candidate'
        result.key = {
          tonic: null,
          mode: null,
          confidence: k.confidence,
          diagnostics: {
            ...k.diagnostics,
            detector: {
              outcome: 'rejected',
              reason,
              confidence: k.confidence,
              threshold,
              evidence: [
                ...(k.diagnostics?.evidence ?? []),
                { name: 'candidateTonic', value: k.tonic },
                { name: 'candidateMode', value: k.mode },
                { name: 'isDrum', value: drumish }
              ]
            }
          }
        }
      }
    }
    if (needsBpm) {
      // Always return a bpm slot (value may be null) so the store can record that the
      // tempo step ran at the current version and not re-queue it every launch.
      const b = analyzeBpm(samples, sampleRate)
      result.bpm = { value: b.bpm, confidence: b.confidence }
    }
  } catch {
    result.error = 'worker_failed'
  }
  ;(self as unknown as Worker).postMessage(result)
}
