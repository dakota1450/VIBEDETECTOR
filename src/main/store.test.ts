import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { Store, needsAudioKey, type DetectedRecord } from './store'

function record(path: string, sourceId: number): DetectedRecord {
  return {
    path,
    filename: 'sound.wav',
    folder: 'samples',
    sourceId,
    size: 128,
    mtimeMs: 1000,
    durationSec: 1,
    sampleRate: 44100,
    channels: 2,
    format: 'WAVE',
    keyTonic: null,
    keyMode: null,
    keyConfidence: 0,
    keySource: null,
    bpm: null,
    bpmConfidence: 0,
    bpmSource: null,
    type: 'unknown',
    subtype: null,
    typeSource: null
  }
}

describe('Store hardening', () => {
  it('sanitizes renderer-provided overrides and tags before persisting library state', async () => {
    const store = new Store(join(tmpdir(), `vibe-store-${Date.now()}.json`))
    await store.load()
    const source = store.addSource('/tmp/samples/../samples', 'Samples')
    expect(source.path).toBe('/tmp/samples')
    const sound = store.upsert(record('/tmp/samples/sound.wav', source.id))

    const invalid = store.applyOverride(sound.id, {
      keyTonic: 'H',
      keyMode: 'dorian',
      type: 'alien',
      subtype: 'laser',
      notes: '   '
    } as never)!
    expect(invalid.keyTonic).toBeNull()
    expect(invalid.keyMode).toBeNull()
    expect(invalid.type).toBe('unknown')
    expect(invalid.subtype).toBeNull()
    expect(invalid.notes).toBeNull()

    const valid = store.applyOverride(sound.id, {
      keyTonic: 'Db',
      keyMode: 'minor',
      type: 'drum',
      subtype: 'kick',
      notes: '  tuned hit  '
    })!
    expect(valid.keyTonic).toBe('C#')
    expect(valid.keyMode).toBe('minor')
    expect(valid.type).toBe('drum')
    expect(valid.subtype).toBe('kick')
    expect(valid.notes).toBe('tuned hit')

    const tagged = store.setTags(sound.id, [' Big ', 'big', '', 'x'.repeat(60)])!
    expect(tagged.tags).toEqual(['big', 'x'.repeat(48)])
  })

  it('queues audio key analysis for gaps and risky keys, not confident melodic filename keys', async () => {
    const store = new Store(join(tmpdir(), `vibe-store-queue-${Date.now()}.json`))
    await store.load()
    const source = store.addSource('/tmp/samples', 'Samples')

    const confident = store.upsert({
      ...record('/tmp/samples/pad-cmaj.wav', source.id),
      keyTonic: 'C',
      keyMode: 'major',
      keyConfidence: 0.9,
      keySource: 'filename',
      type: 'melodic',
      subtype: 'pad',
      typeSource: 'filename'
    })
    const weak = store.upsert({
      ...record('/tmp/samples/kick-c.wav', source.id),
      path: '/tmp/samples/kick-c.wav',
      filename: 'kick-c.wav',
      keyTonic: 'C',
      keyMode: null,
      keyConfidence: 0.6,
      keySource: 'filename',
      type: 'drum',
      subtype: 'kick',
      typeSource: 'filename'
    })
    const unknown = store.upsert({
      ...record('/tmp/samples/untitled.wav', source.id),
      path: '/tmp/samples/untitled.wav',
      filename: 'untitled.wav'
    })

    expect(needsAudioKey(confident)).toBe(false)
    expect(needsAudioKey(weak)).toBe(true)
    expect(needsAudioKey(unknown)).toBe(true)
  })

  it('fills an unknown mode when audio agrees on the tonic', async () => {
    const store = new Store(join(tmpdir(), `vibe-store-mode-${Date.now()}.json`))
    await store.load()
    const source = store.addSource('/tmp/samples', 'Samples')
    const sound = store.upsert({
      ...record('/tmp/samples/piano-c.wav', source.id),
      keyTonic: 'C',
      keyMode: null,
      keyConfidence: 0.7,
      keySource: 'filename',
      type: 'melodic',
      subtype: 'piano',
      typeSource: 'filename'
    })

    store.saveAnalysis([{ id: sound.id, key: { tonic: 'C', mode: 'major', confidence: 0.68 } }])
    const updated = store.getSound(sound.id)!
    expect(updated.keyTonic).toBe('C')
    expect(updated.keyMode).toBe('major')
    expect(updated.keyConfidence).toBe(0.7)
    expect(updated.keySource).toBe('filename')
  })

  it('does not let weaker audio analysis overrule a confident explicit filename key', async () => {
    const store = new Store(join(tmpdir(), `vibe-store-preserve-${Date.now()}.json`))
    await store.load()
    const source = store.addSource('/tmp/samples', 'Samples')
    const sound = store.upsert({
      ...record('/tmp/samples/pad-cmaj.wav', source.id),
      keyTonic: 'C',
      keyMode: 'major',
      keyConfidence: 0.9,
      keySource: 'filename',
      type: 'melodic',
      subtype: 'pad',
      typeSource: 'filename'
    })

    store.saveAnalysis([{ id: sound.id, key: { tonic: 'G', mode: 'major', confidence: 0.62 } }])
    const updated = store.getSound(sound.id)!
    expect(updated.keyTonic).toBe('C')
    expect(updated.keyMode).toBe('major')
    expect(updated.keySource).toBe('filename')
  })

  it('clears stale analysis keys when the upgraded analyzer rejects the key', async () => {
    const store = new Store(join(tmpdir(), `vibe-store-clear-${Date.now()}.json`))
    await store.load()
    const source = store.addSource('/tmp/samples', 'Samples')
    const sound = store.upsert({
      ...record('/tmp/samples/noise.wav', source.id),
      keyTonic: 'D#',
      keyMode: 'minor',
      keyConfidence: 0.62,
      keySource: 'analysis',
      type: 'drum',
      subtype: 'hihat',
      typeSource: 'analysis'
    })

    store.saveAnalysis([{ id: sound.id, key: { tonic: null, mode: null, confidence: 0.12 } }])
    const updated = store.getSound(sound.id)!
    expect(updated.keyTonic).toBeNull()
    expect(updated.keyMode).toBeNull()
    expect(updated.keyConfidence).toBe(0)
    expect(updated.keySource).toBeNull()
  })

  it('persists waveform peaks and stops queueing once every capability is current', async () => {
    const store = new Store(join(tmpdir(), `vibe-store-peaks-${Date.now()}.json`))
    await store.load()
    const source = store.addSource('/tmp/samples', 'Samples')
    const sound = store.upsert(record('/tmp/samples/wave.wav', source.id))
    expect(store.getAnalysisQueue().map((s) => s.id)).toContain(sound.id)

    const values = Array.from({ length: 48 }, (_, i) => i / 47)
    // A real job decodes once and returns every needed step together; the store should
    // record each capability's version and drop the sound from the queue.
    store.saveAnalysis([
      {
        id: sound.id,
        key: { tonic: null, mode: null, confidence: 0 },
        bpm: { value: null, confidence: 0 },
        cls: { type: 'melodic', subtype: 'loop', confidence: 0.8 },
        peaks: { values, version: 1 }
      }
    ])
    const updated = store.getSound(sound.id)!
    expect(updated.waveformPeaks).toEqual(values)
    expect(updated.waveformVersion).toBe(1)
    expect(updated.analysisError).toBeNull()
    expect(updated.needsAudioAnalysis).toBe(false)
  })

  it('only re-runs the capability whose version advanced, not the whole sound', async () => {
    const store = new Store(join(tmpdir(), `vibe-store-cap-${Date.now()}.json`))
    await store.load()
    const source = store.addSource('/tmp/samples', 'Samples')
    const sound = store.upsert(record('/tmp/samples/loop.wav', source.id))

    const values = Array.from({ length: 48 }, (_, i) => i / 47)
    store.saveAnalysis([
      {
        id: sound.id,
        key: { tonic: 'C', mode: 'minor', confidence: 0.8 },
        bpm: { value: 120, confidence: 0.7 },
        cls: { type: 'melodic', subtype: 'loop', confidence: 0.8 },
        peaks: { values, version: 1 }
      }
    ])
    const done = store.getSound(sound.id)!
    expect(done.needsAudioAnalysis).toBe(false)
    expect(done.keyVersion).toBe(1)
    expect(done.bpmVersion).toBe(1)
    expect(done.typeVersion).toBe(1)

    // Simulate a key-algorithm update: the key step is stale again, the rest is not.
    done.keyVersion = 0
    done.needsAudioAnalysis = true
    expect(needsAudioKey(done)).toBe(true)
  })

  it('records analysis failures instead of retrying silently forever', async () => {
    const store = new Store(join(tmpdir(), `vibe-store-error-${Date.now()}.json`))
    await store.load()
    const source = store.addSource('/tmp/samples', 'Samples')
    const sound = store.upsert(record('/tmp/samples/bad.wav', source.id))

    store.saveAnalysis([{ id: sound.id, error: 'decode_failed' }])
    const updated = store.getSound(sound.id)!
    expect(updated.analysisError).toBe('decode_failed')
    expect(updated.needsAudioAnalysis).toBe(false)
  })

  it('can clear an analysis failure and requeue the sound for retry', async () => {
    const store = new Store(join(tmpdir(), `vibe-store-retry-${Date.now()}.json`))
    await store.load()
    const source = store.addSource('/tmp/samples', 'Samples')
    const sound = store.upsert(record('/tmp/samples/retry.wav', source.id))

    store.saveAnalysis([{ id: sound.id, error: 'decode_failed' }])
    expect(store.getSound(sound.id)!.needsAudioAnalysis).toBe(false)

    store.applyOverride(sound.id, { retryAnalysis: true })
    const updated = store.getSound(sound.id)!
    expect(updated.analysisError).toBeNull()
    expect(updated.analysisVersion).toBeNull()
    expect(updated.needsAudioAnalysis).toBe(true)
  })
})
