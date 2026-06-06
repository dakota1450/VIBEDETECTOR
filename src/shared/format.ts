import type { KeyMode, SoundType, Subtype } from './types'

export function withSymbol(tonic: string | null | undefined): string {
  if (!tonic) return ''
  return tonic.replace(/#/g, '♯').replace(/b/g, '♭')
}

/** Compact key label for badges, e.g. "C♯m", "F", "—". */
export function formatKey(tonic: string | null | undefined, mode: KeyMode | null | undefined): string {
  if (!tonic) return '—'
  const sym = withSymbol(tonic)
  if (mode === 'minor') return `${sym}m`
  return sym
}

/** Long key label, e.g. "C♯ minor". */
export function formatKeyLong(tonic: string | null | undefined, mode: KeyMode | null | undefined): string {
  if (!tonic) return 'Unknown key'
  const sym = withSymbol(tonic)
  if (mode === 'minor') return `${sym} minor`
  if (mode === 'major') return `${sym} major`
  return sym
}

export function formatBpm(bpm: number | null | undefined): string {
  if (bpm == null) return '—'
  return String(Math.round(bpm))
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return '—'
  if (sec < 1) return `${sec.toFixed(2)}s`
  if (sec < 60) return `${sec.toFixed(1)}s`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const SUBTYPE_LABELS: Record<Subtype, string> = {
  // drums
  kick: 'Kick',
  snare: 'Snare',
  clap: 'Clap',
  hihat: 'Hi-Hat',
  openhat: 'Open Hat',
  cymbal: 'Cymbal',
  tom: 'Tom',
  perc: 'Perc',
  '808': '808',
  fx: 'FX',
  other: 'One-Shot',
  // melodic
  loop: 'Loop',
  one_shot: 'One-Shot',
  stab: 'Stab',
  chord: 'Chord',
  pad: 'Pad',
  lead: 'Lead',
  pluck: 'Pluck',
  bass: 'Bass',
  keys: 'Keys',
  piano: 'Piano',
  guitar: 'Guitar',
  synth: 'Synth',
  strings: 'Strings',
  brass: 'Brass',
  winds: 'Winds',
  mallet: 'Mallet',
  vocal: 'Vocal',
  arp: 'Arp'
}

export function subtypeLabel(s: Subtype | null | undefined): string {
  return s ? SUBTYPE_LABELS[s] : ''
}

export function typeLabel(t: SoundType): string {
  if (t === 'drum') return 'Drum'
  if (t === 'melodic') return 'Melodic'
  return 'Unknown'
}
