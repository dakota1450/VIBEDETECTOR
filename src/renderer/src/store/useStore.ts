import { create } from 'zustand'
import type {
  KeyMode,
  LibraryFilter,
  ScanProgress,
  Sound,
  SoundOverride,
  Source,
  Subtype
} from '@shared/types'
import { defaultFilter } from '../lib/filter'

const api = window.api
const DEFAULT_VOLUME = 0.85

function clampVolume(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : DEFAULT_VOLUME
}

interface PlayerState {
  playingId: number | null
  isPlaying: boolean
  volume: number
  loop: boolean
  seekNonce: number
}

interface AppStore {
  sources: Source[]
  sounds: Sound[]
  scan: ScanProgress
  filter: LibraryFilter
  selection: number[]
  player: PlayerState
  ready: boolean

  refresh: () => Promise<void>
  refreshSources: () => Promise<void>
  setScan: (s: ScanProgress) => void

  patchFilter: (p: Partial<LibraryFilter>) => void
  resetFilter: () => void
  toggleKey: (tonic: string, mode: KeyMode) => void
  toggleSubtype: (sub: Subtype) => void
  setType: (t: LibraryFilter['type']) => void

  addSources: () => Promise<void>
  removeSource: (id: number) => Promise<void>
  rescan: () => Promise<void>

  select: (id: number, additive?: boolean) => void
  selectMany: (ids: number[]) => void
  clearSelection: () => void

  play: (id: number) => void
  togglePlay: () => void
  stop: () => void
  setPlaying: (v: boolean) => void
  setVolume: (v: number) => void
  toggleLoop: () => void

  setFavorite: (id: number, fav: boolean) => Promise<void>
  override: (id: number, patch: SoundOverride) => Promise<void>
  batchOverride: (ids: number[], patch: SoundOverride) => Promise<void>
  setTags: (id: number, tags: string[]) => Promise<void>
  reveal: (path: string) => void
}

export const useStore = create<AppStore>((set, get) => ({
  sources: [],
  sounds: [],
  scan: { phase: 'idle', found: 0, processed: 0, total: 0, analyzing: 0, currentFile: null },
  filter: defaultFilter,
  selection: [],
  player: { playingId: null, isPlaying: false, volume: DEFAULT_VOLUME, loop: false, seekNonce: 0 },
  ready: false,

  refresh: async () => {
    const [sources, sounds] = await Promise.all([api.listSources(), api.getSounds()])
    set({ sources, sounds, ready: true })
  },
  refreshSources: async () => set({ sources: await api.listSources() }),
  setScan: (s) => set({ scan: s }),

  patchFilter: (p) => set({ filter: { ...get().filter, ...p } }),
  resetFilter: () => set({ filter: { ...defaultFilter } }),
  toggleKey: (tonic, mode) => {
    const keys = get().filter.keys.slice()
    const i = keys.findIndex((k) => k.tonic === tonic && k.mode === mode)
    if (i >= 0) keys.splice(i, 1)
    else keys.push({ tonic, mode })
    set({ filter: { ...get().filter, keys } })
  },
  toggleSubtype: (sub) => {
    const subs = get().filter.subtypes.slice()
    const i = subs.indexOf(sub)
    if (i >= 0) subs.splice(i, 1)
    else subs.push(sub)
    set({ filter: { ...get().filter, subtypes: subs } })
  },
  setType: (t) => set({ filter: { ...get().filter, type: t, subtypes: [] } }),

  addSources: async () => {
    await api.addSources()
    await get().refreshSources()
  },
  removeSource: async (id) => {
    await api.removeSource(id)
    await get().refresh()
  },
  rescan: async () => {
    await api.rescan()
  },

  select: (id, additive) => {
    const sel = get().selection
    if (additive) {
      const i = sel.indexOf(id)
      set({ selection: i >= 0 ? sel.filter((x) => x !== id) : [...sel, id] })
    } else {
      set({ selection: [id] })
    }
  },
  selectMany: (ids) => set({ selection: ids }),
  clearSelection: () => set({ selection: [] }),

  play: (id) => {
    const p = get().player
    if (p.playingId === id) set({ player: { ...p, isPlaying: !p.isPlaying } })
    else set({ player: { ...p, playingId: id, isPlaying: true, seekNonce: p.seekNonce + 1 } })
  },
  togglePlay: () => {
    const { player, selection } = get()
    if (player.playingId == null) {
      const id = selection[selection.length - 1]
      if (id != null) get().play(id)
      return
    }
    set({ player: { ...player, isPlaying: !player.isPlaying } })
  },
  stop: () => set({ player: { ...get().player, isPlaying: false } }),
  setPlaying: (v) => set({ player: { ...get().player, isPlaying: v } }),
  setVolume: (v) => set({ player: { ...get().player, volume: clampVolume(v) } }),
  toggleLoop: () => set({ player: { ...get().player, loop: !get().player.loop } }),

  setFavorite: async (id, fav) => {
    set({ sounds: get().sounds.map((s) => (s.id === id ? { ...s, isFavorite: fav } : s)) })
    const updated = await api.setFavorite(id, fav)
    if (updated) set({ sounds: get().sounds.map((s) => (s.id === id ? updated : s)) })
  },
  override: async (id, patch) => {
    const updated = await api.setOverride(id, patch)
    if (updated) set({ sounds: get().sounds.map((s) => (s.id === id ? updated : s)) })
  },
  batchOverride: async (ids, patch) => {
    const unique = [...new Set(ids)]
    const updates = await Promise.all(unique.map((id) => api.setOverride(id, patch)))
    const byId = new Map(updates.filter((s): s is Sound => !!s).map((s) => [s.id, s]))
    if (byId.size) set({ sounds: get().sounds.map((s) => byId.get(s.id) ?? s) })
  },
  setTags: async (id, tags) => {
    set({ sounds: get().sounds.map((s) => (s.id === id ? { ...s, tags } : s)) })
    const updated = await api.setTags(id, tags)
    if (updated) set({ sounds: get().sounds.map((s) => (s.id === id ? updated : s)) })
  },
  reveal: (path) => api.revealInFinder(path)
}))
