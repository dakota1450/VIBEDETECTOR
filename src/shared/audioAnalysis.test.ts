import { describe, it, expect } from 'vitest'
import { analyzeKey, analyzeBpm, analyzeDrum, computeChroma, detectKeyFromChroma } from './audioAnalysis'

function tone(freqs: number[], sr: number, durSec: number): Float32Array {
  const n = Math.floor(sr * durSec)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (const f of freqs) s += Math.sin((2 * Math.PI * f * i) / sr)
    out[i] = s / freqs.length
  }
  return out
}

function pulseTrain(bpm: number, sr: number, durSec: number): Float32Array {
  const n = Math.floor(sr * durSec)
  const out = new Float32Array(n)
  const period = 60 / bpm
  const burst = 0.03
  for (let i = 0; i < n; i++) {
    const ph = (i / sr) % period
    if (ph < burst) out[i] = Math.sin((2 * Math.PI * 1000 * i) / sr) * (1 - ph / burst)
  }
  return out
}

function deterministicNoise(sr: number, durSec: number): Float32Array {
  const n = Math.floor(sr * durSec)
  const out = new Float32Array(n)
  let seed = 99
  for (let i = 0; i < n; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
    out[i] = (seed / 0x7fffffff) * 2 - 1
  }
  return out
}

describe('audio key analysis', () => {
  it('detects C major from a C–E–G triad', () => {
    const sr = 22050
    const buf = tone([261.63, 329.63, 392.0], sr, 1.5)
    const est = analyzeKey(buf, sr)
    expect(est.tonic).toBe('C')
    expect(est.mode).toBe('major')
    expect(est.confidence).toBeGreaterThan(0.3)
  })

  it('detects A minor from an A–C–E triad', () => {
    const sr = 22050
    const buf = tone([220.0, 261.63, 329.63], sr, 1.5)
    const est = analyzeKey(buf, sr)
    expect(est.tonic).toBe('A')
    expect(est.mode).toBe('minor')
  })

  it('returns no key for silence', () => {
    const est = detectKeyFromChroma(computeChroma(new Float32Array(22050), 22050))
    expect(est.tonic).toBeNull()
  })

  it('detects the tonic of a pitched one-shot without forcing a mode', () => {
    const sr = 22050
    const buf = tone([46.25], sr, 0.8)
    const est = analyzeKey(buf, sr)
    expect(est.tonic).toBe('F#')
    expect(est.mode).toBeNull()
    expect(est.confidence).toBeGreaterThan(0.4)
  })

  it('keeps noisy drums below the key confidence threshold', () => {
    const sr = 22050
    const est = analyzeKey(deterministicNoise(sr, 0.25), sr)
    expect(est.confidence).toBeLessThan(0.4)
  })
})

describe('audio bpm analysis', () => {
  it('estimates tempo from a 120 BPM pulse train', () => {
    const sr = 22050
    const buf = pulseTrain(120, sr, 5)
    const est = analyzeBpm(buf, sr)
    expect(est.bpm).not.toBeNull()
    expect(Math.abs((est.bpm as number) - 120)).toBeLessThanOrEqual(12)
  })

  it('returns null for very short input', () => {
    const sr = 22050
    expect(analyzeBpm(new Float32Array(Math.floor(sr * 0.5)), sr).bpm).toBeNull()
  })
})

describe('audio drum classification', () => {
  const sr = 22050

  function decayTone(freq: number, dur: number, decay: number): Float32Array {
    const n = Math.floor(sr * dur)
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const t = i / sr
      out[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-decay * t)
    }
    return out
  }
  function noise(dur: number, decay: number): Float32Array {
    const n = Math.floor(sr * dur)
    const out = new Float32Array(n)
    let seed = 99
    for (let i = 0; i < n; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
      const r = (seed / 0x7fffffff) * 2 - 1
      out[i] = r * Math.exp(-decay * (i / sr))
    }
    return out
  }

  it('classifies a short low-frequency hit as a low drum (kick/808/tom)', () => {
    const est = analyzeDrum(decayTone(55, 0.18, 26), sr)
    expect(est.type).toBe('drum')
    expect(['kick', '808', 'tom']).toContain(est.subtype)
    expect(est.features.centroid).toBeLessThan(600)
  })

  it('classifies short bright noise as a bright/noisy drum (hat/cymbal/snare/perc)', () => {
    const est = analyzeDrum(noise(0.1, 30), sr)
    expect(est.type).toBe('drum')
    expect(['hihat', 'cymbal', 'snare', 'perc', 'clap']).toContain(est.subtype)
    expect(est.features.centroid).toBeGreaterThan(2000)
  })

  it('detects a sustained tonal sound as melodic, not a drum', () => {
    const n = Math.floor(sr * 2)
    const buf = new Float32Array(n)
    for (let i = 0; i < n; i++) buf[i] = Math.sin((2 * Math.PI * 330 * i) / sr) * 0.7
    const est = analyzeDrum(buf, sr)
    expect(est.type).toBe('melodic')
  })
})
