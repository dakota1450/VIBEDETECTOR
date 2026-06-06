import FFT from 'fft.js'
import type { KeyDecisionDiagnostics, KeyEvidenceItem, KeyMode } from './types'
import { PITCH_CLASSES } from './keyColors'

// Krumhansl–Kessler key profiles (major / minor), indexed from the tonic.
export const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
export const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

// Chroma analysis. A larger frame gives better low-frequency separation; peak
// picking + parabolic interpolation recovers precise partial frequencies so the
// chroma reflects actual tonal content rather than broadband noise.
const FRAME = 8192
const HOP = 4096
const CHROMA_FMIN = 30
const CHROMA_FMAX = 5000
const ROOT_CHROMA_FMAX = 420
const KEY_ANALYSIS_SECONDS = 20
const KEY_SECTION_SECONDS = 4
const KEY_MAX_SECTIONS = 5

// Monophonic pitch (YIN). The lower bound is intentionally low so sub-bass and
// 808-range fundamentals (~40 Hz) are reachable; pitch class is octave-invariant
// so anything below it simply folds up an octave.
const PITCH_FMIN = 30
const PITCH_FMAX = 1600
const PITCH_SPAN_SECONDS = 1.6
const PITCH_MAX_WINDOWS = 8
const YIN_THRESHOLD = 0.15
const HANN_CACHE = new Map<number, Float32Array>()

interface ChromaOptions {
  fMin?: number
  fMax?: number
  bassBias?: boolean
  harmonicFolding?: boolean
}

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

/**
 * Build a 12-bin chromagram (C..B) from mono PCM. Picks spectral peaks per frame
 * and maps their interpolated frequencies to pitch classes, so tonal energy is
 * concentrated and broadband/percussive noise is largely rejected.
 */
export function computeChroma(samples: ArrayLike<number>, sampleRate: number, options: ChromaOptions = {}): Float32Array {
  const chroma = new Float32Array(12)
  const len = samples.length
  if (len < 1024) return chroma
  const fMin = options.fMin ?? CHROMA_FMIN
  const fMax = options.fMax ?? CHROMA_FMAX
  const bassBias = options.bassBias ?? true
  const harmonicFolding = options.harmonicFolding ?? true

  const fft = new FFT(FRAME)
  const spectrum = fft.createComplexArray()
  const window = hannWindow(FRAME)
  const half = FRAME / 2
  const mag = new Float64Array(half)
  const frame = new Array<number>(FRAME)
  const fc = new Float64Array(12) // per-frame chroma

  const addFrame = (start: number): void => {
    for (let i = 0; i < FRAME; i++) {
      const idx = start + i
      frame[i] = (idx < len ? samples[idx] : 0) * window[i]
    }
    fft.realTransform(spectrum, frame)
    fft.completeSpectrum(spectrum)
    let mean = 0
    for (let k = 1; k < half; k++) {
      const re = spectrum[2 * k]
      const im = spectrum[2 * k + 1]
      const m = Math.sqrt(re * re + im * im)
      mag[k] = m
      mean += m
    }
    mean /= half - 1
    const floor = mean * 1.5
    fc.fill(0)
    for (let k = 2; k < half - 1; k++) {
      const m = mag[k]
      if (m <= floor) continue
      if (m <= mag[k - 1] || m < mag[k + 1]) continue // local maximum only
      const a = mag[k - 1]
      const c = mag[k + 1]
      const denom = a - 2 * m + c
      const delta = denom !== 0 ? (0.5 * (a - c)) / denom : 0
      const freq = ((k + delta) * sampleRate) / FRAME
      if (freq < fMin || freq > fMax) continue
      // Weight the bass register more: the tonic/root is most often carried by the
      // bass, so this biases KS toward the true tonic and away from the dominant /
      // subdominant (the dominant i↔v and subdominant i↔iv mix-ups are the main
      // remaining key errors on real loops).
      const w = bassBias ? (freq < 150 ? 3 : freq < 300 ? 2 : freq < 600 ? 1.3 : 1) : 1
      const addPitchClass = (f: number, amount: number): void => {
        if (f < fMin || f > fMax) return
        const midi = 69 + 12 * Math.log2(f / 440)
        const pc = (((Math.round(midi) % 12) + 12) % 12)
        fc[pc] += amount
      }

      addPitchClass(freq, m * w)
      if (harmonicFolding) {
        // Real samples are rich in overtones; raw chroma can mistake harmonics for
        // played notes. A small inverse-harmonic vote lets strong partials point
        // back toward their likely fundamentals without drowning out actual notes.
        for (let h = 2; h <= 6; h++) addPitchClass(freq / h, (m * w * 0.26) / h)
      }
    }
    // Normalise each frame to unit sum before accumulating. Key is determined by WHICH
    // notes are used over time (the scale), not by how loud or sustained any one note
    // is — otherwise a held bass note or a prominent dominant dominates the whole
    // chromagram and KS locks onto the fifth/fourth/relative instead of the tonic.
    let fsum = 0
    for (let i = 0; i < 12; i++) fsum += fc[i]
    if (fsum > 0) for (let i = 0; i < 12; i++) chroma[i] += fc[i] / fsum
  }

  if (len < FRAME) addFrame(0)
  else for (let start = 0; start + FRAME <= len; start += HOP) addFrame(start)

  let sum = 0
  for (let i = 0; i < 12; i++) sum += chroma[i]
  if (sum > 0) for (let i = 0; i < 12; i++) chroma[i] /= sum
  return chroma
}

