import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { useStore } from '../store/useStore'
import { keyColor } from '@shared/keyColors'
import { formatDuration } from '@shared/format'
import { KeyBadge } from './KeyBadge'
import { Loop, Mute, Pause, Play, Volume } from './icons'

const AUDIO_MIME: Record<string, string> = {
  wav: 'audio/wav',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4'
}
const DEFAULT_VOLUME = 0.85

function audioMimeForPath(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase()
  return ext ? AUDIO_MIME[ext] : undefined
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof DOMException ||
    (typeof err === 'object' && err !== null && 'name' in err && typeof err.name === 'string')
  ) && (err as { name: string }).name === 'AbortError'
}

export function PlayerBar(): JSX.Element {
  const sounds = useStore((s) => s.sounds)
  const player = useStore((s) => s.player)
  const setPlaying = useStore((s) => s.setPlaying)
  const togglePlay = useStore((s) => s.togglePlay)
  const setVolume = useStore((s) => s.setVolume)
  const toggleLoop = useStore((s) => s.toggleLoop)

  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const readyRef = useRef(false)
  const playIntentRef = useRef(false)
  const loadSeqRef = useRef(0)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)

  const current = useMemo(() => sounds.find((s) => s.id === player.playingId) ?? null, [sounds, player.playingId])
  const currentPath = current?.path ?? null
  const currentMissing = !!current?.missing
  const col = keyColor(current?.keyTonic ?? null, current?.keyMode ?? null)

  const failPlayback = useCallback(
    (err: unknown) => {
      if (isAbortError(err)) return
      playIntentRef.current = false
      readyRef.current = false
      setLoadError('Preview failed')
      setPlaying(false)
      console.warn('[vibe] Preview failed:', err)
    },
    [setPlaying]
  )

  const playReadyTrack = useCallback(
    (ws: WaveSurfer) => {
      ws.play().catch(failPlayback)
    },
    [failPlayback]
  )

  // Create the WaveSurfer instance once.
  useEffect(() => {
    if (!containerRef.current) return
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 40,
      waveColor: 'rgba(255,255,255,0.22)',
      progressColor: '#8b5cff',
      cursorColor: 'rgba(255,255,255,0.6)',
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      interact: true
    })
    wsRef.current = ws
    ws.on('ready', () => {
      readyRef.current = true
      setDuration(ws.getDuration())
      setLoadError(null)
      if (playIntentRef.current) playReadyTrack(ws)
    })
    ws.on('timeupdate', (t) => setTime(t))
    ws.on('finish', () => {
      const p = useStore.getState().player
      if (p.loop) {
        ws.setTime(0)
        playReadyTrack(ws)
      } else {
        setPlaying(false)
      }
    })
    ws.on('error', failPlayback)
    return () => {
      wsRef.current = null
      ws.destroy()
    }
  }, [failPlayback, playReadyTrack, setPlaying])

  // Load a new track when the playing sound (or replay nonce) changes.
  useEffect(() => {
    const ws = wsRef.current
    if (!ws) return
    if (!currentPath) {
      loadSeqRef.current++
      readyRef.current = false
      playIntentRef.current = false
      ws.pause()
      ws.empty()
      setTime(0)
      setDuration(0)
      setLoadError(null)
      return
    }
    if (currentMissing) {
      loadSeqRef.current++
      readyRef.current = false
      playIntentRef.current = false
      ws.pause()
      ws.empty()
      setTime(0)
      setDuration(0)
      setLoadError('File missing')
      setPlaying(false)
      return
    }
    readyRef.current = false
    playIntentRef.current = useStore.getState().player.isPlaying
    setTime(0)
    setLoadError(null)
    const loadId = ++loadSeqRef.current
    const blobMimeType = audioMimeForPath(currentPath)
    if (blobMimeType) ws.setOptions({ blobMimeType })
    ws.load(window.api.fileUrl(currentPath)).catch((err) => {
      if (loadSeqRef.current !== loadId || isAbortError(err)) return
      failPlayback(err)
    })
  }, [currentMissing, currentPath, player.playingId, player.seekNonce, setPlaying, failPlayback])

  // React to play/pause toggles.
  useEffect(() => {
    const ws = wsRef.current
    if (!ws || !readyRef.current) {
      playIntentRef.current = player.isPlaying
      return
    }
    if (player.isPlaying) playReadyTrack(ws)
    else ws.pause()
  }, [player.isPlaying, playReadyTrack])

  // Volume.
  useEffect(() => {
    wsRef.current?.setVolume(player.volume)
  }, [player.volume])

  const progressColor = current ? col.solid : '#8b5cff'
  useEffect(() => {
    wsRef.current?.setOptions({ progressColor })
  }, [progressColor])

  return (
    <footer className="flex h-[84px] shrink-0 items-center gap-4 border-t border-white/8 bg-black/30 px-4 glass">
      <button
        onClick={togglePlay}
        disabled={!current}
        className="grid h-12 w-12 shrink-0 place-items-center rounded-full transition disabled:opacity-30"
        style={{ background: current ? col.solid : 'rgba(255,255,255,0.08)', color: current ? '#0b0b11' : '#fff' }}
      >
        {player.isPlaying ? <Pause width={20} height={20} /> : <Play width={19} height={19} />}
      </button>

      <div className="hidden sm:flex w-56 shrink-0 flex-col gap-1">
        {current ? (
          <>
            <div className="flex items-center gap-2">
              <KeyBadge
                tonic={current.keyTonic}
                mode={current.keyMode}
                source={current.keySource}
                confidence={current.keyConfidence}
                pending={current.needsAudioAnalysis}
                size="sm"
              />
              <span className="truncate text-sm text-white/85" title={current.filename}>
                {current.filename}
              </span>
            </div>
            <span className={`truncate text-[11px] ${loadError ? 'text-rose-200/70' : 'text-white/35'}`}>
              {loadError ?? current.folder ?? '—'}
            </span>
          </>
        ) : (
          <span className="text-sm text-white/35">Select a sound to preview</span>
        )}
      </div>

      <div className="flex flex-1 items-center gap-3">
        <span className="w-10 text-right font-mono text-[11px] text-white/45 tabular-nums">{formatDuration(time)}</span>
        <div ref={containerRef} className="flex-1 min-w-0" />
        <span className="w-10 font-mono text-[11px] text-white/45 tabular-nums">{formatDuration(duration)}</span>
      </div>

      <button
        onClick={toggleLoop}
        className="shrink-0 rounded-md p-2 transition"
        style={{ background: player.loop ? 'rgba(139,92,255,0.2)' : 'transparent', color: player.loop ? '#c9b6ff' : 'rgba(255,255,255,0.45)' }}
        title="Loop"
      >
        <Loop width={17} height={17} />
      </button>

      <div className="flex shrink-0 items-center gap-2">
        <button onClick={() => setVolume(player.volume > 0 ? 0 : DEFAULT_VOLUME)} className="text-white/45 hover:text-white/70">
          {player.volume > 0 ? <Volume width={17} height={17} /> : <Mute width={17} height={17} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={player.volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="w-20"
        />
      </div>
    </footer>
  )
}
