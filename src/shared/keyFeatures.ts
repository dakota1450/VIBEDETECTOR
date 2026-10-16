import { fftOf, hann } from './dsp'

// ---------------------------------------------------------------------------------
// Pitch-content features for key detection.
//
// Per frame (8192-point FFT ≈ 2.7 Hz bins at 22.05 kHz, 93 ms hop):
//   • spectral peaks with parabolic interpolation (exact partial frequencies),
//     taken from a short temporal median of the spectrum so drum hits and other
//     transients are suppressed while sustained notes survive;
//   • a global tuning offset (circular mean of every partial's deviation from A440
//     equal temperament), so detuned / vinyl / pitched samples still land on the
//     right semitones;
//   • an 84-semitone log-magnitude pitch spectrum (C1..B7).
// From it, frame-normalised chroma profiles (12 pitch classes) are accumulated:
// treble, bass, harmonic-salience (fundamental-weighted), lowest-note histogram, and
// the opening / closing quarter of the phrase.
// ---------------------------------------------------------------------------------

export const KEY_FFT = 8192
const MIDI_LO = 24 // C1
const MIDI_HI = 108 // exclusive (B7)
const NPITCH = MIDI_HI - MIDI_LO
const HARMONIC_OFFSETS = [0, 12, 19, 24, 28, 31] // semitones of harmonics 1..6
const HARMONIC_WEIGHTS = [1, 0.8, 0.64, 0.51, 0.41, 0.33]

export interface KeyFeatures {
  treble: Float64Array
  bass: Float64Array
  salience: Float64Array
  bassNote: Float64Array
  opening: Float64Array
  closing: Float64Array
  /** Histogram of per-frame best-matching major / minor triad roots. */
  chordMajor: Float64Array
  chordMinor: Float64Array
  /** Chroma on the first beat of every bar (needs a beat grid; else the opening). */
  downbeat: Float64Array
  /** Bass chroma at the downbeats. */
  downbeatBass: Float64Array
  /** The very first chord / note (first beat, or first ~0.5 s). */
  firstBeat: Float64Array
  /** The final chord / note (last beat, or last ~0.5 s of tonal content). */
  lastBeat: Float64Array
  /** Global tuning offset in cents (−50..50) relative to A440. */
  tuningCents: number
  /** Number of frames that carried tonal content. */
  tonalFrames: number
  /** Mean per-frame peak concentration (1 = one pitch class). */
  concentration: number
  /**
   * How many distinct pitch classes take turns being the loudest (each for ≥ 10% of
   * the tonal frames): ~1 for a held note, stab or 808; 3+ for a moving melody or
   * progression. Separates short phrases from one-shots better than length alone.
   */
  variety: number
}

function median5(a: number, b: number, c: number, d: number, e: number): number {
  // Branch-light median of five.
  let t: number
  if (a > b) (t = a), (a = b), (b = t)
  if (d > e) (t = d), (d = e), (e = t)
  if (a > d) (t = a), (a = d), (d = t), (t = b), (b = e), (e = t)
  if (c > b) {
    if (b < d) return c < d ? c : d
    return b < e ? b : e
  }
  if (c > d) return c < e ? c : e
  return b < d ? b : d
}

function normalize12(v: Float64Array): Float64Array {
  let s = 0
  for (let i = 0; i < 12; i++) s += v[i]
  if (s > 0) for (let i = 0; i < 12; i++) v[i] /= s
  return v
}

/**
 * Compute key features from mono PCM. `region` limits analysis to the audible part
 * (avoids silence padding).
 */
