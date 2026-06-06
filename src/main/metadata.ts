import { parseFile } from 'music-metadata'

export interface FileMeta {
  durationSec: number | null
  sampleRate: number | null
  channels: number | null
  format: string | null
  bpmTag: number | null
  keyTag: string | null
}

const EMPTY: FileMeta = {
  durationSec: null,
  sampleRate: null,
  channels: null,
  format: null,
  bpmTag: null,
  keyTag: null
}

export async function readMetadata(path: string): Promise<FileMeta> {
  try {
    const mm = await parseFile(path, { duration: true })
    const f = mm.format
    const bpm = mm.common.bpm
    return {
      durationSec: typeof f.duration === 'number' ? f.duration : null,
      sampleRate: typeof f.sampleRate === 'number' ? f.sampleRate : null,
      channels: typeof f.numberOfChannels === 'number' ? f.numberOfChannels : null,
      format: f.container || f.codec || null,
      bpmTag: typeof bpm === 'number' && isFinite(bpm) ? bpm : null,
      keyTag: typeof mm.common.key === 'string' ? mm.common.key : null
    }
  } catch {
    return { ...EMPTY }
  }
}
