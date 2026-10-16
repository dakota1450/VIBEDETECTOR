#!/usr/bin/env node
// Fully held-out, end-to-end accuracy: for each of 5 pack folds, train the key and
// tempo models WITHOUT that fold, drop them into a copy of src/shared, and run the
// real analysis pipeline (the exact code the app ships) on that fold's files only.
// Every number in the merged report is therefore measured on sample packs the models
// never saw — the honest estimate of accuracy on a library you bring. (The tempo
// presence gate is not retrained per fold; it only decides whether a tempo is shown.)
// Keep --out OUTSIDE the repo so the generated entries resolve their fold's models.
//
//   node scripts/eval/holdout-eval.mjs --manifest manifest.json \
//     --key-dump keyfeat.jsonl --tempo-dump tempo.jsonl --tempo-names names.json \
//     --out runs/holdout [--python python3] [--workers 14]

import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { report } from './metrics.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const arg = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}

const manifest = resolve(arg('manifest'))
const keyDump = resolve(arg('key-dump'))
const tempoDump = resolve(arg('tempo-dump'))
const tempoNames = resolve(arg('tempo-names'))
const outDir = resolve(arg('out', 'holdout'))
const python = arg('python', 'python3')
const workers = arg('workers', '14')
const blocks = arg('blocks', 'treble,bass,salience,bassNote,opening,closing,pitch,chordMajor,chordMinor,firstBeat')
mkdirSync(outDir, { recursive: true })

const rows = []
for (let k = 0; k < 5; k++) {
  const shared = join(outDir, `shared-${k}`)
  cpSync(join(root, 'src/shared'), shared, { recursive: true })
  const env = { ...process.env, MKL_NUM_THREADS: '8', OMP_NUM_THREADS: '8' }
  console.log(`fold ${k}: training models without it…`)
  execFileSync(python, [join(here, 'train_key.py'), keyDump, '--blocks', blocks, '--lam', '1e-3', '--holdout', String(k), '--export', join(shared, 'keyModel.ts')], { stdio: 'inherit', env })
  execFileSync(python, [join(here, 'train_tempo.py'), tempoDump, '--names', tempoNames, '--holdout', String(k), '--export', join(shared, 'tempoModel.ts')], { stdio: ['ignore', 'ignore', 'inherit'], env })
  // The entry must import the fold's copy by RELATIVE path: inside the repo, the bundler
  // resolves "@shared/*" through tsconfig paths (→ src/shared), ignoring any alias.
  const entry = join(outDir, `entry-${k}.ts`)
  writeFileSync(entry, readFileSync(join(here, 'entry.ts'), 'utf8').replaceAll("'@shared/", `'./shared-${k}/`))
  const out = join(outDir, `fold-${k}.jsonl`)
  console.log(`fold ${k}: evaluating the shipping pipeline on its packs…`)
  execFileSync(process.execPath, [join(here, 'run-eval.mjs'), '--manifest', manifest, '--fold', String(k), '--entry', entry, '--out', out, '--workers', workers], { stdio: ['ignore', 'ignore', 'inherit'] })
  for (const line of readFileSync(out, 'utf8').split('\n')) if (line.trim()) rows.push(JSON.parse(line))
}
const text = report(rows)
writeFileSync(join(outDir, 'holdout.report.txt'), text)
console.log(`\nHELD-OUT (5 pack folds, ${rows.length} files)\n${text}`)