export function computeKeyFeatures(
  samples: Float32Array,
  sampleRate: number,
  region: readonly [number, number] = [0, samples.length - 1],
  opts: {
    medianFilter?: boolean
    /** Beat period in seconds (from the tempo step) — enables downbeat features. */
    beatSec?: number | null
    /** Beats per bar (default 4). */
    beatsPerBar?: number
  } = {}
): KeyFeatures {
  const N = KEY_FFT
  const hop = N >> 2
  const half = N >> 1
  const binHz = sampleRate / N
  const medianFilter = opts.medianFilter ?? true
  const [r0, r1] = region
  const start = Math.max(0, r0 - (N >> 2))
  const end = Math.min(samples.length, r1 + 1 + (N >> 2))
  const span = end - start
  const frameCount = span <= N ? 1 : 1 + Math.ceil((span - N) / hop)

  const fft = fftOf(N)
  const win = hann(N)
  const input = new Array<number>(N)
  const out = fft.createComplexArray() as number[]
  const kMax = Math.min(half - 1, Math.floor(4300 / binHz))
  const kMin = Math.max(2, Math.floor(28 / binHz))

  // Magnitude frames (only the bins we use), kept for the median filter.
  const mags: Float32Array[] = []
  for (let f = 0; f < frameCount; f++) {
    const s0 = start + f * hop
    for (let i = 0; i < N; i++) {
      const idx = s0 + i
      input[i] = idx < end ? samples[idx] * win[i] : 0
    }
    fft.realTransform(out, input)
    const m = new Float32Array(kMax + 2)
    for (let k = 0; k <= kMax + 1; k++) {
      const re = out[2 * k]
      const im = out[2 * k + 1]
      m[k] = Math.sqrt(re * re + im * im)
    }
    mags.push(m)
  }

  // Harmonic (sustained) spectrum: per-bin median over 5 frames. Short signals keep
  // the raw spectrum (a one-shot has no time to suppress).
  const useMedian = medianFilter && frameCount >= 5
  const harm: Float32Array[] = useMedian
    ? mags.map((_, f) => {
        const a = mags[Math.max(0, f - 2)]
        const b = mags[Math.max(0, f - 1)]
        const c = mags[f]
        const d = mags[Math.min(frameCount - 1, f + 1)]
        const e = mags[Math.min(frameCount - 1, f + 2)]
        const o = new Float32Array(c.length)
        for (let k = 0; k < c.length; k++) o[k] = median5(a[k], b[k], c[k], d[k], e[k])
        return o
      })
    : mags

  // Peak lists per frame.
  interface Peak {
    f: number
    m: number
    /** Prominence: height over the local spectral floor. */
    r: number
  }
  const peaks: Peak[][] = []
  // How clearly tonal each frame is: partials towering over the floor (notes) vs a
  // floor full of near-floor bumps (noise, vinyl crackle, reverb wash). Frames are
  // weighted by it so a noisy stretch doesn't dilute the notes.
  const frameWeight = new Float64Array(frameCount)
  let frameMaxAll = 0
  const frameEnergy = new Float64Array(frameCount)
  for (let f = 0; f < frameCount; f++) {
    const m = harm[f]
    let e = 0
    for (let k = kMin; k <= kMax; k++) e += m[k] * m[k]
    frameEnergy[f] = e
    if (e > frameMaxAll) frameMaxAll = e
  }
  // Local-mean threshold (±12 bins ≈ ±32 Hz): a partial must stand clear of the
  // surrounding spectral floor, which rejects noise and broadband drum residue.
  const W = 12
  let tunSin = 0
  let tunCos = 0
  for (let f = 0; f < frameCount; f++) {
    const m = harm[f]
    const list: Peak[] = []
    if (frameEnergy[f] < frameMaxAll * 1e-4) {
      peaks.push(list)
      continue
    }
    let localSum = 0
    for (let k = kMin - W; k <= kMin + W; k++) localSum += m[Math.max(0, k)]
    let fmax = 0
    for (let k = kMin; k <= kMax; k++) if (m[k] > fmax) fmax = m[k]
    const floorAbs = fmax * 0.01
    for (let k = kMin; k <= kMax; k++) {
      const v = m[k]
      if (k > kMin) localSum += m[Math.min(kMax + 1, k + W)] - m[Math.max(0, k - W - 1)]
      if (v <= floorAbs || v <= m[k - 1] || v < m[k + 1]) continue
      const local = localSum / (2 * W + 1)
      if (v < local * 1.6) continue
      const a = m[k - 1]
      const c = m[k + 1]
      const den = a - 2 * v + c
      const delta = den !== 0 ? (0.5 * (a - c)) / den : 0
      const freq = (k + delta) * binHz
      const amp = v - 0.25 * (a - c) * delta
      list.push({ f: freq, m: amp, r: v / Math.max(1e-12, local) })
      if (freq > 90 && freq < 2200) {
        const cents = 1200 * Math.log2(freq / 440)
        const ang = (2 * Math.PI * cents) / 100
        const w = Math.log1p(amp)
        tunSin += w * Math.sin(ang)
        tunCos += w * Math.cos(ang)
      }
    }
    if (list.length) {
      const top = list.map((p) => p.r).sort((a, b) => b - a).slice(0, 5)
      let lg = 0
      for (const r of top) lg += Math.log(r)
      lg /= top.length
      frameWeight[f] = Math.min(1, Math.max(0.05, (lg - Math.log(2.5)) / (Math.log(12) - Math.log(2.5))))
    }
    peaks.push(list)
  }
  const tuningCents = tunSin === 0 && tunCos === 0 ? 0 : (100 * Math.atan2(tunSin, tunCos)) / (2 * Math.PI)

  const treble = new Float64Array(12)
  const bass = new Float64Array(12)
  const salience = new Float64Array(12)
  const bassNote = new Float64Array(12)
  const opening = new Float64Array(12)
  const closing = new Float64Array(12)
  const chordMajor = new Float64Array(12)
  const chordMinor = new Float64Array(12)
  const downbeat = new Float64Array(12)
  const downbeatBass = new Float64Array(12)
  const firstBeat = new Float64Array(12)
  const lastBeat = new Float64Array(12)
  const beatSec = opts.beatSec && opts.beatSec > 0.15 && opts.beatSec < 2.5 ? opts.beatSec : null
  const barSec = beatSec ? beatSec * (opts.beatsPerBar ?? 4) : null
  // Frame f covers samples [start + f·hop, start + f·hop + N); time its centre from the
  // file start (loops begin on the downbeat).
  const frameTime = (f: number): number => (start + f * hop + N / 2) / sampleRate
  const firstBeatEnd = beatSec ?? 0.5
  const fAll = new Float64Array(12)
  const spec = new Float64Array(NPITCH + 32)
  const sal = new Float64Array(NPITCH)
  const fTreble = new Float64Array(12)
  const fBass = new Float64Array(12)
  const fSal = new Float64Array(12)
  let tonalFrames = 0
  let concAcc = 0
  const topCounts = new Float64Array(12)
  const active: number[] = []
  for (let f = 0; f < frameCount; f++) if (peaks[f].length) active.push(f)
  const lastActive = active.length ? active[active.length - 1] : -1
  const q = Math.max(1, Math.floor(active.length / 4))
  const openSet = new Set(active.slice(0, q))
  const closeSet = new Set(active.slice(active.length - q))

  for (let f = 0; f < frameCount; f++) {
    const list = peaks[f]
    if (!list.length) continue
    spec.fill(0)
    for (const p of list) {
      const midi = 69 + (1200 * Math.log2(p.f / 440) - tuningCents) / 100
      if (midi < MIDI_LO - 0.5 || midi >= MIDI_HI - 0.5) continue
      const x = midi - MIDI_LO
      const lo = Math.floor(x)
      const fr = x - lo
      const v = Math.log1p(p.m)
      // Linear split between the two nearest semitones (sharp peaks after tuning
      // correction land almost entirely on one).
      if (lo >= 0) spec[lo] += v * (1 - fr)
      if (lo + 1 < NPITCH) spec[lo + 1] += v * fr
    }
    let total = 0
    for (let i = 0; i < NPITCH; i++) total += spec[i]
    if (total <= 0) continue
    tonalFrames++
    const fw = frameWeight[f]
    fTreble.fill(0)
    fBass.fill(0)
    fSal.fill(0)
    for (let i = 0; i < NPITCH; i++) {
      const v = spec[i]
      if (v <= 0) continue
      const pc = (MIDI_LO + i) % 12
      if (MIDI_LO + i >= 48) fTreble[pc] += v
      if (MIDI_LO + i < 55) fBass[pc] += v
    }
    // Harmonic salience: a pitch is supported by its own overtone series.
    let salMax = 0
    for (let i = 0; i < NPITCH; i++) {
      let s = 0
      for (let h = 0; h < HARMONIC_OFFSETS.length; h++) {
        const j = i + HARMONIC_OFFSETS[h]
        if (j < NPITCH) s += HARMONIC_WEIGHTS[h] * spec[j]
      }
      // Count a pitch only if it is itself present (not a missing-fundamental ghost).
      sal[i] = spec[i] > 0 ? s : 0
      if (sal[i] > salMax) salMax = sal[i]
    }
    for (let i = 0; i < NPITCH; i++) if (sal[i] > salMax * 0.2) fSal[(MIDI_LO + i) % 12] += sal[i]
    // Lowest clearly-present pitch (the bass note) — must carry real salience.
    for (let i = 0; i < 40; i++) {
      if (sal[i] >= salMax * 0.35) {
        bassNote[(MIDI_LO + i) % 12] += fw
        break
      }
    }
    let tSum = 0
    let tMax = 0
    let tArg = 0
    for (let i = 0; i < 12; i++) {
      const v = fTreble[i] + fBass[i]
      tSum += v
      if (v > tMax) {
        tMax = v
        tArg = i
      }
    }
    if (tSum > 0) {
      concAcc += tMax / tSum
      topCounts[tArg]++
    }
    const add = (dst: Float64Array, src: Float64Array): void => {
      let s = 0
      for (let i = 0; i < 12; i++) s += src[i]
      if (s > 0) for (let i = 0; i < 12; i++) dst[i] += (fw * src[i]) / s
    }
    add(treble, fTreble)
    add(bass, fBass)
    add(salience, fSal)
    // Chord root: best-correlating major/minor triad template on this frame's
    // (bass-weighted) chroma. Only clear matches count.
    let aSum = 0
    for (let i = 0; i < 12; i++) {
      fAll[i] = fTreble[i] + 1.5 * fBass[i]
      aSum += fAll[i]
    }
    if (aSum > 0) {
      const aMean = aSum / 12
      let aVar = 0
      for (let i = 0; i < 12; i++) aVar += (fAll[i] - aMean) ** 2
      if (aVar > 0) {
        let best = -Infinity
        let bestRoot = 0
        let bestMinor = false
        for (let root = 0; root < 12; root++) {
          for (let mi = 0; mi < 2; mi++) {
            const third = (root + (mi ? 3 : 4)) % 12
            const fifth = (root + 7) % 12
            // Correlation with a 3-note template reduces to the mean of the chord
            // tones minus the overall mean (scaled), so this is a cheap argmax.
            const v = fAll[root] * 1.1 + fAll[third] + fAll[fifth] * 0.9
            if (v > best) {
              best = v
              bestRoot = root
              bestMinor = mi === 1
            }
          }
        }
        const strength = best / (3 * aMean) - 1 // > 0 when the triad stands out
        if (strength > 0.4) (bestMinor ? chordMinor : chordMajor)[bestRoot] += fw * Math.min(2, strength)
      }
    }
    if (openSet.has(f)) {
      add(opening, fTreble)
      add(opening, fBass)
    }
    const tf = frameTime(f)
    if (tf <= firstBeatEnd + N / 2 / sampleRate) {
      add(firstBeat, fTreble)
      add(firstBeat, fBass)
    }
    if (lastActive >= 0 && frameTime(lastActive) - tf <= firstBeatEnd) {
      add(lastBeat, fTreble)
      add(lastBeat, fBass)
    }
    if (barSec && beatSec) {
      const inBar = tf - Math.floor(tf / barSec) * barSec
      if (inBar <= beatSec) {
        add(downbeat, fTreble)
        add(downbeat, fBass)
        add(downbeatBass, fBass)
      }
    } else if (openSet.has(f)) {
      add(downbeat, fTreble)
      add(downbeat, fBass)
      add(downbeatBass, fBass)
    }
    if (closeSet.has(f)) {
      add(closing, fTreble)
      add(closing, fBass)
    }
  }
  for (const v of [treble, bass, salience, bassNote, opening, closing, downbeat, downbeatBass, firstBeat, lastBeat]) normalize12(v)
  let chordTotal = 0
  for (let i = 0; i < 12; i++) chordTotal += chordMajor[i] + chordMinor[i]
  if (chordTotal > 0) {
    for (let i = 0; i < 12; i++) {
      chordMajor[i] /= chordTotal
      chordMinor[i] /= chordTotal
    }
  }
  let variety = 0
  for (let i = 0; i < 12; i++) if (tonalFrames > 0 && topCounts[i] >= 0.1 * tonalFrames) variety++
  return {
    treble,
    bass,
    salience,
    bassNote,
    opening,
    closing,
    chordMajor,
    chordMinor,
    downbeat,
    downbeatBass,
    firstBeat,
    lastBeat,
    tuningCents,
    tonalFrames,
    concentration: tonalFrames ? concAcc / tonalFrames : 0,
    variety
  }
}
