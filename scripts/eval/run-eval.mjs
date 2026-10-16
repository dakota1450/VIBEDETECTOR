#!/usr/bin/env node
// Run the audio analyzers over a labeled manifest in parallel and score them.
//
//   node scripts/eval/run-eval.mjs --manifest manifest.json --out preds.jsonl \
//        [--entry scripts/eval/entry.ts] [--workers 14] [--limit 500] [--kind loop|oneshot]
//
// The entry module (TypeScript, bundled on the fly with rolldown) must export
// `evaluate(samples, sampleRate, info)`. The default entry runs the exact analysis
// job the app's worker runs, so these numbers are what ships.

import { mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { rolldown } from 'rolldown'
import { report } from './metrics.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const manifestPath = arg('manifest')
if (!manifestPath) {
  console.error('usage: run-eval.mjs --manifest <manifest.json> [--out preds.jsonl] [--entry file.ts]')
  process.exit(1)
}
const entry = resolve(arg('entry', join(here, 'entry.ts')))
const outPath = resolve(arg('out', 'preds.jsonl'))
const nWorkers = Number(arg('workers', String(Math.max(1, availableParallelism() - 2))))
const limit = Number(arg('limit', '0'))
const kind = arg('kind')
const seedStr = arg('sample-seed')

/** Stable pack → fold assignment (FNV-1a), shared with the Python trainers. */
export function packFold(pack, k = 5) {
  let h = 0x811c9dc5
  for (const b of Buffer.from(String(pack), 'utf8')) {
    h ^= b
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % k
}

let items = JSON.parse(readFileSync(manifestPath, 'utf8'))
const foldArg = arg('fold')
if (foldArg != null) items = items.filter((i) => packFold(i.pack || i.path) === Number(foldArg))
if (kind) items = items.filter((i) => i.kind === kind)
if (arg('labeled') === 'key') items = items.filter((i) => i.tonic)
if (arg('labeled') === 'bpm') items = items.filter((i) => i.bpm)
if (limit > 0) {
  // Deterministic, spread-out subset (not just the first N files of one pack).
  let seed = Number(seedStr ?? 7)
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  items = items
    .map((it) => [rand(), it])
    .sort((a, b) => a[0] - b[0])
    .slice(0, limit)
    .map(([, it]) => it)
}

const bundleDir = join(tmpdir(), 'vibe-eval-bundles')
mkdirSync(bundleDir, { recursive: true })
const bundleFile = join(bundleDir, `${basename(entry).replace(/\.\w+$/, '')}-${process.pid}.mjs`)
const bundle = await rolldown({
  input: entry,
  platform: 'node',
  // Entries may live outside the repo (e.g. a frozen baseline), so pin bare imports to
  // this project's node_modules.
  // (Inside the repo, "@shared/*" resolves through tsconfig paths; the alias serves
  // entries that live elsewhere.)
  resolve: { alias: { '@shared': join(root, 'src/shared'), 'fft.js': join(root, 'node_modules/fft.js') } },
  logLevel: 'warn'
})
await bundle.write({ file: bundleFile, format: 'esm' })
await bundle.close()

mkdirSync(dirname(outPath), { recursive: true })
const out = createWriteStream(outPath)
const results = []
let next = 0
let done = 0
const t0 = Date.now()
let lastLog = 0

await Promise.all(
  Array.from({ length: Math.min(nWorkers, items.length) }, () =>
    new Promise((resolveWorker, rejectWorker) => {
      const w = new Worker(join(here, 'worker.mjs'), { workerData: { bundleFile } })
      const feed = () => {
        if (next >= items.length) {
          void w.terminate()
          resolveWorker()
          return
        }
        const idx = next++
        w.postMessage({ idx, path: items[idx].path, durationMs: items[idx].durationMs })
      }
      w.on('message', (msg) => {
        const item = items[msg.idx]
        const rec = { ...item, durationSec: msg.durationSec ?? null, pred: msg.pred ?? null, error: msg.error ?? null, ms: msg.ms }
        results.push(rec)
        out.write(JSON.stringify(rec) + '\n')
        done++
        const now = Date.now()
        if (now - lastLog > 5000) {
          lastLog = now
          const rate = done / ((now - t0) / 1000)
          process.stderr.write(`  ${done}/${items.length}  ${rate.toFixed(1)}/s  eta ${Math.round((items.length - done) / rate)}s\n`)
        }
        feed()
      })
      w.on('error', rejectWorker)
      w.on('online', feed)
    })
  )
)
out.end()
const secs = (Date.now() - t0) / 1000
const avgMs = results.reduce((a, r) => a + (r.ms || 0), 0) / Math.max(1, results.length)
console.log(`\n${results.length} files in ${secs.toFixed(1)}s (${nWorkers} workers, avg analyze ${avgMs.toFixed(0)} ms/file)`)
console.log(`predictions → ${relative(process.cwd(), outPath) || outPath}\n`)
console.log(report(results))
writeFileSync(outPath.replace(/\.jsonl$/, '') + '.report.txt', report(results))
