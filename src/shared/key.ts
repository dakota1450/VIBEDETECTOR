import { activeRegion, estimatePitchClass, type ActiveRegion } from './audioAnalysis'
import { computeKeyFeatures, type KeyFeatures } from './keyFeatures'
import { keyProbabilities, shortness } from './keyClassifier'
import { PITCH_CLASSES } from './keyColors'
import type { KeyDecisionDiagnostics, KeyEvidenceItem, KeyMode } from './types'

// ---------------------------------------------------------------------------------
// Key detection for any sound — chords, loops, one-shots, tuned drums.
//
// The learned, transposition-equivariant classifier (keyClassifier.ts) turns pitch
// features into a probability for each of the 24 keys. On top of it:
//   • the tonic is the most probable pitch class (summing both modes);
//   • a mode is reported only when the music actually contains a third and the
//     classifier clearly prefers one mode — a lone note, an 808 or a power chord has
//     a root but no major/minor quality, so it stays tonic-only;
//   • the probability itself is the confidence, so "73%" means what it says.
// ---------------------------------------------------------------------------------

// Save thresholds (probability the key is right), set from measured accuracy per
// instrument family on ~4.3k labelled samples: melodic material is reliable even at
// modest probabilities; tuned drums (kick, 808, tom, perc) need more; noisy drums
// (hats, cymbals, claps, snares) and whole drum loops almost never carry one clear
// pitch, so they keep a key only when it is unmistakable (e.g. an 808 bassline).
export const KEY_MIN_CONFIDENCE = 0.25
export const DRUM_KEY_MIN_CONFIDENCE = 0.4
export const STRICT_DRUM_KEY_MIN_CONFIDENCE = 0.55
const STRICT_DRUMS = new Set(['hihat', 'openhat', 'cymbal', 'clap', 'snare', 'loop'])
/** Share of the tonic's probability its mode needs before we commit to major/minor. */
export const MODE_MIN_SHARE = 0.55
/** In a short sound, a third (major or minor) must carry this much of the root's weight
 *  for it to have a mode at all — a lone note or power chord is tonic-only. */
const THIRD_MIN_RATIO = 0.1

export function keyThreshold(isDrum: boolean, subtype?: string | null): number {
  if (!isDrum) return KEY_MIN_CONFIDENCE
  return subtype && STRICT_DRUMS.has(subtype) ? STRICT_DRUM_KEY_MIN_CONFIDENCE : DRUM_KEY_MIN_CONFIDENCE
}

export interface KeyCandidateOut {
  tonic: string
  mode: KeyMode
  p: number
}

export interface KeyOut {
  tonic: string | null
  mode: KeyMode | null
  confidence: number
  /** Most likely keys, best first (shown for one-click correction). */
  candidates?: KeyCandidateOut[]
  diagnostics?: KeyDecisionDiagnostics
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000

/**
 * Does the sound contain a third above `tonic`? Uses the fundamental-weighted
 * (harmonic-salience) profile, where an overtone of the root doesn't masquerade as
 * a played third.
 */
function hasThird(f: KeyFeatures, tonic: number): boolean {
  const root = f.salience[tonic] + f.bass[tonic] * 0.5
  if (root <= 0) return true
  const minor3 = f.salience[(tonic + 3) % 12] + f.bass[(tonic + 3) % 12] * 0.5
  const major3 = f.salience[(tonic + 4) % 12] + f.bass[(tonic + 4) % 12] * 0.5
  return Math.max(minor3, major3) >= root * THIRD_MIN_RATIO
}

export function detectKey(
  samples: Float32Array,
  sampleRate: number,
  region: ActiveRegion = activeRegion(samples),
  opts: { isDrum?: boolean; subtype?: string | null; beatSec?: number | null } = {}
): KeyOut {
  const activeSec = Math.max(0, region[1] - region[0] + 1) / sampleRate
  const features = computeKeyFeatures(samples, sampleRate, region, { beatSec: opts.beatSec })
  const evidence: KeyEvidenceItem[] = [
    { name: 'activeSec', value: round3(activeSec) },
    { name: 'tuningCents', value: round3(features.tuningCents) },
    { name: 'tonalFrames', value: features.tonalFrames }
  ]
  if (features.tonalFrames === 0 || activeSec < 0.03) {
    return {
      tonic: null,
      mode: null,
      confidence: 0,
      diagnostics: { evidence: [{ name: 'analyzerReason', value: 'no tonal content' }, ...evidence] }
    }
  }
  const pitchEst = estimatePitchClass(samples, sampleRate, region)
  const pitch = pitchEst
    ? { pc: PITCH_CLASSES.indexOf(pitchEst.tonic as (typeof PITCH_CLASSES)[number]), confidence: pitchEst.confidence }
    : null
  if (pitchEst) evidence.push({ name: `pitch:${pitchEst.tonic}`, value: round3(pitchEst.clarity), confidence: round3(pitchEst.confidence) })

  const P = keyProbabilities({ features, pitch, activeSec })
  let bestT = 0
  let bestTP = -1
  for (let t = 0; t < 12; t++) {
    const pt = P[t] + P[12 + t]
    if (pt > bestTP) {
      bestTP = pt
      bestT = t
    }
  }
  const pMaj = P[bestT]
  const pMin = P[12 + bestT]
  const modeShare = Math.max(pMaj, pMin) / Math.max(1e-9, bestTP)
  // Phrases almost always carry a third somewhere (and the classifier's mode is
  // reliable there); the no-third rule matters for hits — single notes, 808s, power
  // chords — which have a root but no major/minor quality.
  const short = shortness(activeSec, features.variety) > 0.5
  const third = !short || hasThird(features, bestT)
  const mode: KeyMode | null = third && modeShare >= MODE_MIN_SHARE ? (pMin > pMaj ? 'minor' : 'major') : null
  const confidence = mode ? Math.max(pMaj, pMin) : bestTP

  const order = Array.from({ length: 24 }, (_, k) => k).sort((a, b) => P[b] - P[a])
  const candidates: KeyCandidateOut[] = order.slice(0, 4).map((k) => ({
    tonic: PITCH_CLASSES[k % 12],
    mode: k >= 12 ? 'minor' : 'major',
    p: round3(P[k])
  }))
  for (const c of candidates) evidence.push({ name: `key:${c.tonic}:${c.mode}`, value: c.p, confidence: c.p })
  evidence.push(
    { name: 'shortness', value: round3(shortness(activeSec, features.variety)) },
    { name: 'variety', value: features.variety },
    { name: 'hasThird', value: third }
  )

  const threshold = keyThreshold(!!opts.isDrum, opts.subtype)
  const accepted = confidence >= threshold
  return {
    tonic: accepted ? PITCH_CLASSES[bestT] : null,
    mode: accepted ? mode : null,
    confidence: round3(confidence),
    candidates,
    diagnostics: {
      evidence: [{ name: 'analyzerReason', value: accepted ? 'key-model' : 'below-threshold', confidence: round3(confidence) }, ...evidence],
      detector: {
        outcome: accepted ? 'accepted' : 'rejected',
        reason: accepted ? 'key model probability met threshold' : 'key model probability below threshold',
        confidence: round3(confidence),
        threshold
      }
    }
  }
}
