import FFT from 'fft.js'

// Small, allocation-conscious DSP toolkit shared by the key and tempo analyzers.
// Everything here is pure and synchronous so it runs identically in the renderer's
// analysis worker, in Node tests, and in the offline evaluation harness.

const HANN_CACHE = new Map<number, Float32Array>()
const FFT_CACHE = new Map<number, FFT>()

export function hann(n: number): Float32Array {
  let w = HANN_CACHE.get(n)
  if (!w) {
    w = new Float32Array(n)
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
    HANN_CACHE.set(n, w)
  }
  return w
}

export function fftOf(n: number): FFT {
  let f = FFT_CACHE.get(n)
  if (!f) {
    f = new FFT(n)
    FFT_CACHE.set(n, f)
  }
  return f
}

export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

/**
 * Short-time magnitude spectra, frame by frame. Calls `onFrame(index, mag)` with a
 * reused buffer of N/2+1 magnitudes (bin k = k·sr/N Hz). Frames start at
 * `start + i·hop`; samples past the end are zero.
 */
export function stft(
  samples: ArrayLike<number>,
  n: number,
  hop: number,
  onFrame: (index: number, mag: Float64Array) => void,
  range: { start?: number; end?: number; maxFrames?: number } = {}
): number {
  const start = range.start ?? 0
  const end = Math.min(samples.length, range.end ?? samples.length)
  const span = end - start
  if (span <= 0) return 0
  let frames = span <= n ? 1 : 1 + Math.floor((span - n) / hop)
  if (range.maxFrames != null) frames = Math.min(frames, range.maxFrames)
  const fft = fftOf(n)
  const win = hann(n)
  const input = new Array<number>(n)
  const out = fft.createComplexArray() as number[]
  const half = n >> 1
  const mag = new Float64Array(half + 1)
  for (let f = 0; f < frames; f++) {
    const s0 = start + f * hop
    for (let i = 0; i < n; i++) {
      const idx = s0 + i
      input[i] = idx < end ? samples[idx] * win[i] : 0
    }
    fft.realTransform(out, input)
    for (let k = 0; k <= half; k++) {
      const re = out[2 * k]
      const im = out[2 * k + 1]
      mag[k] = Math.sqrt(re * re + im * im)
    }
    onFrame(f, mag)
  }
  return frames
}

export interface MelBank {
  bands: number
  /** For each band: first FFT bin and its triangular weights. */
  start: Int32Array
  weights: Float32Array[]
}

const MEL_CACHE = new Map<string, MelBank>()
const hzToMel = (f: number): number => 2595 * Math.log10(1 + f / 700)
const melToHz = (m: number): number => 700 * (10 ** (m / 2595) - 1)

/** Triangular mel filterbank over an N-point FFT. */
export function melBank(n: number, sampleRate: number, bands: number, fMin: number, fMax: number): MelBank {
  const key = `${n}|${sampleRate}|${bands}|${fMin}|${fMax}`
  const cached = MEL_CACHE.get(key)
  if (cached) return cached
  const mMin = hzToMel(fMin)
  const mMax = hzToMel(Math.min(fMax, sampleRate / 2))
  const edges: number[] = []
  for (let i = 0; i < bands + 2; i++) edges.push(melToHz(mMin + ((mMax - mMin) * i) / (bands + 1)))
  const binHz = sampleRate / n
  const start = new Int32Array(bands)
  const weights: Float32Array[] = []
  for (let b = 0; b < bands; b++) {
    const lo = edges[b]
    const mid = edges[b + 1]
    const hi = edges[b + 2]
    const k0 = Math.max(1, Math.floor(lo / binHz))
    const k1 = Math.min(n >> 1, Math.ceil(hi / binHz))
    const w = new Float32Array(Math.max(1, k1 - k0 + 1))
    let any = false
    for (let k = k0; k <= k1; k++) {
      const f = k * binHz
      const v = f < mid ? (f - lo) / Math.max(1e-9, mid - lo) : (hi - f) / Math.max(1e-9, hi - mid)
      if (v > 0) {
        w[k - k0] = v
        any = true
      }
    }
    // Very low bands can be narrower than one FFT bin: give them their nearest bin.
    if (!any) w[Math.min(w.length - 1, Math.max(0, Math.round(mid / binHz) - k0))] = 1
    start[b] = k0
    weights.push(w)
  }
  const bank = { bands, start, weights }
  MEL_CACHE.set(key, bank)
  return bank
}

/** Centered moving average with a window of `w` samples (edge-aware). */
export function movingAverage(x: Float32Array, w: number): Float32Array {
  const n = x.length
  const out = new Float32Array(n)
  const half = Math.max(0, Math.floor(w / 2))
  let acc = 0
  let lo = 0
  let hi = -1
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half)
    const b = Math.min(n - 1, i + half)
    while (hi < b) acc += x[++hi]
    while (lo < a) acc -= x[lo++]
    out[i] = acc / (b - a + 1)
  }
  return out
}

/**
 * Autocorrelation via FFT. `compress` < 2 gives the "generalized" ACF (spectral
 * magnitude raised to `compress` instead of squared), which sharpens periodicity
 * peaks. Returns r[0..maxLag], unbiased (divided by the overlap length).
 */
export function autocorrelation(x: Float32Array, maxLag: number, compress = 2): Float64Array {
  const n = x.length
  const m = nextPow2(2 * n)
  const fft = fftOf(m)
  const input = new Array<number>(m).fill(0)
  for (let i = 0; i < n; i++) input[i] = x[i]
  const spec = fft.createComplexArray() as number[]
  fft.realTransform(spec, input)
  fft.completeSpectrum(spec)
  for (let k = 0; k < m; k++) {
    const re = spec[2 * k]
    const im = spec[2 * k + 1]
    const p = re * re + im * im
    spec[2 * k] = compress === 2 ? p : Math.pow(p, compress / 2)
    spec[2 * k + 1] = 0
  }
  const out = fft.createComplexArray() as number[]
  fft.inverseTransform(out, spec)
  const L = Math.min(maxLag, n - 1)
  const r = new Float64Array(L + 1)
  for (let l = 0; l <= L; l++) r[l] = out[2 * l] / (n - l)
  return r
}

/** Linear interpolation into an array at a fractional index. */
export function lerpAt(a: ArrayLike<number>, x: number): number {
  if (x <= 0) return a[0] ?? 0
  const i = Math.floor(x)
  if (i >= a.length - 1) return a[a.length - 1] ?? 0
  const f = x - i
  return a[i] + (a[i + 1] - a[i]) * f
}

/** Sub-sample peak offset in [-0.5, 0.5] from three neighbouring values. */
export function parabolicOffset(l: number, c: number, r: number): number {
  const d = l - 2 * c + r
  if (d === 0) return 0
  const o = (0.5 * (l - r)) / d
  return o < -0.5 ? -0.5 : o > 0.5 ? 0.5 : o
}

export function mean(x: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i]
  return x.length ? s / x.length : 0
}
