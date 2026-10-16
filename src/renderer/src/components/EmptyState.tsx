import { useStore } from '../store/useStore'
import { BrandMark } from './BrandMark'
import { Plus, Radar } from './icons'

export function EmptyState(): JSX.Element {
  const addSources = useStore((s) => s.addSources)
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="relative mb-8 grid h-44 w-44 place-items-center">
        <span className="absolute inset-0 rounded-full bg-[radial-gradient(closest-side,rgba(139,92,255,0.16),transparent)] animate-breathe" />
        <BrandMark size={152} animated plate={false} />
      </div>
      <h2 className="mb-2 text-2xl font-bold tracking-tight">Detect the vibe of every sound</h2>
      <p className="mb-6 max-w-md text-sm leading-relaxed text-white/45">
        Add your sample folders and Vibe Detector reads the key and tempo of every sound from the audio itself — locking
        loops to their exact bar grid and learning keys from thousands of producer-labelled samples — so you can find the
        right one in seconds and drag it straight into your DAW. Everything stays on your machine.
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
