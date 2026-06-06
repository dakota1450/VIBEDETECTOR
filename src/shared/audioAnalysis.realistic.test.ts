import { describe, it, expect } from 'vitest'
import { analyzeKey, analyzeDrum } from './audioAnalysis'

const SR = 22050

// MIDI helpers so tests read in note names.
const NOTE: Record<string, number> = {
  C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11
}
function freq(name: string, octave: number): number {
  return 440 * Math.pow(2, (NOTE[name] + 12 * (octave - 4) - 9) / 12)
}

let seed = 1234567
function rnd(): number {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
  return (seed / 0x7fffffff) * 2 - 1
}

/** A harmonic tone with N partials and an exponential decay (pluck/key/brass body). */
function harmonic(f0: number, dur: number, nHarm: number, decay: number, bright = 1): Float32Array {
  const n = Math.floor(SR * dur)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    let s = 0
    for (let k = 1; k <= nHarm; k++) s += Math.sin(2 * Math.PI * f0 * k * t) / Math.pow(k, bright)
    out[i] = s * Math.exp(-decay * t) * 0.5
  }
  return out
}

/** A sustained harmonic stab (fast attack, held, then released) — e.g. brass/synth stab. */
function stab(f0: number, dur: number, nHarm: number): Float32Array {
  const n = Math.floor(SR * dur)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const env = Math.min(1, t / 0.01) * Math.min(1, (dur - t) / 0.05) // 10ms attack, 50ms release
    let s = 0
    for (let k = 1; k <= nHarm; k++) s += Math.sin(2 * Math.PI * f0 * k * t) / k
    out[i] = s * env * 0.5
  }
  return out
}

/** A tuned drum: a fast noise transient over a longer pitched shell resonance. */
function tunedDrum(fp: number, dur: number, noiseAmt: number): Float32Array {
  const n = Math.floor(SR * dur)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const noise = rnd() * Math.exp(-t * 45) * noiseAmt // buzz decays fast
    const tone = Math.sin(2 * Math.PI * fp * t) * Math.exp(-t * 11) * (1 - noiseAmt) * 1.4 // shell rings
    out[i] = noise + tone
  }
  return out
}

/** A pitched 808/sub: near-sine with a long decay. */
function sub(fp: number, dur: number): Float32Array {
  const n = Math.floor(SR * dur)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    out[i] = (Math.sin(2 * Math.PI * fp * t) + 0.15 * Math.sin(4 * Math.PI * fp * t)) * Math.exp(-t * 3) * 0.9
  }
  return out
}

/** A polyphonic chord, voiced like a real instrument: root emphasized in the bass,
 *  upper notes softer, harmonics rolling off. */
function chord(freqs: number[], dur: number): Float32Array {
  const n = Math.floor(SR * dur)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    let s = 0.9 * Math.sin(2 * Math.PI * (freqs[0] / 2) * t) // sub-octave bass root
    for (let j = 0; j < freqs.length; j++) {
      const amp = j === 0 ? 1.0 : 0.5 // root louder than the upper voices
      for (let k = 1; k <= 5; k++) s += amp * Math.sin(2 * Math.PI * freqs[j] * k * t) / (k * 1.4)
    }
    out[i] = s * Math.exp(-t * 1.2) * 0.25
  }
  return out
}

/** A short tonal phrase with root-weighted start/end notes and a subtle bass anchor. */
function phrase(notes: string[], octave: number, root: string, rootOctave: number, step = 0.24): Float32Array {
  const n = Math.floor(SR * step * notes.length)
  const out = new Float32Array(n)
  const rootFreq = freq(root, rootOctave)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const idx = Math.min(notes.length - 1, Math.floor(t / step))
    const local = t - idx * step
    const env = Math.min(1, local / 0.018) * Math.min(1, (step - local) / 0.035)
    const noteFreq = freq(notes[idx], octave)
    const rootWeight = idx === 0 || idx === notes.length - 1 ? 0.45 : 0.2
    const voice = Math.sin(2 * Math.PI * noteFreq * t) + 0.35 * Math.sin(4 * Math.PI * noteFreq * t)
    const bass = Math.sin(2 * Math.PI * rootFreq * t) * rootWeight
    out[i] = (voice * 0.62 * env + bass) * 0.55
  }
  return out
}

function withLeadingSilence(buf: Float32Array, silenceSeconds: number): Float32Array {
  const offset = Math.floor(SR * silenceSeconds)
  const out = new Float32Array(offset + buf.length)
  out.set(buf, offset)
  return out
}

function kickSweep(dur = 0.2): Float32Array {
  const n = Math.floor(SR * dur)
  const out = new Float32Array(n)
  let ph = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const f = 90 * Math.exp(-t * 16) + 45
    ph += (2 * Math.PI * f) / SR
    out[i] = Math.sin(ph) * Math.exp(-t * 20) * 0.95
  }
  return out
}

function brightNoise(dur: number, decay: number): Float32Array {
  const n = Math.floor(SR * dur)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = rnd() * Math.exp(-(i / SR) * decay) * 0.8
  return out
}

function lowNoise(dur: number, amp = 0.04): Float32Array {
  const n = Math.floor(SR * dur)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = rnd() * amp
  return out
}

