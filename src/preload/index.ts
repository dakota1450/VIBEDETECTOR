import { contextBridge, ipcRenderer } from 'electron'
import type { AnalysisResult, ScanProgress, SoundOverride, VibeApi } from '@shared/types'

const api: VibeApi = {
  listSources: () => ipcRenderer.invoke('sources:list'),
  addSources: () => ipcRenderer.invoke('sources:add'),
  removeSource: (id: number) => ipcRenderer.invoke('sources:remove', id),
  rescan: () => ipcRenderer.invoke('library:rescan'),
  getSounds: () => ipcRenderer.invoke('sounds:list'),
  setFavorite: (id: number, favorite: boolean) => ipcRenderer.invoke('sounds:favorite', id, favorite),
  setOverride: (id: number, patch: SoundOverride) => ipcRenderer.invoke('sounds:override', id, patch),
  setTags: (id: number, tags: string[]) => ipcRenderer.invoke('sounds:tags', id, tags),
  revealInFinder: (p: string) => ipcRenderer.invoke('sounds:reveal', p),
  startDrag: (paths: string[]) => ipcRenderer.send('drag:start', paths),
  getAnalysisQueue: () => ipcRenderer.invoke('analysis:queue'),
  saveAnalysis: (results: AnalysisResult[]) => ipcRenderer.invoke('analysis:save', results),
  fileUrl: (p: string) => `vibe://media/${encodeURIComponent(typeof p === 'string' ? p : '')}`,
  onScanProgress: (cb: (p: ScanProgress) => void) => {
    const handler = (_e: unknown, p: ScanProgress): void => cb(p)
    ipcRenderer.on('scan:progress', handler)
    return () => ipcRenderer.removeListener('scan:progress', handler)
  },
  onSoundsChanged: (cb: () => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('sounds:changed', handler)
    return () => ipcRenderer.removeListener('sounds:changed', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
