import FFT from 'fft.js'
import { PITCH_CLASSES } from './keyColors'

// Low-level audio analysis shared by the key, tempo and type detectors:
//   • activeRegion — the audible span of a sample (skips silence padding);
//   • estimatePitchClass — a robust multi-window YIN pitch tracker for one-shots and
//     tuned drums (skips the attack transient, votes across the sustained body);
//   • analyzeDrum — drum-vs-melodic type and drum subtype from the sound itself.
// Key detection lives in key.ts (learned classifier over keyFeatures.ts), tempo in
// tempo.ts; analysisJob.ts runs a whole analysis pass.

// Monophonic pitch (YIN). The lower bound is intentionally low so sub-bass and
// 808-range fundamentals (~40 Hz) are reachable; pitch class is octave-invariant
// so anything below it simply folds up an octave.
const PITCH_FMIN = 30
const PITCH_FMAX = 1600
const PITCH_SPAN_SECONDS = 1.6
const PITCH_MAX_WINDOWS = 8
const YIN_THRESHOLD = 0.15
const HANN_CACHE = new Map<number, Float32Array>()

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function hannWindow(N: number): Float32Array {
  const cached = HANN_CACHE.get(N)
  if (cached) return cached
  const w = new Float32Array(N)
  for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))
  HANN_CACHE.set(N, w)
  return w
}

export type ActiveRegion = readonly [number, number]

export interface PitchEstimate {
  tonic: string
  confidence: number
  clarity: number
}

/** Run YIN over a single window, returning the fundamental frequency and clarity. */
function yinWindow(x: Float32Array, offset: number, W: number, sampleRate: number): { freq: number; clarity: number } | null {
  const minTau = Math.max(2, Math.floor(sampleRate / PITCH_FMAX))
  const maxTau = Math.min(Math.floor(sampleRate / PITCH_FMIN), W >> 1)
  if (maxTau <= minTau + 1) return null

  const diff = new Float64Array(maxTau + 1)
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0
    const limit = W - tau
    for (let i = 0; i < limit; i++) {
      const d = x[offset + i] - x[offset + i + tau]
      sum += d * d
    }
    diff[tau] = sum
  }

  const cmnd = new Float64Array(maxTau + 1)
  cmnd[0] = 1
  let running = 0
  for (let tau = 1; tau <= maxTau; tau++) {
    running += diff[tau]
    cmnd[tau] = running > 0 ? (diff[tau] * tau) / running : 1
  }

  // Absolute-threshold: first dip below the threshold, walked to its local min.
  let tau = -1
  for (let t = minTau; t <= maxTau; t++) {
    if (cmnd[t] < YIN_THRESHOLD) {
      while (t + 1 <= maxTau && cmnd[t + 1] < cmnd[t]) t++
      tau = t
      break
    }
  }
  if (tau < 0) {
    let bt = -1
    let bv = Infinity
    for (let t = minTau; t <= maxTau; t++) {
      if (cmnd[t] < bv) {
        bv = cmnd[t]
        bt = t
      }
    }
    if (bt < 0 || bv > 0.45) return null
    tau = bt
  }

  let refined = tau
  if (tau > minTau && tau < maxTau) {
    const l = cmnd[tau - 1]
    const c = cmnd[tau]
    const r = cmnd[tau + 1]
    const denom = l - 2 * c + r
    if (Math.abs(denom) > 1e-12) refined = tau + (l - r) / (2 * denom)
  }

  const freq = sampleRate / refined
  if (!isFinite(freq) || freq < PITCH_FMIN || freq > PITCH_FMAX) return null
  return { freq, clarity: 1 - Math.min(1, cmnd[tau]) }
}

/**
 * Estimate the pitch class of a (mostly) monophonic or tuned sound. Skips the
 * attack transient and votes across overlapping windows of the sustained body,
 * weighting by per-window clarity — robust for tuned drum hits and one-shots.
 */
