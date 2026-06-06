import { promises as fs } from 'fs'
import { dirname, resolve } from 'path'
import type {
  AnalysisResult,
  DetectionSource,
  KeyDecisionDiagnostics,
  KeyDecisionSnapshot,
  DrumSubtype,
  KeyMode,
  MelodicSubtype,
  Sound,
  SoundOverride,
  SoundType,
  Subtype,
  Source
} from '@shared/types'
import { normalizeTonic } from '@shared/keyColors'

/** Detection-only fields produced by the scanner; merged into a Sound by the store. */
export interface DetectedRecord {
  path: string
  filename: string
  folder: string
  sourceId: number
  size: number
  mtimeMs: number
  durationSec: number | null
  sampleRate: number | null
  channels: number | null
  format: string | null
  keyTonic: string | null
  keyMode: KeyMode | null
  keyConfidence: number
  keySource: DetectionSource | null
  bpm: number | null
  bpmConfidence: number
  bpmSource: DetectionSource | null
  type: SoundType
  subtype: Subtype | null
  typeSource: DetectionSource | null
}

interface Persisted {
  version: number
  nextSourceId: number
  nextSoundId: number
  sources: Source[]
  sounds: Sound[]
}

const CURRENT_ANALYSIS_VERSION = 7
const CURRENT_WAVEFORM_VERSION = 1
const MAX_TAG_LENGTH = 48
const MAX_TAGS_PER_SOUND = 64
const MAX_NOTES_LENGTH = 5000

const SOUND_TYPES = new Set<SoundType>(['drum', 'melodic', 'unknown'])
const KEY_MODES = new Set<KeyMode>(['major', 'minor'])
const DRUM_SUBTYPES = new Set<DrumSubtype>([
  'kick',
  'snare',
  'clap',
  'hihat',
  'openhat',
  'cymbal',
  'tom',
  'perc',
  '808',
  'fx',
  'other'
])
const MELODIC_SUBTYPES = new Set<MelodicSubtype>([
  'loop',
  'one_shot',
  'stab',
  'chord',
  'pad',
  'lead',
  'pluck',
  'bass',
  'keys',
  'piano',
  'guitar',
  'synth',
  'strings',
  'brass',
  'winds',
  'mallet',
  'vocal',
  'arp',
  'fx'
])
const SUBTYPES = new Set<Subtype>([...DRUM_SUBTYPES, ...MELODIC_SUBTYPES])

function isSoundType(value: unknown): value is SoundType {
  return typeof value === 'string' && SOUND_TYPES.has(value as SoundType)
}

function isKeyMode(value: unknown): value is KeyMode {
  return typeof value === 'string' && KEY_MODES.has(value as KeyMode)
}

function cleanSubtype(value: unknown): Subtype | null {
  return typeof value === 'string' && SUBTYPES.has(value as Subtype) ? (value as Subtype) : null
}

function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    if (typeof raw !== 'string') continue
    const tag = raw.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length >= MAX_TAGS_PER_SOUND) break
  }
  return out
}

function cleanNotes(notes: unknown): string | null {
  if (typeof notes !== 'string') return null
  const trimmed = notes.trim()
  return trimmed ? trimmed.slice(0, MAX_NOTES_LENGTH) : null
}

export function needsAudioKey(s: Sound): boolean {
  if (s.keySource === 'manual') return false
  if (!s.keyTonic) return true
  if (s.keySource === 'analysis') return true
  if (s.type === 'drum' || s.type === 'unknown') return true
  if (s.keySource === 'filename') return s.keyConfidence < 0.85
  if (s.keySource === 'metadata') return s.keyConfidence < 0.9
  return s.keyConfidence < 0.55
}

export function needsAudioBpm(s: Sound): boolean {
  return s.bpm == null && s.bpmSource !== 'manual' && s.type !== 'drum'
}

export function needsAudioClassification(s: Sound): boolean {
  if (s.typeSource === 'manual') return false
  return s.type === 'unknown' || s.type === 'drum'
}

export function needsWaveformPeaks(s: Sound): boolean {
  return s.waveformVersion !== CURRENT_WAVEFORM_VERSION || !Array.isArray(s.waveformPeaks) || s.waveformPeaks.length < 16
}

