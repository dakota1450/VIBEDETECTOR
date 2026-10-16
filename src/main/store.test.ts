import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { ANALYZER_VERSIONS, Store, looksLikeOneShot, needsAudioBpm, needsAudioKey, type DetectedRecord } from './store'

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

  it('fills an unknown mode and trusts the key more when audio agrees on the tonic', async () => {
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
    expect(updated.keyConfidence).toBeCloseTo(0.78)
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
    expect(done.keyVersion).toBe(ANALYZER_VERSIONS.key)
    expect(done.bpmVersion).toBe(ANALYZER_VERSIONS.bpm)
    expect(done.typeVersion).toBe(ANALYZER_VERSIONS.classify)

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

describe('Store tempo + key merging (v2 analyzers)', () => {
  async function fresh(name: string): Promise<{ store: Store; sourceId: number }> {
    const store = new Store(join(tmpdir(), `vibe-store-${name}-${Date.now()}-${Math.random()}.json`))
    await store.load()
    return { store, sourceId: store.addSource('/tmp/samples', 'Samples').id }
  }

  it('lets drum loops (not just melodic sounds) get an audio tempo', async () => {
    const { store, sourceId } = await fresh('drumloop')
    const loop = store.upsert({ ...record('/tmp/samples/drum-loop.wav', sourceId), filename: 'Drum_Loop_Dusty.wav', durationSec: 10.4, type: 'drum', subtype: 'other', typeSource: 'filename' })
    expect(needsAudioBpm(loop)).toBe(true)
    const kick = store.upsert({ ...record('/tmp/samples/kick.wav', sourceId), filename: 'Kick_01.wav', durationSec: 0.4, type: 'drum', subtype: 'kick', typeSource: 'filename' })
    expect(needsAudioBpm(kick)).toBe(false)
  })

  it('skips tempo analysis for sounds named as one-shots', () => {
    expect(looksLikeOneShot({ folder: 'Drums/One Shots', filename: 'Crash_Long.wav' })).toBe(true)
    expect(looksLikeOneShot({ folder: 'Loops', filename: 'Kick_Loop_140.wav' })).toBe(false)
    expect(looksLikeOneShot({ folder: 'Fills', filename: 'Tom_Fill.wav' })).toBe(false)
  })

  it('fills a missing tempo from audio and keeps half/double alternatives', async () => {
    const { store, sourceId } = await fresh('fill')
    const s = store.upsert({ ...record('/tmp/samples/loop.wav', sourceId), durationSec: 8 })
    store.saveAnalysis([{ id: s.id, bpm: { value: 120, confidence: 0.91, alternatives: [60, 240] } }])
    const u = store.getSound(s.id)!
    expect(u).toMatchObject({ bpm: 120, bpmSource: 'analysis', bpmVersion: ANALYZER_VERSIONS.bpm })
    expect(u.bpmAlternatives).toEqual([60, 240])
  })

  it('refreshes an older analysis tempo and clears it when the new analyzer finds no pulse', async () => {
    const { store, sourceId } = await fresh('refresh')
    const s = store.upsert({ ...record('/tmp/samples/pad.wav', sourceId), durationSec: 8 })
    store.saveAnalysis([{ id: s.id, bpm: { value: 97, confidence: 0.4 } }])
    store.saveAnalysis([{ id: s.id, bpm: { value: 128, confidence: 0.8 } }])
    expect(store.getSound(s.id)!.bpm).toBe(128)
    store.saveAnalysis([{ id: s.id, bpm: { value: null, confidence: 0.1 } }])
    expect(store.getSound(s.id)).toMatchObject({ bpm: null, bpmSource: null })
  })

  it('keeps the producer octave when audio reads a weak filename tempo at half/double time', async () => {
    const { store, sourceId } = await fresh('octave')
    const s = store.upsert({ ...record('/tmp/samples/trap.wav', sourceId), durationSec: 9, bpm: 140, bpmConfidence: 0.6, bpmSource: 'filename' })
    expect(needsAudioBpm(s)).toBe(true)
    store.saveAnalysis([{ id: s.id, bpm: { value: 70, confidence: 0.9 } }])
    const u = store.getSound(s.id)!
    expect(u.bpm).toBe(140)
    expect(u.bpmSource).toBe('filename')
    expect(u.bpmConfidence).toBeGreaterThanOrEqual(0.9)
  })

  it('never re-analyses a confident filename tempo', async () => {
    const { store, sourceId } = await fresh('trusted')
    const s = store.upsert({ ...record('/tmp/samples/loop90.wav', sourceId), durationSec: 10.67, bpm: 90, bpmConfidence: 0.92, bpmSource: 'filename' })
    expect(needsAudioBpm(s)).toBe(false)
  })

  it('lets the upgraded analyzer replace an older analysis key and records its candidates', async () => {
    const { store, sourceId } = await fresh('rekey')
    const s = store.upsert(record('/tmp/samples/loop.wav', sourceId))
    store.saveAnalysis([{ id: s.id, key: { tonic: 'E', mode: 'minor', confidence: 0.9 } }])
    store.saveAnalysis([
      {
        id: s.id,
        key: {
          tonic: 'A',
          mode: 'minor',
          confidence: 0.61,
          candidates: [
            { tonic: 'A', mode: 'minor', p: 0.61 },
            { tonic: 'C', mode: 'major', p: 0.2 }
          ]
        }
      }
    ])
    const u = store.getSound(s.id)!
    expect(u).toMatchObject({ keyTonic: 'A', keyMode: 'minor', keySource: 'analysis', keyConfidence: 0.61 })
    expect(u.keyCandidates?.[1]).toEqual({ tonic: 'C', mode: 'major', p: 0.2 })
  })

  it('a manual tempo clears the analysis alternatives', async () => {
    const { store, sourceId } = await fresh('manual')
    const s = store.upsert({ ...record('/tmp/samples/loop.wav', sourceId), durationSec: 8 })
    store.saveAnalysis([{ id: s.id, bpm: { value: 120, confidence: 0.9, alternatives: [60, 240] } }])
    store.applyOverride(s.id, { bpm: 60 })
    expect(store.getSound(s.id)).toMatchObject({ bpm: 60, bpmSource: 'manual', bpmAlternatives: null })
  })
})
