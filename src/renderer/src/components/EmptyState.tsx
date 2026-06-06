import { useStore } from '../store/useStore'
import { Plus, Radar } from './icons'

export function EmptyState(): JSX.Element {
  const addSources = useStore((s) => s.addSources)
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="relative mb-8 grid h-40 w-40 place-items-center">
        <span className="absolute h-40 w-40 rounded-full border border-vibe/20 animate-breathe" />
        <span className="absolute h-28 w-28 rounded-full border border-vibe/30" />
        <span className="absolute h-40 w-40 rounded-full border-t-2 border-vibe/60 animate-sweep" />
        <Radar width={56} height={56} className="text-vibe" />
      </div>
      <h2 className="mb-2 text-2xl font-bold tracking-tight">
        Detect the vibe of <span className="bg-gradient-to-r from-vibe to-fuchsia-400 bg-clip-text text-transparent">every sound</span>
      </h2>
      <p className="mb-6 max-w-md text-sm leading-relaxed text-white/45">
        Add your sample folders and Vibe Detector will scan them, read the key and tempo of every sound, and sort drums from
        melodic samples — so you can find the right one in seconds and drag it straight into your DAW.
      </p>
      <button
        onClick={() => void addSources()}
        className="flex items-center gap-2 rounded-xl bg-vibe px-5 py-3 font-semibold text-[#0b0b11] shadow-lg shadow-vibe/30 transition hover:bg-vibe/90"
      >
        <Plus width={18} height={18} /> Add sample folders
      </button>
    </div>
  )
}

export function NoResults(): JSX.Element {
  const resetFilter = useStore((s) => s.resetFilter)
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center px-8">
      <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-white/5 text-white/30">
        <Radar width={28} height={28} />
      </div>
      <p className="mb-1 text-sm font-medium text-white/70">No sounds match these filters</p>
      <p className="mb-4 text-xs text-white/40">Try widening your key, type, or tempo filters.</p>
      <button onClick={resetFilter} className="rounded-lg bg-white/8 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/12">
        Clear all filters
      </button>
    </div>
  )
}