function entropy12(chroma: ArrayLike<number>): number {
  let h = 0
  let sum = 0
  for (let i = 0; i < 12; i++) sum += chroma[i]
  if (sum <= 0) return 1
  for (let i = 0; i < 12; i++) {
    const p = chroma[i] / sum
    if (p > 0) h -= p * Math.log(p)
  }
  return h / Math.log(12)
}

function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let ma = 0
  let mb = 0
  for (let i = 0; i < 12; i++) {
    ma += a[i]
    mb += b[i]
  }
  ma /= 12
  mb /= 12
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < 12; i++) {
    const x = a[i] - ma
    const y = b[i] - mb
    num += x * y
    da += x * x
    db += y * y
  }
  if (da === 0 || db === 0) return 0
  return num / Math.sqrt(da * db)
}

export interface KeyEstimate {
  tonic: string | null
  mode: KeyMode | null
  confidence: number
  diagnostics?: KeyDecisionDiagnostics
}

export type ActiveRegion = readonly [number, number]

interface PitchEstimate {
  tonic: string
  confidence: number
  clarity: number
}

const MAJOR_SCALE = new Set([0, 2, 4, 5, 7, 9, 11])
const MINOR_SCALE = new Set([0, 2, 3, 5, 7, 8, 10])

interface KeyCandidate {
  tonic: number
  mode: KeyMode
  corr: number
  rank: number
  scaleFit: number
  rootSupport: number
}

function activeDurationFromRegion(region: ActiveRegion, sampleRate: number): number {
  const [start, end] = region
  return Math.max(0, end - start + 1) / sampleRate
}

function keyAnalysisRanges(samples: Float32Array, sampleRate: number, region: ActiveRegion): ActiveRegion[] {
  const [start, end] = region
  if (end <= start) return [[0, Math.max(0, samples.length - 1)]]
  const activeLen = end - start + 1
  const maxLen = Math.floor(sampleRate * KEY_ANALYSIS_SECONDS)
  const pad = Math.floor(sampleRate * 0.05)
  if (activeLen <= maxLen) {
    return [[Math.max(0, start - pad), Math.min(samples.length - 1, end + pad)]]
  }

  const sectionLen = Math.min(activeLen, Math.floor(sampleRate * KEY_SECTION_SECONDS))
  const lastStart = Math.max(start, end - sectionLen + 1)
  const ranges: ActiveRegion[] = []
  for (let i = 0; i < KEY_MAX_SECTIONS; i++) {
    const frac = i / (KEY_MAX_SECTIONS - 1)
    const sectionStart = Math.min(lastStart, start + Math.round((activeLen - sectionLen) * frac))
    const from = Math.max(0, sectionStart - pad)
    const to = Math.min(samples.length - 1, sectionStart + sectionLen - 1 + pad)
    const prev = ranges[ranges.length - 1]
    if (!prev || from - prev[0] > Math.floor(sampleRate * 0.5)) ranges.push([from, to])
  }
  return ranges
}