export function estimatePitchClass(
  samples: Float32Array,
  sampleRate: number,
  region: ActiveRegion = activeRegion(samples)
): PitchEstimate | null {
  const [aStart, aEnd] = region
  const activeLen = aEnd - aStart + 1
  if (activeLen < Math.floor(sampleRate * 0.03)) return null

  const spanLen = Math.min(activeLen, Math.floor(sampleRate * PITCH_SPAN_SECONDS))

  // Skip the (noisy) attack only when the peak is near the onset.
  let peakIdx = aStart
  let peakVal = 0
  const scanEnd = Math.min(aEnd, aStart + spanLen)
  for (let i = aStart; i <= scanEnd; i++) {
    const a = Math.abs(samples[i])
    if (a > peakVal) {
      peakVal = a
      peakIdx = i
    }
  }
  if (peakVal <= 0) return null
  let bStart = aStart
  if (peakIdx - aStart < spanLen * 0.25) {
    bStart = Math.min(peakIdx + Math.floor(sampleRate * 0.006), aStart + Math.floor(spanLen * 0.3))
  }
  const bodyLen = Math.min(aEnd - bStart + 1, spanLen)
  if (bodyLen < Math.floor(sampleRate * 0.03)) return null

  let mean = 0
  for (let i = 0; i < bodyLen; i++) mean += samples[bStart + i]
  mean /= bodyLen
  const x = new Float32Array(bodyLen)
  let sumSq = 0
  for (let i = 0; i < bodyLen; i++) {
    const v = samples[bStart + i] - mean
    x[i] = v
    sumSq += v * v
  }
  if (Math.sqrt(sumSq / bodyLen) < 0.0012) return null

  const W = Math.min(bodyLen, 2048)
  const denseHop = Math.max(1, W >> 1)
  const denseWindows = bodyLen >= W ? 1 + Math.floor((bodyLen - W) / denseHop) : 0
  const hop =
    denseWindows > PITCH_MAX_WINDOWS
      ? Math.max(1, Math.floor((bodyLen - W) / Math.max(1, PITCH_MAX_WINDOWS - 1)))
      : denseHop
  const votes = new Float64Array(12)
  const centsAcc = new Float64Array(12)
  const centsW = new Float64Array(12)
  let bestClarity = 0
  let nValid = 0
  let nChecked = 0
  for (let off = 0; off + W <= bodyLen; off += hop) {
    nChecked++
    const r = yinWindow(x, off, W, sampleRate)
    if (r) {
      nValid++
      const midi = 69 + 12 * Math.log2(r.freq / 440)
      const nearest = Math.round(midi)
      const pc = ((nearest % 12) + 12) % 12
      const cents = Math.abs(midi - nearest) * 100
      const w = r.clarity * r.clarity
      votes[pc] += w
      centsAcc[pc] += cents * w
      centsW[pc] += w
      if (r.clarity > bestClarity) bestClarity = r.clarity
    }
    if (nChecked >= PITCH_MAX_WINDOWS) break
  }

  let total = 0
  let bestPc = -1
  let bestW = 0
  for (let i = 0; i < 12; i++) {
    total += votes[i]
    if (votes[i] > bestW) {
      bestW = votes[i]
      bestPc = i
    }
  }
  if (bestPc < 0 || total <= 0) return null

  // Agreement = share of clarity-weight on the winning pitch class. A stable
  // tuned tone scores ~1; a pitch-swept kick or a noisy hit splits its votes and
  // is penalised hard, so atonal percussion doesn't earn a confident key.
  const agreement = bestW / total
  const cents = centsW[bestPc] > 0 ? centsAcc[bestPc] / centsW[bestPc] : 50
  const tuning = clamp01(1 - cents / 50)
  let confidence = clamp01((bestClarity - 0.5) / 0.42) * (0.2 + 0.8 * agreement) * (0.7 + 0.3 * tuning)
  if (agreement < 0.6) confidence *= 0.65
  // A single short window makes agreement trivially 1.0 — too little evidence to
  // trust (e.g. 60 ms of hi-hat noise can fake a periodicity), so require corroboration.
  if (nValid < 2) confidence *= 0.55
  if (confidence < 0.35) return null
  return { tonic: PITCH_CLASSES[bestPc], confidence: Math.min(0.97, confidence), clarity: bestClarity }
}

// ---- Audio-based drum / one-shot classification ----

export interface DrumFeatures {
  activeDuration: number // seconds of audible content
  centroid: number // spectral centroid (Hz) — brightness
  zcr: number // zero-crossing rate — noisiness
  lowRatio: number // energy below 150 Hz / total
  highRatio: number // energy above 6 kHz / total
  tonality: number // 0..1, 1 = strongly pitched (low spectral flatness)
  decay: number // late/early energy ratio — low = fast percussive decay
  attackTime: number // seconds from onset to peak — drums attack near-instantly
  peakCount: number // onset peaks in the first ~220 ms (claps flam)
}

export interface DrumEstimate {
  type: 'drum' | 'melodic'
  subtype: string | null
  confidence: number
  features: DrumFeatures
}

