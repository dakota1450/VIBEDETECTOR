import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'
import { useAnalysis } from '../hooks/useAnalysis'
import { TopBar } from './TopBar'
import { Sidebar } from './Sidebar'
import { SoundGrid } from './SoundGrid'
import { DetailPanel } from './DetailPanel'
import { PlayerBar } from './PlayerBar'

const LIBRARY_REFRESH_DEBOUNCE_MS = 500

export default function App(): JSX.Element {
  const refresh = useStore((s) => s.refresh)
  const setScan = useStore((s) => s.setScan)
  const analyzing = useStore((s) => s.scan.analyzing)
  const runAnalysis = useAnalysis()
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    void refresh()
    const offProgress = window.api.onScanProgress((p) => setScan(p))
    const scheduleRefresh = (): void => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => void refresh(), LIBRARY_REFRESH_DEBOUNCE_MS)
    }
    const offChanged = window.api.onSoundsChanged(scheduleRefresh)
    return () => {
      offProgress()
      offChanged()
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [refresh, setScan])

  useEffect(() => {
    if (analyzing > 0) runAnalysis()
  }, [analyzing, runAnalysis])

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1">
          <SoundGrid />
        </main>
        <DetailPanel />
      </div>
      <PlayerBar />
    </div>
  )
}
