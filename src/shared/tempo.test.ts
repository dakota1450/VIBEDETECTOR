import { describe, expect, it } from 'vitest'
import { estimateTempo } from './tempo'
import { detectTempo } from './analysisJob'

const SR = 22050

let seed = 424242
function rnd(): number {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
  return (seed / 0x7fffffff) * 2 - 1
}

function addAt(out: Float32Array, src: Float32Array, at: number, gain = 1): void {
  for (let i = 0; i < src.length && at + i < out.length; i++) out[at + i] += src[i] * gain
}

function kick(): Float32Array {
  const n = Math.floor(SR * 0.3)
  const o = new Float32Array(n)
  let ph = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    ph += (2 * Math.PI * (45 + 110 * Math.exp(-t * 28))) / SR
    o[i] = Math.sin(ph) * Math.exp(-t * 11)
  }
  return o
}

function snare(): Float32Array {
  const n = Math.floor(SR * 0.2)
  const o = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    o[i] = (rnd() * 0.7 * Math.exp(-t * 22) + Math.sin(2 * Math.PI * 190 * t) * 0.5 * Math.exp(-t * 30)) * 0.8
  }
  return o
}

function hat(): Float32Array {
  const n = Math.floor(SR * 0.045)
  const o = new Float32Array(n)
  let prev = 0
  for (let i = 0; i < n; i++) {
    const r = rnd()
    o[i] = (r - prev) * 0.35 * Math.exp(-(i / SR) * 70) // differentiated noise ≈ bright
    prev = r
  }
  return o
}

/** A boom-bap/backbeat drum loop: kick 1 & 3 (+ "and" of 3), snare 2 & 4, 8th hats. */
function drumLoop(bpm: number, bars: number, tailSec = 0): Float32Array {
  const beat = 60 / bpm
  const total = Math.round(SR * (bars * 4 * beat + tailSec))
  const out = new Float32Array(total)
  const k = kick()
  const s = snare()
  const h = hat()
  for (let bar = 0; bar < bars; bar++) {
    const b0 = bar * 4 * beat
    for (const pos of [0, 2, 2.5]) addAt(out, k, Math.round(SR * (b0 + pos * beat)), 0.9)
    for (const pos of [1, 3]) addAt(out, s, Math.round(SR * (b0 + pos * beat)), 0.8)
    for (let e = 0; e < 8; e++) addAt(out, h, Math.round(SR * (b0 + e * 0.5 * beat)), e % 2 ? 0.5 : 0.8)
  }
  return out
}

/** Four-on-the-floor house pattern: kick every beat, open hat on the off-beats, clap 2 & 4. */
function houseLoop(bpm: number, bars: number): Float32Array {
  const beat = 60 / bpm
  const out = new Float32Array(Math.round(SR * bars * 4 * beat))
  const k = kick()
  const s = snare()
  const h = hat()
  for (let i = 0; i < bars * 4; i++) {
    addAt(out, k, Math.round(SR * i * beat), 0.9)
    addAt(out, h, Math.round(SR * (i + 0.5) * beat), 0.9)
    if (i % 2 === 1) addAt(out, s, Math.round(SR * i * beat), 0.6)
  }
  return out
}

/** Plucked chord stabs on every beat — a melodic loop with no drums. */
function chordLoop(bpm: number, bars: number): Float32Array {
  const beat = 60 / bpm
  const out = new Float32Array(Math.round(SR * bars * 4 * beat))
  const chords = [
    [220, 261.63, 329.63],
    [174.61, 220, 261.63],
    [261.63, 329.63, 392],
    [196, 246.94, 293.66]
  ]
  for (let i = 0; i < bars * 4; i++) {
    const notes = chords[Math.floor(i / 4) % chords.length]
    const at = Math.round(SR * i * beat)
    const len = Math.round(SR * beat * 0.9)
    for (let j = 0; j < len && at + j < out.length; j++) {
      const t = j / SR
      let v = 0
      for (const f of notes) v += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)
      out[at + j] += v * Math.exp(-t * 5) * 0.2
    }
  }
  return out
}

function pad(sec: number): Float32Array {
  const out = new Float32Array(Math.round(SR * sec))
  for (let i = 0; i < out.length; i++) {
    const t = i / SR
    const env = Math.min(1, t / 1.2) * Math.min(1, (sec - t) / 1.5)
    out[i] = (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277.18 * t) + Math.sin(2 * Math.PI * 329.63 * t)) * env * 0.2
  }
  return out
}

const tempoOf = (buf: Float32Array): ReturnType<typeof estimateTempo> =>
  estimateTempo(buf, SR, { durationSec: buf.length / SR })

describe('tempo: loops trimmed to the bar grid', () => {
  for (const bpm of [84, 92, 100, 120]) {
    it(`locks a ${bpm} BPM 4-bar drum loop to exactly ${bpm}`, () => {
      const est = tempoOf(drumLoop(bpm, 4))
      expect(est.bpm).toBe(bpm)
      expect(est.method).toBe('loop-grid')
      expect(est.confidence).toBeGreaterThan(0.5)
    })
  }

  it('reads a four-on-the-floor 126 BPM house loop as 126', () => {
    expect(tempoOf(houseLoop(126, 4)).bpm).toBe(126)
  })

  it('keeps a fractional tempo on its exact grid (87.5, or its whole-number double 175)', () => {
    // Producer tempos are whole numbers in >99.9% of labelled loops, so the model prefers
    // the integer reading of the same grid; either way the beat grid is exact.
    expect([87.5, 175]).toContain(tempoOf(drumLoop(87.5, 4)).bpm)
  })

  it('finds the tempo of a drum-less melodic chord loop (or its half/double)', () => {
    const bpm = tempoOf(chordLoop(96, 4)).bpm
    expect([48, 96, 192]).toContain(bpm)
  })
})

describe('tempo: free audio estimate', () => {
  it('estimates a loop with a reverb tail (not grid-trimmed) to within 1 BPM', () => {
    const est = tempoOf(drumLoop(100, 4, 0.43))
    expect(est.bpm).not.toBeNull()
    expect(Math.abs((est.bpm as number) - 100)).toBeLessThanOrEqual(1)
  })

  it('works without knowing the file length', () => {
    const buf = drumLoop(110, 4)
    const est = estimateTempo(buf, SR)
    expect(est.bpm).not.toBeNull()
    expect(Math.abs((est.bpm as number) - 110)).toBeLessThanOrEqual(1)
  })
})

describe('tempo: sounds without a pulse', () => {
  it('returns no tempo for a single kick one-shot', () => {
    expect(tempoOf(kick()).bpm).toBeNull()
  })

  it('returns no tempo for a sustained pad', () => {
    expect(tempoOf(pad(6.37)).bpm).toBeNull()
  })

  it('returns no tempo for silence', () => {
    expect(tempoOf(new Float32Array(SR * 5)).bpm).toBeNull()
  })

  it('returns no tempo for steady noise', () => {
    const buf = new Float32Array(SR * 5)
    for (let i = 0; i < buf.length; i++) buf[i] = rnd() * 0.3
    expect(tempoOf(buf).bpm).toBeNull()
  })

  it('offers half/double-time alternatives with a detected tempo', () => {
    const out = detectTempo(drumLoop(90, 4), SR, (4 * 4 * 60) / 90)
    expect(out.value).toBe(90)
    expect(out.alternatives).toEqual([45, 180])
  })
})