export function activeRegion(samples: Float32Array): ActiveRegion {
  let max = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > max) max = a
  }
  if (max <= 0) return [0, 0]
  const thr = max * 0.02
  let start = 0
  while (start < samples.length && Math.abs(samples[start]) < thr) start++
  let end = samples.length - 1
  while (end > start && Math.abs(samples[end]) < thr) end--
  return [start, Math.max(start, end)]
}

/** Count distinct hits (sharp energy rises ≥ 60 ms apart) across a span of audio. */
function countHits(samples: Float32Array, sampleRate: number, start: number, end: number): number {
  const hop = Math.max(1, Math.round(sampleRate * 0.01))
  const env: number[] = []
  for (let i = start; i + hop <= end; i += hop) {
    let e = 0
    for (let j = 0; j < hop; j++) e += samples[i + j] * samples[i + j]
    env.push(Math.sqrt(e / hop))
  }
  const rise: number[] = env.map((v, i) => (i > 0 ? Math.max(0, v - env[i - 1]) : 0))
  let max = 0
  for (const v of rise) max = Math.max(max, v)
  if (max <= 0) return 0
  const minGap = Math.round(0.06 / 0.01)
  let hits = 0
  let last = -minGap
  for (let i = 1; i < rise.length - 1; i++) {
    if (rise[i] >= max * 0.3 && rise[i] >= rise[i - 1] && rise[i] > rise[i + 1] && i - last >= minGap) {
      hits++
      last = i
    }
  }
  return hits
}

