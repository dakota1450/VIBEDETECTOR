// Generates a small, musical demo library (synthesized — no third-party audio) for
// screenshots and end-to-end checks. Loops are cut to exact bar lengths like real
// sample packs; many names carry NO key or tempo, so what you see in the app is what
// the audio analysis detected.
//
//   node scripts/make-demo-library.mjs [outDir]
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const SR = 44100

function writeWav(path, samples) {
  let peak = 0
  for (const v of samples) peak = Math.max(peak, Math.abs(v))
  const g = peak > 0 ? 0.89 / peak : 1
  const n = samples.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] * g)) * 32767), 44 + i * 2)
  writeFileSync(path, buf)
}

let seed = 20261015
const rnd = () => {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
  return (seed / 0x7fffffff) * 2 - 1
}
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 }
const hz = (name, oct) => 440 * 2 ** ((NOTE[name] + 12 * (oct - 4) - 9) / 12)
const len = (sec) => Math.round(sec * SR)
const mix = (out, src, at, gain = 1) => {
  for (let i = 0; i < src.length && at + i < out.length; i++) if (at + i >= 0) out[at + i] += src[i] * gain
}

// ---------- instruments ----------
function kick(dur = 0.35) {
  const o = new Float64Array(len(dur))
  let ph = 0
  for (let i = 0; i < o.length; i++) {
    const t = i / SR
    ph += (2 * Math.PI * (48 + 120 * Math.exp(-t * 30))) / SR
    o[i] = Math.tanh(Math.sin(ph) * Math.exp(-t * 9) * 1.6)
  }
  return o
}
function snare(dur = 0.22) {
  const o = new Float64Array(len(dur))
  let y = 0
  for (let i = 0; i < o.length; i++) {
    const t = i / SR
    y += 0.5 * (rnd() - y)
    o[i] = y * 1.4 * Math.exp(-t * 20) + Math.sin(2 * Math.PI * 190 * t) * 0.45 * Math.exp(-t * 28)
  }
  return o
}
function clap(dur = 0.25) {
  const o = new Float64Array(len(dur))
  for (const b of [0, 0.012, 0.026]) {
    let y = 0
    for (let i = 0; i < len(0.05); i++) {
      y += 0.35 * (rnd() - y)
      o[len(b) + i] += y * 2 * Math.exp(-(i / SR) * 45)
    }
  }
  let y = 0
  for (let i = 0; i < o.length; i++) {
    y += 0.35 * (rnd() - y)
    o[i] += y * Math.exp(-(i / SR) * 11)
  }
  return o
}
function hat(dur = 0.05, open = false) {
  const o = new Float64Array(len(open ? 0.32 : dur))
  let prev = 0
  for (let i = 0; i < o.length; i++) {
    const r = rnd()
    o[i] = (r - prev) * 0.5 * Math.exp(-(i / SR) * (open ? 9 : 75))
    prev = r
  }
  return o
}
function tom(f0, dur = 0.5) {
  const o = new Float64Array(len(dur))
  let ph = 0
  for (let i = 0; i < o.length; i++) {
    const t = i / SR
    ph += (2 * Math.PI * f0 * (1 + 0.4 * Math.exp(-t * 25))) / SR
    o[i] = Math.sin(ph) * Math.exp(-t * 7) + rnd() * 0.15 * Math.exp(-t * 40)
  }
  return o
}
function sub808(f0, dur) {
  const o = new Float64Array(len(dur))
  let ph = 0
  for (let i = 0; i < o.length; i++) {
    const t = i / SR
    ph += (2 * Math.PI * f0 * (1 + 0.6 * Math.exp(-t * 40))) / SR
    o[i] = Math.tanh(Math.sin(ph) * 1.8) * Math.exp(-t * 1.6) * Math.min(1, (dur - t) / 0.03)
  }
  return o
}
/** Karplus–Strong plucked string — sounds like a real pluck/guitar/harp. */
function pluck(f0, dur, bright = 0.5) {
  const o = new Float64Array(len(dur))
  const N = Math.max(2, Math.round(SR / f0))
  const line = new Float64Array(N)
  for (let i = 0; i < N; i++) line[i] = rnd() * (0.6 + 0.4 * bright)
  let idx = 0
  const damp = 0.4985 + bright * 0.0012
  for (let i = 0; i < o.length; i++) {
    const a = line[idx]
    const b = line[(idx + 1) % N]
    line[idx] = (a + b) * damp
    o[i] = a
    idx = (idx + 1) % N
  }
  return o
}
/** Electric-piano-ish tone: inharmonic-free bell partials with per-partial decay. */
function epiano(f0, dur) {
  const o = new Float64Array(len(dur))
  const parts = [
    [1, 1, 1.6],
    [2, 0.45, 3],
    [3, 0.18, 4.5],
    [4, 0.12, 6],
    [7, 0.05, 9]
  ]
  for (let i = 0; i < o.length; i++) {
    const t = i / SR
    let s = 0
    for (const [k, a, d] of parts) s += a * Math.sin(2 * Math.PI * f0 * k * t * (1 + 0.0007 * k)) * Math.exp(-t * d)
    o[i] = s * Math.min(1, t / 0.004) * Math.min(1, (dur - t) / 0.06)
  }
  return o
}
/** Warm pad: detuned saws through a one-pole low-pass, slow swell. */
function pad(freqs, dur) {
  const o = new Float64Array(len(dur))
  const phases = freqs.flatMap((f) => [f * 0.997, f, f * 1.003]).map((f) => ({ f, ph: Math.random() }))
  let y = 0
  for (let i = 0; i < o.length; i++) {
    const t = i / SR
    let s = 0
    for (const p of phases) {
      p.ph = (p.ph + p.f / SR) % 1
      s += 2 * p.ph - 1
    }
    y += 0.06 * (s - y)
    o[i] = y * Math.min(1, t / 0.8) * Math.min(1, (dur - t) / 0.9) * 0.25
  }
  return o
}

