#!/usr/bin/env node
// Build a labeled evaluation manifest from a local Splice library database.
//
// Splice keeps producer-assigned metadata (key, chord type, BPM, loop/one-shot) for
// every downloaded sample in a SQLite file. That is far cleaner ground truth than
// parsing filenames, so it is the preferred source for tuning the detectors.
//
//   node scripts/eval/dataset-from-splice.mjs --db "<path>/sounds.db" --out manifest.json
//
// The default DB location is ~/Library/Application Support/com.splice.Splice/users/
// default/<user>/sounds.db (the first user directory found is used).

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

function defaultDb() {
  const base = join(homedir(), 'Library/Application Support/com.splice.Splice/users/default')
  if (!existsSync(base)) return null
  for (const user of readdirSync(base)) {
    const db = join(base, user, 'sounds.db')
    if (existsSync(db)) return db
  }
  return null
}

const TONICS = { c: 'C', 'c#': 'C#', d: 'D', 'd#': 'D#', e: 'E', f: 'F', 'f#': 'F#', g: 'G', 'g#': 'G#', a: 'A', 'a#': 'A#', b: 'B' }

const db = arg('db', defaultDb())
const out = arg('out', 'manifest.json')
if (!db || !existsSync(db)) {
  console.error('Splice sounds.db not found; pass --db <path>')
  process.exit(1)
}

const sqlite = existsSync('/usr/bin/sqlite3') ? '/usr/bin/sqlite3' : 'sqlite3'
const rows = JSON.parse(
  execFileSync(
    sqlite,
    [
      '-json',
      db,
      "select local_path, audio_key, chord_type, bpm, duration, sample_type, tags, pack_uuid from samples where local_path is not null and local_path != ''"
    ],
    { maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' }
  ) || '[]'
)

const items = []
let missing = 0
for (const r of rows) {
  if (!existsSync(r.local_path)) {
    missing++
    continue
  }
  const tonic = TONICS[String(r.audio_key || '').trim().toLowerCase()] ?? null
  const ct = String(r.chord_type || '').toLowerCase()
  const mode = ct.startsWith('maj') ? 'major' : ct.startsWith('min') ? 'minor' : null
  items.push({
    path: r.local_path,
    kind: r.sample_type === 'loop' ? 'loop' : 'oneshot',
    bpm: Number(r.bpm) > 0 ? Number(r.bpm) : null,
    tonic,
    mode: tonic ? mode : null,
    durationMs: Number(r.duration) || null,
    pack: r.pack_uuid || null,
    tags: String(r.tags || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  })
}

writeFileSync(out, JSON.stringify(items))
const loops = items.filter((i) => i.kind === 'loop')
console.log(
  `${items.length} samples (${missing} missing on disk) → ${out}\n` +
    `  loops ${loops.length} (bpm ${loops.filter((i) => i.bpm).length}, key ${loops.filter((i) => i.tonic).length})\n` +
    `  one-shots ${items.length - loops.length} (key ${items.filter((i) => i.kind === 'oneshot' && i.tonic).length})`
)
