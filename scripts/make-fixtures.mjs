// Generates small, valid WAV fixtures with realistic-ish spectra so the scanner
// (filename) and the audio classifier broadly agree. Usage: node scripts/make-fixtures.mjs [outDir]
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const SR = 22050

function writeWav(path, samples) {
  const n = samples.length
  const dataSize = n * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
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
  buf.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2)
  }
  writeFileSync(path, buf)
}

let seed = 1234567
const rnd = () => {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
  return (seed / 0x7fffffff) * 2 - 1
}

// --- melodic (tonal) ---
function tone(freqs, dur) {
  const n = Math.floor(SR * dur)
  const o = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (const f of freqs) s += Math.sin((2 * Math.PI * f * i) / SR)
    o[i] = (s / freqs.length) * 0.6
  }
  return o
}

// --- drums ---
function kick(dur = 0.2) {
  const n = Math.floor(SR * dur)
  const o = new Float64Array(n)
  let ph = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const f = 90 * Math.exp(-t * 16) + 45
    ph += (2 * Math.PI * f) / SR
    o[i] = Math.sin(ph) * Math.exp(-t * 20) * 0.95
  }
  return o
}
function sub808(dur = 0.6) {
  const n = Math.floor(SR * dur)
  const o = new Float64Array(n)
  let ph = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    ph += (2 * Math.PI * 46) / SR
    o[i] = Math.sin(ph) * Math.exp(-t * 3) * 0.9
  }
  return o
}
function brightNoise(dur, decay) {
  const n = Math.floor(SR * dur)
  const o = new Float64Array(n)
  for (let i = 0; i < n; i++) o[i] = rnd() * Math.exp(-(i / SR) * decay) * 0.8
  return o
}
function midNoise(dur, decay, alpha = 0.4) {
  const n = Math.floor(SR * dur)
  const o = new Float64Array(n)
  let y = 0
  for (let i = 0; i < n; i++) {
    const x = rnd()
    y = y + alpha * (x - y)
    o[i] = y * Math.exp(-(i / SR) * decay) * 1.6
  }
  return o
}
function snare(dur = 0.2) {
  const o = midNoise(dur, 14, 0.2)
  let ph = 0
  for (let i = 0; i < o.length; i++) {
    const t = i / SR
    ph += (2 * Math.PI * 185) / SR
    o[i] = o[i] * 0.8 + Math.sin(ph) * Math.exp(-t * 22) * 0.3
  }
  return o
}
function clap(dur = 0.22) {
  const n = Math.floor(SR * dur)
  const o = new Float64Array(n)
  for (const b of [0, 0.011, 0.024]) {
    const start = Math.floor(b * SR)
    const seg = midNoise(0.05, 40, 0.2)
    for (let i = 0; i < seg.length && start + i < n; i++) o[start + i] += seg[i]
  }
  const tail = midNoise(dur, 9, 0.2)
  for (let i = 0; i < n; i++) o[i] += tail[i] * 0.5
  return o
}
function perc(dur = 0.12) {
  const o = midNoise(dur, 22, 0.2)
  let ph = 0
  for (let i = 0; i < o.length; i++) {
    const t = i / SR
    ph += (2 * Math.PI * 520) / SR
    o[i] = o[i] * 0.7 + Math.sin(ph) * Math.exp(-t * 30) * 0.3
  }
  return o
}

// [folder, filename, samples]
const FILES = [
  ['Melodics', 'Piano_Loop_Cmaj_120bpm.wav', tone([261.63, 329.63, 392.0], 2.0)],
  ['Melodics', 'Reese_Bass_Gm_140.wav', tone([98.0, 146.83, 196.0], 2.0)],
  ['Melodics', 'Vocal_Chop_Am.wav', tone([220.0, 261.63, 329.63], 1.8)],
  ['Melodics', '8A_melody_loop.wav', tone([220.0, 261.63, 329.63], 2.0)],
  ['Melodics', 'Lush_Pad_Fmaj.wav', tone([174.61, 220.0, 261.63], 2.4)],
  ['Melodics', 'dusty_chords_take2.wav', tone([293.66, 349.23, 440.0], 2.2)],
  ['Melodics', 'field_recording_long.wav', tone([261.63, 329.63, 392.0], 3.0)],
  ['Drum Kit', '808_F#_140.wav', sub808()],
  ['Drum Kit', 'Kick_01.wav', kick()],
  ['Drum Kit', 'Snare_Acoustic.wav', snare()],
  ['Drum Kit', 'Closed_Hat_03.wav', brightNoise(0.06, 50)],
  ['Drum Kit', 'OpenHat.wav', brightNoise(0.32, 7)],
  ['Drum Kit', 'Clap_Hard.wav', clap()],
  ['Drum Kit', 'Crash_Cymbal.wav', brightNoise(0.85, 3.2)],
  ['Drum Kit', 'Perc_Shaker_02.wav', perc()],
  // Generically-named hits (weak filename) — the audio classifier should fill these:
  ['Drum Kit', 'Drum_Hit_Low_01.wav', kick(0.18)],
  ['Drum Kit', 'Drum_Hit_Bright_02.wav', brightNoise(0.08, 40)]
]

const outDir = process.argv[2] || join(process.cwd(), 'fixtures')
mkdirSync(join(outDir, 'Drum Kit'), { recursive: true })
mkdirSync(join(outDir, 'Melodics'), { recursive: true })
for (const [folder, name, samples] of FILES) writeWav(join(outDir, folder, name), samples)

console.log(`Wrote ${FILES.length} fixture WAVs to ${outDir}`)
