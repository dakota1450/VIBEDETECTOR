import { promises as fs } from 'fs'
import { basename, dirname, extname, join, relative } from 'path'
import type { KeyMode, Source } from '@shared/types'
import { detectKeyFromName } from '@shared/keyDetect'
import { detectBpmFromName } from '@shared/bpmDetect'
import { classify } from '@shared/classify'
import { normalizeTonic } from '@shared/keyColors'
import { readMetadata } from './metadata'
import type { DetectedRecord, Store } from './store'

export const AUDIO_EXT = new Set(['.wav', '.aif', '.aiff', '.flac', '.mp3', '.ogg', '.m4a'])

export function isAudioFile(path: string): boolean {
  return AUDIO_EXT.has(extname(path).toLowerCase())
}

export interface ScanCallbacks {
  onFound?: (count: number) => void
  onProcessed?: (processed: number, total: number, file: string) => void
}

const SCAN_CONCURRENCY = 3

async function walk(dir: string, out: string[]): Promise<void> {
  try {
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    )
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) await walk(full, out)
      else if (e.isFile() && AUDIO_EXT.has(extname(e.name).toLowerCase())) out.push(full)
    }
  } catch {
    // unreadable directory — skip
  }
}

export async function listAudioFiles(root: string): Promise<string[]> {
  const out: string[] = []
  await walk(root, out)
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
}

function parseKeyTag(tag: string): { tonic: string; mode: KeyMode | null } | null {
  const m = tag.trim().match(/^([A-Ga-g])([#♯b♭]?)\s*(maj(?:or)?|min(?:or)?|m)?$/i)
  if (m) {
    const acc = m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2]
    const tonic = normalizeTonic(m[1] + acc)
    if (tonic) {
      const md = m[3]
      const mode: KeyMode | null = md ? (/^maj/i.test(md) || md === 'M' ? 'major' : 'minor') : null
      return { tonic, mode }
    }
  }
  const k = detectKeyFromName(tag)
  return k.tonic ? { tonic: k.tonic, mode: k.mode } : null
}

export async function buildRecord(
  path: string,
  sourceId: number,
  sourceRoot: string
): Promise<DetectedRecord | null> {
  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(path)
  } catch {
    return null
  }

  const filename = basename(path)
  const relFolder = relative(sourceRoot, dirname(path))
  const meta = await readMetadata(path)

  // Key: filename first, then embedded metadata tag.
  let key = detectKeyFromName(filename)
  if (!key.tonic && meta.keyTag) {
    const parsed = parseKeyTag(meta.keyTag)
    if (parsed) key = { tonic: parsed.tonic, mode: parsed.mode, confidence: 0.92, source: 'metadata' }
  }

  // Tempo: filename first, then embedded metadata tag.
  let bpm = detectBpmFromName(filename)
  if (bpm.bpm == null && meta.bpmTag != null && meta.bpmTag >= 40 && meta.bpmTag <= 300) {
    bpm = { bpm: Math.round(meta.bpmTag), confidence: 0.9, source: 'metadata' }
  }

  const cls = classify({
    filename,
    folder: relFolder,
    durationSec: meta.durationSec,
    hasMusicalKey: !!key.tonic,
    hasBpm: bpm.bpm != null
  })

  return {
    path,
    filename,
    folder: relFolder || basename(sourceRoot),
    sourceId,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    durationSec: meta.durationSec,
    sampleRate: meta.sampleRate,
    channels: meta.channels,
    format: meta.format,
    keyTonic: key.tonic,
    keyMode: key.mode,
    keyConfidence: key.tonic ? key.confidence : 0,
    keySource: key.tonic ? key.source : null,
    bpm: bpm.bpm,
    bpmConfidence: bpm.bpm != null ? bpm.confidence : 0,
    bpmSource: bpm.bpm != null ? bpm.source : null,
    type: cls.type,
    subtype: cls.subtype,
    typeSource: 'filename'
  }
}

async function pool<T>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<void>): Promise<void> {
  let i = 0
  const n = Math.min(Math.max(1, limit), items.length || 1)
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx], idx)
    }
  })
  await Promise.all(workers)
}

/** Scan one source folder into the store, reporting progress. */
export async function scanSource(store: Store, source: Source, cb: ScanCallbacks = {}): Promise<void> {
  const files = await listAudioFiles(source.path)
  cb.onFound?.(files.length)
  const seen = new Set<string>()
  let processed = 0
  await pool(files, SCAN_CONCURRENCY, async (file) => {
    const rec = await buildRecord(file, source.id, source.path)
    if (rec) {
      store.upsert(rec)
      seen.add(file)
    }
    processed++
    cb.onProcessed?.(processed, files.length, file)
  })
  store.reconcile(source.id, seen)
}

/** Re-process a single file (used by the file watcher). */
export async function scanFile(store: Store, source: Source, file: string): Promise<void> {
  const rec = await buildRecord(file, source.id, source.path)
  if (rec) store.upsert(rec)
}

export interface AggregateCallbacks {
  onTotal?: (total: number) => void
  onProgress?: (processed: number, total: number, file: string) => void
}

/** Scan many sources with aggregate progress reporting. */
export async function scanSources(
  store: Store,
  sources: Source[],
  cb: AggregateCallbacks = {}
): Promise<void> {
  const lists: { source: Source; files: string[] }[] = []
  let total = 0
  for (const s of sources) {
    const files = await listAudioFiles(s.path)
    lists.push({ source: s, files })
    total += files.length
  }
  cb.onTotal?.(total)
  let processed = 0
  for (const { source, files } of lists) {
    await pool(files, SCAN_CONCURRENCY, async (file) => {
      // Incremental: skip files that are already indexed and unchanged (no metadata
      // read, no re-detection) so reopening the app doesn't re-scan everything.
      const existing = store.getByPath(file)
      if (existing && !existing.missing) {
        try {
          const st = await fs.stat(file)
          if (st.mtimeMs === existing.mtimeMs && st.size === existing.size) {
            processed++
            cb.onProgress?.(processed, total, file)
            return
          }
        } catch {
          // fall through to a full rebuild
        }
      }
      const rec = await buildRecord(file, source.id, source.path)
      if (rec) store.upsert(rec)
      processed++
      cb.onProgress?.(processed, total, file)
    })
    store.reconcile(source.id, new Set(files))
  }
}
