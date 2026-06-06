import { describe, it } from 'vitest'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { analyzeKey, analyzeDrum } from './audioAnalysis'
import { classify } from './classify'

// Folder-level ground truth from the user's real (poorly-named) library:
//   SAMPLES/* => melodic,  DRM/* => drum.  Filenames are unreliable here, so this
// measures the AUDIO classifier (analyzeDrum) — what actually has to carry the load.
const ROOT = process.env.SAMPLE_ROOT || join(homedir(), 'sample-test')
const TARGET_SR = 22050
const MAX_SECONDS = 12
const PER_FOLDER = 600

// ---- audio decode: WAV (LE) + AIFF/AIFC (BE), → mono Float32 @ TARGET_SR ----
function read80(buf: Buffer, off: number): number {
  const expon = (buf[off] << 8) | buf[off + 1]
  const hi = ((buf[off + 2] << 24) | (buf[off + 3] << 16) | (buf[off + 4] << 8) | buf[off + 5]) >>> 0
  const lo = ((buf[off + 6] << 24) | (buf[off + 7] << 16) | (buf[off + 8] << 8) | buf[off + 9]) >>> 0
  const sign = expon & 0x8000 ? -1 : 1
  const e = expon & 0x7fff
  if (e === 0 && hi === 0 && lo === 0) return 0
  return sign * (hi * 2 ** 32 + lo) * 2 ** (e - 16383 - 63)
}

interface Decoded {
  samples: Float32Array
  sampleRate: number
}

function resample(mono: Float32Array, rate: number): Decoded {
  if (rate === TARGET_SR) return { samples: mono, sampleRate: TARGET_SR }
  const ratio = TARGET_SR / rate
  const outLen = Math.max(1, Math.floor(mono.length * ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const src = i / ratio
    const i0 = Math.floor(src)
    const a = mono[i0] ?? 0
    const b = mono[i0 + 1] ?? a
    out[i] = a + (b - a) * (src - i0)
  }
  return { samples: out, sampleRate: TARGET_SR }
}

function decodeWav(buf: Buffer): Decoded | null {
  let off = 12
  let fmt: { af: number; ch: number; rate: number; bits: number } | null = null
  let dOff = -1
  let dLen = 0
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    const body = off + 8
    if (id === 'fmt ') {
      let af = buf.readUInt16LE(body)
      if (af === 0xfffe && size >= 40) af = buf.readUInt16LE(body + 24)
      fmt = { af, ch: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) }
    } else if (id === 'data') {
      dOff = body
      dLen = Math.min(size, buf.length - body)
    }
    off = body + size + (size & 1)
    if (fmt && dOff >= 0) break
  }
  if (!fmt || dOff < 0 || fmt.ch < 1) return null
  const { af, ch, rate, bits } = fmt
  const bps = bits >> 3
  const fb = bps * ch
  if (fb <= 0) return null
  const n = Math.floor(Math.min(dLen, rate * fb * MAX_SECONDS) / fb)
  if (n < 1) return null
  const mono = new Float32Array(n)
  const rd = (p: number): number => {
    if (af === 3) return bits === 32 ? buf.readFloatLE(p) : buf.readDoubleLE(p)
    if (bits === 16) return buf.readInt16LE(p) / 32768
    if (bits === 24) {
      const v = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16)
      return (v & 0x800000 ? v - 0x1000000 : v) / 8388608
    }
    if (bits === 32) return buf.readInt32LE(p) / 2147483648
    if (bits === 8) return (buf[p] - 128) / 128
    return 0
  }
  for (let f = 0; f < n; f++) {
    let s = 0
    const base = dOff + f * fb
    for (let c = 0; c < ch; c++) s += rd(base + c * bps)
    mono[f] = s / ch
  }
  return resample(mono, rate)
}

function decodeAiff(buf: Buffer): Decoded | null {
  let off = 12
  let ch = 0
  let bits = 0
  let rate = 0
  let dOff = -1
  let dLen = 0
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32BE(off + 4)
    const body = off + 8
    if (id === 'COMM') {
      ch = buf.readUInt16BE(body)
      bits = buf.readUInt16BE(body + 6)
      rate = Math.round(read80(buf, body + 8))
    } else if (id === 'SSND') {
      const offsetBytes = buf.readUInt32BE(body)
      dOff = body + 8 + offsetBytes
      dLen = Math.min(size - 8 - offsetBytes, buf.length - dOff)
    }
    off = body + size + (size & 1)
    if (ch && dOff >= 0) break
  }
  if (!ch || dOff < 0 || !rate) return null
  const bps = bits >> 3
  const fb = bps * ch
  if (fb <= 0) return null
  const n = Math.floor(Math.min(dLen, rate * fb * MAX_SECONDS) / fb)
  if (n < 1) return null
  const mono = new Float32Array(n)
  const rd = (p: number): number => {
    if (bits === 16) return buf.readInt16BE(p) / 32768
    if (bits === 24) {
      const v = (buf[p] << 16) | (buf[p + 1] << 8) | buf[p + 2]
      return (v & 0x800000 ? v - 0x1000000 : v) / 8388608
    }
    if (bits === 32) return buf.readInt32BE(p) / 2147483648
    if (bits === 8) return (buf.readInt8(p)) / 128
    return 0
  }
  for (let f = 0; f < n; f++) {
    let s = 0
    const base = dOff + f * fb
    for (let c = 0; c < ch; c++) s += rd(base + c * bps)
    mono[f] = s / ch
  }
  return resample(mono, rate)
}

