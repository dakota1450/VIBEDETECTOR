/// <reference lib="webworker" />
import { runAnalysisJob } from '@shared/analysisJob'
import type { AnalysisResult, WorkerJobMessage } from '@shared/types'

// Thin shell around the shared analysis job (src/shared/analysisJob.ts) — the same
// code the offline evaluation harness scores, so measured accuracy is what ships.
self.onmessage = (e: MessageEvent<WorkerJobMessage>): void => {
  const { id, buffer, sampleRate, durationSec, needsKey, needsBpm, classifyDrum, isDrum, subtype } = e.data
  const result: AnalysisResult = { id }
  try {
    const out = runAnalysisJob({
      samples: new Float32Array(buffer),
      sampleRate,
      durationSec,
      needsKey,
      needsBpm,
      classifyDrum,
      isDrum,
      subtype
    })
    if (out.cls) result.cls = out.cls
    if (out.key) result.key = out.key
    // Always return a bpm slot when requested (value may be null) so the store can
    // record that the tempo step ran at the current version and not re-queue it.
    if (needsBpm) result.bpm = out.bpm ?? { value: null, confidence: 0 }
  } catch {
    result.error = 'worker_failed'
  }
  ;(self as unknown as Worker).postMessage(result)
}