function computeNeedsAnalysis(s: Sound): boolean {
  if (s.analysisError) return false
  if (needsWaveformPeaks(s)) return true
  if (s.analyzedAt && s.analysisVersion === CURRENT_ANALYSIS_VERSION) return false
  // Keep audio analysis for gaps and risky labels instead of decoding every
  // already-confident sample on each algorithm version.
  return needsAudioKey(s) || needsAudioBpm(s) || needsAudioClassification(s)
}

function keySnapshot(s: Sound): KeyDecisionSnapshot {
  return {
    tonic: s.keyTonic,
    mode: s.keyMode,
    confidence: s.keyConfidence,
    source: s.keySource
  }
}

function resultKeySnapshot(key: NonNullable<AnalysisResult['key']>): KeyDecisionSnapshot {
  return {
    tonic: key.tonic,
    mode: key.mode,
    confidence: key.confidence,
    source: 'analysis'
  }
}

function withKeyDecision(
  diagnostics: KeyDecisionDiagnostics | undefined,
  decision: KeyDecisionDiagnostics['decision']
): KeyDecisionDiagnostics {
  return {
    ...diagnostics,
    decision
  }
}

function applyClassification(
  s: Sound,
  cls: { type: SoundType; subtype: Subtype | null; confidence: number }
): void {
  // Drum <-> melodic disagreement: a producer's explicit type label (a kick/snare/
  // brass/bass keyword, or a "drum loop" folder) is reliable and is kept — validated
  // against a well-labeled library, audio type classification is only ~80% and makes
  // confident errors, so it must not overrule a real label. Audio decides the type
  // only when the filename gave us nothing (Unknown); on everything else its job is
  // the KEY, not the type.
  if (cls.type !== s.type) {
    if (s.type === 'unknown' && cls.confidence >= 0.5) {
      s.type = cls.type
      s.subtype = cls.subtype
      s.typeSource = 'analysis'
    }
    return
  }
  // Same type, drum: fill a generic subtype (other/none) with the audio-detected one;
  // keep specific filename subtypes (snare/hat/...) as-is.
  if (s.type !== 'drum') return
  const subtypeWeak = !s.subtype || s.subtype === 'other'
  if (subtypeWeak && cls.subtype && cls.confidence >= 0.5) {
    s.subtype = cls.subtype
    s.typeSource = 'analysis'
  }
}

/**
 * Local library index. Pure-JS JSON-backed store (atomic, debounced writes) behind
 * a small repository surface so a SQLite backend could replace it without touching
 * callers. Preserves user data (favorites, tags, manual overrides, prior audio
 * analysis) across rescans.
 */
