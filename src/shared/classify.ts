import type { Classification, DrumSubtype, MelodicSubtype } from './types'

// Token guards: not preceded/followed by a letter (so digits and separators are fine,
// e.g. "808s", "kick01", but "kickdrum" won't match "kick").
const G = (alts: string): RegExp => new RegExp(`(?<![a-z])(?:${alts})(?![a-z])`)

// Ordered: more specific buckets first (open hat before hi-hat, etc.).
const DRUM_PATTERNS: [DrumSubtype, RegExp][] = [
  ['kick', G('kicks?|kik|bd|bass\\s?drums?')],
  ['snare', G('snares?|snr|rimshot|rim\\s?shots?')],
  ['clap', G('claps?|snaps?|finger\\s?snaps?')],
  ['openhat', G('open\\s?hats?|openhats?|open\\s?hi\\s?hats?|ohh')],
  ['hihat', G('closed\\s?hats?|hi\\s?hats?|hihats?|hats?|hh|chh')],
  ['cymbal', G('cymbals?|crash(?:es)?|rides?|splash(?:es)?')],
  ['tom', G('toms?|floor\\s?toms?')],
  ['808', G('808s?|sub\\s?bass(?:es)?|subbass')],
  ['perc', G('percs?|percussions?|congas?|bongos?|shakers?|tambourines?|tamb|cowbells?|woodblocks?|claves?|triangles?|rim')],
  ['fx', G('fx|sfx|risers?|sweeps?|downlifters?|uplifters?|impacts?|whoosh(?:es)?|foley|noise|texture|drone|ambien(?:ce|t)|atmos')]
]

// Specific roles and instruments first; generic loop/fx labels last.
const MELODIC_PATTERNS: [MelodicSubtype, RegExp][] = [
  ['stab', G('stabs?')],
  ['one_shot', G('one\\s?shots?|1\\s?shots?|oneshots?|single\\s?notes?|single\\s?hits?')],
  ['chord', G('chords?|progs?|progressions?')],
  ['arp', G('arps?|arpeggios?')],
  ['pad', G('pads?')],
  ['pluck', G('plucks?')],
  ['lead', G('leads?|melod(?:y|ic|ies)')],
  ['bass', G('bass(?:line)?s?|reese|subs?')],
  ['vocal', G('vox|vocals?|acapellas?|acap|adlibs?|ad\\s?libs?|choir|chops?')],
  ['guitar', G('guitars?|gtrs?|electric\\s?guitars?|acoustic\\s?guitars?|nylon|strats?|teles?')],
  ['piano', G('pianos?|e\\s?pianos?|electric\\s?pianos?|rhodes|wurli|clavs?')],
  ['synth', G('synths?|saws?|supersaws?|serum|massive|analog')],
  ['strings', G('strings?|violins?|violas?|cellos?|orchestras?|orchestral')],
  ['brass', G('brass|horns?|trumpets?|trombones?|tubas?')],
  ['winds', G('winds?|woodwinds?|flutes?|sax(?:es|ophones?)?|clarinets?|oboes?')],
  ['mallet', G('bells?|mallets?|vibes?|vibraphones?|marimbas?|xylophones?|glocks?|glockenspiels?')],
  ['keys', G('keys?|organs?|hammonds?')],
  ['loop', G('loops?')],
  ['fx', G('fx|sfx|risers?|sweeps?|downlifters?|uplifters?|drones?|textures?|ambien(?:ce|t)|atmos|impacts?')]
]

