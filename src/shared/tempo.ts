import { autocorrelation, lerpAt, mean, melBank, movingAverage, parabolicOffset, stft } from './dsp'
import { TEMPO_MODEL } from './tempoModel'
import { TEMPO_PRESENCE_MODEL } from './tempoPresenceModel'

/** Below this P(has a tempo) the sound is treated as having no pulse (one-shot, pad, riser). */
export const TEMPO_PRESENCE_THRESHOLD = 0.4

// ---------------------------------------------------------------------------------
// Tempo estimation for samples and loops.
//
// 1. Onset strength: log-compressed mel-band spectral flux at ~172 frames/s (full
//    band plus low/high band variants), so drum hits, note attacks and chord
//    changes all register while steady tones don't.
// 2. Periodicity: generalized autocorrelation of each onset curve.
// 3. Loop structure: producer loops are cut to whole bars, so the file's exact
//    length admits only a few tempos (60·beats / duration). Those candidates — plus
//    the audio's own periodicity peaks and their octave relatives — are each
//    described by a feature vector (periodicity at the beat / half / bar lag,
//    low vs high band, beat-grid phase at the loop start, how close the tempo is to
//    a whole BPM, bar structure, onsets per beat, log-tempo).
// 4. A conditional-logit ranking model, trained on thousands of producer-labelled
//    loops with pack-grouped cross-validation, picks the candidate. It learns the
//    half/double-time conventions producers actually label with.
// ---------------------------------------------------------------------------------

export interface TempoOptions {
  /** Exact length of the whole file in seconds (the analysed signal may be truncated). */
  durationSec?: number | null
  minBpm?: number
  maxBpm?: number
  /** Return candidate feature vectors (for training / debugging). */
  debug?: boolean
}

export interface TempoCandidate {
  bpm: number
  beats: number | null
  features: number[]
  score: number
}

export interface TempoEstimate {
  bpm: number | null
  confidence: number
  method: 'loop-grid' | 'audio' | null
  /** Beats in the file when the tempo was locked to the loop length. */
  beats?: number | null
  /** 0..1 — how much distinct rhythmic onset activity the signal has. */
  rhythmic?: number
  /** 0..1 — learned probability that the sound has a musical tempo at all. */
  presence?: number
  candidates?: TempoCandidate[]
  global?: number[]
}

export const TEMPO_FEATURE_NAMES = [
  'lsal',
  'r1',
  'r2',
  'rHalf',
  'r4',
  'r3',
  'lowR1',
  'lowR2',
  'highR1',
  'highHalf',
  'lb',
  'lb2',
  'lb3',
  'sPow2',
  'sThree',
  'sIntBars',
  'sHalfBar',
  'sEven',
  'sOdd',
  'sAudio',
  'intClose',
  'intMid',
  'phase0',
  'onsetsPerBeat',
  'combPeak',
  'lowHalf',
  'midR1',
  'midR2',
  'midR4',
  'highQuarter',
  'highR2',
  'm8th',
  'm16th',
  'm32nd',
  'mBeat',
  'backbeat',
  'snareOn3',
  'kickOn13',
  'hat16'
] as const

/** Whole-loop descriptors; each enters the model only through its product with the
 *  log-tempo terms (a loop-level constant can't change a softmax over candidates),
 *  i.e. they let the tempo prior shift with the loop's character. */
export const TEMPO_GLOBAL_NAMES = [
  'logDur',
  'logOnsetRate',
  'rhythmic',
  'highShare',
  'lowShare',
  'logCentroid',
  'lowEnergy',
  'flatness',
  'salMax',
  'mfcc1',
  'mfcc2',
  'mfcc3',
  'mfcc4',
  'mfcc5',
  'mfcc6'
] as const

/** Longest file treated as a bar-trimmed loop (99% of producer loops are < 47 s). */
const MAX_LOOP_SECONDS = 75
const ENV_FFT = 1024
const ENV_HOP_SEC = 128 / 22050
const MEL_BANDS = 40
const LOG_GAMMA = 100
const LOW_BAND_HZ = 200
const HIGH_BAND_HZ = 2500

