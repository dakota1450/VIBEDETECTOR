/// <reference lib="webworker" />
import { activeRegion, analyzeBpm, analyzeDrum, analyzeKey } from '@shared/audioAnalysis'
import type { AnalysisResult, Subtype } from '@shared/types'

const KEY_SAVE_THRESHOLD = 0.38

interface JobMsg {
  id: number
  buffer: ArrayBuffer
  sampleRate: number
  needsKey: boolean
  needsBpm: boolean
  classifyDrum: boolean
}

self.onmessage = (e: MessageEvent<JobMsg>): void => {
  const { id, buffer, sampleRate, needsKey, needsBpm, classifyDrum } = e.data
  const samples = new Float32Array(buffer)
  const result: AnalysisResult = { id }
  try {
    const region = classifyDrum || needsKey ? activeRegion(samples) : undefined
    // Classify first so the key step can use the drum profile to reject false keys.
    let atonalDrum = false
    if (classifyDrum) {
      const d = analyzeDrum(samples, sampleRate, region)
      result.cls = { type: d.type, subtype: (d.subtype as Subtype | null) ?? null, confidence: d.confidence }
      const f = d.features
      // Percussion with no real pitch must not get a key — its "pitch" is a transient
      // or noise, not a tuned tone. Two cases: a short low fast-decaying thump (a kick),
      // and a noisy/bright hit (hi-hat, cymbal, clap, noisy snare). Tuned drums — 808s,
      // toms, tuned snares — have clear sustained tonality and DO keep their key.
      const kickLike = f.activeDuration < 0.22 && f.centroid < 250 && f.decay < 0.12
      const noisyHit = f.tonality < 0.4 && f.zcr > 0.12
      atonalDrum = d.type === 'drum' && (kickLike || noisyHit)
    }
    if (needsKey) {
      const k = analyzeKey(samples, sampleRate, region)
      if (k.tonic && k.confidence >= KEY_SAVE_THRESHOLD && !atonalDrum) {
        result.key = {
          tonic: k.tonic,
          mode: k.mode,
          confidence: k.confidence,
          diagnostics: {
            ...k.diagnostics,
            detector: {
              outcome: 'accepted',
              reason: 'candidate met audio key threshold',
              confidence: k.confidence,
              threshold: KEY_SAVE_THRESHOLD,
              evidence: [
                ...(k.diagnostics?.evidence ?? []),
                { name: 'atonalDrumVeto', value: atonalDrum }
              ]
            }
          }
        }
      } else {
        const reason = atonalDrum
          ? 'atonal drum veto'
          : k.tonic
            ? 'below audio key threshold'
            : 'no reliable key candidate'
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
              threshold: KEY_SAVE_THRESHOLD,
              evidence: [
                ...(k.diagnostics?.evidence ?? []),
                { name: 'candidateTonic', value: k.tonic },
                { name: 'candidateMode', value: k.mode },
                { name: 'atonalDrumVeto', value: atonalDrum }
              ]
            }
          }
        }
      }
    }
    if (needsBpm) {
      const b = analyzeBpm(samples, sampleRate)
      if (b.bpm != null) result.bpm = { value: b.bpm, confidence: b.confidence }
    }
  } catch {
    result.error = 'worker_failed'
  }
  ;(self as unknown as Worker).postMessage(result)
}