/** Classify a percussive sound (or detect that it is actually sustained/melodic) from audio. */
export function analyzeDrum(
  samples: Float32Array,
  sampleRate: number,
  region: ActiveRegion = activeRegion(samples)
): DrumEstimate {
  const [aStart, aEnd] = region
  const activeLen = Math.max(1, aEnd - aStart + 1)
  const activeDuration = activeLen / sampleRate

  // Zero-crossing rate over the active region.
  let zc = 0
  for (let i = aStart + 1; i <= aEnd; i++) {
    if ((samples[i - 1] < 0 && samples[i] >= 0) || (samples[i - 1] >= 0 && samples[i] < 0)) zc++
  }
  const zcr = zc / activeLen

  // Attack time: onset → peak amplitude. Percussion peaks almost instantly.
  let peakIdx = aStart
  let peakVal = 0
  for (let i = aStart; i <= aEnd; i++) {
    const a = Math.abs(samples[i])
    if (a > peakVal) {
      peakVal = a
      peakIdx = i
    }
  }
  const attackTime = (peakIdx - aStart) / sampleRate

  // Averaged magnitude spectrum across a few windows.
  const N = 2048
  const fft = new FFT(N)
  const spec = fft.createComplexArray()
  const win = hannWindow(N)

  const positions: number[] = []
  if (activeLen >= N) {
    const step = Math.max(N >> 1, Math.floor((activeLen - N) / 6) || N)
    for (let start = aStart; start + N <= aEnd + 1; start += step) positions.push(start)
  } else {
    positions.push(aStart)
  }
  const mag = new Float64Array(N / 2)
  const frame = new Array<number>(N)
  for (const start of positions) {
    for (let i = 0; i < N; i++) {
      const idx = start + i
      frame[i] = (idx <= aEnd && idx < samples.length ? samples[idx] : 0) * win[i]
    }
    fft.realTransform(spec, frame)
    fft.completeSpectrum(spec)
    for (let k = 0; k < N / 2; k++) {
      const re = spec[2 * k]
      const im = spec[2 * k + 1]
      mag[k] += Math.sqrt(re * re + im * im)
    }
  }
  const frames = positions.length || 1

  let total = 0
  let low = 0
  let high = 0
  let cWeighted = 0
  let logSum = 0
  let arith = 0
  let count = 0
  for (let k = 1; k < N / 2; k++) {
    const m = mag[k] / frames
    const freq = (k * sampleRate) / N
    total += m
    if (freq < 150) low += m
    if (freq > 6000) high += m
    cWeighted += freq * m
    const mm = m + 1e-9
    logSum += Math.log(mm)
    arith += mm
    count++
  }
  const centroid = total > 0 ? cWeighted / total : 0
  const lowRatio = total > 0 ? low / total : 0
  const highRatio = total > 0 ? high / total : 0
  const flatness = count > 0 ? Math.exp(logSum / count) / (arith / count) : 1
  const tonality = Math.max(0, Math.min(1, 1 - flatness))

  // Early vs late energy (decay).
  const third = Math.max(1, Math.floor(activeLen / 3))
  let early = 0
  let late = 0
  for (let i = 0; i < third; i++) {
    const a = samples[aStart + i] ?? 0
    early += a * a
    const b = samples[aEnd - i] ?? 0
    late += b * b
  }
  const decay = early > 0 ? late / early : 1

  // Onset peaks in the first ~220 ms (claps have a flam/multiple transients).
  const winLen = Math.floor(sampleRate * 0.22)
  const ehop = Math.max(1, Math.floor(sampleRate * 0.005))
  const env: number[] = []
  let prev = 0
  for (let i = aStart; i < aStart + winLen && i + ehop < samples.length; i += ehop) {
    let e = 0
    for (let j = 0; j < ehop; j++) e += samples[i + j] * samples[i + j]
    const rms = Math.sqrt(e / ehop)
    env.push(Math.max(0, rms - prev))
    prev = rms
  }
  let emax = 0
  for (const v of env) if (v > emax) emax = v
  let peakCount = 0
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] > emax * 0.4 && env[i] >= env[i - 1] && env[i] > env[i + 1]) peakCount++
  }

  const features: DrumFeatures = {
    activeDuration,
    centroid,
    zcr,
    lowRatio,
    highRatio,
    tonality,
    decay,
    attackTime,
    peakCount
  }

  // Tonal + sustained (relative to its length) => a melodic sound, even a short
  // stab or pluck. Duration is NOT the discriminator: a brass stab and a tuned
  // snare can be the same length — the snare collapses fast (low decay) and is
  // noisy (low tonality), the brass sustains and is harmonic. The centroid floor
  // protects bass-range drums (kick/808/tom) which read as tonal but aren't melodic.
  const inInstrumentRange = centroid > 250 && centroid < 6000 && lowRatio < 0.6
  const sustainGate = activeDuration > 1.0 ? 0.34 : 0.2
  // Sustained tonal content (held stab, pad, loop) OR a clean harmonic hit whose
  // pitch is unmistakable (pluck/key/mallet one-shot) — the latter can decay fast
  // like a drum, so it's identified by very high tonality + very low noise (ZCR)
  // instead of by its envelope. A tuned snare (noisy, tonality ~0.45) or 808
  // (sub-bass, out of range) stay drums while still getting a detected key.
  const tonalSustained = tonality > 0.5 && decay > sustainGate && inInstrumentRange
  const harmonicClean = tonality > 0.85 && zcr < 0.06 && inInstrumentRange
  const looksMelodic = tonalSustained || harmonicClean
  if (looksMelodic) {
    return {
      type: 'melodic',
      subtype: activeDuration >= 1.2 ? 'loop' : 'one_shot',
      confidence: Math.min(0.9, 0.45 + tonality * 0.35 + Math.min(0.15, decay * 0.12)),
      features
    }
  }

  // A long sound with many separate hits is a drum *loop* (break, groove, top loop),
  // not a one-shot — whatever its dominant timbre.
  if (activeDuration >= 1.5 && countHits(samples, sampleRate, aStart, aEnd) >= 4) {
    return { type: 'drum', subtype: 'loop', confidence: 0.75, features }
  }

  let subtype: string
  let conf = 0.5
  if (centroid < 350 || lowRatio > 0.5) {
    if (tonality > 0.5 && activeDuration > 0.22) {
      subtype = '808'
      conf = 0.55 + lowRatio * 0.3
    } else {
      subtype = 'kick'
      conf = 0.55 + lowRatio * 0.35
    }
  } else if (centroid > 4800 && zcr > 0.22) {
    // bright + noisy = hats / cymbals; long ring => cymbal, short => hi-hat
    if (activeDuration > 0.5) {
      subtype = 'cymbal'
      conf = 0.5 + Math.min(0.3, highRatio)
    } else {
      subtype = 'hihat'
      conf = 0.55 + Math.min(0.35, zcr)
    }
  } else if (tonality > 0.5 && centroid < 1200) {
    subtype = 'tom'
    conf = 0.5 + tonality * 0.25
  } else if (peakCount >= 2) {
    subtype = 'clap'
    conf = 0.55
  } else if (zcr > 0.1) {
    subtype = 'snare'
    conf = 0.5 + Math.min(0.25, zcr)
  } else {
    subtype = 'perc'
    conf = 0.45
  }

  return { type: 'drum', subtype, confidence: Math.max(0.4, Math.min(0.9, conf)), features }
}
