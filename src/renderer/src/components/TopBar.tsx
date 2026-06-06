import { useStore } from '../store/useStore'
import { ScanIndicator } from './ScanIndicator'
import { Radar, Search, X } from './icons'

export function TopBar(): JSX.Element {
  const search = useStore((s) => s.filter.search)
  const patchFilter = useStore((s) => s.patchFilter)

  return (
    <header className="drag-region flex h-14 shrink-0 items-center gap-4 border-b border-white/5 px-4 pl-20">
      <div className="flex items-center gap-2 select-none">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-vibe to-fuchsia-500 text-[#0b0b11] shadow-lg shadow-vibe/30">
          <Radar width={17} height={17} />
        </span>
        <span className="text-[15px] font-bold tracking-tight">
          VIBE<span className="bg-gradient-to-r from-vibe to-fuchsia-400 bg-clip-text text-transparent"> DETECTOR</span>
        </span>
      </div>

      <div className="no-drag relative mx-auto w-full max-w-md">
        <Search width={16} height={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
        <input
          value={search}
          onChange={(e) => patchFilter({ search: e.target.value })}
          placeholder="Search sounds, folders…"
          className="w-full rounded-lg bg-white/5 py-2 pl-9 pr-9 text-sm outline-none border border-white/8 focus:border-vibe/60 placeholder:text-white/30"
        />
        {search && (
          <button
            onClick={() => patchFilter({ search: '' })}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/70"
          >
            <X width={15} height={15} />
          </button>
        )}
      </div>

      <ScanIndicator />
    </header>
  )
}
