import { useStore } from '../store/useStore'
import { Radar } from './icons'

export function ScanIndicator(): JSX.Element | null {
  const scan = useStore((s) => s.scan)
  const active = scan.phase === 'scanning' || scan.phase === 'analyzing'
  const analyzingOnly = scan.phase === 'analyzing' && scan.analyzing > 0

  if (!active && scan.analyzing === 0) return null

  const analyzeTotal = scan.analyzeTotal || scan.analyzing
  const analyzeDone = Math.max(0, analyzeTotal - scan.analyzing)
  const pct =
    scan.phase === 'scanning'
      ? scan.total > 0
        ? Math.round((scan.processed / scan.total) * 100)
        : 0
      : analyzeTotal > 0
        ? Math.round((analyzeDone / analyzeTotal) * 100)
        : 0
  const showBar = scan.phase === 'scanning' || analyzingOnly

  return (
    <div className="no-drag flex items-center gap-2.5 rounded-full bg-white/5 px-3 py-1.5 border border-white/8">
      <span className="relative inline-flex h-4 w-4 items-center justify-center text-vibe">
        <Radar width={16} height={16} className={active ? 'animate-sweep' : ''} />
      </span>
      <div className="flex flex-col leading-tight">
        <span className="text-[11px] font-semibold text-white/80">
          {scan.phase === 'scanning' ? 'Detecting vibe…' : analyzingOnly ? 'Updating library…' : 'Up to date'}
        </span>
        <span className="text-[10px] text-white/45 tabular-nums">
          {scan.phase === 'scanning'
            ? `${scan.processed}/${scan.total}${scan.currentFile ? ` · ${scan.currentFile}` : ''}`
            : scan.analyzing > 0
              ? `${analyzeDone.toLocaleString()}/${analyzeTotal.toLocaleString()} sounds`
              : ''}
        </span>
      </div>
      {showBar && (
        <div className="h-1 w-16 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-vibe transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}