// A specific melodic instrument / role keyword — a strong, reliable signal that the
// content is tonal. Deliberately excludes the generic "loop"/"sample" words (those
// match drum loops too), which are handled at lower priority.
const MELODIC_INSTRUMENT = G(
  'melod(?:y|ic|ies)|chords?|progs?|progressions?|pianos?|e\\s?pianos?|keys?|guitars?|gtrs?|synths?|saws?|supersaws?|serum|massive|pads?|bells?|mallets?|vibraphones?|marimbas?|xylophones?|glocks?|glockenspiels?|brass|horns?|trumpets?|trombones?|tubas?|flutes?|winds?|woodwinds?|sax(?:es|ophones?)?|clarinets?|oboes?|strings?|violins?|violas?|cellos?|harps?|organs?|hammonds?|rhodes|wurli|clavs?|arps?|arpeggios?|leads?|plucks?|stabs?|riffs?|choir|vox|vocals?|acapellas?|acap|adlibs?|ad\\s?libs?|chops?|basslines?|bass(?:es)?|reese|subs?'
)

// Generic drum / percussion context (folders like "Drum Loops", "Percussion",
// "Breaks") with no specific kit piece — still unambiguously a drum.
const DRUM_CONTEXT = G(
  'drums?|drum\\s?loops?|drum\\s?hits?|drum\\s?kits?|drum\\s?breaks?|drum\\s?fills?|percussion|percussions?|breakbeats?|breaks?'
)

// Generic "this is a musical clip" words, used only as a last resort before duration.
const MELODIC_GENERIC = G('samples?|loops?|melodies')

function normalize(text: string): string {
  return (
    ' ' +
    text
      .replace(/[_\-./\\()[\]{}+,~!@]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase() +
    ' '
  )
}

function melodicSubtype(hay: string, durationSec: number | null, hasBpm: boolean): MelodicSubtype {
  for (const [sub, re] of MELODIC_PATTERNS) {
    if (re.test(hay)) return sub
  }
  if (hasBpm || (durationSec != null && durationSec >= 2)) return 'loop'
  if (durationSec != null && durationSec <= 0.8) return 'one_shot'
  return 'loop'
}

/**
 * Classify a sound as a drum one-shot or a melodic sample, with a subtype.
 * Combines filename + folder keywords, duration, tempo, and whether a key was detected.
 */
export function classify(input: {
  filename: string
  folder?: string | null
  durationSec?: number | null
  hasMusicalKey?: boolean
  hasBpm?: boolean
}): Classification {
  const hay = normalize(`${input.folder ?? ''} ${input.filename}`)
  const dur = input.durationSec ?? null
  const hasBpm = !!input.hasBpm

  let drum: DrumSubtype | null = null
  for (const [sub, re] of DRUM_PATTERNS) {
    if (re.test(hay)) {
      drum = sub
      break
    }
  }
  const instrument = MELODIC_INSTRUMENT.test(hay)
  const drumContext = DRUM_CONTEXT.test(hay)
  const genericMelodic = MELODIC_GENERIC.test(hay)

  // Priority: specific drum kit piece → specific instrument → generic drum context
  // → generic "loop"/"sample" → explicit key tag → defer to audio.
  if (drum && drum !== 'fx') return { type: 'drum', subtype: drum }
  if (drum === 'fx') {
    if (instrument || genericMelodic) return { type: 'melodic', subtype: melodicSubtype(hay, dur, hasBpm) }
    return { type: 'drum', subtype: 'fx' }
  }
  if (instrument) return { type: 'melodic', subtype: melodicSubtype(hay, dur, hasBpm) }
  // "Drum loop", "percussion", "break" → a drum, even with no kit-piece keyword. Subtype
  // stays generic so the audio classifier can refine the family (kick/hat/...) later.
  if (drumContext) return { type: 'drum', subtype: /(?<![a-z])perc/.test(hay) ? 'perc' : 'other' }
  if (genericMelodic) return { type: 'melodic', subtype: melodicSubtype(hay, dur, hasBpm) }

  // An explicit key tag (accidental / maj-min / Camelot) implies tonal content.
  if (input.hasMusicalKey) return { type: 'melodic', subtype: melodicSubtype(hay, dur, hasBpm) }

  // No naming signal at all. Do NOT guess drum-vs-melodic from duration — that's
  // exactly what mislabels brass stabs and tuned hits. Leave it Unknown and let
  // the audio classifier decide from the actual sound.
  return { type: 'unknown', subtype: null }
}