// ---------- patterns ----------
const CHORD = (root, q, oct = 3) => {
  const r = hz(root, oct)
  return [r, r * 2 ** ((q === 'm' ? 3 : 4) / 12), r * 2 ** (7 / 12)]
}
function chordLoop(prog, bpm, voice, bars = 4) {
  const beat = 60 / bpm
  const out = new Float64Array(len(bars * 4 * beat))
  prog.forEach(([root, q], bar) => {
    const notes = CHORD(root, q)
    const bass = hz(root, 2)
    for (let b = 0; b < 4; b++) {
      const at = len((bar * 4 + b) * beat)
      const noteLen = beat * (voice === 'ep' ? 1.9 : 0.95)
      for (const f of notes) mix(out, voice === 'ep' ? epiano(f, noteLen) : pluck(f, noteLen, 0.6), at, 0.5)
      if (b % 2 === 0) mix(out, voice === 'ep' ? epiano(bass, beat * 2) : pluck(bass, beat * 1.8, 0.2), at, 0.7)
    }
  })
  return out
}
function melodyLoop(notes, bpm, oct, bars = 2) {
  const beat = 60 / bpm
  const out = new Float64Array(len(bars * 4 * beat))
  const step = (bars * 4 * beat) / notes.length
  notes.forEach((n, i) => mix(out, pluck(hz(n, oct), step * 1.6, 0.8), len(i * step), 0.9))
  return out
}
function drumLoop(bpm, style, bars = 4) {
  const beat = 60 / bpm
  const out = new Float64Array(len(bars * 4 * beat))
  const K = kick()
  const S = snare()
  const C = clap()
  for (let bar = 0; bar < bars; bar++) {
    const b0 = bar * 4
    const at = (pos) => len((b0 + pos) * beat)
    if (style === 'boombap') {
      for (const p of [0, 1.75, 2.5]) mix(out, K, at(p), 0.95)
      for (const p of [1, 3]) mix(out, S, at(p), 0.8)
      for (let e = 0; e < 8; e++) mix(out, hat(), at(e / 2 + (e % 2 ? 0.06 : 0)), e % 2 ? 0.45 : 0.7)
    } else if (style === 'house') {
      for (let q = 0; q < 4; q++) mix(out, K, at(q), 0.95)
      for (const p of [1, 3]) mix(out, C, at(p), 0.55)
      for (let q = 0; q < 4; q++) mix(out, hat(0, true), at(q + 0.5), 0.5)
    } else if (style === 'trap') {
      for (const p of [0, 0.75, 2.5]) mix(out, K, at(p), 0.95)
      mix(out, C, at(2), 0.75)
      for (let s = 0; s < 16; s++) mix(out, hat(), at(s / 4), s % 4 === 0 ? 0.7 : 0.45)
    } else if (style === 'dnb') {
      for (const p of [0, 2.5]) mix(out, K, at(p), 0.95)
      for (const p of [1, 3]) mix(out, S, at(p), 0.85)
      for (let e = 0; e < 8; e++) mix(out, hat(), at(e / 2), 0.5)
    }
  }
  return out
}
function bassLoop(notes, bpm, bars = 2) {
  const beat = 60 / bpm
  const out = new Float64Array(len(bars * 4 * beat))
  const step = (bars * 4 * beat) / notes.length
  notes.forEach((n, i) => mix(out, sub808(hz(n, 1), step * 0.95), len(i * step), 1))
  return out
}

