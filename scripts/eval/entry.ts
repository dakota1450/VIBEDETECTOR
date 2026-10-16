// Default evaluation entry: runs the exact analysis job the app's worker runs
// (src/shared/analysisJob.ts), with the job flags the store would set for a sound
// that has no filename key/tempo — i.e. it scores the audio detectors themselves.
import { runAnalysisJob } from '@shared/analysisJob'
import { classify } from '@shared/classify'

const MIN_TEMPO_SECONDS = 1.2

export function evaluate(
  samples: Float32Array,
  sampleRate: number,
  info: { filename: string; folder: string; durationSec: number }
): Record<string, unknown> {
  const cls = classify({ filename: info.filename, folder: info.folder, durationSec: info.durationSec })
  const out = runAnalysisJob({
    samples,
    sampleRate,
    durationSec: info.durationSec,
    needsKey: true,
    needsBpm: info.durationSec >= MIN_TEMPO_SECONDS,
    classifyDrum: cls.type === 'unknown' || cls.type === 'drum',
    isDrum: cls.type === 'drum',
    subtype: cls.subtype
  })
  const key = out.key?.tonic ? { tonic: out.key.tonic, mode: out.key.mode, confidence: out.key.confidence } : null
  return {
    nameType: cls.type,
    audioType: out.cls?.type ?? null,
    key,
    keyCandidates: out.key?.candidates?.slice(0, 3),
    keyRawConfidence: out.key?.confidence ?? 0,
    hasThird: out.key?.diagnostics?.evidence?.find((e) => e.name === 'hasThird')?.value ?? null,
    bpm: out.bpm?.value ?? null,
    bpmConfidence: out.bpm?.confidence ?? 0,
    bpmMethod: out.bpm?.method ?? null
  }
}