export interface OnsetEnvelopes {
  full: Float32Array
  low: Float32Array
  mid: Float32Array
  high: Float32Array
  frameRate: number
  /** Whole-signal timbre descriptors, used to condition the half/double-time choice. */
  centroidHz: number
  lowEnergyShare: number
  flatness: number
  /** Mean log-mel spectrum (timbre). */
  meanLogMel: Float64Array
}

/**
 * Mel-band log spectral flux (SuperFlux-style: compared with the max of the
 * neighbouring bands two frames back, so vibrato/glides don't read as onsets).
 * Frames are centred: frame f is centred on sample f·hop, so an onset at t = 0 is
 * visible (important — loops start on the downbeat).
 */
export function onsetEnvelopes(samples: ArrayLike<number>, sampleRate: number): OnsetEnvelopes {
  const hop = Math.max(1, Math.round(ENV_HOP_SEC * sampleRate))
  const n = sampleRate > 30000 ? ENV_FFT * 2 : ENV_FFT
  const pad = n >> 1
  const padded = new Float32Array(samples.length + 2 * pad)
  for (let i = 0; i < samples.length; i++) padded[pad + i] = samples[i]
  const bank = melBank(n, sampleRate, MEL_BANDS, 30, Math.min(11000, sampleRate / 2 - 100))
  const B = bank.bands
  const centers: number[] = []
  for (let b = 0; b < B; b++) {
    const w = bank.weights[b]
    let best = 0
    for (let j = 1; j < w.length; j++) if (w[j] > w[best]) best = j
    centers.push(((bank.start[b] + best) * sampleRate) / n)
  }
  const frames = 1 + Math.floor(samples.length / hop)
  const full = new Float32Array(frames)
  const low = new Float32Array(frames)
  const mid = new Float32Array(frames)
  const high = new Float32Array(frames)
  let prev2 = new Float32Array(B)
  let prev1 = new Float32Array(B)
  let cur = new Float32Array(B)
  const bandEnergy = new Float64Array(B)
  const logMelSum = new Float64Array(B)
  let flatSum = 0
  let flatFrames = 0
  stft(
    padded,
    n,
    hop,
    (f, mag) => {
      for (let b = 0; b < B; b++) {
        const w = bank.weights[b]
        const k0 = bank.start[b]
        let acc = 0
        for (let j = 0; j < w.length; j++) acc += w[j] * mag[k0 + j]
        cur[b] = Math.log1p(LOG_GAMMA * acc)
        bandEnergy[b] += acc * acc
        logMelSum[b] += cur[b]
      }
      let logSum = 0
      let linSum = 0
      for (let b = 0; b < B; b++) {
        const e = Math.expm1(cur[b]) + 1e-6
        logSum += Math.log(e)
        linSum += e
      }
      if (linSum > B * 1e-4) {
        flatSum += Math.exp(logSum / B) / (linSum / B)
        flatFrames++
      }
      let fl = 0
      let lo = 0
      let md = 0
      let hi = 0
      for (let b = 0; b < B; b++) {
        const ref = Math.max(prev2[b], b > 0 ? prev2[b - 1] : 0, b < B - 1 ? prev2[b + 1] : 0)
        const d = cur[b] - ref
        if (d > 0) {
          fl += d
          if (centers[b] < LOW_BAND_HZ) lo += d
          else if (centers[b] > HIGH_BAND_HZ) hi += d
          else md += d
        }
      }
      full[f] = fl
      low[f] = lo
      mid[f] = md
      high[f] = hi
      const t = prev2
      prev2 = prev1
      prev1 = cur
      cur = t
    },
    { maxFrames: frames }
  )
  let eTot = 0
  let eLow = 0
  let cAcc = 0
  for (let b = 0; b < B; b++) {
    eTot += bandEnergy[b]
    cAcc += bandEnergy[b] * centers[b]
    if (centers[b] < 150) eLow += bandEnergy[b]
  }
  return {
    full,
    low,
    mid,
    high,
    frameRate: sampleRate / hop,
    centroidHz: eTot > 0 ? cAcc / eTot : 0,
    lowEnergyShare: eTot > 0 ? eLow / eTot : 0,
    flatness: flatFrames ? flatSum / flatFrames : 1,
    meanLogMel: logMelSum.map((v) => v / Math.max(1, frames))
  }
}