export class Store {
  private data: Persisted = { version: 1, nextSourceId: 1, nextSoundId: 1, sources: [], sounds: [] }
  private byPath = new Map<string, Sound>()
  private byId = new Map<number, Sound>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as Partial<Persisted>
      this.data = {
        version: typeof parsed.version === 'number' ? parsed.version : 1,
        nextSourceId: Number.isInteger(parsed.nextSourceId) && (parsed.nextSourceId ?? 0) > 0 ? parsed.nextSourceId! : 1,
        nextSoundId: Number.isInteger(parsed.nextSoundId) && (parsed.nextSoundId ?? 0) > 0 ? parsed.nextSoundId! : 1,
        sources: Array.isArray(parsed.sources) ? parsed.sources : [],
        sounds: Array.isArray(parsed.sounds) ? parsed.sounds : []
      }
    } catch {
      // first run — no file yet
    }
    this.reindex()
  }

  private reindex(): void {
    this.byPath.clear()
    this.byId.clear()
    let migrated = false
    let maxSourceId = 0
    let maxSoundId = 0
    for (const source of this.data.sources) {
      maxSourceId = Math.max(maxSourceId, source.id)
      const normalized = resolve(source.path)
      if (source.path !== normalized) {
        source.path = normalized
        migrated = true
      }
    }
    for (const s of this.data.sounds) {
      maxSoundId = Math.max(maxSoundId, s.id)
      if (s.analysisVersion === undefined) {
        s.analysisVersion = null
        migrated = true
      }
      if (s.analysisError === undefined) {
        s.analysisError = null
        migrated = true
      }
      if (s.waveformVersion === undefined) {
        s.waveformVersion = null
        migrated = true
      }
      if (s.waveformPeaks !== null && s.waveformPeaks !== undefined) {
        if (!Array.isArray(s.waveformPeaks)) {
          s.waveformPeaks = null
          s.waveformVersion = null
          migrated = true
        } else {
          const peaks = s.waveformPeaks.filter((v) => typeof v === 'number' && isFinite(v)).map((v) => Math.max(0, Math.min(1, v)))
          if (peaks.length !== s.waveformPeaks.length || peaks.some((v, i) => v !== s.waveformPeaks![i])) {
            s.waveformPeaks = peaks.length ? peaks : null
            migrated = true
          }
        }
      } else if (s.waveformPeaks === undefined) {
        s.waveformPeaks = null
        migrated = true
      }
      if (!Array.isArray(s.tags)) {
        s.tags = []
        migrated = true
      } else {
        const tags = cleanTags(s.tags)
        if (tags.length !== s.tags.length || tags.some((tag, i) => tag !== s.tags[i])) {
          s.tags = tags
          migrated = true
        }
      }
      if (s.notes != null) {
        const notes = cleanNotes(s.notes)
        if (notes !== s.notes) {
          s.notes = notes
          migrated = true
        }
      }
      const needsAudioAnalysis = computeNeedsAnalysis(s)
      if (s.needsAudioAnalysis !== needsAudioAnalysis) {
        s.needsAudioAnalysis = needsAudioAnalysis
        migrated = true
      }
      this.byPath.set(s.path, s)
      this.byId.set(s.id, s)
    }
    if (this.data.nextSourceId <= maxSourceId) {
      this.data.nextSourceId = maxSourceId + 1
      migrated = true
    }
    if (this.data.nextSoundId <= maxSoundId) {
      this.data.nextSoundId = maxSoundId + 1
      migrated = true
    }
    if (migrated) this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flush(), 400)
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    const tmp = `${this.file}.tmp`
    await fs.mkdir(dirname(this.file), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(this.data), 'utf8')
    await fs.rename(tmp, this.file)
  }

  // ---- sources ----
  listSources(): Source[] {
    return this.data.sources.map((s) => ({ ...s, soundCount: this.countForSource(s.id) }))
  }

  private countForSource(id: number): number {
    let n = 0
    for (const s of this.data.sounds) if (s.sourceId === id && !s.missing) n++
    return n
  }

  addSource(path: string, label: string): Source {
    const normalizedPath = resolve(path)
    const existing = this.data.sources.find((s) => s.path === normalizedPath)
    if (existing) return existing
    const src: Source = { id: this.data.nextSourceId++, path: normalizedPath, label: label || normalizedPath, addedAt: Date.now(), soundCount: 0 }
    this.data.sources.push(src)
    this.scheduleSave()
    return src
  }

  removeSource(id: number): void {
    this.data.sources = this.data.sources.filter((s) => s.id !== id)
    this.data.sounds = this.data.sounds.filter((s) => s.sourceId !== id)
    this.reindex()
    this.scheduleSave()
  }

  // ---- sounds ----
  getSounds(): Sound[] {
    return this.data.sounds
  }

  getSound(id: number): Sound | undefined {
    return this.byId.get(id)
  }

  getByPath(path: string): Sound | undefined {
    return this.byPath.get(path)
  }

  pathsForSource(sourceId: number): Set<string> {
    const set = new Set<string>()
    for (const s of this.data.sounds) if (s.sourceId === sourceId) set.add(s.path)
    return set
  }

  upsert(rec: DetectedRecord): Sound {
    const existing = this.byPath.get(rec.path)
    if (!existing) {
      const sound: Sound = {
        id: this.data.nextSoundId++,
        sourceId: rec.sourceId,
        path: rec.path,
        filename: rec.filename,
        folder: rec.folder,
        size: rec.size,
        mtimeMs: rec.mtimeMs,
        durationSec: rec.durationSec,
        sampleRate: rec.sampleRate,
        channels: rec.channels,
        format: rec.format,
        keyTonic: rec.keyTonic,
        keyMode: rec.keyMode,
        keyConfidence: rec.keyConfidence,
        keySource: rec.keySource,
        keyDiagnostics: null,
        bpm: rec.bpm,
        bpmConfidence: rec.bpmConfidence,
        bpmSource: rec.bpmSource,
        type: rec.type,
        subtype: rec.subtype,
        typeSource: rec.typeSource,
        isFavorite: false,
        tags: [],
        notes: null,
        analyzedAt: null,
        analysisVersion: null,
        analysisError: null,
        waveformPeaks: null,
        waveformVersion: null,
        needsAudioAnalysis: false,
        missing: false
      }
      sound.needsAudioAnalysis = computeNeedsAnalysis(sound)
      this.data.sounds.push(sound)
      this.byPath.set(sound.path, sound)
      this.byId.set(sound.id, sound)
      this.scheduleSave()
      return sound
    }

    const unchanged = existing.mtimeMs === rec.mtimeMs && existing.size === rec.size
    existing.sourceId = rec.sourceId
    existing.filename = rec.filename
    existing.folder = rec.folder
    existing.size = rec.size
    existing.mtimeMs = rec.mtimeMs
    existing.durationSec = rec.durationSec
    existing.sampleRate = rec.sampleRate
    existing.channels = rec.channels
    existing.format = rec.format
    existing.missing = false

    if (!unchanged) {
      existing.analyzedAt = null
      existing.analysisVersion = null
      existing.analysisError = null
      existing.waveformPeaks = null
      existing.waveformVersion = null
    }

    if (existing.keySource !== 'manual') {
      const keepAnalysis = unchanged && existing.keySource === 'analysis' && !!existing.keyTonic
      if (!keepAnalysis) {
        existing.keyTonic = rec.keyTonic
        existing.keyMode = rec.keyMode
        existing.keyConfidence = rec.keyConfidence
        existing.keySource = rec.keySource
        existing.keyDiagnostics = null
      }
    }
    if (existing.bpmSource !== 'manual') {
      const keepAnalysis = unchanged && existing.bpmSource === 'analysis' && existing.bpm != null
      if (!keepAnalysis) {
        existing.bpm = rec.bpm
        existing.bpmConfidence = rec.bpmConfidence
        existing.bpmSource = rec.bpmSource
      }
    }
    if (existing.typeSource !== 'manual') {
      const keepAnalysis = unchanged && existing.typeSource === 'analysis'
      if (!keepAnalysis) {
        existing.type = rec.type
        existing.subtype = rec.subtype
        existing.typeSource = rec.typeSource
      }
    }
    existing.needsAudioAnalysis = computeNeedsAnalysis(existing)
    this.scheduleSave()
    return existing
  }

  setFavorite(id: number, favorite: boolean): Sound | null {
    const s = this.byId.get(id)
    if (s) {
      s.isFavorite = !!favorite
      this.scheduleSave()
      return s
    }
    return null
  }

  setTags(id: number, tags: string[]): Sound | null {
    const s = this.byId.get(id)
    if (s) {
      s.tags = cleanTags(tags)
      this.scheduleSave()
      return s
    }
    return null
  }

  applyOverride(id: number, patch: SoundOverride): Sound | null {
    const s = this.byId.get(id)
    if (!s) return null
    if ('keyTonic' in patch || 'keyMode' in patch) {
      s.keyTonic = patch.keyTonic ? normalizeTonic(patch.keyTonic) : null
      s.keyMode = s.keyTonic && isKeyMode(patch.keyMode) ? patch.keyMode : null
      s.keyConfidence = 1
      s.keySource = 'manual'
      s.keyDiagnostics = null
    }
    if ('bpm' in patch) {
      const bpm = patch.bpm
      if (typeof bpm === 'number' && isFinite(bpm)) {
        s.bpm = Math.max(40, Math.min(300, Math.round(bpm)))
        s.bpmConfidence = 1
      } else {
        s.bpm = null
        s.bpmConfidence = 0
      }
      s.bpmSource = 'manual'
    }
    if (isSoundType(patch.type)) {
      s.type = patch.type
      s.subtype = cleanSubtype(patch.subtype)
      s.typeSource = 'manual'
    } else if ('subtype' in patch) {
      s.subtype = cleanSubtype(patch.subtype)
      s.typeSource = 'manual'
    }
    if ('notes' in patch) s.notes = cleanNotes(patch.notes)
    if (patch.retryAnalysis) {
      s.analysisError = null
      s.analyzedAt = null
      s.analysisVersion = null
    }
    s.needsAudioAnalysis = computeNeedsAnalysis(s)
    this.scheduleSave()
    return s
  }

  saveAnalysis(results: AnalysisResult[]): void {
    for (const r of results) {
      const s = this.byId.get(r.id)
      if (!s) continue
      if (r.error) s.analysisError = r.error
      else s.analysisError = null
      if (r.key && s.keySource !== 'manual') {
        const previous = keySnapshot(s)
        const candidate = resultKeySnapshot(r.key)
        let keyDecision: KeyDecisionDiagnostics['decision'] | null = null
        if (r.key.tonic) {
          const sameTonic = s.keyTonic === r.key.tonic
          const compatibleMode = r.key.mode == null || s.keyMode == null || s.keyMode === r.key.mode
          const weakFilenameKey = s.keySource === 'filename' && s.keyConfidence < 0.75
          const audioCanCorrectDrumKey = s.type === 'drum' && !sameTonic && r.key.confidence >= 0.52
          const audioCanRefreshAnalysis = s.keySource === 'analysis' && r.key.confidence >= s.keyConfidence + 0.03
          const analysisIsStronger = r.key.confidence >= Math.max(0.55, s.keyConfidence + 0.1)
          if (!s.keyTonic || audioCanCorrectDrumKey || audioCanRefreshAnalysis || (weakFilenameKey && analysisIsStronger)) {
            s.keyTonic = r.key.tonic
            s.keyMode = r.key.mode
            s.keyConfidence = r.key.confidence
            s.keySource = 'analysis'
            keyDecision = {
              outcome: previous.tonic ? 'updated' : 'accepted',
              reason: !previous.tonic
                ? 'filled missing key from audio analysis'
                : audioCanCorrectDrumKey
                  ? 'audio corrected drum key'
                  : audioCanRefreshAnalysis
                    ? 'new audio analysis improved prior analysis confidence'
                    : 'audio analysis was stronger than weak filename key',
              candidate,
              previous
            }
          } else if (sameTonic && compatibleMode && (r.key.confidence > s.keyConfidence || (s.keyMode == null && r.key.mode != null))) {
            if (s.keyMode == null && r.key.mode != null) s.keyMode = r.key.mode
            s.keyConfidence = Math.max(s.keyConfidence, r.key.confidence)
            if (s.type === 'drum') s.keySource = 'analysis'
            keyDecision = {
              outcome: 'updated',
              reason: 'audio matched existing key and improved confidence or mode detail',
              candidate,
              previous
            }
          } else {
            keyDecision = {
              outcome: 'rejected',
              reason: sameTonic
                ? compatibleMode
                  ? 'audio matched existing key but did not improve confidence'
                  : 'audio mode conflicted with existing key mode'
                : 'existing filename or metadata key was stronger than audio analysis',
              candidate,
              previous
            }
          }
        } else if (s.keySource === 'analysis') {
          s.keyTonic = null
          s.keyMode = null
          s.keyConfidence = 0
          s.keySource = null
          keyDecision = {
            outcome: 'cleared',
            reason: 'upgraded analyzer rejected the previous analysis key',
            candidate,
            previous
          }
        } else {
          keyDecision = {
            outcome: 'rejected',
            reason: 'audio analysis did not find a reliable key and existing key was not analysis-sourced',
            candidate,
            previous
          }
        }
        if (keyDecision) s.keyDiagnostics = withKeyDecision(r.key.diagnostics, keyDecision)
      }
      if (r.bpm && r.bpm.value != null && s.bpm == null && s.bpmSource !== 'manual') {
        s.bpm = r.bpm.value
        s.bpmConfidence = r.bpm.confidence
        s.bpmSource = 'analysis'
      }
      if (r.cls && s.typeSource !== 'manual') applyClassification(s, r.cls)
      if (r.peaks && r.peaks.version === CURRENT_WAVEFORM_VERSION && Array.isArray(r.peaks.values)) {
        const peaks = r.peaks.values.filter((v) => typeof v === 'number' && isFinite(v)).map((v) => Math.max(0, Math.min(1, v)))
        if (peaks.length >= 16) {
          s.waveformPeaks = peaks
          s.waveformVersion = r.peaks.version
        }
      }
      s.analyzedAt = Date.now()
      s.analysisVersion = CURRENT_ANALYSIS_VERSION
      s.needsAudioAnalysis = false
    }
    this.scheduleSave()
  }

  getAnalysisQueue(): Sound[] {
    return this.data.sounds.filter((s) => s.needsAudioAnalysis && !s.missing)
  }

  /** Mark sounds under a source whose paths are no longer present as missing. */
  reconcile(sourceId: number, seen: Set<string>): number {
    let missing = 0
    for (const s of this.data.sounds) {
      if (s.sourceId === sourceId && !seen.has(s.path)) {
        if (!s.missing) {
          s.missing = true
          missing++
        }
      }
    }
    if (missing) this.scheduleSave()
    return missing
  }

  markMissing(path: string): void {
    const s = this.byPath.get(path)
    if (s && !s.missing) {
      s.missing = true
      this.scheduleSave()
    }
  }
}