function chromaEvidence(chroma: ArrayLike<number>): number {
  let sum = 0
  const sorted: number[] = []
  for (let i = 0; i < 12; i++) {
    const v = chroma[i] ?? 0
    sum += v
    sorted.push(v)
  }
  if (sum <= 0) return 0
  sorted.sort((a, b) => b - a)
  const top3 = (sorted[0] + sorted[1] + sorted[2]) / sum
  const entropy = entropy12(chroma)
  return clamp01((top3 - 0.32) / 0.38) * 0.7 + clamp01((0.94 - entropy) / 0.42) * 0.3
}

function computeSectionChroma(
  samples: Float32Array,
  sampleRate: number,
  ranges: ActiveRegion[],
  options: ChromaOptions = {}
): Float32Array {
  const out = new Float32Array(12)
  let totalWeight = 0
  for (const [from, to] of ranges) {
    const chroma = computeChroma(samples.subarray(from, to + 1), sampleRate, options)
    const evidence = chromaEvidence(chroma)
    if (evidence < 0.08) continue
    const weight = 0.2 + evidence
    for (let i = 0; i < 12; i++) out[i] += chroma[i] * weight
    totalWeight += weight
  }
  if (totalWeight <= 0) return out
  let sum = 0
  for (let i = 0; i < 12; i++) sum += out[i]
  if (sum > 0) for (let i = 0; i < 12; i++) out[i] /= sum
  return out
}

