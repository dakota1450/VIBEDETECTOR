import type { KeyFeatures } from './keyFeatures'
import { KEY_MODEL, type KeyModel } from './keyModel'

// ---------------------------------------------------------------------------------
// Transposition-equivariant key classifier.
//
// For every candidate tonic t the pitch-class profiles are rotated so t sits at
// index 0, log-compressed, and scored against one learned profile per mode:
//
//     score(t, mode) = w_mode · φ(rotate(profiles, t)) + b_mode
//
// The same weights serve all twelve tonics, so the model learns what a key *sounds
// like* relative to its tonic (trained on thousands of producer-labelled loops and
// one-shots) rather than which keys are common. A softmax over the 24 keys gives
// calibrated probabilities, used directly as the confidence.
// ---------------------------------------------------------------------------------

export type KeyBlockName = 'treble' | 'bass' | 'salience' | 'bassNote' | 'opening' | 'closing' | 'pitch'

export interface KeyClassifierInput {
  features: KeyFeatures
  /** Monophonic pitch-tracker estimate (pitch class 0..11 + confidence), if any. */
  pitch?: { pc: number; confidence: number } | null
  /** Seconds of audible content (short sounds get their own learned profile). */
  activeSec: number
}

function block(input: KeyClassifierInput, name: KeyBlockName): Float64Array {
  if (name === 'pitch') {
    const v = new Float64Array(12)
    if (input.pitch && input.pitch.pc >= 0) v[input.pitch.pc] = input.pitch.confidence
    return v
  }
  return input.features[name]
}

/**
 * Weight of the short-sound ("hit") profile: 1 for a short, harmonically static sound
 * (a note, stab, 808), fading to 0 for anything long or melodically moving.
 */
export function shortness(activeSec: number, variety?: number, model: KeyModel = KEY_MODEL): number {
  const { shortSec, phraseSec, varietyFull, varietyNone } = model.gate
  const clamp = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
  let g = activeSec <= shortSec ? 1 : activeSec >= phraseSec ? 0 : (phraseSec - activeSec) / (phraseSec - shortSec)
  if (variety != null && varietyNone > varietyFull) g *= clamp((varietyNone - variety) / (varietyNone - varietyFull))
  return g
}

/** Probabilities over 24 keys: index t = t major, 12 + t = t minor (t: C=0 … B=11). */
export function keyProbabilities(input: KeyClassifierInput, model: KeyModel = KEY_MODEL): Float64Array {
  const blocks = model.blocks.map((b) => block(input, b.name as KeyBlockName))
  const g = model.gate.enabled ? shortness(input.activeSec, input.features.variety, model) : 0
  const dim = model.blocks.length * 12
  const phi = new Float64Array(dim)
  const scores = new Float64Array(24)
  for (let t = 0; t < 12; t++) {
    let o = 0
    for (let bi = 0; bi < blocks.length; bi++) {
      const v = blocks[bi]
      const log = model.blocks[bi].transform === 'log'
      for (let d = 0; d < 12; d++) {
        const x = v[(d + t) % 12]
        phi[o++] = log ? Math.log(x + model.eps) : x
      }
    }
    for (let m = 0; m < 2; m++) {
      const w = m === 0 ? model.major : model.minor
      let s = m === 0 ? 0 : model.minorBias + g * model.minorBiasShort
      for (let i = 0; i < dim; i++) s += w[i] * phi[i]
      if (g > 0) {
        const ws = m === 0 ? model.majorShort : model.minorShort
        let ss = 0
        for (let i = 0; i < dim; i++) ss += ws[i] * phi[i]
        s += g * ss
      }
      scores[m * 12 + t] = s
    }
  }
  let max = -Infinity
  for (let k = 0; k < 24; k++) max = Math.max(max, scores[k])
  let z = 0
  for (let k = 0; k < 24; k++) {
    scores[k] = Math.exp(scores[k] - max)
    z += scores[k]
  }
  for (let k = 0; k < 24; k++) scores[k] /= z
  return scores
}