function decode(path: string): Decoded | null {
  let buf: Buffer
  try {
    buf = readFileSync(path)
  } catch {
    return null
  }
  if (buf.length < 44) return null
  const tag = buf.toString('ascii', 0, 4)
  if (tag === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return decodeWav(buf)
  if (tag === 'FORM') {
    const f = buf.toString('ascii', 8, 12)
    if (f === 'AIFF' || f === 'AIFC') return decodeAiff(buf)
  }
  return null
}

const AUDIO = /\.(wav|aif|aiff)$/i
function walk(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const e of entries) {
    if (e.startsWith('.')) continue
    const full = join(dir, e)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out)
    else if (AUDIO.test(e)) out.push(full)
  }
}

function pick<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr
  const step = arr.length / n
  const out: T[] = []
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)])
  return out
}

describe('REAL poorly-named library (SAMPLES=melodic, DRM=drum ground truth)', () => {
  it('audio type classifier vs folder ground truth', { timeout: 1800000 }, () => {
    if (!existsSync(ROOT)) {
      writeFileSync(`${process.cwd()}/_libtest.txt`, `ROOT not found: ${ROOT}\nCopy files into ~/sample-test/SAMPLES and ~/sample-test/DRM (or set SAMPLE_ROOT).`)
      return
    }
    const melodic: string[] = []
    const drum: string[] = []
    walk(join(ROOT, 'SAMPLES'), melodic)
    walk(join(ROOT, 'DRM'), drum)
    // also accept lowercase / nested
    if (!melodic.length && !drum.length) {
      const all: string[] = []
      walk(ROOT, all)
      for (const p of all) (/\/(drm|drums?)\//i.test(p) ? drum : melodic).push(p)
    }

    const sets: [string, string[], 'melodic' | 'drum'][] = [
      ['SAMPLES', pick(melodic, PER_FOLDER), 'melodic'],
      ['DRM', pick(drum, PER_FOLDER), 'drum']
    ]

    const lines: string[] = [`ROOT=${ROOT}  melodic-files=${melodic.length} drum-files=${drum.length}`]
    const miss: string[] = []
    let keyHave = 0
    let keyTotal = 0
    for (const [label, files, gt] of sets) {
      let n = 0
      let nameOK = 0
      let audioOK = 0
      let prodOK = 0
      let nameUnknown = 0
      const ext: Record<string, number> = {}
      for (const p of files) {
        const e = (p.match(AUDIO)?.[1] ?? '').toLowerCase()
        ext[e] = (ext[e] ?? 0) + 1
        const dec = decode(p)
        if (!dec || dec.samples.length < 2000) continue
        n++
        const name = p.split('/').pop() ?? ''
        const folder = '' // names unreliable AND folder names here aren't the kit-type, so audio must decide
        const cls = classify({ filename: name, folder })
        const aud = analyzeDrum(dec.samples, dec.sampleRate)
        if (cls.type === gt) nameOK++
        if (cls.type === 'unknown') nameUnknown++
        if (aud.type === gt) audioOK++
        // production: filename if specific, else audio
        const prod = cls.type === 'unknown' ? aud.type : cls.type
        if (prod === gt) prodOK++
        if (gt === 'melodic') {
          keyTotal++
          const k = analyzeKey(dec.samples, dec.sampleRate)
          if (k.tonic && k.confidence >= 0.4) keyHave++
        }
        if (aud.type !== gt && miss.length < 80) {
          const f = aud.features
          miss.push(`${label} gt=${gt} audio=${aud.type}/${aud.subtype} c=${aud.confidence.toFixed(2)} ton=${f.tonality.toFixed(2)} cen=${Math.round(f.centroid)} dec=${f.decay.toFixed(2)} zcr=${f.zcr.toFixed(3)} atk=${f.attackTime.toFixed(3)} dur=${f.activeDuration.toFixed(2)} | ${name}`)
        }
      }
      lines.push(
        `${label} (n=${n}): AUDIO-correct ${((100 * audioOK) / (n || 1)).toFixed(1)}%  | filename-correct ${((100 * nameOK) / (n || 1)).toFixed(1)}% (unknown ${((100 * nameUnknown) / (n || 1)).toFixed(1)}%)  | production ${((100 * prodOK) / (n || 1)).toFixed(1)}%  ext=${JSON.stringify(ext)}`
      )
    }
    lines.push(`KEY coverage on SAMPLES: ${keyHave}/${keyTotal} = ${((100 * keyHave) / (keyTotal || 1)).toFixed(1)}% got a key`)
    lines.push('', '--- AUDIO type mismatches (for refinement) ---', ...miss)
    writeFileSync(`${process.cwd()}/_libtest.txt`, lines.join('\n'))
  })
})
