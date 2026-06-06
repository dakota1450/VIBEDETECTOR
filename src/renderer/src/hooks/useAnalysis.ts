import { useCallback, useEffect, useRef } from 'react'
import type { AnalysisJob, AnalysisResult } from '@shared/types'

const ANALYSIS_SAMPLE_RATE = 22050
const MAX_SECONDS = 30
const ANALYSIS_BATCH_SIZE = 24
const ANALYSIS_JOB_PAUSE_MS = 8
const ANALYSIS_BATCH_PAUSE_MS = 60
const ANALYSIS_JOB_TIMEOUT_MS = 30000
const DECODE_TIMEOUT_MS = 20000
// Spread decoding + DSP across cores. One worker per slot, each with its own decode
// context, so several samples are analyzed at once instead of one-at-a-time.
const ANALYSIS_POOL_SIZE = Math.max(1, Math.min(4, ((globalThis.navigator?.hardwareConcurrency ?? 4) - 1)))
const NORMALIZE_PEAK = 0.95
const NORMALIZE_FLOOR = 0.0005
const WAVEFORM_VERSION = 1
const WAVEFORM_BUCKETS = 48

interface AnalysisSlot {
  worker: Worker
  ctx: OfflineAudioContext
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Resolve to null if a promise doesn't settle in time — a corrupt file that hangs
 *  the audio decoder must not stall the whole analysis queue. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))])
}

async function decodeMono(
  ctx: OfflineAudioContext,
  url: string
): Promise<{ samples: Float32Array; sampleRate: number; peaks: number[] } | null> {
  const resp = await fetch(url)
  if (!resp.ok) return null
  const arrayBuffer = await resp.arrayBuffer()
  const buf = await ctx.decodeAudioData(arrayBuffer)
  const len = Math.min(buf.length, Math.floor(buf.sampleRate * MAX_SECONDS))
  const mono = new Float32Array(len)
  const ch = buf.numberOfChannels
  for (let c = 0; c < ch; c++) {
    const data = buf.getChannelData(c)
    for (let i = 0; i < len; i++) mono[i] += data[i] / ch
  }
  const peaks = computeWaveformPeaks(mono, WAVEFORM_BUCKETS)
  return { ...prepareAnalysisSamples(mono, buf.sampleRate), peaks }
}

function computeWaveformPeaks(samples: Float32Array, buckets: number): number[] {
  const out = new Array<number>(buckets).fill(0)
  if (samples.length === 0) return out
  const bucketSize = Math.max(1, Math.ceil(samples.length / buckets))
  let max = 0
  for (let b = 0; b < buckets; b++) {
    const start = b * bucketSize
    const end = Math.min(samples.length, start + bucketSize)
    let sumSq = 0
    let peak = 0
    for (let i = start; i < end; i++) {
      const a = Math.abs(samples[i])
      peak = Math.max(peak, a)
      sumSq += a * a
    }
    const rms = end > start ? Math.sqrt(sumSq / (end - start)) : 0
    out[b] = peak * 0.65 + rms * 0.35
    max = Math.max(max, out[b])
  }
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] = Math.max(0.04, Math.min(1, out[i] / max))
  return out
}

function prepareAnalysisSamples(samples: Float32Array, sampleRate: number): { samples: Float32Array; sampleRate: number } {
  const resampled = resampleLinear(samples, sampleRate, ANALYSIS_SAMPLE_RATE)
  let peak = 0
  for (let i = 0; i < resampled.length; i++) {
    const a = Math.abs(resampled[i])
    if (a > peak) peak = a
  }
  if (peak >= NORMALIZE_FLOOR) {
    const gain = NORMALIZE_PEAK / peak
    for (let i = 0; i < resampled.length; i++) resampled[i] *= gain
  }
  return { samples: resampled, sampleRate: ANALYSIS_SAMPLE_RATE }
}

