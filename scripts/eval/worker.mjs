import { readFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import { loadForAnalysis } from './audio-io.mjs'

const mod = await import(pathToFileURL(workerData.bundleFile).href)

parentPort.on('message', ({ idx, path }) => {
  const t = performance.now()
  try {
    const { samples, sampleRate, durationSec } = loadForAnalysis(readFileSync(path))
    const ta = performance.now()
    const pred = mod.evaluate(samples, sampleRate, {
      filename: basename(path),
      folder: basename(dirname(path)),
      durationSec
    })
    parentPort.postMessage({ idx, pred, durationSec, ms: performance.now() - ta, totalMs: performance.now() - t })
  } catch (err) {
    parentPort.postMessage({ idx, error: String(err?.message ?? err), ms: performance.now() - t })
  }
})
