import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, shell } from 'electron'
import type { MenuItemConstructorOptions, NativeImage } from 'electron'
import { existsSync, promises as fsp } from 'fs'
import { basename, extname, join } from 'path'
import { pathToFileURL } from 'url'
import chokidar, { type FSWatcher } from 'chokidar'
import type { AnalysisJob, AnalysisResult, ScanProgress, Sound, SoundOverride, Source } from '@shared/types'
import { needsAudioBpm, needsAudioClassification, needsAudioKey, needsWaveformPeaks, Store } from './store'
import { isAudioFile, scanFile, scanSources } from './scanner'

const FALLBACK_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let mainWindow: BrowserWindow | null = null
let store: Store
let dragIcon: NativeImage
const watchers = new Map<number, FSWatcher>()

function resourcePath(name: string): string {
  return join(app.getAppPath(), 'resources', name)
}

function loadDragIcon(): NativeImage {
  try {
    const img = nativeImage.createFromPath(resourcePath('dragIcon.png'))
    if (!img.isEmpty()) return img.resize({ width: 96, height: 96 })
  } catch {
    // fall through to fallback
  }
  return nativeImage.createFromDataURL(FALLBACK_ICON).resize({ width: 32, height: 32 })
}

const fileUrl = (p: string): string => `vibe://media/${encodeURIComponent(p)}`

const AUDIO_MIME: Record<string, string> = {
  '.wav': 'audio/wav',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4'
}

function audioMimeForPath(path: string): string {
  return AUDIO_MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

function indexedReadableSound(path: unknown): Sound | null {
  if (typeof path !== 'string' || !isAudioFile(path)) return null
  const sound = store.getByPath(path)
  if (!sound || sound.missing) return null
  return sound
}

function existingIndexedSound(path: unknown): Sound | null {
  const sound = indexedReadableSound(path)
  if (!sound || !existsSync(sound.path)) {
    if (sound) {
      store.markMissing(sound.path)
      emitSoundsChangedDebounced()
    }
    return null
  }
  return sound
}

// ---- scan progress ----
let scan: ScanProgress = { phase: 'idle', found: 0, processed: 0, total: 0, analyzing: 0, currentFile: null }

function emitScan(): void {
  mainWindow?.webContents.send('scan:progress', scan)
}
function emitSoundsChanged(): void {
  mainWindow?.webContents.send('sounds:changed')
}
function refreshAnalyzing(): void {
  scan.analyzing = store.getAnalysisQueue().length
}

let soundsChangedTimer: ReturnType<typeof setTimeout> | null = null
const SOUNDS_CHANGED_DEBOUNCE_MS = 700
function emitSoundsChangedDebounced(): void {
  if (soundsChangedTimer) clearTimeout(soundsChangedTimer)
  soundsChangedTimer = setTimeout(() => {
    refreshAnalyzing()
    emitScan()
    emitSoundsChanged()
  }, SOUNDS_CHANGED_DEBOUNCE_MS)
}

let scanning = false
async function runScan(sources: Source[]): Promise<void> {
  if (scanning || sources.length === 0) return
  scanning = true
  scan = { phase: 'scanning', found: 0, processed: 0, total: 0, analyzing: scan.analyzing, currentFile: null }
  emitScan()
  try {
    await scanSources(store, sources, {
      onTotal: (total) => {
        scan.total = total
        scan.found = total
        emitScan()
      },
      onProgress: (processed, total, file) => {
        scan.processed = processed
        scan.total = total
        scan.currentFile = basename(file)
        if (processed % 24 === 0 || processed === total) {
          emitScan()
          emitSoundsChanged()
        }
      }
    })
    await store.flush()
  } finally {
    scanning = false
    refreshAnalyzing()
    scan.phase = scan.analyzing > 0 ? 'analyzing' : 'done'
    scan.currentFile = null
    emitScan()
    emitSoundsChanged()
  }
}

// ---- file watching ----
function watchSource(source: Source): void {
  if (watchers.has(source.id)) return
  const watcher = chokidar.watch(source.path, {
    ignoreInitial: true,
    depth: 30,
    useFsEvents: false,
    awaitWriteFinish: { stabilityThreshold: 750, pollInterval: 250 },
    ignored: /(^|[/\\])\../
  })
  const onChange = async (file: string): Promise<void> => {
    if (!isAudioFile(file)) return
    await scanFile(store, source, file)
    emitSoundsChangedDebounced()
  }
  watcher
    .on('add', (f) => void onChange(f))
    .on('change', (f) => void onChange(f))
    .on('unlink', (f) => {
      if (!isAudioFile(f)) return
      store.markMissing(f)
      emitSoundsChangedDebounced()
    })
    .on('error', () => {
      // Source folders can disappear or become unreadable; the next rescan reconciles them.
    })
  watchers.set(source.id, watcher)
}

function unwatchSource(id: number): void {
  const w = watchers.get(id)
  if (w) {
    void w.close()
    watchers.delete(id)
  }
}

async function addSourcesViaDialog(): Promise<{ added: number }> {
  if (!mainWindow) return { added: 0 }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Add sample folders',
    properties: ['openDirectory', 'multiSelections', 'createDirectory']
  })
  if (result.canceled) return { added: 0 }
  const newSources: Source[] = []
  const knownPaths = new Set(store.listSources().map((s) => s.path))
  for (const dir of result.filePaths) {
    if (knownPaths.has(dir)) continue
    const src = store.addSource(dir, basename(dir))
    knownPaths.add(src.path)
    newSources.push(src)
    watchSource(src)
  }
  await store.flush()
  void runScan(newSources)
  return { added: newSources.length }
}

