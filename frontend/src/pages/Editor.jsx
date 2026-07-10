import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  Play, Pause, SkipBack, SkipForward, Scissors, Type, Image as ImageIcon,
  Film, Volume2, VolumeX, Download, ChevronLeft, Settings, Plus, Trash2,
  Move, ZoomIn, ZoomOut, RotateCcw, Save, Monitor, Smartphone,
  Music, Upload, X, Check, Copy, Undo2, Redo2, Repeat, Square,
  Mic, SplitSquareHorizontal
} from 'lucide-react'
import { getProject, getScenes, getShotImage, getShotVideo, getEditorState, saveEditorState, exportVideo, uploadMedia, regenerateShot, wsManager } from '../services/api'

const EXPORT_PRESETS = [
  { id: 'youtube', name: 'YouTube', icon: Monitor, width: 1920, height: 1080, ratio: '16:9', fps: 30 },
  { id: 'youtube-shorts', name: 'YouTube Shorts', icon: Smartphone, width: 1080, height: 1920, ratio: '9:16', fps: 30 },
  { id: 'tiktok', name: 'TikTok', icon: Smartphone, width: 1080, height: 1920, ratio: '9:16', fps: 30 },
  { id: 'instagram-reels', name: 'Instagram Reels', icon: Smartphone, width: 1080, height: 1920, ratio: '9:16', fps: 30 },
  { id: 'instagram-post', name: 'Instagram Post', icon: Smartphone, width: 1080, height: 1080, ratio: '1:1', fps: 30 },
  { id: 'twitter', name: 'Twitter/X', icon: Monitor, width: 1280, height: 720, ratio: '16:9', fps: 30 },
  { id: 'custom', name: 'Custom', icon: Settings, width: 1920, height: 1080, ratio: '16:9', fps: 30 },
]

const TRANSITIONS = [
  { id: 'none', name: 'None' },
  { id: 'fade', name: 'Fade' },
  { id: 'dissolve', name: 'Dissolve' },
  { id: 'wipe-left', name: 'Wipe Left' },
  { id: 'wipe-right', name: 'Wipe Right' },
  { id: 'slide-left', name: 'Slide Left' },
  { id: 'slide-right', name: 'Slide Right' },
  { id: 'zoom-in', name: 'Zoom In' },
  { id: 'zoom-out', name: 'Zoom Out' },
]

const MAX_HISTORY = 50

