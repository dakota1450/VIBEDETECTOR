import { useStore } from '../store/useStore'
import { ScanIndicator } from './ScanIndicator'
import { BrandMark } from './BrandMark'
import { Search, X } from './icons'

export function TopBar(): JSX.Element {
  const search = useStore((s) => s.filter.search)
  const patchFilter = useStore((s) => s.patchFilter)

  return (
    <header className="drag-region flex h-14 shrink-0 items-center gap-4 border-b border-white/5 px-4 pl-20">
      <div className="flex items-center gap-2.5 select-none">
        <span className="rounded-[7px] shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_6px_18px_-6px_rgba(139,92,255,0.55)]">
          <BrandMark size={28} />
        </span>
        <span className="text-[13px] font-bold tracking-[0.14em] text-white/90">
          VIBE <span className="font-semibold text-white/45">DETECTOR</span>
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