/** DCT-II of the mean log-mel spectrum (MFCC-style timbre summary), c1..cK. */
function timbreCoefficients(meanLogMel: Float64Array, k: number): number[] {
  const B = meanLogMel.length
  let total = 0
  for (let b = 0; b < B; b++) total += meanLogMel[b]
  const scale = total > 0 ? B / total : 1
  const out: number[] = []
  for (let c = 1; c <= k; c++) {
    let acc = 0
    for (let b = 0; b < B; b++) acc += meanLogMel[b] * scale * Math.cos((Math.PI * c * (b + 0.5)) / B)
    out.push(acc / B)
  }
  return out
}

/** Detrend (remove slow loudness changes), half-wave rectify. */
function detrend(raw: Float32Array, frameRate: number): Float32Array {
  const trend = movingAverage(raw, Math.round(frameRate * 0.4))
  const out = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = Math.max(0, raw[i] - trend[i])
  return out
}

function centered(x: Float32Array): Float32Array {
  const mu = mean(x)
  const out = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = x[i] - mu
  return out
}

/** Peak-picked onset count (adaptive threshold, ≥50 ms apart). */
function countOnsets(env: Float32Array, frameRate: number): number {
  const avg = movingAverage(env, Math.round(frameRate * 0.25))
  let max = 0
  for (let i = 0; i < env.length; i++) max = Math.max(max, env[i])
  if (max <= 0) return 0
  const minGap = Math.round(frameRate * 0.05)
  let count = 0
  let last = -minGap
  for (let i = 1; i < env.length - 1; i++) {
    const v = env[i]
    if (v > env[i - 1] && v >= env[i + 1] && v > avg[i] * 1.5 + max * 0.06 && i - last >= minGap) {
      count++
      last = i
    }
  }
  return count
}

function structureOneHot(beats: number | null): number[] {
  // [pow2 bars, 3/6/12/24 bars (or 12-beat multiples), other whole bars, half bar,
  //  other even beat counts, odd beat counts, not a loop-length candidate]
  const v = [0, 0, 0, 0, 0, 0, 0]
  if (beats == null) {
    v[6] = 1
    return v
  }
  const bars = beats / 4
  if ([1, 2, 4, 8, 16, 32].includes(bars)) v[0] = 1
  else if ([3, 6, 12, 24].includes(bars) || beats % 12 === 0) v[1] = 1
  else if (Number.isInteger(bars)) v[2] = 1
  else if (bars === 0.5) v[3] = 1
  else if (beats % 2 === 0) v[4] = 1
  else v[5] = 1
  return v
}

/** Max of `env` within ±w frames of a fractional position (tolerates swing/jitter). */
function peakNear(env: Float32Array, t: number, w: number): number {
  const a = Math.max(0, Math.floor(t - w))
  const b = Math.min(env.length - 1, Math.ceil(t + w))
  let m = 0
  for (let i = a; i <= b; i++) if (env[i] > m) m = env[i]
  return m
}

/**
 * Metrical profile of a beat grid: mean onset strength at each 32nd-note slot of the
 * bar (32 slots, 4/4), starting at `phase` frames. Loops start on the downbeat, so
 * for loop-length candidates phase 0 aligns slot 0 with beat 1.
 */
function barProfile(env: Float32Array, period: number, phase: number): Float64Array {
  const prof = new Float64Array(32)
  const cnt = new Float64Array(32)
  const slot = period / 8
  const w = Math.max(1, slot * 0.35)
  for (let k = 0; ; k++) {
    const t = phase + k * slot
    if (t >= env.length - 1) break
    const i = k % 32
    prof[i] += peakNear(env, t, w)
    cnt[i]++
  }
  for (let i = 0; i < 32; i++) prof[i] = cnt[i] ? prof[i] / cnt[i] : 0
  return prof
}

const avgSlots = (p: Float64Array, slots: number[]): number => {
  let s = 0
  for (const i of slots) s += p[i]
  return s / slots.length
}
const SLOTS_BEAT = [0, 8, 16, 24]
const SLOTS_8TH = [4, 12, 20, 28]
const SLOTS_16TH = [2, 6, 10, 14, 18, 22, 26, 30]
const SLOTS_32ND = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31]