// ---- audio protocol ----
function registerProtocol(): void {
  protocol.handle('vibe', async (request) => {
    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Range, Content-Type, Accept'
          }
        })
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(null, { status: 405 })
      }
      const url = new URL(request.url)
      if (url.hostname !== 'media') return new Response(null, { status: 404 })
      const abs = decodeURIComponent(url.pathname.replace(/^\//, ''))
      const sound = existingIndexedSound(abs)
      if (!sound) return new Response(null, { status: 404 })
      const response = await net.fetch(pathToFileURL(sound.path).toString(), {
        headers: request.headers,
        method: request.method
      })
      const headers = new Headers(response.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
      headers.set('Accept-Ranges', headers.get('Accept-Ranges') || 'bytes')
      headers.set('Content-Type', audioMimeForPath(sound.path))
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}

// ---- ipc ----
function registerIpc(): void {
  ipcMain.handle('sources:list', () => store.listSources())

  ipcMain.handle('sources:add', () => addSourcesViaDialog())

  ipcMain.handle('sources:remove', async (_e, id: number) => {
    unwatchSource(id)
    store.removeSource(id)
    await store.flush()
    refreshAnalyzing()
    emitSoundsChanged()
  })

  ipcMain.handle('library:rescan', async () => {
    void runScan(store.listSources())
  })

  ipcMain.handle('sounds:list', () => store.getSounds())

  ipcMain.handle('sounds:favorite', (_e, id: number, favorite: boolean) => {
    const sound = store.setFavorite(id, favorite)
    emitSoundsChangedDebounced()
    return sound
  })

  ipcMain.handle('sounds:override', (_e, id: number, patch: SoundOverride) => {
    const s = store.applyOverride(id, patch)
    emitSoundsChangedDebounced()
    return s ?? null
  })

  ipcMain.handle('sounds:tags', (_e, id: number, tags: string[]) => {
    const sound = store.setTags(id, tags)
    emitSoundsChangedDebounced()
    return sound
  })

  ipcMain.handle('sounds:reveal', (_e, p: string) => {
    const sound = existingIndexedSound(p)
    if (!sound) return false
    shell.showItemInFolder(sound.path)
    return true
  })

  ipcMain.handle('analysis:queue', (): AnalysisJob[] =>
    store.getAnalysisQueue().map((s) => {
      const needsKey = needsAudioKey(s)
      const classifyDrum = needsAudioClassification(s)
      const needsPeaks = needsWaveformPeaks(s)
      return {
        id: s.id,
        url: fileUrl(s.path),
        needsKey,
        needsBpm: needsAudioBpm(s),
        classifyDrum: classifyDrum || (needsKey && s.type === 'drum'),
        needsPeaks
      }
    })
  )

  ipcMain.handle('analysis:save', (_e, results: AnalysisResult[]) => {
    store.saveAnalysis(results)
    refreshAnalyzing()
    if (scan.analyzing === 0 && !scanning) scan.phase = 'done'
    emitSoundsChangedDebounced()
  })

  ipcMain.on('drag:start', (event, paths: string[]) => {
    const seen = new Set<string>()
    const files = (Array.isArray(paths) ? paths : [])
      .map((p) => existingIndexedSound(p)?.path)
      .filter((p): p is string => {
        if (!p || seen.has(p)) return false
        seen.add(p)
        return true
      })
    if (files.length === 0) return
    try {
      event.sender.startDrag(
        files.length === 1 ? { file: files[0], icon: dragIcon } : { file: files[0], files, icon: dragIcon }
      )
    } catch (err) {
      console.error('[vibe] startDrag failed:', err)
    }
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1340,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Vibe Detector',
    backgroundColor: '#0b0b11',
    icon: resourcePath('icon.png'),
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Name the app everywhere (menu bar, About, userData path) — not "Electron".
app.setName('Vibe Detector')

function buildAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = []
  if (isMac) {
    template.push({
      label: 'Vibe Detector',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }
  template.push({
    label: 'File',
    submenu: [
      { label: 'Add Folders…', accelerator: 'CmdOrCtrl+O', click: () => void addSourcesViaDialog() },
      { label: 'Rescan Library', accelerator: 'CmdOrCtrl+R', click: () => void runScan(store.listSources()) },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' }
    ]
  })
  template.push({ label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] })
  template.push({
    label: 'View',
    submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }]
  })
  template.push({ role: 'window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vibe',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  }
])

app.whenReady().then(async () => {
  const dataDir = process.env.VIBE_DATA_DIR || app.getPath('userData')
  store = new Store(join(dataDir, 'vibe-library.json'))
  await store.load()
  dragIcon = loadDragIcon()
  registerProtocol()
  registerIpc()
  createWindow()

  if (process.platform === 'darwin' && app.dock) {
    try {
      const dock = nativeImage.createFromPath(resourcePath('icon.png'))
      if (!dock.isEmpty()) app.dock.setIcon(dock)
    } catch {
      // ignore
    }
  }

  buildAppMenu()
  app.setAboutPanelOptions({
    applicationName: 'Vibe Detector',
    applicationVersion: app.getVersion(),
    copyright: 'Detect the vibe of every sound.'
  })

  // Re-watch existing sources and pick up any changes since last launch.
  const existing = store.listSources()
  for (const s of existing) watchSource(s)
  refreshAnalyzing()

  // Optional auto-import (used for testing/demo without the native dialog).
  const importDirs = (process.env.VIBE_IMPORT_DIR || '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean)
  if (importDirs.length) {
    const added: Source[] = []
    const knownPaths = new Set(store.listSources().map((s) => s.path))
    for (const d of importDirs) {
      if (knownPaths.has(d)) continue
      const src = store.addSource(d, basename(d))
      knownPaths.add(src.path)
      watchSource(src)
      added.push(src)
    }
    await store.flush()
    mainWindow?.webContents.once('did-finish-load', () => void runScan(added.length ? added : existing))
  } else if (existing.length) {
    mainWindow?.webContents.once('did-finish-load', () => void runScan(existing))
  }

  // Permission-free self-capture for verification/demo (VIBE_SHOT=path).
  if (process.env.VIBE_SHOT) {
    mainWindow?.webContents.once('did-finish-load', () => {
      setTimeout(
        () => {
          void (async () => {
            try {
              const img = await mainWindow!.webContents.capturePage()
              await fsp.writeFile(process.env.VIBE_SHOT as string, img.toPNG())
            } catch {
              // ignore
            }
            if (process.env.VIBE_SHOT_QUIT) app.quit()
          })()
        },
        Number(process.env.VIBE_SHOT_DELAY) || 7000
      )
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let finishingQuit = false
app.on('before-quit', (event) => {
  if (finishingQuit) return
  event.preventDefault()
  finishingQuit = true
  void (async () => {
    try {
      await store?.flush()
      await Promise.all([...watchers.values()].map((w) => w.close()))
    } finally {
      app.quit()
    }
  })()
})