// [folder, filename, audio]
const FILES = [
  ['Drum Loops', 'Dusty Break.wav', drumLoop(88, 'boombap')],
  ['Drum Loops', 'Warehouse Groove.wav', drumLoop(124, 'house')],
  ['Drum Loops', 'Night Shift Drums.wav', drumLoop(140, 'trap')],
  ['Drum Loops', 'Roller Break 174.wav', drumLoop(174, 'dnb')],
  ['Drum Loops', 'Lazy Sunday Kit Loop.wav', drumLoop(76, 'boombap')],
  ['Melodic Loops', 'Velvet Keys.wav', chordLoop([['A', 'm'], ['F', ''], ['C', ''], ['G', '']], 90, 'ep')],
  ['Melodic Loops', 'Golden Hour Chords.wav', chordLoop([['D', 'm'], ['A#', ''], ['F', ''], ['C', '']], 120, 'ep')],
  ['Melodic Loops', 'Glass Pluck Loop.wav', chordLoop([['E', 'm'], ['C', ''], ['G', ''], ['D', '']], 100, 'pluck')],
  ['Melodic Loops', 'Midnight Harp.wav', chordLoop([['F#', 'm'], ['D', ''], ['A', ''], ['E', '']], 140, 'pluck')],
  ['Melodic Loops', 'Sunrise Rhodes Cmaj.wav', chordLoop([['C', ''], ['A', 'm'], ['F', ''], ['G', '']], 96, 'ep')],
  ['Melodic Loops', 'Lead Line G#m.wav', melodyLoop(['G#', 'B', 'D#', 'C#', 'B', 'G#', 'F#', 'G#'], 128, 4)],
  ['Melodic Loops', 'Bell Motif.wav', melodyLoop(['C', 'E', 'G', 'B', 'A', 'G', 'E', 'C'], 110, 5)],
  ['Bass', '808 Glide Loop.wav', bassLoop(['G', 'G', 'A#', 'F'], 140)],
  ['Bass', 'Sub Line.wav', bassLoop(['D', 'D', 'F', 'C'], 92)],
  ['Bass', '808_C.wav', sub808(hz('C', 1), 1.4)],
  ['Bass', '808 Long Tail.wav', sub808(hz('F#', 1), 2.2)],
  ['One Shots', 'Kick Punchy.wav', kick()],
  ['One Shots', 'Snare Crack.wav', snare()],
  ['One Shots', 'Clap Wide.wav', clap()],
  ['One Shots', 'Hat Tight.wav', hat()],
  ['One Shots', 'Hat Open.wav', hat(0, true)],
  ['One Shots', 'Tom Low.wav', tom(hz('A', 2))],
  ['One Shots', 'Pluck Hit.wav', pluck(hz('E', 3), 1.1, 0.7)],
  ['One Shots', 'Keys Stab Cm.wav', (() => {
    const o = new Float64Array(len(1.2))
    for (const f of CHORD('C', 'm', 4)) mix(o, epiano(f, 1.2), 0, 0.6)
    return o
  })()],
  ['One Shots', 'Chord Hit Fmaj.wav', (() => {
    const o = new Float64Array(len(1.1))
    for (const f of CHORD('F', '', 3)) mix(o, pluck(f, 1.1, 0.6), 0, 0.6)
    return o
  })()],
  ['Pads', 'Floating Pad.wav', pad(CHORD('D', '', 3), 7.3)],
  ['Pads', 'Dark Atmosphere.wav', pad(CHORD('B', 'm', 2), 9.1)]
]

const outDir = process.argv[2] || join(process.cwd(), 'demo-library')
for (const [folder, name, audio] of FILES) {
  mkdirSync(join(outDir, folder), { recursive: true })
  writeWav(join(outDir, folder, name), audio)
}
console.log(`Wrote ${FILES.length} demo sounds to ${outDir}`)