export function estimateTempo(samples: ArrayLike<number>, sampleRate: number, opts: TempoOptions = {}): TempoEstimate {
  const minBpm = opts.minBpm ?? 50
  const maxBpm = opts.maxBpm ?? 220
  const analysedSec = samples.length / sampleRate
  const durationSec = opts.durationSec && opts.durationSec > 0 ? opts.durationSec : analysedSec
  if (analysedSec < 1.2) return { bpm: null, confidence: 0, method: null }

  const envs = onsetEnvelopes(samples, sampleRate)
  const fr = envs.frameRate
  const nFrames = envs.full.length
  if (nFrames < 64) return { bpm: null, confidence: 0, method: null }

  const pos = detrend(envs.full, fr)
  const env = centered(pos)
  const lowEnv = centered(detrend(envs.low, fr))
  const midEnv = centered(detrend(envs.mid, fr))
  const highEnv = centered(detrend(envs.high, fr))

  const lagFor = (bpm: number): number => (60 * fr) / bpm
  const maxLag = Math.min(nFrames - 1, Math.ceil(lagFor(minBpm) * 4) + 2)
  const r = autocorrelation(env, maxLag, 1)
  const rLow = autocorrelation(lowEnv, maxLag, 1)
  const rMid = autocorrelation(midEnv, maxLag, 1)
  const rHigh = autocorrelation(highEnv, maxLag, 1)
  const norm = (a: Float64Array): number => (a[0] > 0 ? a[0] : 1)
  const r0 = norm(r)
  const rl0 = norm(rLow)
  const rh0 = norm(rHigh)
  const rm0 = norm(rMid)
  const usable = Math.min(maxLag, nFrames * 0.75)
  const at = (a: Float64Array, a0: number, lag: number): number => (lag <= usable && lag >= 1 ? lerpAt(a, lag) / a0 : 0)

  const salienceAt = (bpm: number): number => {
    const L = lagFor(bpm)
    const ks = [1, 2, 4]
    const ws = [1, 0.6, 0.4]
    let s = 0
    let wsum = 0
    for (let i = 0; i < ks.length; i++) {
      const lag = L * ks[i]
      if (lag > usable) break
      s += ws[i] * Math.max(0, lerpAt(r, lag)) / r0
      wsum += ws[i]
    }
    return wsum > 0 ? s / wsum : 0
  }

  // Dense salience curve → its peaks are the audio-driven tempo hypotheses.
  const step = 0.25
  const grid: number[] = []
  const sal: number[] = []
  for (let b = minBpm; b <= maxBpm + 1e-9; b += step) {
    grid.push(b)
    sal.push(salienceAt(b))
  }
  let salMax = 0
  for (const v of sal) salMax = Math.max(salMax, v)

  const onsets = countOnsets(pos, fr)
  const onsetRate = onsets / analysedSec
  let sumFull = 0
  let sumLow = 0
  let sumHigh = 0
  for (let i = 0; i < nFrames; i++) {
    sumFull += envs.full[i]
    sumLow += envs.low[i]
    sumHigh += envs.high[i]
  }
  const sorted = Float32Array.from(envs.full).sort()
  const p50 = sorted[Math.floor(nFrames * 0.5)]
  const p95 = sorted[Math.floor(nFrames * 0.95)]
  const rhythmic = Math.min(1, Math.max(0, (p95 / (p50 + 1e-6) - 1.5) / 4))
  const globals = [
    Math.log(durationSec),
    Math.log(onsetRate + 0.1),
    rhythmic,
    sumFull > 0 ? sumHigh / sumFull : 0,
    sumFull > 0 ? sumLow / sumFull : 0,
    Math.log(envs.centroidHz + 50),
    envs.lowEnergyShare,
    envs.flatness,
    salMax,
    ...timbreCoefficients(envs.meanLogMel, 6)
  ]

  // Beat-grid comb: mean onset strength on a grid of the given period and phase.
  const comb = (period: number, phase: number): number => {
    let s = 0
    let c = 0
    for (let t = phase; t < nFrames - 1; t += period) {
      s += lerpAt(pos, t)
      c++
    }
    return c ? s / c : 0
  }
  let posMean = mean(pos)
  if (posMean <= 0) posMean = 1e-9

  const raw: { bpm: number; beats: number | null }[] = []
  const audioPeaks: { bpm: number; v: number }[] = []
  if (salMax > 0) {
    for (let i = 1; i < sal.length - 1; i++) {
      if (sal[i] >= sal[i - 1] && sal[i] > sal[i + 1] && sal[i] > salMax * 0.15) {
        const off = parabolicOffset(sal[i - 1], sal[i], sal[i + 1])
        audioPeaks.push({ bpm: grid[i] + off * step, v: sal[i] })
      }
    }
  }
  audioPeaks.sort((a, b) => b.v - a.v)
  const durationCands: number[] = []
  // Loop-length candidates only make sense for loop-sized files; a long recording (a
  // song, a stem, a jam) isn't trimmed to a bar count.
  if (durationSec >= 1.0 && durationSec <= MAX_LOOP_SECONDS) {
    const nMin = Math.max(1, Math.ceil((minBpm * durationSec) / 60))
    const nMax = Math.min(512, Math.floor((maxBpm * durationSec) / 60))
    for (let beats = nMin; beats <= nMax; beats++) {
      const bpm = (60 * beats) / durationSec
      durationCands.push(bpm)
      raw.push({ bpm, beats })
    }
  }
  const nearDuration = (bpm: number): boolean => durationCands.some((d) => Math.abs(d - bpm) / bpm < 0.004)
  const addAudio = (bpm: number): void => {
    if (bpm < minBpm || bpm > maxBpm) return
    if (nearDuration(bpm)) return
    if (raw.some((c) => c.beats == null && Math.abs(c.bpm - bpm) / bpm < 0.01)) return
    raw.push({ bpm, beats: null })
  }
  for (const p of audioPeaks.slice(0, 6)) addAudio(p.bpm)
  for (const p of audioPeaks.slice(0, 3)) for (const m of [2, 0.5, 1.5, 2 / 3]) addAudio(p.bpm * m)
  if (raw.length === 0) return { bpm: null, confidence: 0, method: null, rhythmic }

  const candidates: TempoCandidate[] = raw.map(({ bpm, beats }) => {
    const L = lagFor(bpm)
    const lb = Math.log2(bpm / 100)
    const dev = Math.abs(bpm - Math.round(bpm))
    const isDur = beats != null ? 1 : 0
    let bestPh = 0
    const phases = Math.max(1, Math.floor(L))
    for (let ph = 0; ph < phases; ph++) bestPh = Math.max(bestPh, comb(L, ph))
    const ph0 = Math.max(comb(L, 0), comb(L, 1), comb(L, 2))
    // Downbeat phase: the loop start for loop-length candidates, otherwise the
    // strongest beat-grid phase.
    let phase = 0
    if (beats == null) {
      let bp = -1
      for (let ph = 0; ph < phases; ph++) {
        const v = comb(L, ph)
        if (v > bp) {
          bp = v
          phase = ph
        }
      }
    }
    const eps = 0.02 * posMean + 1e-6
    const prof = barProfile(pos, L, phase)
    const pBeat = avgSlots(prof, SLOTS_BEAT) + eps
    const midProf = barProfile(envs.mid, L, phase)
    const lowProf = barProfile(envs.low, L, phase)
    const highProf = barProfile(envs.high, L, phase)
    const midEps = 0.02 * mean(envs.mid) + 1e-6
    const lowEps = 0.02 * mean(envs.low) + 1e-6
    const highEps = 0.02 * mean(envs.high) + 1e-6
    const features = [
      Math.log(salienceAt(bpm) + 0.02),
      at(r, r0, L),
      at(r, r0, 2 * L),
      at(r, r0, L / 2),
      at(r, r0, 4 * L),
      at(r, r0, 3 * L),
      at(rLow, rl0, L),
      at(rLow, rl0, 2 * L),
      at(rHigh, rh0, L),
      at(rHigh, rh0, L / 2),
      lb,
      lb * lb,
      lb * lb * lb,
      ...structureOneHot(beats),
      isDur * Math.exp(-((dev / 0.04) ** 2)),
      isDur * Math.exp(-((dev / 0.15) ** 2)),
      bestPh > 0 ? ph0 / bestPh : 0,
      Math.log2(Math.max(0.05, (onsetRate * 60) / bpm)),
      Math.log(bestPh / posMean + 1e-3),
      at(rLow, rl0, L / 2),
      at(rMid, rm0, L),
      at(rMid, rm0, 2 * L),
      at(rMid, rm0, 4 * L),
      at(rHigh, rh0, L / 4),
      at(rHigh, rh0, 2 * L),
      Math.log((avgSlots(prof, SLOTS_8TH) + eps) / pBeat),
      Math.log((avgSlots(prof, SLOTS_16TH) + eps) / pBeat),
      Math.log((avgSlots(prof, SLOTS_32ND) + eps) / pBeat),
      Math.log(pBeat / (posMean + eps)),
      Math.log((avgSlots(midProf, [8, 24]) + midEps) / (avgSlots(midProf, [0, 16]) + midEps)),
      Math.log((midProf[16] + midEps) / (avgSlots(midProf, [8, 24]) + midEps)),
      Math.log((avgSlots(lowProf, [0, 16]) + lowEps) / (avgSlots(lowProf, [8, 24]) + lowEps)),
      Math.log((avgSlots(highProf, SLOTS_16TH) + highEps) / (avgSlots(highProf, [...SLOTS_BEAT, ...SLOTS_8TH]) + highEps))
    ]
    for (const g of globals) features.push(lb * g, lb * lb * g)
    return { bpm, beats, features, score: 0 }
  })

  const w = TEMPO_MODEL.weights
  for (const c of candidates) {
    let s = 0
    for (let i = 0; i < w.length; i++) s += w[i] * c.features[i]
    c.score = s
  }
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  let z = 0
  for (const c of candidates) z += Math.exp(c.score - best.score)
  const pBest = 1 / z
  const confidence = Math.max(0, Math.min(0.97, pBest))

  // Does this sound have a tempo at all? A long one-shot (pad, riser, crash, 808 tail)
  // still yields *some* best candidate; a learned gate over the same evidence (grid
  // fit, periodicity, onset activity, timbre) tells loops from hits.
  const pm = TEMPO_PRESENCE_MODEL
  const presenceInputs = [
    ...globals,
    confidence,
    best.beats != null ? 1 : 0,
    ...pm.candidateNames.map((n) => best.features[TEMPO_FEATURE_NAMES.indexOf(n as (typeof TEMPO_FEATURE_NAMES)[number])] ?? 0)
  ]
  let zp = pm.bias
  for (let i = 0; i < pm.weights.length; i++) zp += pm.weights[i] * presenceInputs[i]
  const presence = 1 / (1 + Math.exp(-zp))
  if (presence < TEMPO_PRESENCE_THRESHOLD) {
    return {
      bpm: null,
      confidence: confidence * presence,
      method: null,
      rhythmic,
      presence,
      candidates: opts.debug ? candidates : undefined,
      global: opts.debug ? globals : undefined
    }
  }

  let bpm = best.bpm
  if (best.beats == null) bpm = refineTempo(pos, fr, bpm)
  const rounded = Math.round(bpm)
  bpm = Math.abs(bpm - rounded) < 0.12 ? rounded : Math.round(bpm * 100) / 100

  return {
    bpm,
    confidence: Math.min(0.97, confidence * Math.min(1, presence / 0.8)),
    method: best.beats != null ? 'loop-grid' : 'audio',
    beats: best.beats,
    rhythmic,
    presence,
    candidates: opts.debug ? candidates : undefined,
    global: opts.debug ? globals : undefined
  }
}

/**
 * Fine-tune a free (not loop-locked) tempo by fitting a phase-aligned beat grid to
 * the onset curve over ±1.5%: the precision grows with every beat the grid spans.
 */
export function refineTempo(env: Float32Array, frameRate: number, bpm: number): number {
  let bestBpm = bpm
  let bestScore = -Infinity
  for (let rel = -0.015; rel <= 0.015 + 1e-9; rel += 0.0005) {
    const b = bpm * (1 + rel)
    const period = (60 * frameRate) / b
    const phases = Math.max(1, Math.floor(period))
    for (let ph = 0; ph < phases; ph++) {
      let s = 0
      let count = 0
      for (let t = ph; t < env.length - 1; t += period) {
        s += lerpAt(env, t)
        count++
      }
      const v = count ? s / count : 0
      if (v > bestScore) {
        bestScore = v
        bestBpm = b
      }
    }
  }
  return bestBpm
}
