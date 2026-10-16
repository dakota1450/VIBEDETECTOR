// Pure-JS audio loading for the evaluation harness. Mirrors the app's renderer
// pipeline (decode → mono → 22.05 kHz → first 30 s → peak-normalise) so offline
// accuracy numbers match what users actually get. The app resamples inside
// Chromium's decodeAudioData (a windowed-sinc resampler); this uses the same kind of
// band-limited resampler so both feed the analyzers equivalent signals.

export const ANALYSIS_SAMPLE_RATE = 22050
export const MAX_SECONDS = 30
const NORMALIZE_PEAK = 0.95
const NORMALIZE_FLOOR = 0.0005

/**
 * Decode a WAV/RF64 file (PCM 8/16/24/32-bit int, 32/64-bit float, EXTENSIBLE).
 * Returns the downmixed mono signal (mean of channels, as the app does), the native
 * sample rate, and the exact duration in seconds.
 */
export function decodeWavMono(buf, maxSeconds = Infinity) {
  if (buf.length < 12) throw new Error('short file')
  const riff = buf.toString('ascii', 0, 4)
  if ((riff !== 'RIFF' && riff !== 'RF64') || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a wav')
  let off = 12
  let fmt = null
  let dataStart = -1
  let dataLen = 0
  let ds64DataSize = null
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    let size = buf.readUInt32LE(off + 4)
    const body = off + 8
    if (id === 'ds64' && size >= 16) {
      ds64DataSize = Number(buf.readBigUInt64LE(body + 8))
    } else if (id === 'fmt ') {
      let format = buf.readUInt16LE(body)
      const channels = buf.readUInt16LE(body + 2)
      const sampleRate = buf.readUInt32LE(body + 4)
      const blockAlign = buf.readUInt16LE(body + 12)
      const bits = buf.readUInt16LE(body + 14)
      if (format === 0xfffe && size >= 40) format = buf.readUInt16LE(body + 24) // SubFormat GUID's first 2 bytes
      fmt = { format, channels, sampleRate, blockAlign, bits }
    } else if (id === 'data') {
      dataStart = body
      if (size === 0xffffffff && ds64DataSize != null) size = ds64DataSize
      dataLen = Math.min(size, buf.length - body)
      break
    }
    off = body + size + (size & 1)
  }
  if (!fmt || dataStart < 0) throw new Error('missing fmt/data chunk')
  const { format, channels, sampleRate, bits } = fmt
  const bytes = bits >> 3
  const blockAlign = fmt.blockAlign || bytes * channels
  if (!channels || !sampleRate || !bytes) throw new Error('bad fmt')
  const totalFrames = Math.floor(dataLen / blockAlign)
  const frames = Math.min(totalFrames, Number.isFinite(maxSeconds) ? Math.ceil(maxSeconds * sampleRate) : totalFrames)
  const mono = new Float32Array(frames)
  const inv = 1 / channels
  const read = sampleReader(buf, format, bits)
  for (let f = 0; f < frames; f++) {
    const base = dataStart + f * blockAlign
    let acc = 0
    for (let c = 0; c < channels; c++) acc += read(base + c * bytes)
    mono[f] = acc * inv
  }
  return { mono, sampleRate, durationSec: totalFrames / sampleRate }
}

function sampleReader(buf, format, bits) {
  if (format === 3) {
    if (bits === 32) return (o) => buf.readFloatLE(o)
    if (bits === 64) return (o) => buf.readDoubleLE(o)
  }
  if (format === 1) {
    if (bits === 8) return (o) => (buf[o] - 128) / 128
    if (bits === 16) return (o) => buf.readInt16LE(o) / 32768
    if (bits === 24) return (o) => ((buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16)) << 8 >> 8) / 8388608
    if (bits === 32) return (o) => buf.readInt32LE(o) / 2147483648
  }
  throw new Error(`unsupported wav format ${format}/${bits}`)
}

const KERNEL_CACHE = new Map()

/** Band-limited (Blackman-windowed sinc) resampler. */
export function resampleSinc(input, fromRate, toRate, zeroCrossings = 16) {
  if (fromRate === toRate) return Float32Array.from(input)
  const ratio = toRate / fromRate
  const cutoff = Math.min(1, ratio) * 0.94 // fraction of the input Nyquist
  const halfWidth = zeroCrossings / cutoff // kernel half-width in input samples
  const TABLE = 4096
  const key = `${cutoff}|${halfWidth}`
  let table = KERNEL_CACHE.get(key)
  if (!table) {
    table = new Float64Array(TABLE + 2)
    for (let i = 0; i <= TABLE + 1; i++) {
      const u = Math.min(1, i / TABLE) // |x| / halfWidth
      const x = u * halfWidth
      const s = x === 0 ? 1 : Math.sin(Math.PI * cutoff * x) / (Math.PI * cutoff * x)
      const w = 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u) // Blackman
      table[i] = cutoff * s * w
    }
    KERNEL_CACHE.set(key, table)
  }
  const outLen = Math.max(1, Math.floor(input.length * ratio))
  const out = new Float32Array(outLen)
  const step = 1 / ratio
  const n = input.length
  for (let i = 0; i < outLen; i++) {
    const center = i * step
    const lo = Math.max(0, Math.ceil(center - halfWidth))
    const hi = Math.min(n - 1, Math.floor(center + halfWidth))
    let acc = 0
    for (let k = lo; k <= hi; k++) {
      const pos = (Math.abs(k - center) / halfWidth) * TABLE
      const p0 = pos | 0
      const frac = pos - p0
      acc += input[k] * (table[p0] + (table[p0 + 1] - table[p0]) * frac)
    }
    out[i] = acc
  }
  return out
}

/** File bytes → the exact Float32 signal the app's worker receives, plus duration. */
export function loadForAnalysis(buf) {
  const { mono, sampleRate, durationSec } = decodeWavMono(buf, MAX_SECONDS + 0.05)
  let samples = resampleSinc(mono, sampleRate, ANALYSIS_SAMPLE_RATE)
  const maxLen = Math.floor(ANALYSIS_SAMPLE_RATE * MAX_SECONDS)
  if (samples.length > maxLen) samples = samples.subarray(0, maxLen)
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > peak) peak = a
  }
  if (peak >= NORMALIZE_FLOOR) {
    const gain = NORMALIZE_PEAK / peak
    for (let i = 0; i < samples.length; i++) samples[i] *= gain
  }
  return { samples, sampleRate: ANALYSIS_SAMPLE_RATE, durationSec }
}