function concat(...parts: Float32Array[]): Float32Array {
  const len = parts.reduce((n, p) => n + p.length, 0)
  const out = new Float32Array(len)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

describe('key detection on realistic tuned one-shots (the core edge)', () => {
  const oneShots: [string, string, Float32Array][] = [
    ['tuned snare → G', 'G', tunedDrum(freq('G', 3), 0.45, 0.5)],
    ['tuned snare → C#', 'C#', tunedDrum(freq('C#', 3), 0.4, 0.5)],
    ['tuned tom → A', 'A', tunedDrum(freq('A', 2), 0.5, 0.35)],
    ['808 → F#', 'F#', sub(freq('F#', 1), 0.7)],
    ['808 → D', 'D', sub(freq('D', 1), 0.6)],
    ['pluck → E', 'E', harmonic(freq('E', 3), 0.6, 8, 6)],
    ['key one-shot → B', 'B', harmonic(freq('B', 3), 0.8, 6, 4)],
    ['brass stab → C', 'C', stab(freq('C', 4), 0.5, 9)]
  ]
  for (const [label, tonic, buf] of oneShots) {
    it(`${label}`, () => {
      const est = analyzeKey(buf, SR)
      expect(est.tonic).toBe(tonic)
      expect(est.confidence).toBeGreaterThan(0.4)
    })
  }
})

describe('key detection on polyphonic content', () => {
  it('reads a C major piano chord as C major', () => {
    const est = analyzeKey(chord([freq('C', 3), freq('E', 3), freq('G', 3)], 2.2), SR)
    expect(est.tonic).toBe('C')
    expect(est.mode).toBe('major')
  })
  it('reads an A minor chord as A minor', () => {
    const est = analyzeKey(chord([freq('A', 2), freq('C', 3), freq('E', 3)], 2.2), SR)
    expect(est.tonic).toBe('A')
    expect(est.mode).toBe('minor')
  })
  it('does not invent a mode for a sustained single harmonic note', () => {
    const est = analyzeKey(harmonic(freq('D', 2), 2.4, 9, 0.35), SR)
    expect(est.tonic).toBe('D')
    expect(est.mode).toBeNull()
    expect(est.confidence).toBeGreaterThan(0.5)
  })
  it('keeps a root-fifth power chord mode-open when no third is present', () => {
    const est = analyzeKey(chord([freq('C', 3), freq('G', 3)], 1.8), SR)
    expect(est.tonic).toBe('C')
    expect(est.mode).toBeNull()
    expect(est.confidence).toBeGreaterThan(0.4)
  })
  it('tracks a slightly detuned A tone to the nearest musical key', () => {
    const est = analyzeKey(harmonic(432, 1.1, 7, 3.5), SR)
    expect(est.tonic).toBe('A')
    expect(est.mode).toBeNull()
  })
  it('keeps a long held single note tonic-only instead of inventing a mode', () => {
    const est = analyzeKey(harmonic(freq('C#', 2), 3.4, 8, 0.25), SR)
    expect(est.tonic).toBe('C#')
    expect(est.mode).toBeNull()
    expect(est.confidence).toBeGreaterThan(0.5)
  })
  it('uses the audible section when a file has a long silent lead-in', () => {
    const est = analyzeKey(withLeadingSilence(chord([freq('C', 3), freq('E', 3), freq('G', 3)], 2.0), 13), SR)
    expect(est.tonic).toBe('C')
    expect(est.mode).toBe('major')
  })
  it('samples across long active files instead of trusting only the opening section', () => {
    const lateChord = chord([freq('C', 3), freq('E', 3), freq('G', 3)], 4.5)
    const est = analyzeKey(concat(lowNoise(22), lateChord), SR)
    expect(est.tonic).toBe('C')
    expect(est.mode).toBe('major')
    expect(est.confidence).toBeGreaterThan(0.35)
  })
  it('reads a G major melodic phrase as G major, not its relative minor', () => {
    const est = analyzeKey(phrase(['G', 'A', 'B', 'D', 'E', 'D', 'B', 'G'], 3, 'G', 2), SR)
    expect(est.tonic).toBe('G')
    expect(est.mode).toBe('major')
  })
  it('reads an E minor melodic phrase as E minor, not its relative major', () => {
    const est = analyzeKey(phrase(['E', 'G', 'A', 'B', 'D', 'C', 'B', 'E'], 3, 'E', 2), SR)
    expect(est.tonic).toBe('E')
    expect(est.mode).toBe('minor')
  })
})

describe('atonal percussion stays keyless / low confidence', () => {
  it('kick sweep has no confident key', () => {
    expect(analyzeKey(kickSweep(0.2), SR).confidence).toBeLessThan(0.5)
  })
  it('hi-hat noise has no confident key', () => {
    expect(analyzeKey(brightNoise(0.06, 50), SR).confidence).toBeLessThan(0.5)
  })
})

describe('type classification is sound-driven, not duration-driven', () => {
  it('a short brass stab is melodic, not a drum', () => {
    expect(analyzeDrum(stab(freq('C', 4), 0.5, 9), SR).type).toBe('melodic')
  })
  it('a short pluck is melodic, not a drum', () => {
    expect(analyzeDrum(harmonic(freq('E', 3), 0.6, 8, 6), SR).type).toBe('melodic')
  })
  it('a tuned snare is still a drum (despite having a pitch)', () => {
    expect(analyzeDrum(tunedDrum(freq('G', 3), 0.45, 0.5), SR).type).toBe('drum')
  })
  it('an 808 is still a drum (low-frequency tonal)', () => {
    expect(analyzeDrum(sub(freq('F#', 1), 0.7), SR).type).toBe('drum')
  })
  it('a hi-hat is a drum', () => {
    expect(analyzeDrum(brightNoise(0.06, 50), SR).type).toBe('drum')
  })
})