function uid() { return `c${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }

function reindex(clips) {
  if (!Array.isArray(clips)) return []
  let time = 0
  return clips.map(c => {
    const s = time
    const e = time + c.duration
    time = e
    return { ...c, startTime: s, endTime: e }
  })
}

function makeClip(sceneId, shotIdx, duration, opts = {}) {
  return {
    id: opts.id || uid(),
    sceneId: sceneId || 0,
    shotIdx: shotIdx || 0,
    type: opts.type || 'image',
    src: opts.src || null,
    thumbnail: opts.thumbnail || null,
    file: opts.file || null,
    duration: duration || 5,
    startTime: 0,
    endTime: 0,
    trimStart: opts.trimStart || 0,
    trimEnd: opts.trimEnd || 0,
    transition: opts.transition || 'none',
    transitionDuration: 0.5,
    volume: opts.volume ?? 1,
    speed: opts.speed ?? 1,
    opacity: opts.opacity ?? 1,
    prompt: opts.prompt || '',
    status: opts.status || 'generated',
    sourceType: opts.sourceType || 'generated',
    track: opts.track || 'video',
    name: opts.name || '',
    reversed: opts.reversed || false,
    frozen: opts.frozen || false,
    brightness: opts.brightness ?? 0,
    contrast: opts.contrast ?? 1,
    saturation: opts.saturation ?? 1,
    temperature: opts.temperature ?? 0,
    keyframes: opts.keyframes || [],
    speedRamp: opts.speedRamp || null,
  }
}

const SNAP_THRESHOLD = 5

function snapTime(time, clips, excludeId, threshold = SNAP_THRESHOLD) {
  const candidates = [0]
  for (const c of clips) {
    if (c.id === excludeId) continue
    candidates.push(c.startTime, c.endTime)
  }
  for (const t of candidates) {
    if (Math.abs(time - t) < threshold / 1000 * totalDurationRef.current) return t
  }
  return time
}

let totalDurationRef = { current: 0 }

function AudioWaveform({ audioRef, width = 200, height = 30, color = '#4ade80' }) {
  const canvasRef = useRef(null)
  const [bars, setBars] = useState(null)

  useEffect(() => {
    const numBars = Math.floor(width / 3)
    const generated = []
    for (let i = 0; i < numBars; i++) {
      generated.push(0.2 + Math.random() * 0.8)
    }
    setBars(generated)
  }, [width])

  useEffect(() => {
    if (!bars || !canvasRef.current) return
    const ctx = canvasRef.current.getContext('2d')
    ctx.clearRect(0, 0, width, height)
    const barW = 2
    const gap = 1
    bars.forEach((h, i) => {
      const x = i * (barW + gap)
      const barH = h * height * 0.8
      const y = (height - barH) / 2
      ctx.fillStyle = color
      ctx.globalAlpha = 0.6 + h * 0.4
      ctx.fillRect(x, y, barW, barH)
    })
  }, [bars, width, height, color])

  return <canvas ref={canvasRef} width={width} height={height} className="w-full h-full" />
}

export default function Editor() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [project, setProject] = useState(null)
  const [scenes, setScenes] = useState([])
  const [loading, setLoading] = useState(true)
  const [clips, setClips] = useState([])
  const [audioClips, setAudioClips] = useState([])
  const [selectedClip, setSelectedClip] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [totalDuration, setTotalDuration] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [loop, setLoop] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState(EXPORT_PRESETS[0])
  const [customWidth, setCustomWidth] = useState(1920)
  const [customHeight, setCustomHeight] = useState(1080)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportMessage, setExportMessage] = useState('')
  const [showTextEditor, setShowTextEditor] = useState(false)
  const [textOverlays, setTextOverlays] = useState([])
  const [selectedText, setSelectedText] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragClip, setDragClip] = useState(null)
  const [history, setHistory] = useState([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [muted, setMuted] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [recording, setRecording] = useState(false)
  const [trimming, setTrimming] = useState(null)
  const [trimSide, setTrimSide] = useState(null)
  const [showProperties, setShowProperties] = useState(true)
  const [propertiesWidth, setPropertiesWidth] = useState(300)
  const [showMobileToolbar, setShowMobileToolbar] = useState(false)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [proxyMode, setProxyMode] = useState(false)

  const timelineRef = useRef(null)
  const playTimerRef = useRef(null)
  const lastTickRef = useRef(null)
  const imageInputRef = useRef(null)
  const videoInputRef = useRef(null)
  const audioInputRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const recordedChunksRef = useRef([])
  const previewVideoRef = useRef(null)
  const backgroundAudioRef = useRef(null)

  const canUndo = historyIdx > 0
  const canRedo = historyIdx < history.length - 1

  const pushHistory = useCallback((newClips) => {
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIdx + 1)
      const next = [...trimmed, JSON.parse(JSON.stringify(newClips))]
      if (next.length > MAX_HISTORY) next.shift()
      return next
    })
    setHistoryIdx(prev => Math.min(prev + 1, MAX_HISTORY - 1))
  }, [historyIdx])

  const undo = useCallback(() => {
    if (!canUndo) return
    const prev = history[historyIdx - 1]
    if (!Array.isArray(prev)) return
    setClips(prev)
    setHistoryIdx(historyIdx - 1)
    recalcDuration(prev)
  }, [canUndo, history, historyIdx])

  const redo = useCallback(() => {
    if (!canRedo) return
    const next = history[historyIdx + 1]
    if (!Array.isArray(next)) return
    setClips(next)
    setHistoryIdx(historyIdx + 1)
    recalcDuration(next)
  }, [canRedo, history, historyIdx])

  const recalcDuration = (c) => {
    if (!Array.isArray(c)) return
    let t = 0
    for (const clip of c) t += clip.duration
    setTotalDuration(t)
    totalDurationRef.current = t
  }

  const getClipAtTime = useCallback((time) => {
    if (!Array.isArray(clips)) return null
    for (const clip of clips) {
      if (time >= clip.startTime && time < clip.endTime) return clip
    }
    return clips.length > 0 ? clips[clips.length - 1] : null
  }, [clips])

  const currentClip = useMemo(() => getClipAtTime(currentTime), [getClipAtTime, currentTime])

  const updateClips = (newClips, skipHistory) => {
    if (!Array.isArray(newClips)) return
    const indexed = reindex(newClips)
    setClips(indexed)
    let t = 0
    for (const c of indexed) t += c.duration
    setTotalDuration(t)
    totalDurationRef.current = t
    if (!skipHistory) pushHistory(indexed)
  }

  useEffect(() => { loadData() }, [id])

  useEffect(() => {
    if (!id) return
    let downloaded = false
    const unsub = wsManager.connect(id, (data) => {
      if (data.type === 'export_progress') {
        setExportProgress(data.progress || 0)
        setExportMessage(data.message || 'Exporting...')
      }
      else if (data.type === 'export_completed') {
        setExportProgress(1)
        setExportMessage('Export complete!')
        setExporting(false)
        if (!downloaded) {
          downloaded = true
          toast.success('Export complete! Downloading...')
          const a = document.createElement('a')
          a.href = `/api/projects/${id}/download`
          a.download = 'documentary.mp4'
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
        }
        setTimeout(() => setShowExport(false), 1500)
      }
      else if (data.type === 'error') { toast.error(data.message || 'Export failed'); setExporting(false); setExportMessage(data.message || 'Failed') }
    })
    return () => { downloaded = false; wsManager.disconnect(id) }
  }, [id])

  useEffect(() => {
    if (playing && totalDuration > 0) {
      lastTickRef.current = performance.now()
      const tick = (now) => {
        const delta = (now - lastTickRef.current) / 1000
        lastTickRef.current = now
        setCurrentTime(prev => {
          const next = prev + delta
          if (next >= totalDuration) {
            if (loop) return 0
            setPlaying(false)
            return totalDuration
          }
          return next
        })
        playTimerRef.current = requestAnimationFrame(tick)
      }
      playTimerRef.current = requestAnimationFrame(tick)
      return () => { if (playTimerRef.current) cancelAnimationFrame(playTimerRef.current) }
    } else {
      if (playTimerRef.current) cancelAnimationFrame(playTimerRef.current)
    }
  }, [playing, totalDuration, loop])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return
      if (e.code === 'Space') { e.preventDefault(); setPlaying(p => !p) }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); setCurrentTime(t => Math.max(0, t - (e.shiftKey ? 1 : 0.1))) }
      else if (e.code === 'ArrowRight') { e.preventDefault(); setCurrentTime(t => Math.min(totalDuration, t + (e.shiftKey ? 1 : 0.1))) }
      else if (e.code === 'Delete' || e.code === 'Backspace') {
        if (selectedText) { e.preventDefault(); deleteText(selectedText) }
        else if (selectedClip) { e.preventDefault(); deleteClip(selectedClip) }
      }
      else if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redo() : undo() }
      else if ((e.metaKey || e.ctrlKey) && e.code === 'KeyD') { e.preventDefault(); if (selectedClip) duplicateClip(selectedClip) }
      else if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') { e.preventDefault(); handleSave() }
      else if (e.code === 'KeyS' && !e.metaKey && !e.ctrlKey) { if (selectedClip) { e.preventDefault(); splitClipAtPlayhead(selectedClip) } }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedClip, selectedText, totalDuration, undo, redo])

  const loadData = async () => {
    try {
      const [proj, scns] = await Promise.all([getProject(id), getScenes(id)])
      setProject(proj)
      setScenes(scns)

      let allClips = []
      try {
        const ed = await getEditorState(id)
        if (ed && ed.clips && Array.isArray(ed.clips) && ed.clips.length > 0) {
          allClips = ed.clips.map(c => makeClip(c.scene_id, c.shot_id, c.duration || 5, {
            id: c.id, type: c.type, transition: c.transitions?.in,
            prompt: c.prompt, status: c.status, sourceType: c.source_type,
            src: c.src, name: c.name, track: c.track,
            volume: c.volume, speed: c.speed, trimStart: c.trim_start, trimEnd: c.trim_end,
            brightness: c.brightness, contrast: c.contrast, saturation: c.saturation, temperature: c.temperature,
            opacity: c.opacity, reversed: c.reversed, frozen: c.frozen,
            keyframes: c.keyframes, speedRamp: c.speed_ramp,
          }))
          setTextOverlays(ed.text_overlays || [])
          if (ed.audio_clips && Array.isArray(ed.audio_clips)) {
            setAudioClips(ed.audio_clips.map(a => ({
              id: a.id || uid(), name: a.name || '', src: a.src || null,
              volume: a.volume ?? 0.7, duration: a.duration || totalDuration,
              type: a.type || 'music', track: 'audio',
            })))
          }
        }
      } catch (e) {}

      if (allClips.length === 0) {
        for (const scene of scns) {
          const shots = scene.shots || []
          for (let i = 0; i < shots.length; i++) {
            const shot = shots[i]
            const dur = shot.duration_seconds || scene.duration_seconds / shots.length || 3
            allClips.push(makeClip(scene.id, i, dur, {
              type: shot.video_path ? 'video' : 'image',
              prompt: shot.prompt, status: shot.image_status, sourceType: shot.source_type,
            }))
          }
        }
      }

      const indexed = reindex(allClips)
      setClips(indexed)
      let t = 0
      for (const c of indexed) t += c.duration
      setTotalDuration(t)
      totalDurationRef.current = t
      setHistory([JSON.parse(JSON.stringify(indexed))])
      setHistoryIdx(0)

      for (const clip of indexed) {
        if (!clip.sceneId || clip.sceneId < 1) {
          if (clip.src && !clip.thumbnail) clip.thumbnail = clip.src
          continue
        }
        if (clip.sourceType === 'uploaded' && clip.src) {
          if (!clip.thumbnail) clip.thumbnail = clip.src
          continue
        }
        try {
          if (clip.type === 'video') {
            const vUrl = await getShotVideo(id, clip.sceneId, clip.shotIdx, Date.now())
            clip.thumbnail = vUrl
            clip.src = vUrl
          } else {
            const url = await getShotImage(id, clip.sceneId, clip.shotIdx, Date.now())
            clip.thumbnail = url
            clip.src = url
          }
        } catch (e) {
          try {
            const vUrl = await getShotVideo(id, clip.sceneId, clip.shotIdx, Date.now())
            clip.thumbnail = vUrl
            clip.src = vUrl
            clip.type = 'video'
          } catch (e2) {
            try {
              const url = await getShotImage(id, clip.sceneId, clip.shotIdx, Date.now())
              clip.thumbnail = url
              if (!clip.src) clip.src = url
            } catch (e3) {
              if (clip.src && !clip.thumbnail) clip.thumbnail = clip.src
            }
          }
        }
      }
      setClips([...indexed])
      setSelectedClip(prev => {
        if (prev && indexed.some(c => c.id === prev)) return prev
        return indexed.length > 0 ? indexed[0].id : null
      })
    } catch (err) {
      toast.error('Failed to load project')
      navigate('/projects')
    } finally { setLoading(false) }
  }

  const handlePlayPause = () => setPlaying(p => !p)
  const handleSeek = (time) => {
    const snapped = snapTime(Math.max(0, Math.min(time, totalDuration)), clips, selectedClip)
    setCurrentTime(snapped)
    // Sync audio with seek
    const audio = backgroundAudioRef.current
    if (audio) {
      audio.currentTime = snapped
    }
  }

  // Sync background audio with playback state
  useEffect(() => {
    const audio = backgroundAudioRef.current
    if (!audio) return
    if (playing) {
      audio.currentTime = currentTime
      audio.volume = audioClips.find(c => c.type === 'music')?.volume || 0.7
      audio.play().catch(() => {})
    } else {
      audio.pause()
    }
  }, [playing, audioClips])

  // Keep audio volume in sync with clip volume
  useEffect(() => {
    const audio = backgroundAudioRef.current
    if (!audio) return
    const musicClip = audioClips.find(c => c.type === 'music')
    if (musicClip) {
      audio.volume = musicClip.volume || 0.7
    }
  }, [audioClips])

  const handleTimelineClick = (e) => {
    if (!timelineRef.current) return
    const rect = timelineRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left + timelineRef.current.scrollLeft - 64
    const contentWidth = Math.max(rect.width, rect.width * zoom) - 64
    const pct = Math.max(0, Math.min(1, x / contentWidth))
    handleSeek(pct * totalDuration)
  }

  const handleTimelineMouseDown = (e) => {
    if (!timelineRef.current) return
    if (e.button !== 0) return
    if (e.target.closest('[data-trim]')) return
    setIsScrubbing(true)
    const rect = timelineRef.current.getBoundingClientRect()
    const update = (ev) => {
      if (!timelineRef.current) return
      const x = ev.clientX - rect.left + timelineRef.current.scrollLeft - 64
      const contentWidth = Math.max(rect.width, rect.width * zoom) - 64
      const pct = Math.max(0, Math.min(1, x / contentWidth))
      handleSeek(pct * totalDuration)
    }
    update(e)
    const onMove = (ev) => update(ev)
    const onUp = () => {
      setIsScrubbing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const handleTimelineTouchStart = (e) => {
    if (!timelineRef.current) return
    if (e.target.closest('[data-trim]')) return
    setIsScrubbing(true)
    const rect = timelineRef.current.getBoundingClientRect()
    const touch = e.touches[0]
    const x = touch.clientX - rect.left + timelineRef.current.scrollLeft - 64
    const contentWidth = Math.max(rect.width, rect.width * zoom) - 64
    const pct = Math.max(0, Math.min(1, x / contentWidth))
    handleSeek(pct * totalDuration)
  }

  const handleTimelineTouchMove = (e) => {
    if (!timelineRef.current || !isScrubbing) return
    e.preventDefault()
    const rect = timelineRef.current.getBoundingClientRect()
    const touch = e.touches[0]
    const x = touch.clientX - rect.left + timelineRef.current.scrollLeft - 64
    const contentWidth = Math.max(rect.width, rect.width * zoom) - 64
    const pct = Math.max(0, Math.min(1, x / contentWidth))
    handleSeek(pct * totalDuration)
  }

  const handleTimelineTouchEnd = () => {
    setIsScrubbing(false)
  }

  const handleClipSelect = (clipId) => {
    setSelectedClip(clipId)
    const clip = clips.find(c => c.id === clipId)
    if (clip) setCurrentTime(clip.startTime)
  }

  const handleClipDragStart = (e, clipId) => { setIsDragging(true); setDragClip(clipId); e.dataTransfer.effectAllowed = 'move' }
  const handleClipDragOver = (e, targetId) => {
    e.preventDefault()
    if (dragClip === targetId) return
    const nc = [...clips]
    const di = nc.findIndex(c => c.id === dragClip)
    const ti = nc.findIndex(c => c.id === targetId)
    if (di === -1 || ti === -1) return
    const [removed] = nc.splice(di, 1)
    nc.splice(ti, 0, removed)
    updateClips(nc)
  }
  const handleClipDragEnd = () => { setIsDragging(false); setDragClip(null) }

  const deleteClip = (clipId) => {
    const idx = clips.findIndex(c => c.id === clipId)
    if (idx === -1) return
    const clip = clips[idx]
    const remaining = clips.filter(c => c.id !== clipId)
    if (remaining.length > 0) {
      const prev = remaining[Math.min(idx, remaining.length - 1)]
      if (prev) {
        prev.duration += clip.duration
      }
    }
    updateClips(remaining)
    if (selectedClip === clipId) setSelectedClip(null)
  }

  const reverseClip = (clipId) => {
    updateClips(clips.map(c => c.id === clipId ? { ...c, reversed: !c.reversed } : c))
    toast.info('Reverse toggled')
  }

  const freezeFrame = (clipId) => {
    const clip = clips.find(c => c.id === clipId)
    if (!clip) return
    const freeze = makeClip(clip.sceneId, clip.shotIdx, 3, {
      type: clip.type, transition: 'none', prompt: clip.prompt,
      status: clip.status, sourceType: clip.sourceType, src: clip.src,
      thumbnail: clip.thumbnail, track: clip.track, name: 'Freeze Frame',
      frozen: true,
    })
    const idx = clips.indexOf(clip)
    updateClips([...clips.slice(0, idx + 1), freeze, ...clips.slice(idx + 1)])
    toast.success('Freeze frame added')
  }

  const duplicateClip = (clipId) => {
    const clip = clips.find(c => c.id === clipId)
    if (!clip) return
    const dup = makeClip(clip.sceneId, clip.shotIdx, clip.duration, {
      type: clip.type, transition: clip.transition, prompt: clip.prompt,
      status: clip.status, sourceType: clip.sourceType, src: clip.src,
      thumbnail: clip.thumbnail, file: clip.file, track: clip.track, name: clip.name,
    })
    const idx = clips.indexOf(clip)
    updateClips([...clips.slice(0, idx + 1), dup, ...clips.slice(idx + 1)])
    setSelectedClip(dup.id)
  }

  const splitClipAtPlayhead = (clipId) => {
    const clip = clips.find(c => c.id === clipId)
    if (!clip) return
    if (currentTime <= clip.startTime || currentTime >= clip.endTime) {
      toast.warning('Playhead must be inside the clip to split')
      return
    }
    const splitPoint = currentTime - clip.startTime
    const left = makeClip(clip.sceneId, clip.shotIdx, splitPoint, {
      id: clip.id, type: clip.type, transition: clip.transition, prompt: clip.prompt,
      status: clip.status, sourceType: clip.sourceType, src: clip.src,
      thumbnail: clip.thumbnail, file: clip.file, track: clip.track, name: clip.name,
      volume: clip.volume, speed: clip.speed,
    })
    const right = makeClip(clip.sceneId, clip.shotIdx, clip.duration - splitPoint, {
      type: clip.type, transition: clip.transition, prompt: clip.prompt,
      status: clip.status, sourceType: clip.sourceType, src: clip.src,
      thumbnail: clip.thumbnail, file: clip.file, track: clip.track, name: clip.name,
      volume: clip.volume, speed: clip.speed,
    })
    const idx = clips.indexOf(clip)
    updateClips([...clips.slice(0, idx), left, right, ...clips.slice(idx + 1)])
    toast.success('Clip split')
  }

  const insertAtPlayhead = (newClip) => {
    let insertIdx = clips.length
    for (let i = 0; i < clips.length; i++) {
      if (currentTime < clips[i].startTime) { insertIdx = i; break }
      if (currentTime >= clips[i].startTime && currentTime < clips[i].endTime) { insertIdx = i + 1; break }
    }
    const nc = [...clips.slice(0, insertIdx), newClip, ...clips.slice(insertIdx)]
    updateClips(nc)
    setSelectedClip(newClip.id)
  }

  const handleAddImage = () => imageInputRef.current?.click()
  const handleAddVideo = () => videoInputRef.current?.click()
  const handleAddMusic = () => audioInputRef.current?.click()

  const handleImageFile = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      toast.info('Uploading image...')
      const data = await uploadMedia(id, file)
      const serverPath = data.path
      if (selectedClip) {
        updateClips(clips.map(c => c.id === selectedClip ? { ...c, type: 'image', src: serverPath, thumbnail: serverPath, sourceType: 'uploaded', name: file.name } : c))
        toast.success('Image replaced')
      } else {
        const clip = makeClip(0, 0, 5, { type: 'image', src: serverPath, thumbnail: serverPath, file, sourceType: 'uploaded', name: file.name })
        insertAtPlayhead(clip)
        toast.success('Image added at playhead')
      }
    } catch (err) {
      const url = URL.createObjectURL(file)
      if (selectedClip) {
        updateClips(clips.map(c => c.id === selectedClip ? { ...c, type: 'image', src: url, thumbnail: url, sourceType: 'uploaded', name: file.name } : c))
        toast.warning('Added locally')
      } else {
        const clip = makeClip(0, 0, 5, { type: 'image', src: url, thumbnail: url, file, sourceType: 'uploaded', name: file.name })
        insertAtPlayhead(clip)
        toast.warning('Added locally (may not persist after reload)')
      }
    }
    e.target.value = ''
  }

  const handleVideoFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    const vid = document.createElement('video')
    vid.preload = 'metadata'
    vid.onloadedmetadata = async () => {
      const dur = vid.duration || 5
      try {
        toast.info('Uploading video...')
        const data = await uploadMedia(id, file)
        const serverPath = data.path
        if (selectedClip) {
          updateClips(clips.map(c => c.id === selectedClip ? { ...c, type: 'video', src: serverPath, thumbnail: serverPath, duration: dur, sourceType: 'uploaded', name: file.name } : c))
          toast.success('Video replaced')
        } else {
          const clip = makeClip(0, 0, dur, { type: 'video', src: serverPath, thumbnail: serverPath, file, sourceType: 'uploaded', name: file.name })
          insertAtPlayhead(clip)
          toast.success('Video added at playhead')
        }
        URL.revokeObjectURL(url)
      } catch (err) {
        if (selectedClip) {
          updateClips(clips.map(c => c.id === selectedClip ? { ...c, type: 'video', src: url, thumbnail: url, duration: dur, sourceType: 'uploaded', name: file.name } : c))
          toast.warning('Added locally')
        } else {
          const clip = makeClip(0, 0, dur, { type: 'video', src: url, thumbnail: url, file, sourceType: 'uploaded', name: file.name })
          insertAtPlayhead(clip)
          toast.warning('Added locally (may not persist after reload)')
        }
      }
    }
    vid.src = url
    e.target.value = ''
  }

  const handleAudioFile = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      const formData = new FormData()
      formData.append('file', file)
      const resp = await fetch(`/api/projects/${id}/upload-audio`, { method: 'POST', body: formData })
      const data = await resp.json()
      const fileUrl = data.path || URL.createObjectURL(file)
      const fileDur = await new Promise((resolve) => {
        const aud = document.createElement('audio')
        aud.preload = 'metadata'
        aud.onloadedmetadata = () => resolve(aud.duration || 5)
        aud.onerror = () => resolve(5)
        aud.src = URL.createObjectURL(file)
      })
      const clip = makeClip(0, 0, totalDuration, {
        type: 'music',
        src: fileUrl,
        file,
        sourceType: 'uploaded',
        name: file.name,
        track: 'audio',
        volume: 0.7,
        fileDuration: fileDur,
      })
      setAudioClips(prev => [...prev, clip])
      toast.success(`Background music added (${Math.round(totalDuration)}s)`)
    } catch (err) {
      const url = URL.createObjectURL(file)
      const clip = makeClip(0, 0, totalDuration, {
        type: 'music',
        src: url,
        file,
        sourceType: 'uploaded',
        name: file.name,
        track: 'audio',
        volume: 0.7,
      })
      setAudioClips(prev => [...prev, clip])
      toast.success(`Background music added (${Math.round(totalDuration)}s)`)
    }
    e.target.value = ''
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      recordedChunksRef.current = []
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data) }
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' })
        const url = URL.createObjectURL(blob)
        const clip = makeClip(0, 0, 5, { type: 'voiceover', src: url, sourceType: 'recorded', name: 'Voiceover', track: 'audio', volume: 1 })
        setAudioClips(prev => [...prev, clip])
        stream.getTracks().forEach(t => t.stop())
        toast.success('Voiceover recorded')
      }
      mediaRecorder.start()
      setRecording(true)
      toast.info('Recording... click stop when done')
    } catch (err) {
      toast.error('Microphone access denied')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop()
      setRecording(false)
    }
  }

  const handleTrimStart = (clipId, e) => { e.stopPropagation(); setTrimming(clipId); setTrimSide('left') }
  const handleTrimEnd = (clipId, e) => { e.stopPropagation(); setTrimming(clipId); setTrimSide('right') }

  const handleTrimMove = (e) => {
    if (!trimming || !timelineRef.current) return
    const rect = timelineRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left + timelineRef.current.scrollLeft
    const pct = x / (rect.width * zoom)
    const time = pct * totalDuration
    updateClips(clips.map(c => {
      if (c.id !== trimming) return c
      if (trimSide === 'left') {
        const maxTrim = c.duration - 0.5
        const trimAmount = Math.max(0, Math.min(maxTrim, time - c.startTime))
        return { ...c, trimStart: trimAmount, duration: c.duration - trimAmount + (c.trimStart || 0) }
      } else {
        const maxTrim = c.duration - 0.5
        const trimAmount = Math.max(0, Math.min(maxTrim, c.endTime - time))
        return { ...c, trimEnd: trimAmount, duration: c.duration - trimAmount + (c.trimEnd || 0) }
      }
    }), true)
  }

  const handleTrimEnd2 = () => { setTrimming(null); setTrimSide(null) }

  useEffect(() => {
    if (trimming) {
      window.addEventListener('mousemove', handleTrimMove)
      window.addEventListener('mouseup', handleTrimEnd2)
      return () => {
        window.removeEventListener('mousemove', handleTrimMove)
        window.removeEventListener('mouseup', handleTrimEnd2)
      }
    }
  }, [trimming, trimSide, clips, zoom, totalDuration])

  const handleTransitionChange = (clipId, transition) => updateClips(clips.map(c => c.id === clipId ? { ...c, transition } : c))
  const handleVolumeChange = (clipId, volume) => updateClips(clips.map(c => c.id === clipId ? { ...c, volume } : c))
  const handleSpeedChange = (clipId, speed) => updateClips(clips.map(c => c.id === clipId ? { ...c, speed } : c))
  const handleDurationChange = (clipId, duration) => updateClips(clips.map(c => c.id === clipId ? { ...c, duration: Math.max(0.5, duration) } : c))
  const handleBrightnessChange = (clipId, val) => updateClips(clips.map(c => c.id === clipId ? { ...c, brightness: parseFloat(val) } : c))
  const handleContrastChange = (clipId, val) => updateClips(clips.map(c => c.id === clipId ? { ...c, contrast: parseFloat(val) } : c))
  const handleSaturationChange = (clipId, val) => updateClips(clips.map(c => c.id === clipId ? { ...c, saturation: parseFloat(val) } : c))
  const handleTemperatureChange = (clipId, val) => updateClips(clips.map(c => c.id === clipId ? { ...c, temperature: parseFloat(val) } : c))

  const addKeyframe = (clipId, prop) => {
    updateClips(clips.map(c => {
      if (c.id !== clipId) return c
      const kfs = [...(c.keyframes || []), { time: currentTime - c.startTime, prop, value: c[prop] }]
      kfs.sort((a, b) => a.time - b.time)
      return { ...c, keyframes: kfs }
    }))
    toast.success('Keyframe added')
  }

  const removeKeyframe = (clipId, idx) => {
    updateClips(clips.map(c => {
      if (c.id !== clipId) return c
      const kfs = (c.keyframes || []).filter((_, i) => i !== idx)
      return { ...c, keyframes: kfs }
    }))
  }

  const speedRampPreset = (clipId, preset) => {
    const presets = {
      'slow-in': [{ time: 0, value: 0.5 }, { time: 1, value: 1 }],
      'slow-out': [{ time: 0, value: 1 }, { time: 1, value: 0.5 }],
      'fast-in': [{ time: 0, value: 2 }, { time: 1, value: 1 }],
      'fast-out': [{ time: 0, value: 1 }, { time: 1, value: 2 }],
      'bounce': [{ time: 0, value: 0.5 }, { time: 0.5, value: 2 }, { time: 1, value: 0.5 }],
    }
    updateClips(clips.map(c => c.id === clipId ? { ...c, speedRamp: presets[preset] || null } : c))
    toast.success(`Speed ramp: ${preset}`)
  }

  const handleAddText = () => {
    const newText = { id: uid(), text: 'New Text', x: 50, y: 50, fontSize: 24, fontFamily: 'Arial', color: '#ffffff', backgroundColor: 'transparent', startTime: currentTime, endTime: currentTime + 3, animation: 'none' }
    setTextOverlays([...textOverlays, newText])
    setSelectedText(newText.id)
    setShowTextEditor(true)
  }

  const deleteText = (textId) => {
    setTextOverlays(textOverlays.filter(t => t.id !== textId))
    if (selectedText === textId) { setSelectedText(null); setShowTextEditor(false) }
  }

  const handleSave = async () => {
    try {
      await saveEditorState(id, {
        clips: clips.map(c => ({
          id: c.id, scene_id: c.sceneId, shot_id: c.shotIdx, type: c.type,
          duration: c.duration, volume: c.volume, speed: c.speed,
          trim_start: c.trimStart, trim_end: c.trimEnd,
          transitions: { in: c.transition },
          brightness: c.brightness, contrast: c.contrast,
          saturation: c.saturation, temperature: c.temperature,
          opacity: c.opacity, reversed: c.reversed, frozen: c.frozen,
          keyframes: c.keyframes, speed_ramp: c.speedRamp,
          source_type: c.sourceType, src: c.src?.startsWith('blob:') ? null : c.src, name: c.name,
          prompt: c.prompt, track: c.track,
        })),
        text_overlays: textOverlays,
        audio_clips: audioClips.map(a => ({ id: a.id, name: a.name, src: a.src?.startsWith('blob:') ? null : a.src, volume: a.volume, duration: a.duration, type: a.type })),
      })
      toast.success('Saved!')
    } catch (e) { toast.error('Failed to save') }
  }

  const handleExport = async () => {
    try {
      setExporting(true)
      setExportProgress(0)
      setExportMessage('Preparing export...')
      const preset = selectedPreset.id === 'custom' ? { ...selectedPreset, width: customWidth, height: customHeight } : selectedPreset
      await saveEditorState(id, {
        clips: clips.map(c => ({
          id: c.id, scene_id: c.sceneId, shot_id: c.shotIdx, type: c.type,
          duration: c.duration, volume: c.volume, speed: c.speed,
          trim_start: c.trimStart, trim_end: c.trimEnd,
          transitions: { in: c.transition },
          brightness: c.brightness, contrast: c.contrast,
          saturation: c.saturation, temperature: c.temperature,
          opacity: c.opacity, reversed: c.reversed, frozen: c.frozen,
          keyframes: c.keyframes, speed_ramp: c.speedRamp,
          source_type: c.sourceType, src: c.src?.startsWith('blob:') ? null : c.src, name: c.name, track: c.track,
          prompt: c.prompt,
        })),
        text_overlays: textOverlays,
        audio_clips: audioClips.map(a => ({ id: a.id, name: a.name, src: a.src?.startsWith('blob:') ? null : a.src, volume: a.volume, duration: a.duration, type: a.type })),
      })
      await exportVideo(id, { width: preset.width, height: preset.height, fps: preset.fps, preset: preset.id })
    } catch (e) { toast.error('Export failed'); setExporting(false); setExportMessage('Failed') }
  }

  const formatTime = (s) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    const ms = Math.floor((s % 1) * 100)
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
  }

  if (loading) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading editor...</p>
        </div>
      </div>
    )
  }

  const selectedClipData = clips.find(c => c.id === selectedClip)
  const activeClip = selectedClipData || currentClip

  return (
    <div className="h-[calc(100vh-3.5rem)] sm:h-[calc(100vh-4rem)] bg-gray-950 flex flex-col overflow-hidden select-none" onMouseUp={handleTrimEnd2}>
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-2 sm:px-4 py-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <button onClick={() => navigate(`/project/${id}`)} className="text-gray-400 hover:text-white flex-shrink-0"><ChevronLeft className="w-5 h-5" /></button>
          <h1 className="text-white font-semibold truncate text-sm sm:text-base max-w-[120px] sm:max-w-xs">{project?.name || 'Untitled'}</h1>
          <span className="text-[10px] sm:text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded hidden sm:inline">{clips.length} clips &middot; {formatTime(totalDuration)}</span>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <button onClick={undo} disabled={!canUndo} className="p-2 text-gray-400 hover:text-white disabled:opacity-30" title="Undo"><Undo2 className="w-4 h-4" /></button>
          <button onClick={redo} disabled={!canRedo} className="p-2 text-gray-400 hover:text-white disabled:opacity-30" title="Redo"><Redo2 className="w-4 h-4" /></button>
          <div className="h-5 w-px bg-gray-700 mx-0.5 sm:mx-1 hidden sm:block" />
          <button onClick={() => setProxyMode(p => !p)} className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm ${proxyMode ? 'bg-green-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`} title="Proxy mode">
            <span className="text-[10px]">{proxyMode ? 'PROXY ON' : 'PROXY'}</span>
          </button>
          <button onClick={handleSave} className="flex items-center gap-1 bg-gray-700 hover:bg-gray-600 text-white px-2 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm"><Save className="w-4 h-4" /><span className="hidden sm:inline">Save</span></button>
          {!showProperties && (
            <button onClick={() => setShowProperties(true)} className="flex items-center gap-1 bg-gray-700 hover:bg-gray-600 text-white px-2 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm" title="Show properties">
              <Settings className="w-4 h-4" />
            </button>
          )}
          <button onClick={() => setShowExport(true)} disabled={exporting} className="flex items-center gap-1 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white px-2 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm">
            {exporting ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Download className="w-4 h-4" />}<span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Mobile toolbar toggle */}
        <button onClick={() => setShowMobileToolbar(p => !p)} className="md:hidden fixed bottom-20 left-2 z-50 bg-gray-800 border border-gray-600 rounded-full p-2.5 shadow-lg">
          <Plus className={`w-5 h-5 text-gray-300 transition-transform ${showMobileToolbar ? 'rotate-45' : ''}`} />
        </button>

        {/* Left Toolbar */}
        <div className={`${showMobileToolbar ? 'flex' : 'hidden'} md:flex flex-col items-center py-3 gap-1 flex-shrink-0 bg-gray-900 border-r border-gray-800 ${showMobileToolbar ? 'fixed inset-y-0 left-0 z-40 w-14 pt-14' : 'w-12'}`}>
          {[
            { icon: Type, title: 'Add Text', action: handleAddText },
            { icon: ImageIcon, title: 'Add Image', action: handleAddImage },
            { icon: Film, title: 'Add Video', action: handleAddVideo },
            { icon: Music, title: 'Add Music', action: handleAddMusic },
            { icon: Mic, title: recording ? 'Stop Recording' : 'Record Voiceover', action: recording ? stopRecording : startRecording, color: recording ? 'text-red-400' : '' },
          ].map(({ icon: Icon, title, action, color }, i) => (
            <React.Fragment key={title}>
              {i === 4 && <div className="h-px w-8 bg-gray-700 my-1" />}
              <button onClick={() => { action(); setShowMobileToolbar(false) }} className={`w-10 h-10 md:w-9 md:h-9 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 hover:text-white transition-colors ${color}`} title={title}>
                <Icon className="w-4 h-4" />
              </button>
            </React.Fragment>
          ))}
          {selectedClip && (
            <>
              <div className="h-px w-8 bg-gray-700 my-1" />
              <button onClick={() => { splitClipAtPlayhead(selectedClip); setShowMobileToolbar(false) }} className="w-10 h-10 md:w-9 md:h-9 rounded-lg bg-gray-800 hover:bg-yellow-900/50 flex items-center justify-center text-gray-400 hover:text-yellow-400 transition-colors" title="Split">
                <SplitSquareHorizontal className="w-4 h-4" />
              </button>
              <button onClick={() => { duplicateClip(selectedClip); setShowMobileToolbar(false) }} className="w-10 h-10 md:w-9 md:h-9 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 hover:text-white transition-colors" title="Duplicate">
                <Copy className="w-4 h-4" />
              </button>
              <button onClick={() => { deleteClip(selectedClip); setShowMobileToolbar(false) }} className="w-10 h-10 md:w-9 md:h-9 rounded-lg bg-gray-800 hover:bg-red-900/50 flex items-center justify-center text-gray-400 hover:text-red-400 transition-colors" title="Delete">
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Preview */}
          <div className="flex-1 bg-black flex items-center justify-center p-2 relative min-h-0">
            <div className="relative bg-gray-900 rounded-lg overflow-hidden shadow-2xl flex items-center justify-center" style={{ maxWidth: '100%', maxHeight: '100%', aspectRatio: `${selectedPreset.width}/${selectedPreset.height}` }}>
              {activeClip?.type === 'video' && activeClip?.src ? (
                <video
                  key={activeClip.id}
                  ref={previewVideoRef}
                  src={activeClip.src}
                  className="w-full h-full object-contain"
                  autoPlay={playing}
                  muted={muted}
                />
              ) : activeClip?.thumbnail ? (
                <img src={activeClip.thumbnail} className="w-full h-full object-contain" alt="" draggable={false} />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-gray-600 gap-2">
                  <Film className="w-12 h-12" />
                  <span className="text-xs">Select a clip to preview</span>
                </div>
              )}
              {/* Background music audio element */}
              {audioClips.filter(c => c.type === 'music' && c.src).map(clip => (
                <audio
                  key={clip.id}
                  ref={backgroundAudioRef}
                  src={clip.src}
                  loop
                  preload="auto"
                  style={{ display: 'none' }}
                />
              ))}
              {/* Text overlays */}
              {textOverlays.filter(t => currentTime >= t.startTime && currentTime <= t.endTime).map(text => (
                <div key={text.id} className="absolute cursor-move" style={{ left: `${text.x}%`, top: `${text.y}%`, fontSize: `${text.fontSize}px`, fontFamily: text.fontFamily, color: text.color, backgroundColor: text.backgroundColor, padding: '4px 8px', borderRadius: '4px' }}
                  onClick={() => { setSelectedText(text.id); setShowTextEditor(true) }}>
                  {text.text}
                </div>
              ))}
              {/* Overlay clips (PIP) */}
              {clips.filter(c => c.track === 'overlay' && currentTime >= c.startTime && currentTime < c.endTime).map(ov => (
                <div key={ov.id} className="absolute border border-orange-500/50 rounded overflow-hidden shadow-lg cursor-pointer"
                  style={{ left: `${ov.overlayX || 50}%`, top: `${ov.overlayY || 50}%`, width: `${ov.overlayScale || 30}%`, transform: 'translate(-50%, -50%)' }}
                  onClick={() => handleClipSelect(ov.id)}>
                  {ov.type === 'video' && ov.src ? (
                    <video src={ov.src} className="w-full h-full object-cover" autoPlay={playing} muted />
                  ) : ov.thumbnail ? (
                    <img src={ov.thumbnail} className="w-full h-full object-cover" alt="" />
                  ) : null}
                </div>
              ))}
              {/* Current clip label */}
              {activeClip && (
                <div className="absolute top-2 left-2 bg-black/70 px-2 py-1 rounded text-xs text-white">
                  {activeClip.name || `Scene ${activeClip.sceneId} Shot ${(activeClip.shotIdx || 0) + 1}`}
                </div>
              )}
              {/* Timecode */}
              <div className="absolute bottom-2 left-2 bg-black/70 px-2 py-1 rounded text-xs text-white font-mono">{formatTime(currentTime)}</div>
              {playing && <div className="absolute top-2 right-2 bg-red-600 px-2 py-0.5 rounded text-xs text-white flex items-center gap-1"><div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />REC</div>}
            </div>
          </div>

          {/* Transport Controls */}
          <div className="bg-gray-900 border-t border-gray-800 px-2 sm:px-4 py-2 flex items-center justify-center gap-2 sm:gap-3 flex-shrink-0">
            <button onClick={() => handleSeek(Math.max(0, currentTime - 5))} className="text-gray-400 hover:text-white p-1.5 sm:p-1" title="Back 5s"><SkipBack className="w-4 h-4" /></button>
            <button onClick={handlePlayPause} className="w-11 h-11 sm:w-10 sm:h-10 bg-white rounded-full flex items-center justify-center text-black hover:bg-gray-200 transition-colors">
              {playing ? <Square className="w-4 h-4" fill="black" /> : <Play className="w-4 h-4 ml-0.5" fill="black" />}
            </button>
            <button onClick={() => handleSeek(Math.min(totalDuration, currentTime + 5))} className="text-gray-400 hover:text-white p-1.5 sm:p-1" title="Forward 5s"><SkipForward className="w-4 h-4" /></button>
            <div className="h-5 w-px bg-gray-700 mx-0.5 sm:mx-1" />
            <button onClick={() => setLoop(l => !l)} className={`p-1.5 sm:p-1 ${loop ? 'text-purple-400' : 'text-gray-400 hover:text-white'}`} title="Loop"><Repeat className="w-4 h-4" /></button>
            <button onClick={() => setMuted(m => !m)} className="p-1.5 sm:p-1 text-gray-400 hover:text-white" title="Mute">
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <div className="ml-2 sm:ml-4 text-xs sm:text-sm text-gray-400 font-mono">
              <span className="text-white">{formatTime(currentTime)}</span>
              <span className="mx-0.5 sm:mx-1">/</span>
              <span>{formatTime(totalDuration)}</span>
            </div>
            {activeClip && (
              <div className="hidden sm:block ml-4 text-xs text-gray-500">
                Clip: {activeClip.name || `Scene ${activeClip.sceneId}`} ({formatTime(activeClip.duration)})
              </div>
            )}
          </div>

          {/* Timeline */}

            {/* Timeline Tracks */}
            <div className="bg-gray-900 border-t border-gray-800 flex-shrink-0 overflow-hidden" style={{ height: '220px' }}>
              {/* Timeline header */}
              <div className="flex items-center justify-between px-2 sm:px-3 py-1.5 border-b border-gray-800">
                <div className="flex items-center gap-1 sm:gap-2">
                  <button onClick={() => setZoom(Math.max(0.25, zoom - 0.25))} className="text-gray-400 hover:text-white p-1" title="Zoom out"><ZoomOut className="w-3.5 h-3.5" /></button>
                  <span className="text-[10px] text-gray-500 w-8 sm:w-10 text-center">{Math.round(zoom * 100)}%</span>
                  <button onClick={() => setZoom(Math.min(4, zoom + 0.25))} className="text-gray-400 hover:text-white p-1" title="Zoom in"><ZoomIn className="w-3.5 h-3.5" /></button>
                </div>
                <div className="hidden sm:flex items-center gap-3 text-[10px] text-gray-500">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-sky-500" />Selected</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-sky-400" />Current</span>
                  <span>S=Split</span>
                  <span>Drag to reorder</span>
                </div>
              </div>

              {/* Scrollable area: Ruler + Tracks */}
              <div ref={timelineRef} className="overflow-x-auto overflow-y-hidden relative" style={{ scrollbarWidth: 'thin', scrollbarColor: '#4B5563 #1F2937' }}>
                <div style={{ minWidth: `${Math.max(100, 100 * zoom)}%`, position: 'relative' }}>

                  {/* Ruler */}
                  <div className="h-5 bg-gray-800 border-b border-gray-700 relative cursor-pointer select-none" onClick={handleTimelineClick}>
                    <div className="absolute left-0 top-0 bottom-0 w-16 bg-gray-800 border-r border-gray-700 z-10" />
                    {totalDuration > 0 && Array.from({ length: Math.ceil(totalDuration / 5) + 1 }).map((_, i) => (
                      <div key={i} className="absolute top-0 h-full border-l border-gray-600" style={{ left: `calc(64px + ${(i * 5 / totalDuration) * 100}%)` }}>
                        <span className="text-[9px] text-gray-500 ml-0.5">{formatTime(i * 5)}</span>
                      </div>
                    ))}
                    {/* Playhead on ruler */}
                    {totalDuration > 0 && (
                      <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 pointer-events-none" style={{ left: `calc(64px + ${(currentTime / totalDuration) * 100}%)` }}>
                        <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-2 h-2 bg-red-500 rotate-45" />
                      </div>
                    )}
                  </div>

                  {/* Video Track */}
                  <div className="h-14 relative border-b border-gray-800 cursor-pointer select-none" onMouseDown={handleTimelineMouseDown} onTouchStart={handleTimelineTouchStart} onTouchMove={handleTimelineTouchMove} onTouchEnd={handleTimelineTouchEnd}>
                    <div className="absolute left-0 top-0 bottom-0 w-16 bg-gray-800 flex items-center justify-center text-[9px] text-gray-500 z-10 border-r border-gray-700">
                      <Film className="w-3 h-3 mr-1" />Video
                    </div>
                    <div className="absolute left-16 right-0 top-0 bottom-0 flex items-center gap-0.5 px-1">
                      {clips.filter(c => c.track !== 'overlay').map((clip) => (
                        <div key={clip.id}
                          draggable onDragStart={(e) => handleClipDragStart(e, clip.id)} onDragOver={(e) => handleClipDragOver(e, clip.id)} onDragEnd={handleClipDragEnd}
                          onClick={(e) => { e.stopPropagation(); handleClipSelect(clip.id) }}
                          className={`h-full rounded overflow-hidden cursor-pointer border-2 transition-all relative group flex-shrink-0 ${
                            selectedClip === clip.id ? 'border-sky-500 ring-2 ring-sky-500/50 z-10' : currentClip?.id === clip.id ? 'border-sky-400 ring-1 ring-sky-400/30' : 'border-gray-700 hover:border-gray-500'
                          } ${isDragging && dragClip === clip.id ? 'opacity-40' : ''}`}
                          style={{ width: `${(clip.duration / totalDuration) * 100}%` }}>
                          {/* Trim handles */}
                          <div data-trim className="absolute left-0 top-0 bottom-0 w-2 bg-yellow-500/0 hover:bg-yellow-500/80 cursor-col-resize z-10 group-hover:bg-yellow-500/40" onMouseDown={(e) => { e.stopPropagation(); handleTrimStart(clip.id, e) }} />
                          <div data-trim className="absolute right-0 top-0 bottom-0 w-2 bg-yellow-500/0 hover:bg-yellow-500/80 cursor-col-resize z-10 group-hover:bg-yellow-500/40" onMouseDown={(e) => { e.stopPropagation(); handleTrimEnd(clip.id, e) }} />
                          <div className="h-full flex flex-col relative">
                            <div className="flex-1 relative overflow-hidden">
                              {clip.thumbnail ? (
                                <img src={clip.thumbnail} className="w-full h-full object-cover" alt="" draggable={false} />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900">
                                  {clip.type === 'video' ? <Film className="w-4 h-4 text-blue-400" /> : clip.type === 'audio' ? <Music className="w-4 h-4 text-green-400" /> : <ImageIcon className="w-4 h-4 text-purple-400" />}
                                </div>
                              )}
                              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1 py-0.5">
                                <span className="text-[8px] text-white truncate block">{clip.name || `Shot ${(clip.shotIdx || 0) + 1}`}</span>
                              </div>
                              {clip.transition !== 'none' && <div className="absolute top-0 right-0 bg-yellow-500/80 px-0.5"><span className="text-[7px] text-white">{clip.transition}</span></div>}
                              {clip.reversed && <div className="absolute top-0 left-0 bg-orange-500/80 px-0.5"><span className="text-[7px] text-white">R</span></div>}
                              {clip.frozen && <div className="absolute top-0 left-0 bg-blue-500/80 px-0.5"><span className="text-[7px] text-white">F</span></div>}
                              {Math.abs(clip.speed - 1) > 0.01 && <div className="absolute top-0 left-6 bg-purple-500/80 px-0.5"><span className="text-[7px] text-white">{clip.speed}x</span></div>}
                            </div>
                            <div className="h-2.5 bg-gray-900/90 px-1 flex items-center justify-between">
                              <span className="text-[7px] text-gray-400">{formatTime(clip.startTime)}</span>
                              <span className="text-[7px] text-gray-500">{clip.duration.toFixed(1)}s</span>
                            </div>
                          </div>
                        </div>
                      ))}
                      {clips.filter(c => c.track !== 'overlay').length === 0 && (
                        <div className="h-full flex items-center text-[9px] text-gray-600">No clips — go to Review to generate shots first</div>
                      )}
                    </div>
                    {/* Playhead line on video track */}
                    {totalDuration > 0 && (
                      <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none z-20" style={{ left: `calc(64px + ${(currentTime / totalDuration) * 100}%)` }}>
                        <div className="absolute -top-1 -left-1.5 w-3.5 h-3.5 bg-red-500 rounded-full shadow-lg flex items-center justify-center">
                          <div className="w-1.5 h-1.5 bg-white rounded-full" />
                        </div>
                        <div className="absolute bottom-0 -left-1.5 w-3.5 h-1.5 bg-red-500 rounded-t" />
                      </div>
                    )}
                  </div>

                  {/* Overlay Track */}
                  {clips.some(c => c.track === 'overlay') && (
                    <div className="h-10 relative bg-gray-900/50 border-b border-gray-800">
                      <div className="absolute left-0 top-0 bottom-0 w-16 bg-gray-800 flex items-center justify-center text-[9px] text-gray-500 z-10 border-r border-gray-700">
                        <ImageIcon className="w-3 h-3 mr-1" />Overlay
                      </div>
                      <div className="absolute left-16 right-0 top-0 bottom-0 flex items-center gap-0.5 px-1">
                        {clips.filter(c => c.track === 'overlay').map((clip) => (
                          <div key={clip.id}
                            onClick={(e) => { e.stopPropagation(); handleClipSelect(clip.id) }}
                            className={`h-full rounded overflow-hidden cursor-pointer border-2 transition-all relative group flex-shrink-0 ${
                              selectedClip === clip.id ? 'border-sky-500 ring-2 ring-sky-500/50 z-10' : 'border-orange-600 hover:border-orange-400'
                            }`}
                            style={{ width: `${(clip.duration / totalDuration) * 100}%` }}>
                            <div className="h-full flex flex-col relative bg-gradient-to-br from-orange-900/50 to-orange-800/30">
                              {clip.thumbnail && <img src={clip.thumbnail} className="w-full h-full object-cover opacity-60" alt="" draggable={false} />}
                              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1 py-0.5">
                                <span className="text-[7px] text-orange-300 truncate block">PIP: {clip.name || `Shot ${(clip.shotIdx || 0) + 1}`}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      {totalDuration > 0 && (
                        <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none z-20" style={{ left: `calc(64px + ${(currentTime / totalDuration) * 100}%)` }} />
                      )}
                    </div>
                  )}

                   {/* Audio Track */}
                   <div className="h-10 relative bg-gray-900/50 border-b border-gray-800">
                     <div className="absolute left-0 top-0 bottom-0 w-16 bg-gray-800 flex items-center justify-center text-[9px] text-gray-500 z-10 border-r border-gray-700">
                       <Music className="w-3 h-3 mr-1" />Audio
                     </div>
                     <div className="absolute left-16 right-0 top-0 bottom-0 flex items-center gap-0.5 px-1">
                       {audioClips.map((clip) => (
                         <div key={clip.id} className="h-full rounded overflow-hidden border border-green-700 bg-gradient-to-r from-green-900/50 to-green-800/30 flex items-center px-1 gap-1 relative flex-shrink-0" style={{ width: `${(clip.duration / totalDuration) * 100}%` }}>
                           <Music className="w-3 h-3 text-green-400 flex-shrink-0 relative z-10" />
                           <span className="text-[8px] text-green-300 truncate relative z-10">{clip.name}</span>
                           <div className="flex items-center gap-1 ml-auto relative z-10">
                             <Volume2 className="w-3 h-3 text-green-500" />
                             <input
                               type="range"
                               min="0"
                               max="100"
                               value={Math.round((clip.volume || 0.7) * 100)}
                               onChange={(e) => {
                                 e.stopPropagation()
                                 const newVol = parseInt(e.target.value) / 100
                                 setAudioClips(prev => prev.map(c => c.id === clip.id ? { ...c, volume: newVol } : c))
                               }}
                               className="w-12 h-2 accent-green-500 cursor-pointer"
                               onClick={(e) => e.stopPropagation()}
                             />
                           </div>
                           <button onClick={(e) => { e.stopPropagation(); setAudioClips(prev => prev.filter(c => c.id !== clip.id)); toast.success('Audio removed') }} className="text-green-500 hover:text-red-400 relative z-10"><X className="w-3 h-3" /></button>
                         </div>
                       ))}
                       {audioClips.length === 0 && <div className="h-full flex items-center text-[9px] text-gray-600 pl-2">No audio tracks — click mic or music icon to add</div>}
                     </div>
                     {totalDuration > 0 && (
                       <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none z-20" style={{ left: `calc(64px + ${(currentTime / totalDuration) * 100}%)` }} />
                     )}
                   </div>

            </div>
          </div>
        </div>
        </div>

        {/* Properties Panel */}
        {showProperties && (
          <div className={`${showMobileToolbar ? 'hidden' : 'flex'} md:flex flex-col bg-gray-900 border-l border-gray-800 overflow-y-auto flex-shrink-0 relative ${showMobileToolbar ? '' : 'fixed md:static inset-y-0 right-0 z-40 w-72 md:w-auto'}`} style={{ width: `${propertiesWidth}px` }}>
            <div
              className="hidden md:block absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-sky-500/50 z-10"
              onMouseDown={(e) => {
                e.preventDefault()
                const startX = e.clientX
                const startW = propertiesWidth
                const onMove = (ev) => { setPropertiesWidth(Math.max(200, Math.min(500, startW + (startX - ev.clientX)))) }
                const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
            />
            <div className="p-3">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-medium text-sm">Properties</h3>
                <button onClick={() => setShowProperties(false)} className="text-gray-400 hover:text-white p-1" title="Close panel"><X className="w-5 h-5" /></button>
              </div>
              {activeClip ? (
                <div className="space-y-3">
                  <div className="bg-gray-800 rounded-lg p-2 text-xs text-gray-400">
                    <div className="flex justify-between mb-1"><span>Type</span><span className="text-gray-300 capitalize">{activeClip.type}{activeClip.reversed ? ' (reversed)' : ''}{activeClip.frozen ? ' (frozen)' : ''}</span></div>
                    <div className="flex justify-between mb-1"><span>Start</span><span className="text-gray-300">{formatTime(activeClip.startTime)}</span></div>
                    <div className="flex justify-between"><span>End</span><span className="text-gray-300">{formatTime(activeClip.endTime)}</span></div>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-1">Track</label>
                    <select value={activeClip.track || 'video'} onChange={(e) => updateClips(clips.map(c => c.id === activeClip.id ? { ...c, track: e.target.value } : c))} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs">
                      <option value="video">Video (Main)</option>
                      <option value="overlay">Overlay (PIP)</option>
                      <option value="video2">Video Track 2</option>
                    </select>
                  </div>
                  {activeClip.track === 'overlay' && (
                    <>
                      <div><label className="text-[10px] text-gray-400 block mb-0.5">X Position: {activeClip.overlayX || 50}%</label>
                        <input type="range" min="0" max="100" step="1" value={activeClip.overlayX || 50} onChange={(e) => updateClips(clips.map(c => c.id === activeClip.id ? { ...c, overlayX: parseInt(e.target.value) } : c))} className="w-full" /></div>
                      <div><label className="text-[10px] text-gray-400 block mb-0.5">Y Position: {activeClip.overlayY || 50}%</label>
                        <input type="range" min="0" max="100" step="1" value={activeClip.overlayY || 50} onChange={(e) => updateClips(clips.map(c => c.id === activeClip.id ? { ...c, overlayY: parseInt(e.target.value) } : c))} className="w-full" /></div>
                      <div><label className="text-[10px] text-gray-400 block mb-0.5">Scale: {((activeClip.overlayScale || 30))}%</label>
                        <input type="range" min="10" max="100" step="1" value={activeClip.overlayScale || 30} onChange={(e) => updateClips(clips.map(c => c.id === activeClip.id ? { ...c, overlayScale: parseInt(e.target.value) } : c))} className="w-full" /></div>
                    </>
                  )}
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-1">Duration</label>
                    <div className="flex items-center gap-1">
                      <input type="range" min="0.5" max="30" step="0.1" value={activeClip.duration} onChange={(e) => handleDurationChange(activeClip.id, parseFloat(e.target.value))} className="flex-1" />
                      <span className="text-xs text-gray-300 w-10 text-right">{activeClip.duration.toFixed(1)}s</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-1">Transition</label>
                    <select value={activeClip.transition} onChange={(e) => handleTransitionChange(activeClip.id, e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-xs">
                      {TRANSITIONS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-1">Volume: {Math.round(activeClip.volume * 100)}%</label>
                    <input type="range" min="0" max="1" step="0.05" value={activeClip.volume} onChange={(e) => handleVolumeChange(activeClip.id, parseFloat(e.target.value))} className="w-full" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-1">Speed: {activeClip.speed}x</label>
                    <input type="range" min="0.25" max="4" step="0.25" value={activeClip.speed} onChange={(e) => handleSpeedChange(activeClip.id, parseFloat(e.target.value))} className="w-full" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-1">Opacity: {Math.round(activeClip.opacity * 100)}%</label>
                    <input type="range" min="0" max="1" step="0.05" value={activeClip.opacity} onChange={(e) => updateClips(clips.map(c => c.id === activeClip.id ? { ...c, opacity: parseFloat(e.target.value) } : c))} className="w-full" />
                  </div>

                  <div className="border-t border-gray-700 pt-2">
                    <h4 className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Color Grading</h4>
                    <div className="space-y-2">
                      <div><label className="text-[10px] text-gray-400 block mb-0.5">Brightness: {activeClip.brightness?.toFixed(2) || '0'}</label>
                        <input type="range" min="-0.5" max="0.5" step="0.01" value={activeClip.brightness || 0} onChange={(e) => handleBrightnessChange(activeClip.id, e.target.value)} className="w-full" /></div>
                      <div><label className="text-[10px] text-gray-400 block mb-0.5">Contrast: {activeClip.contrast?.toFixed(2) || '1'}</label>
                        <input type="range" min="0.5" max="2" step="0.01" value={activeClip.contrast || 1} onChange={(e) => handleContrastChange(activeClip.id, e.target.value)} className="w-full" /></div>
                      <div><label className="text-[10px] text-gray-400 block mb-0.5">Saturation: {activeClip.saturation?.toFixed(2) || '1'}</label>
                        <input type="range" min="0" max="2" step="0.01" value={activeClip.saturation || 1} onChange={(e) => handleSaturationChange(activeClip.id, e.target.value)} className="w-full" /></div>
                      <div><label className="text-[10px] text-gray-400 block mb-0.5">Temperature: {activeClip.temperature?.toFixed(1) || '0'}</label>
                        <input type="range" min="-5" max="5" step="0.1" value={activeClip.temperature || 0} onChange={(e) => handleTemperatureChange(activeClip.id, e.target.value)} className="w-full" /></div>
                    </div>
                  </div>

                  <div className="border-t border-gray-700 pt-2">
                    <h4 className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Speed Ramping</h4>
                    <div className="grid grid-cols-2 gap-1">
                      {['slow-in', 'slow-out', 'fast-in', 'fast-out', 'bounce'].map(p => (
                        <button key={p} onClick={() => speedRampPreset(activeClip.id, p)}
                          className="text-[9px] bg-gray-800 hover:bg-gray-700 text-gray-300 rounded py-1 px-2 capitalize">{p.replace('-', ' ')}</button>
                      ))}
                      <button onClick={() => updateClips(clips.map(c => c.id === activeClip.id ? { ...c, speedRamp: null } : c))}
                        className="text-[9px] bg-gray-800 hover:bg-red-900/30 text-gray-400 hover:text-red-400 rounded py-1 px-2">Clear</button>
                    </div>
                  </div>

                  <div className="border-t border-gray-700 pt-2">
                    <h4 className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Keyframes</h4>
                    <div className="space-y-1">
                      {(activeClip.keyframes || []).map((kf, ki) => (
                        <div key={ki} className="flex items-center gap-1 text-[9px] bg-gray-800 rounded px-2 py-1">
                          <span className="text-gray-400 w-16">{kf.prop}</span>
                          <span className="text-gray-300 flex-1">t={kf.time.toFixed(1)}s v={kf.value.toFixed(2)}</span>
                          <button onClick={() => removeKeyframe(activeClip.id, ki)} className="text-red-400 hover:text-red-300"><X className="w-3 h-3" /></button>
                        </div>
                      ))}
                      <div className="grid grid-cols-2 gap-1 pt-1">
                        <button onClick={() => addKeyframe(activeClip.id, 'opacity')} className="text-[9px] bg-gray-800 hover:bg-gray-700 text-gray-300 rounded py-1">+ Opacity</button>
                        <button onClick={() => addKeyframe(activeClip.id, 'volume')} className="text-[9px] bg-gray-800 hover:bg-gray-700 text-gray-300 rounded py-1">+ Volume</button>
                        <button onClick={() => addKeyframe(activeClip.id, 'brightness')} className="text-[9px] bg-gray-800 hover:bg-gray-700 text-gray-300 rounded py-1">+ Brightness</button>
                        <button onClick={() => addKeyframe(activeClip.id, 'speed')} className="text-[9px] bg-gray-800 hover:bg-gray-700 text-gray-300 rounded py-1">+ Speed</button>
                      </div>
                    </div>
                  </div>

                  {activeClip.prompt && (
                    <div>
                      <label className="text-[10px] text-gray-400 block mb-1">Prompt</label>
                      <p className="text-[10px] text-gray-300 bg-gray-800 rounded p-2 leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap">{activeClip.prompt}</p>
                    </div>
                  )}
                  <div className="flex gap-1 pt-1">
                    <button onClick={() => splitClipAtPlayhead(activeClip.id)} className="flex-1 flex items-center justify-center gap-1 bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-400 rounded-lg py-1.5 text-[10px]"><SplitSquareHorizontal className="w-3 h-3" />Split</button>
                    <button onClick={() => duplicateClip(activeClip.id)} className="flex-1 flex items-center justify-center gap-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg py-1.5 text-[10px]"><Copy className="w-3 h-3" />Copy</button>
                    <button onClick={() => deleteClip(activeClip.id)} className="flex-1 flex items-center justify-center gap-1 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg py-1.5 text-[10px]"><Trash2 className="w-3 h-3" />Del</button>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => reverseClip(activeClip.id)} className={`flex-1 flex items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] ${activeClip.reversed ? 'bg-orange-600/30 text-orange-400' : 'bg-gray-800 hover:bg-gray-700 text-gray-400'}`}>Reverse</button>
                    <button onClick={() => freezeFrame(activeClip.id)} className="flex-1 flex items-center justify-center gap-1 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-lg py-1.5 text-[10px]">Freeze</button>
                  </div>
                  {activeClip.sceneId > 0 && activeClip.sceneId && (
                    <button onClick={async () => {
                      if (!activeClip.sceneId || !activeClip.shotIdx && activeClip.shotIdx !== 0) return
                      try {
                        toast.info('Regenerating image...')
                        const data = await regenerateShot(id, activeClip.sceneId, activeClip.shotIdx)
                        if (data) {
                          const url = await getShotImage(id, activeClip.sceneId, activeClip.shotIdx, Date.now())
                          updateClips(clips.map(c => c.id === activeClip.id ? { ...c, src: url, thumbnail: url, type: 'image', status: 'generated' } : c))
                          toast.success('Image regenerated!')
                        }
                      } catch (e) { toast.error('Regeneration failed') }
                    }} className="w-full flex items-center justify-center gap-1 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 rounded-lg py-1.5 text-[10px] mt-1">
                      <Repeat className="w-3 h-3" />Regenerate Image
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-500 text-center py-8">Click a clip on the timeline to edit it</p>
              )}

              {/* Background Music Section */}
              <div className="border-t border-gray-700 pt-3 mt-3">
                <h4 className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <Music className="w-3 h-3" /> Background Music
                </h4>
                {audioClips.filter(c => c.type === 'music').length > 0 ? (
                  <div className="space-y-2">
                    {audioClips.filter(c => c.type === 'music').map(clip => (
                      <div key={clip.id} className="bg-gray-800 rounded-lg p-2 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-gray-300 truncate flex-1">{clip.name}</span>
                          <button onClick={() => setAudioClips(prev => prev.filter(c => c.id !== clip.id))} className="text-gray-500 hover:text-red-400"><X className="w-3 h-3" /></button>
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-400 block mb-0.5">Volume: {Math.round((clip.volume || 0.7) * 100)}%</label>
                          <input type="range" min="0" max="100" value={Math.round((clip.volume || 0.7) * 100)} onChange={(e) => setAudioClips(prev => prev.map(c => c.id === clip.id ? { ...c, volume: parseInt(e.target.value) / 100 } : c))} className="w-full" />
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-gray-400">
                          <span>Duration: {formatTime(clip.duration)}</span>
                          <span>&middot;</span>
                          <span>Loops to fill video</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-gray-600">No background music added yet. Click the music icon in the toolbar to add one.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Hidden inputs */}
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
      <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleVideoFile} />
      <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={handleAudioFile} />

      {/* Export Modal */}
      {showExport && (
        <div className="fixed inset-0 bg-black/80 z-50 p-4 overflow-y-auto" onClick={() => setShowExport(false)}>
          <div className="min-h-full flex items-start sm:items-center justify-center py-4" onClick={(e) => e.stopPropagation()}>
          <div className="bg-gray-900 rounded-2xl w-full max-w-lg overflow-hidden border-2 border-gray-600 shadow-2xl">
            <div className="p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <h2 className="text-lg sm:text-xl font-semibold text-white">Export Video</h2>
                <button onClick={() => setShowExport(false)} className="text-gray-400 hover:text-white p-1"><X className="w-5 h-5" /></button>
              </div>
              <div className="space-y-2">
                {EXPORT_PRESETS.map(preset => {
                  const Icon = preset.icon
                  return (
                    <button key={preset.id} onClick={() => setSelectedPreset(preset)} className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${selectedPreset.id === preset.id ? 'border-sky-500 bg-sky-500/10' : 'border-gray-700 hover:border-gray-600 bg-gray-800'}`}>
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${selectedPreset.id === preset.id ? 'bg-sky-500' : 'bg-gray-700'}`}><Icon className="w-4 h-4 text-white" /></div>
                      <div className="text-left flex-1 min-w-0"><div className="text-white font-medium text-sm">{preset.name}</div><div className="text-[10px] text-gray-400">{preset.width}x{preset.height} &middot; {preset.ratio}</div></div>
                      {selectedPreset.id === preset.id && <Check className="w-4 h-4 text-sky-500 shrink-0" />}
                    </button>
                  )
                })}
              </div>
              {selectedPreset.id === 'custom' && (
                <div className="mt-4 flex gap-4">
                  <div className="flex-1"><label className="text-xs text-gray-400 block mb-1">Width</label><input type="number" value={customWidth} onChange={(e) => setCustomWidth(parseInt(e.target.value) || 1920)} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm" /></div>
                  <div className="flex-1"><label className="text-xs text-gray-400 block mb-1">Height</label><input type="number" value={customHeight} onChange={(e) => setCustomHeight(parseInt(e.target.value) || 1080)} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm" /></div>
                </div>
              )}
              <div className="mt-4 p-3 bg-gray-800 rounded-lg text-xs text-gray-400">
                <div className="flex justify-between mb-1"><span>Clips:</span><span className="text-gray-300">{clips.length}</span></div>
                <div className="flex justify-between mb-1"><span>Duration:</span><span className="text-gray-300">{formatTime(totalDuration)}</span></div>
                <div className="flex justify-between"><span>Resolution:</span><span className="text-gray-300">{selectedPreset.id === 'custom' ? `${customWidth}x${customHeight}` : `${selectedPreset.width}x${selectedPreset.height}`}</span></div>
              </div>
              <button onClick={handleExport} disabled={exporting || clips.length === 0} className="w-full mt-4 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
                {exporting ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Exporting...</> : <><Download className="w-4 h-4" />Export {selectedPreset.name}</>}
              </button>
              {exporting && (
                <div className="mt-3">
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                    <span>{exportMessage}</span>
                    <span>{Math.round(exportProgress * 100)}%</span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div className="bg-sky-500 h-full rounded-full transition-all duration-300" style={{ width: `${exportProgress * 100}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>
          </div>
        </div>
      )}

      {/* Text Editor Modal */}
      {showTextEditor && selectedText && (
        <div className="fixed inset-0 bg-black/80 z-50 p-4 overflow-y-auto" onClick={() => setShowTextEditor(false)}>
          <div className="min-h-full flex items-start sm:items-center justify-center py-4" onClick={(e) => e.stopPropagation()}>
          <div className="bg-gray-900 rounded-2xl w-full max-w-md overflow-hidden border-2 border-gray-600 shadow-2xl">
            <div className="p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <h2 className="text-lg sm:text-xl font-semibold text-white">Edit Text</h2>
                <button onClick={() => setShowTextEditor(false)} className="text-gray-400 hover:text-white p-1"><X className="w-5 h-5" /></button>
              </div>
              {(() => {
                const text = textOverlays.find(t => t.id === selectedText)
                if (!text) return null
                return (
                  <div className="space-y-4">
                    <div><label className="text-xs text-gray-400 block mb-1">Text</label><input type="text" value={text.text} onChange={(e) => setTextOverlays(textOverlays.map(t => t.id === selectedText ? { ...t, text: e.target.value } : t))} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white" autoFocus /></div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div><label className="text-xs text-gray-400 block mb-1">Font Size</label><input type="number" value={text.fontSize} onChange={(e) => setTextOverlays(textOverlays.map(t => t.id === selectedText ? { ...t, fontSize: parseInt(e.target.value) || 24 } : t))} className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white" /></div>
                      <div><label className="text-xs text-gray-400 block mb-1">Color</label><input type="color" value={text.color} onChange={(e) => setTextOverlays(textOverlays.map(t => t.id === selectedText ? { ...t, color: e.target.value } : t))} className="w-full h-10 bg-gray-800 border border-gray-700 rounded cursor-pointer" /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div><label className="text-[10px] text-gray-500 block mb-0.5">X %</label><input type="number" value={Math.round(text.x)} onChange={(e) => setTextOverlays(textOverlays.map(t => t.id === selectedText ? { ...t, x: parseInt(e.target.value) || 0 } : t))} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm" /></div>
                      <div><label className="text-[10px] text-gray-500 block mb-0.5">Y %</label><input type="number" value={Math.round(text.y)} onChange={(e) => setTextOverlays(textOverlays.map(t => t.id === selectedText ? { ...t, y: parseInt(e.target.value) || 0 } : t))} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm" /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div><label className="text-[10px] text-gray-500 block mb-0.5">Start Time</label><input type="number" step="0.1" value={text.startTime.toFixed(1)} onChange={(e) => setTextOverlays(textOverlays.map(t => t.id === selectedText ? { ...t, startTime: parseFloat(e.target.value) || 0 } : t))} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm" /></div>
                      <div><label className="text-[10px] text-gray-500 block mb-0.5">End Time</label><input type="number" step="0.1" value={text.endTime.toFixed(1)} onChange={(e) => setTextOverlays(textOverlays.map(t => t.id === selectedText ? { ...t, endTime: parseFloat(e.target.value) || 3 } : t))} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm" /></div>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button onClick={() => deleteText(selectedText)} className="flex-1 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg py-2 text-sm">Delete</button>
                      <button onClick={() => setShowTextEditor(false)} className="flex-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg py-2 text-sm">Done</button>
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}