/** Chroma peak-pick cross-check: returns the single dominant pitch class, if any. */
function detectSinglePitchFromChroma(chroma: ArrayLike<number>): PitchEstimate | null {
  let sum = 0
  let max = 0
  let second = 0
  let best = 0
  for (let i = 0; i < 12; i++) {
    const v = chroma[i]
    sum += v
    if (v > max) {
      second = max
      max = v
      best = i
    } else if (v > second) {
      second = v
    }
  }
  if (sum <= 0) return null
  const peak = max / sum
  const contrast = (max - second) / sum
  const confidence = clamp01((peak - 0.42) / 0.36) * 0.65 + clamp01((contrast - 0.18) / 0.3) * 0.35
  if (confidence < 0.4) return null
  return { tonic: PITCH_CLASSES[best], confidence: Math.min(0.9, confidence), clarity: peak }
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
function estimatePitchClass(
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

function scaleFitScore(chroma: ArrayLike<number>, tonic: number, mode: KeyMode): number {
  const scale = mode === 'major' ? MAJOR_SCALE : MINOR_SCALE
  let inside = 0
  let outside = 0
  for (let i = 0; i < 12; i++) {
    const degree = (i - tonic + 12) % 12
    if (scale.has(degree)) inside += chroma[i] ?? 0
    else outside += chroma[i] ?? 0
  }
  return inside - outside * 1.15
}

function rootSupport(chroma: ArrayLike<number>, tonic: number): number {
  let maxOther = 0
  for (let i = 0; i < 12; i++) {
    if (i !== tonic) maxOther = Math.max(maxOther, chroma[i] ?? 0)
  }
  const root = chroma[tonic] ?? 0
  return root + Math.max(0, root - maxOther) * 0.65
}

function triadSupport(chroma: ArrayLike<number>, tonic: number, mode: KeyMode): number {
  const root = chroma[tonic] ?? 0
  const third = chroma[(tonic + (mode === 'major' ? 4 : 3)) % 12] ?? 0
  const otherThird = chroma[(tonic + (mode === 'major' ? 3 : 4)) % 12] ?? 0
  const fifth = chroma[(tonic + 7) % 12] ?? 0
  return root * 0.8 + third * 0.55 + fifth * 0.45 - otherThird * 0.25
}

/** Estimate key from chroma using KS correlation plus scale, triad, and bass-root evidence. */
export function detectKeyFromChroma(chroma: ArrayLike<number>, rootChroma?: ArrayLike<number>): KeyEstimate {
  let sum = 0
  for (let i = 0; i < 12; i++) sum += chroma[i]
  if (sum <= 0) return { tonic: null, mode: null, confidence: 0 }

  let rootHintSum = 0
  if (rootChroma) for (let i = 0; i < 12; i++) rootHintSum += rootChroma[i] ?? 0

  const candidates: KeyCandidate[] = []

  const consider = (corr: number, tonic: number, mode: KeyMode): void => {
    const scaleFit = scaleFitScore(chroma, tonic, mode)
    const broadRoot = rootSupport(chroma, tonic)
    const bassRoot = rootChroma && rootHintSum > 0 ? rootSupport(rootChroma, tonic) : 0
    const triad = triadSupport(chroma, tonic, mode)
    const root = bassRoot > 0 ? bassRoot : broadRoot
    const rank = corr + scaleFit * 0.24 + root * 0.18 + triad * 0.12
    candidates.push({ tonic, mode, corr, rank, scaleFit, rootSupport: root })
  }

  const majRot = new Array<number>(12)
  const minRot = new Array<number>(12)
  for (let t = 0; t < 12; t++) {
    for (let i = 0; i < 12; i++) {
      majRot[i] = KS_MAJOR[(i - t + 12) % 12]
      minRot[i] = KS_MINOR[(i - t + 12) % 12]
    }
    consider(pearson(chroma, majRot), t, 'major')
    consider(pearson(chroma, minRot), t, 'minor')
  }

  candidates.sort((a, b) => b.rank - a.rank)
  const best = candidates[0]
  const second = candidates[1]
  if (!best) return { tonic: null, mode: null, confidence: 0 }
  const margin = Math.max(0, best.rank - (second?.rank ?? -Infinity))
  const corrFit = clamp01((best.corr - 0.14) / 0.58)
  const scaleFit = clamp01((best.scaleFit - 0.2) / 0.62)
  const rootFit = clamp01(best.rootSupport / 0.18)
  const marginFit = clamp01(margin / 0.18)
  const base = corrFit * 0.68 + scaleFit * 0.2 + rootFit * 0.12
  const confidence = clamp01(base * (0.54 + marginFit * 0.46))
  return { tonic: PITCH_CLASSES[best.tonic], mode: best.mode, confidence: Math.min(0.95, confidence) }
}

function modeWithThirdEvidence(chroma: ArrayLike<number>, tonic: string | null, mode: KeyMode | null): KeyMode | null {
  if (!tonic || !mode) return null
  const tonicIndex = PITCH_CLASSES.indexOf(tonic as (typeof PITCH_CLASSES)[number])
  if (tonicIndex < 0) return null

  const thirdIndex = (tonicIndex + (mode === 'major' ? 4 : 3)) % 12
  const otherThirdIndex = (tonicIndex + (mode === 'major' ? 3 : 4)) % 12
  const fifthIndex = (tonicIndex + 7) % 12
  const root = chroma[tonicIndex] ?? 0
  const third = chroma[thirdIndex] ?? 0
  const otherThird = chroma[otherThirdIndex] ?? 0
  const fifth = chroma[fifthIndex] ?? 0

  // Harmonic spectra from a single note/root-fifth can look "major" because the
  // fifth harmonic lands on the major third. Require the third to be a meaningful
  // part of the chroma before claiming major/minor; otherwise report tonic-only.
  const strongEnough = third >= 0.045 || third >= root * 0.11 || third >= fifth * 0.45
  const distinguishable = otherThird <= 0.015 || third >= otherThird * 1.2
  return strongEnough && distinguishable ? mode : null
}

function keyEstimateDiagnostics(
  reason: string,
  confidence: number,
  evidence: KeyEvidenceItem[]
): KeyDecisionDiagnostics {
  return {
    evidence: [
      { name: 'analyzerReason', value: reason, confidence },
      ...evidence
    ]
  }
}

/**
 * Detect the musical key of any sound. Fuses a monophonic pitch estimate (great
 * for one-shots and tuned percussion) with a Krumhansl–Schmuckler chroma estimate
 * (great for chords/loops). Mode is only assigned when the content is genuinely
 * polyphonic — a single tuned hit gets a tonic with an open (null) mode.
 */
export function analyzeKey(
  samples: Float32Array,
  sampleRate: number,
  region: ActiveRegion = activeRegion(samples)
): KeyEstimate {
  const pitch = estimatePitchClass(samples, sampleRate, region)
  const ranges = keyAnalysisRanges(samples, sampleRate, region)
  const chroma = computeSectionChroma(samples, sampleRate, ranges)
  const rootChroma = computeSectionChroma(samples, sampleRate, ranges, { fMax: ROOT_CHROMA_FMAX, harmonicFolding: false })
  const ks = detectKeyFromChroma(chroma, rootChroma)
  const peak = detectSinglePitchFromChroma(chroma)

  // Shape of the chroma distribution. A single note concentrates almost all mass
  // in one class; a chord/loop spreads it across a few; broadband noise spreads it
  // across all twelve (so even its top three classes hold little mass).
  let concentration = 0
  const sorted = [...chroma].sort((a, b) => b - a)
  const top3 = sorted[0] + sorted[1] + sorted[2]
  for (let i = 0; i < 12; i++) concentration = Math.max(concentration, chroma[i])
  const entropy = entropy12(chroma)
  const polyphonic = concentration < 0.58 && (top3 >= 0.46 || entropy < 0.9)
  const tonalChroma = top3 >= 0.43 || (top3 >= 0.34 && entropy < 0.9) // structured enough to be music, not noise
  const dur = activeDurationFromRegion(region, sampleRate)
  const baseEvidence: KeyEvidenceItem[] = [
    { name: 'activeDurationSec', value: Number(dur.toFixed(3)) },
    { name: 'top3ChromaShare', value: Number(top3.toFixed(3)) },
    { name: 'chromaConcentration', value: Number(concentration.toFixed(3)) },
    { name: 'chromaEntropy', value: Number(entropy.toFixed(3)) },
    { name: 'tonalChroma', value: tonalChroma },
    { name: 'polyphonic', value: polyphonic }
  ]
  if (pitch) baseEvidence.push({ name: `pitch:${pitch.tonic}`, value: pitch.clarity.toFixed(3), confidence: pitch.confidence })
  if (ks.tonic) baseEvidence.push({ name: `ks:${ks.tonic}:${ks.mode ?? 'unknown'}`, value: ks.confidence, confidence: ks.confidence })
  if (peak) baseEvidence.push({ name: `chromaPeak:${peak.tonic}`, value: peak.clarity.toFixed(3), confidence: peak.confidence })

  // A single tuned tone — a one-shot or a sustained single note — is read by the
  // monophonic pitch tracker. A musical PHRASE (loop, melody, chord progression) is
  // read by the whole-distribution chroma + KS estimate: validated on a real library,
  // running the pitch tracker on a phrase locks onto whatever note is sounding (often
  // the bass or the dominant) and is the single biggest source of perfect-fifth /
  // -fourth key errors. So restrict the pitch path to short hits or a chroma so
  // concentrated it is effectively one held note.
  const monophonicHit =
    !!pitch &&
    pitch.confidence >= 0.5 &&
    (dur <= 1.3 || concentration >= 0.72 || (pitch.confidence >= 0.72 && peak?.tonic === pitch.tonic && top3 < 0.78))

  // 1. Single tuned tone → pitch tracker owns the tonic. Mode stays open unless the
  //    chroma is clearly polyphonic and agrees (a held stacked chord, not one note).
  if (monophonicHit && pitch) {
    const agree = !!ks.tonic && ks.tonic === pitch.tonic
    const mode = agree && ks.confidence >= 0.5 && polyphonic ? modeWithThirdEvidence(chroma, ks.tonic, ks.mode) : null
    let conf = pitch.confidence
    if (agree) conf = Math.min(0.97, conf + 0.06)
    if (peak?.tonic === pitch.tonic) conf = Math.min(0.97, conf + 0.03)
    return {
      tonic: pitch.tonic,
      mode,
      confidence: conf,
      diagnostics: keyEstimateDiagnostics('monophonic-pitch', conf, baseEvidence)
    }
  }

  // 2. Musical phrase / chord / sustained content → chroma + KS owns tonic AND mode.
  //    A corroborating pitch estimate nudges confidence up.
  if (ks.tonic && tonalChroma && ks.confidence >= 0.38) {
    const mode = modeWithThirdEvidence(chroma, ks.tonic, ks.mode)
    const conf = pitch?.tonic === ks.tonic ? Math.min(0.97, ks.confidence + 0.05) : ks.confidence
    return {
      tonic: ks.tonic,
      mode,
      confidence: conf,
      diagnostics: keyEstimateDiagnostics('chroma-ks', conf, baseEvidence)
    }
  }

  // 3. Weaker single-source fallbacks.
  if (pitch && pitch.confidence >= 0.5) {
    return {
      tonic: pitch.tonic,
      mode: null,
      confidence: pitch.confidence,
      diagnostics: keyEstimateDiagnostics('fallback-pitch', pitch.confidence, baseEvidence)
    }
  }
  if (ks.tonic && tonalChroma) {
    return {
      tonic: ks.tonic,
      mode: polyphonic ? modeWithThirdEvidence(chroma, ks.tonic, ks.mode) : null,
      confidence: ks.confidence,
      diagnostics: keyEstimateDiagnostics('fallback-chroma-ks', ks.confidence, baseEvidence)
    }
  }
  if (peak && peak.confidence >= 0.4 && tonalChroma) {
    return {
      tonic: peak.tonic,
      mode: null,
      confidence: peak.confidence,
      diagnostics: keyEstimateDiagnostics('fallback-chroma-peak', peak.confidence, baseEvidence)
    }
  }
  return {
    tonic: null,
    mode: null,
    confidence: 0,
    diagnostics: keyEstimateDiagnostics('insufficient-tonal-evidence', 0, baseEvidence)
  }
}

export interface BpmEstimate {
  bpm: number | null
  confidence: number
}

/** Estimate tempo via an onset-energy envelope + autocorrelation. Best-effort. */
export function analyzeBpm(samples: Float32Array, sampleRate: number): BpmEstimate {
  const W = 1024
  const H = 512
  if (samples.length < sampleRate * 1.5) return { bpm: null, confidence: 0 }
  const nFrames = Math.floor((samples.length - W) / H)
  if (nFrames < 32) return { bpm: null, confidence: 0 }

  const env = new Float32Array(nFrames)
  let prevRms = 0
  for (let f = 0; f < nFrames; f++) {
    const start = f * H
    let sumSq = 0
    for (let i = 0; i < W; i++) {
      const v = samples[start + i]
      sumSq += v * v
    }
    const rms = Math.sqrt(sumSq / W)
    env[f] = Math.max(0, rms - prevRms) // positive-going energy = onset
    prevRms = rms
  }

  let mean = 0
  for (let i = 0; i < nFrames; i++) mean += env[i]
  mean /= nFrames
  for (let i = 0; i < nFrames; i++) env[i] = Math.max(0, env[i] - mean)

  const envHop = H / sampleRate
  const lagAt = (bpm: number): number => Math.round(60 / bpm / envHop)
  const lagMin = Math.max(1, lagAt(200))
  const lagMax = Math.min(nFrames - 1, lagAt(60))

  let bestLag = -1
  let bestVal = 0
  let total = 0
  let count = 0
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let ac = 0
    for (let i = 0; i + lag < nFrames; i++) ac += env[i] * env[i + lag]
    total += ac
    count++
    if (ac > bestVal) {
      bestVal = ac
      bestLag = lag
    }
  }
  if (bestLag < 0 || bestVal <= 0) return { bpm: null, confidence: 0 }

  let bpm = 60 / (bestLag * envHop)
  while (bpm < 70) bpm *= 2
  while (bpm > 190) bpm /= 2

  const meanAc = count > 0 ? total / count : 0
  const prominence = meanAc > 0 ? bestVal / meanAc : 0
  const confidence = Math.max(0, Math.min(0.9, (prominence - 1) / 3))
  if (confidence < 0.25) return { bpm: null, confidence }
  return { bpm: Math.round(bpm), confidence }
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