function resampleLinear(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return new Float32Array(samples)
  const ratio = toRate / fromRate
  const outLen = Math.max(1, Math.floor(samples.length * ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const src = i / ratio
    const i0 = Math.floor(src)
    const a = samples[i0] ?? 0
    const b = samples[i0 + 1] ?? a
    out[i] = a + (b - a) * (src - i0)
  }
  return out
}

/**
 * Pulls the audio-analysis queue from the main process, decodes each unlabeled
 * sound one at a time, runs the DSP in a worker, and saves results in modest
 * batches so library indexing does not monopolize the machine.
 * Returns a `run()` you can call after scans settle. Fails safe: every job is
 * marked analyzed (even on decode error) so nothing is retried forever.
 */
export function useAnalysis(): () => void {
  const slotsRef = useRef<AnalysisSlot[]>([])
  const runningRef = useRef(false)

  useEffect(() => {
    const slots: AnalysisSlot[] = []
    for (let i = 0; i < ANALYSIS_POOL_SIZE; i++) {
      slots.push({
        worker: new Worker(new URL('../analysis/analysis.worker.ts', import.meta.url), { type: 'module' }),
        ctx: new OfflineAudioContext(1, 1, ANALYSIS_SAMPLE_RATE)
      })
    }
    slotsRef.current = slots
    return () => {
      for (const s of slots) s.worker.terminate()
      slotsRef.current = []
    }
  }, [])

  const analyzeJob = useCallback(async (job: AnalysisJob, slot: AnalysisSlot): Promise<AnalysisResult> => {
    try {
      const decoded = await withTimeout(decodeMono(slot.ctx, job.url), DECODE_TIMEOUT_MS)
      if (!decoded || decoded.samples.length === 0) return { id: job.id, error: 'decode_failed' }
      const peaks = job.needsPeaks ? { values: decoded.peaks, version: WAVEFORM_VERSION } : undefined
      if (!job.needsKey && !job.needsBpm && !job.classifyDrum) return { id: job.id, peaks }
      const worker = slot.worker
      return await new Promise<AnalysisResult>((resolve) => {
        const onMsg = (e: MessageEvent<AnalysisResult>): void => {
          if (e.data.id !== job.id) return
          window.clearTimeout(timeout)
          worker.removeEventListener('message', onMsg)
          resolve({ ...e.data, peaks })
        }
        const timeout = window.setTimeout(() => {
          worker.removeEventListener('message', onMsg)
          resolve({ id: job.id, peaks, error: 'analysis_timeout' })
        }, ANALYSIS_JOB_TIMEOUT_MS)
        worker.addEventListener('message', onMsg)
        const buffer = decoded.samples.buffer
        worker.postMessage(
          {
            id: job.id,
            buffer,
            sampleRate: decoded.sampleRate,
            needsKey: job.needsKey,
            needsBpm: job.needsBpm,
            classifyDrum: job.classifyDrum,
            isDrum: job.isDrum
          },
          [buffer]
        )
      })
    } catch {
      return { id: job.id, error: 'decode_failed' }
    }
  }, [])

  const run = useCallback(() => {
    if (runningRef.current) return
    runningRef.current = true
    void (async () => {
      try {
        // Loop in batches until the queue drains.
        // Each pass re-reads the queue (it shrinks as results save).
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const jobs = await window.api.getAnalysisQueue()
          if (jobs.length === 0) break
          const slots = slotsRef.current
          if (slots.length === 0) break
          const batch = jobs.slice(0, ANALYSIS_BATCH_SIZE)
          const results: AnalysisResult[] = []
          let next = 0
          // Every worker slot pulls the next job until the batch drains, so several
          // samples decode + analyze concurrently across cores.
          await Promise.all(
            slots.map(async (slot) => {
              while (next < batch.length) {
                const job = batch[next++]
                results.push(await analyzeJob(job, slot))
                await delay(ANALYSIS_JOB_PAUSE_MS)
              }
            })
          )
          await window.api.saveAnalysis(results)
          await delay(ANALYSIS_BATCH_PAUSE_MS)
        }
      } finally {
        runningRef.current = false
      }
    })()
  }, [analyzeJob])

  return run
}
