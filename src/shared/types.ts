// Shared domain types used across main, preload, and renderer.

export type KeyMode = 'major' | 'minor'
export type DetectionSource = 'filename' | 'metadata' | 'analysis' | 'manual'
export type SoundType = 'drum' | 'melodic' | 'unknown'

export type DrumSubtype =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'hihat'
  | 'openhat'
  | 'cymbal'
  | 'tom'
  | 'perc'
  | '808'
  | 'fx'
  | 'other'

export type MelodicSubtype =
  | 'loop'
  | 'one_shot'
  | 'stab'
  | 'chord'
  | 'pad'
  | 'lead'
  | 'pluck'
  | 'bass'
  | 'keys'
  | 'piano'
  | 'guitar'
  | 'synth'
  | 'strings'
  | 'brass'
  | 'winds'
  | 'mallet'
  | 'vocal'
  | 'arp'
  | 'fx'

export type Subtype = DrumSubtype | MelodicSubtype

export interface DetectedKey {
  tonic: string | null // canonical sharp spelling: 'C','C#',...,'B'
  mode: KeyMode | null
  confidence: number // 0..1
  source: DetectionSource | null
  diagnostics?: KeyDecisionDiagnostics
}

export interface KeyDecisionSnapshot {
  tonic: string | null
  mode: KeyMode | null
  confidence: number
  source: DetectionSource | null
}

export interface KeyEvidenceItem {
  name: string
  value: number | string | boolean | null
  confidence?: number
}

export interface KeyDetectorDiagnostics {
  outcome: 'accepted' | 'rejected'
  reason: string
  confidence: number
  threshold?: number
  evidence?: KeyEvidenceItem[]
}

export interface KeyStoreDecisionDiagnostics {
  outcome: 'accepted' | 'rejected' | 'updated' | 'cleared' | 'unchanged'
  reason: string
  candidate: KeyDecisionSnapshot
  previous: KeyDecisionSnapshot
}

export interface KeyDecisionDiagnostics {
  detector?: KeyDetectorDiagnostics
  decision?: KeyStoreDecisionDiagnostics
  evidence?: KeyEvidenceItem[]
}

export interface DetectedTempo {
  bpm: number | null
  confidence: number // 0..1
  source: DetectionSource | null
}

export interface Classification {
  type: SoundType
  subtype: Subtype | null
}

export interface Sound {
  id: number
  sourceId: number
  path: string
  filename: string
  folder: string
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
  keyDiagnostics?: KeyDecisionDiagnostics | null

  bpm: number | null
  bpmConfidence: number
  bpmSource: DetectionSource | null

  type: SoundType
  subtype: Subtype | null
  typeSource: DetectionSource | null

  isFavorite: boolean
  tags: string[]
  notes: string | null

  analyzedAt: number | null
  analysisVersion: number | null
  analysisError?: string | null
  // Per-capability algorithm versions. Each detection step (key, tempo, type,
  // waveform) tracks the version it was last *processed* at, so a future update can
  // re-run only the step that changed — on only the sounds that benefit — instead of
  // dragging the whole library back through every analyzer. Absent (legacy) = 0.
  keyVersion?: number | null
  bpmVersion?: number | null
  typeVersion?: number | null
  // Pipeline version at which a decode/analysis error was last recorded; lets a
  // failed file retry automatically when the pipeline advances, but not every launch.
  errorVersion?: number | null
  waveformPeaks?: number[] | null
  waveformVersion?: number | null
  needsAudioAnalysis: boolean
  missing: boolean
}

export interface Source {
  id: number
  path: string
  label: string
  addedAt: number
  soundCount: number
}

export type ScanPhase = 'idle' | 'scanning' | 'analyzing' | 'done'

export interface ScanProgress {
  phase: ScanPhase
  found: number
  processed: number
  total: number
  analyzing: number // remaining audio-analysis jobs
  analyzeTotal: number // jobs in the current analysis batch (for a determinate bar)
  currentFile: string | null
}

export interface LibraryFilter {
  search: string
  type: 'all' | 'melodic' | 'drum'
  subtypes: Subtype[]
  keys: { tonic: string; mode: KeyMode }[]
  matchKeyAnyMode: boolean
  keyStatus: 'all' | 'unknown' | 'low' | 'verified'
  reviewStatus: 'all' | 'needs_review' | 'analysis_failed'
  bpmMin: number | null
  bpmMax: number | null
  halfDoubleTime: boolean
  favoritesOnly: boolean
  sourceIds: number[]
  hasTempoOnly: boolean
  sort: 'name' | 'key' | 'bpm' | 'duration' | 'added'
  sortDir: 'asc' | 'desc'
}

export interface SoundOverride {
  keyTonic?: string | null
  keyMode?: KeyMode | null
  bpm?: number | null
  type?: SoundType
  subtype?: Subtype | null
  notes?: string | null
  retryAnalysis?: boolean
}

export interface AnalysisResult {
  id: number
  key?: { tonic: string | null; mode: KeyMode | null; confidence: number; diagnostics?: KeyDecisionDiagnostics }
  bpm?: { value: number | null; confidence: number }
  cls?: { type: SoundType; subtype: Subtype | null; confidence: number }
  peaks?: { values: number[]; version: number }
  error?: string
}

export interface AnalysisJob {
  id: number
  url: string
  needsKey: boolean
  needsBpm: boolean
  classifyDrum: boolean
  needsPeaks?: boolean
  // The sound's current type is a drum, so the worker should attempt a key even on
  // low-confidence/percussive material (and save it flagged) rather than veto it.
  isDrum?: boolean
}

// The API surface exposed to the renderer via the preload contextBridge.
export interface VibeApi {
  listSources(): Promise<Source[]>
  addSources(): Promise<{ added: number }>
  removeSource(id: number): Promise<void>
  rescan(): Promise<void>
  getSounds(): Promise<Sound[]>
  setFavorite(id: number, favorite: boolean): Promise<Sound | null>
  setOverride(id: number, patch: SoundOverride): Promise<Sound | null>
  setTags(id: number, tags: string[]): Promise<Sound | null>
  revealInFinder(path: string): Promise<boolean>
  startDrag(paths: string[]): void
  getAnalysisQueue(): Promise<AnalysisJob[]>
  saveAnalysis(results: AnalysisResult[]): Promise<void>
  fileUrl(path: string): string
  onScanProgress(cb: (p: ScanProgress) => void): () => void
  onSoundsChanged(cb: () => void): () => void
}
