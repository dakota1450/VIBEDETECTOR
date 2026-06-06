#!/usr/bin/env node
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  resolve: {
    alias: {
      '@shared': new URL('../src/shared', import.meta.url).pathname
    }
  },
  logLevel: 'error'
})

try {
  const mod = await server.ssrLoadModule('/src/shared/keyDetectionBenchmark.ts')
  const result = mod.evaluateKeyDetection()
  console.log(mod.formatKeyBenchmark(result))
  process.exitCode = result.metrics.correct === result.metrics.total ? 0 : 1
} finally {
  await server.close()
}
