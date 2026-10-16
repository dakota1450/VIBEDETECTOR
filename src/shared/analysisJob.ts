import { activeRegion, analyzeDrum } from './audioAnalysis'
import { detectKey, type KeyOut } from './key'
import { estimateTempo, type TempoEstimate } from './tempo'
import type { SoundType, Subtype } from './types'

// ---------------------------------------------------------------------------------
// One analysis job: everything the renderer worker (and the offline evaluation
// harness) runs on a decoded sample. Keeping it here — pure, synchronous, shared —
// guarantees the accuracy measured offline is exactly what ships.
// ---------------------------------------------------------------------------------

export interface AnalysisJobInput {
  samples: Float32Array
  sampleRate: number
  /** Exact duration of the whole file (the decoded signal may be truncated). */
  durationSec?: number | null
  needsKey: boolean
  needsBpm: boolean
  classifyDrum: boolean
  isDrum?: boolean
  /** The sound's current subtype (e.g. 'hihat'), which sets how clear a drum's pitch must be. */
  subtype?: string | null
}

export interface TempoOut {
  value: number | null
  confidence: number
  /** Half/double-time readings, offered as one-click alternatives. */
  alternatives?: number[]
  method?: string | null
}

export interface AnalysisJobOutput {
  key?: KeyOut
  bpm?: TempoOut
  cls?: { type: SoundType; subtype: Subtype | null; confidence: number }
}

/** Sounds at least this long are phrases whose bar grid can inform the key. */
const KEY_GRID_MIN_SEC = 2

function roundBpm(b: number): number {
  return Math.abs(b - Math.round(b)) < 0.06 ? Math.round(b) : Math.round(b * 100) / 100
}

export function tempoOut(est: TempoEstimate): TempoOut {
  if (est.bpm == null) return { value: null, confidence: Math.round(est.confidence * 1000) / 1000, method: est.method }
  const alternatives = [est.bpm / 2, est.bpm * 2].filter((b) => b >= 45 && b <= 240).map(roundBpm)
  return { value: est.bpm, confidence: Math.round(est.confidence * 1000) / 1000, alternatives, method: est.method }
}

/** Detect tempo; null for one-shots and sounds without a usable pulse. */
export function detectTempo(samples: Float32Array, sampleRate: number, durationSec?: number | null): TempoOut {
  return tempoOut(estimateTempo(samples, sampleRate, { durationSec }))
}

/** Beat period implied by a tempo estimate (loop-grid lock is exact). */
function beatSecOf(est: TempoEstimate | null, durationSec: number): number | null {
  if (!est || est.bpm == null) return null
  if (est.method === 'loop-grid' && est.beats) return durationSec / est.beats
  return 60 / est.bpm
}

export function runAnalysisJob(input: AnalysisJobInput): AnalysisJobOutput {
  const { samples, sampleRate } = input
  const out: AnalysisJobOutput = {}
  const fileSec = input.durationSec && input.durationSec > 0 ? input.durationSec : samples.length / sampleRate
  const region = input.classifyDrum || input.needsKey ? activeRegion(samples) : undefined
  let drumish = !!input.isDrum
  let subtype = input.subtype ?? null
  if (input.classifyDrum) {
    const d = analyzeDrum(samples, sampleRate, region)
    out.cls = { type: d.type, subtype: (d.subtype as Subtype | null) ?? null, confidence: d.confidence }
    if (d.type === 'drum') {
      drumish = true
      // A specific filename subtype (snare, kick…) wins over the audio's guess.
      if (!subtype || subtype === 'other') subtype = d.subtype
    }
  }
  // One tempo estimate serves both the BPM result and the key's bar grid.
  const tempo = input.needsBpm || (input.needsKey && fileSec >= KEY_GRID_MIN_SEC) ? estimateTempo(samples, sampleRate, { durationSec: fileSec }) : null
  if (input.needsKey) out.key = detectKey(samples, sampleRate, region, { isDrum: drumish, subtype, beatSec: beatSecOf(tempo, fileSec) })
  if (input.needsBpm && tempo) out.bpm = tempoOut(tempo)
  return out
}
