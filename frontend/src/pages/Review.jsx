import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  Check, X, RefreshCw, ChevronLeft, ChevronRight, Loader2, Image,
  Volume2, FileText, Play, Settings, Sparkles, Eye, EyeOff, Zap, Edit3,
  Upload, UploadCloud, Film
} from 'lucide-react'
import {
  getProject, getScenes, generateSceneShots, regenerateShot,
  approveShot, generateVoiceover, approveScene, approveAllScenes,
  startGeneration, getShotImage, uploadShotImage, uploadShotVideo, getShotVideo
} from '../services/api'

function Review() {
  const { id } = useParams()
  const navigate = useNavigate()
  
  const [project, setProject] = useState(null)
  const [scenes, setScenes] = useState([])
  const [currentSceneIdx, setCurrentSceneIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [shotImages, setShotImages] = useState({})
  const [shotVideos, setShotVideos] = useState({})
  const [selectedShot, setSelectedShot] = useState(0)
  const [generatingScene, setGeneratingScene] = useState(null)
  const [generatingVoiceover, setGeneratingVoiceover] = useState(null)
  const [sceneApproving, setSceneApproving] = useState(null)
  const [editingShotPrompt, setEditingShotPrompt] = useState(null)
  const [editedShotPrompt, setEditedShotPrompt] = useState('')
  const [cacheBust, setCacheBust] = useState({})
  const [dragOverShot, setDragOverShot] = useState(null)
  const [uploadingShot, setUploadingShot] = useState(null)
  const fileInputRef = useRef(null)
  const videoInputRef = useRef(null)
  
  const currentScene = scenes[currentSceneIdx] || null
  const shots = currentScene?.shots || []
  
  const loadData = useCallback(async () => {
    try {
      const [proj, scns] = await Promise.all([
        getProject(id),
        getScenes(id),
      ])
      setProject(proj)
      setScenes(scns)
      
      const idx = Math.min(proj.current_review_scene || 0, scns.length - 1)
      setCurrentSceneIdx(Math.max(0, idx))
    } catch (err) {
      toast.error('Failed to load project')
      navigate('/projects')
    } finally {
      setLoading(false)
    }
  }, [id, navigate])
  
  useEffect(() => { loadData() }, [loadData])
  
  const loadImage = useCallback((sceneId, shotIdx, bust) => {
    const key = `${sceneId}-${shotIdx}`
    const ts = bust || cacheBust[key] || Date.now()
    getShotImage(id, sceneId, shotIdx, ts)
      .then(url => {
        setShotImages(prev => ({ ...prev, [key]: url }))
      })
      .catch(() => {})
  }, [id, cacheBust])

  const loadVideo = useCallback((sceneId, shotIdx) => {
    const key = `${sceneId}-${shotIdx}`
    getShotVideo(id, sceneId, shotIdx)
      .then(url => {
        setShotVideos(prev => ({ ...prev, [key]: url }))
      })
      .catch(() => {})
  }, [id])

  useEffect(() => {
    if (!currentScene) return
    const shots = currentScene.shots || []

    shots.forEach((shot, idx) => {
      if (shot.image_status === 'generated' || shot.image_status === 'approved' || shot.image_status === 'uploaded') {
        if (shot.video_path) {
          loadVideo(currentScene.id, idx)
        } else {
          loadImage(currentScene.id, idx)
        }
      }
    })
  }, [currentScene, loadImage, loadVideo])
  
  const bustCache = (sceneId, shotIdx) => {
    const key = `${sceneId}-${shotIdx}`
    const ts = Date.now()
    setCacheBust(prev => ({ ...prev, [key]: ts }))
    return ts
  }
  
  const handleGenerateShots = async (sceneId) => {
    setGeneratingScene(sceneId)
    try {
      await generateSceneShots(id, sceneId)
      toast.success('Shots generated!')
      await loadData()
      const scene = scenes.find(s => s.id === sceneId)
      if (scene) {
        const shots = scene.shots || []
        shots.forEach((_, idx) => bustCache(sceneId, idx))
      }
    } catch (err) {
      toast.error('Failed to generate shots')
    } finally {
      setGeneratingScene(null)
    }
  }
  
  const handleRegenerateShot = async (sceneId, shotIdx) => {
    setGenerating(true)
    try {
      const updateData = editingShotPrompt === shotIdx ? { prompt: editedShotPrompt } : null
      await regenerateShot(id, sceneId, shotIdx, updateData)
      bustCache(sceneId, shotIdx)
      setEditingShotPrompt(null)
      toast.success('Shot regenerated!')
      await loadData()
    } catch (err) {
      toast.error('Failed to regenerate shot')
    } finally {
      setGenerating(false)
    }
  }
  
  const handleApproveShot = async (sceneId, shotIdx) => {
    try {
      await approveShot(id, sceneId, shotIdx)
      toast.success('Shot approved!')
      await loadData()
    } catch (err) {
      toast.error('Failed to approve shot')
    }
  }
  
  const handleUploadImage = async (sceneId, shotIdx, file) => {
    setUploadingShot(shotIdx)
    try {
      await uploadShotImage(id, sceneId, shotIdx, file)
      bustCache(sceneId, shotIdx)
      toast.success('Image uploaded!')
      await loadData()
    } catch (err) {
      toast.error('Failed to upload image')
    } finally {
      setUploadingShot(null)
    }
  }
  
  const handleUploadVideo = async (sceneId, shotIdx, file) => {
    setUploadingShot(shotIdx)
    try {
      await uploadShotVideo(id, sceneId, shotIdx, file)
      bustCache(sceneId, shotIdx)
      toast.success('Video uploaded!')
      await loadData()
    } catch (err) {
      toast.error('Failed to upload video')
    } finally {
      setUploadingShot(null)
    }
  }
  
  const handleDragOver = (e, shotIdx) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverShot(shotIdx)
  }
  
  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverShot(null)
  }
  
  const handleDrop = (e, sceneId, shotIdx) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverShot(null)
    
    const files = e.dataTransfer.files
    if (files.length === 0) return
    
    const file = files[0]
    const isVideo = file.type.startsWith('video/')
    
    if (isVideo) {
      handleUploadVideo(sceneId, shotIdx, file)
    } else {
      handleUploadImage(sceneId, shotIdx, file)
    }
  }
  
  const handleFileSelect = (e, sceneId, shotIdx) => {
    const file = e.target.files[0]
    if (!file) return
    
    const isVideo = file.type.startsWith('video/')
    if (isVideo) {
      handleUploadVideo(sceneId, shotIdx, file)
    } else {
      handleUploadImage(sceneId, shotIdx, file)
    }
    e.target.value = ''
  }
  
  const handleGenerateVoiceover = async (sceneId) => {
    setGeneratingVoiceover(sceneId)
    try {
      await generateVoiceover(id, sceneId)
      toast.success('Voiceover generated!')
      await loadData()
    } catch (err) {
      toast.error('Failed to generate voiceover')
    } finally {
      setGeneratingVoiceover(null)
    }
  }
  
  const handleApproveScene = async (sceneId) => {
    setSceneApproving(sceneId)
    try {
      await approveScene(id, sceneId)
      toast.success('Scene approved!')
      await loadData()
    } catch (err) {
      toast.error('Failed to approve scene')
    } finally {
      setSceneApproving(null)
    }
  }
  
  const handleApproveAll = async () => {
    try {
      await approveAllScenes(id)
      toast.success('All scenes approved! Starting generation...')
      await startGeneration(id)
      navigate(`/project/${id}`)
    } catch (err) {
      toast.error('Failed to approve all')
    }
  }
  
  const handleStartGeneration = async () => {
    try {
      await startGeneration(id)
      toast.success('Generation started!')
      navigate(`/project/${id}`)
    } catch (err) {
      toast.error('Failed to start generation')
    }
  }
  
  const goToPrev = () => {
    if (currentSceneIdx > 0) {
      setCurrentSceneIdx(currentSceneIdx - 1)
      setSelectedShot(0)
    }
  }
  
  const goToNext = () => {
    if (currentSceneIdx < scenes.length - 1) {
      setCurrentSceneIdx(currentSceneIdx + 1)
      setSelectedShot(0)
    }
  }
  
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-12 h-12 animate-spin text-sky-500" />
      </div>
    )
  }
  
  if (!project || !currentScene) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-400">Project not found</p>
      </div>
    )
  }
  
  const allApproved = scenes.every(s => s.generated)
  const approvedCount = scenes.filter(s => s.generated).length
  const hasGeneratedShots = shots.some(s => s.image_status === 'generated' || s.image_status === 'approved')
  const allPending = shots.length > 0 && shots.every(s => s.image_status === 'pending' || s.image_status === 'failed')
  
  return (
    <div className="page-container">
      <div className="mb-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl md:text-2xl font-bold truncate">{project.name}</h1>
          <p className="text-gray-500 text-xs sm:text-sm">
            Scene {currentSceneIdx + 1} of {scenes.length} · {approvedCount}/{scenes.length} approved
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {project.status === 'completed' ? (
            <button onClick={() => navigate(`/project/${id}/editor`)}
              className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-700 text-white px-3 md:px-5 py-2 md:py-2.5 rounded-xl text-xs md:text-sm font-medium transition-colors">
              <Film className="w-4 h-4" /> Edit Video
            </button>
          ) : allApproved ? (
            <button onClick={handleStartGeneration}
              className="btn-success flex items-center gap-1.5 text-xs md:text-sm">
              <Zap className="w-4 h-4" /> Generate
            </button>
          ) : (
            <button onClick={handleApproveAll}
              className="btn-primary flex items-center gap-1.5 text-xs md:text-sm">
              <Check className="w-4 h-4" /> Approve All
            </button>
          )}
        </div>
      </div>
      
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {scenes.map((scene, idx) => (
          <button
            key={scene.id}
            onClick={() => { setCurrentSceneIdx(idx); setSelectedShot(0) }}
            className={`flex-shrink-0 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              idx === currentSceneIdx
                ? 'bg-sky-600 text-white'
                : scene.generated
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-gray-800/60 text-gray-400 border border-gray-700/50 hover:border-gray-600'
            }`}
          >
            {scene.generated ? '✓' : ''} S{scene.scene_number}
          </button>
        ))}
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="card">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-2">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Image className="w-5 h-5 text-purple-400" />
                Scene {currentScene.scene_number} — Shots ({shots.length})
              </h2>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => handleGenerateShots(currentScene.id)}
                  disabled={generatingScene === currentScene.id}
                  className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {generatingScene === currentScene.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  {allPending ? 'Generate Shots' : 'Regenerate All'}
                </button>
                {hasGeneratedShots && (
                  <button
                    onClick={() => handleApproveScene(currentScene.id)}
                    disabled={sceneApproving === currentScene.id}
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {sceneApproving === currentScene.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    Approve Scene
                  </button>
                )}
              </div>
            </div>
            
            {shots.length === 0 ? (
              <div className="text-center py-16 border-2 border-dashed border-gray-700 rounded-xl">
                <Image className="w-16 h-16 mx-auto mb-4 text-gray-600" />
                <p className="text-gray-400 mb-4">No shots generated yet</p>
                <button
                  onClick={() => handleGenerateShots(currentScene.id)}
                  disabled={generatingScene === currentScene.id}
                  className="bg-sky-600 hover:bg-sky-700 text-white px-6 py-3 rounded-xl font-semibold transition-colors disabled:opacity-50"
                >
                  {generatingScene === currentScene.id ? 'Generating...' : 'Generate Shots'}
                </button>
              </div>
            ) : (
              <>
                <div 
                  className="mb-4 aspect-video bg-gray-900 rounded-xl overflow-hidden flex items-center justify-center relative"
                  onDragOver={(e) => handleDragOver(e, selectedShot)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, currentScene.id, selectedShot)}
                >
                  {dragOverShot === selectedShot && (
                    <div className="absolute inset-0 bg-yellow-400/10 border-2 border-dashed border-yellow-400 rounded-xl flex items-center justify-center z-10">
                      <div className="text-center">
                        <UploadCloud className="w-12 h-12 text-yellow-400 mx-auto mb-2" />
                        <p className="text-yellow-400 font-medium">Drop image or video here</p>
                      </div>
                    </div>
                  )}
                  {shots[selectedShot]?.video_path ? (
                    <video
                      key={`${currentScene.id}-${selectedShot}`}
                      src={shotVideos[`${currentScene.id}-${selectedShot}`]}
                      className="w-full h-full object-contain"
                      controls
                      autoPlay
                      muted
                    />
                  ) : shotImages[`${currentScene.id}-${selectedShot}`] ? (
                    <img
                      src={shotImages[`${currentScene.id}-${selectedShot}`]}
                      alt={`Shot ${selectedShot + 1}`}
                      className="w-full h-full object-contain"
                    />
                  ) : shots[selectedShot]?.image_status === 'generating' ? (
                    <div className="text-center">
                      <Loader2 className="w-12 h-12 animate-spin text-sky-500 mx-auto mb-2" />
                      <p className="text-gray-400 text-sm">Generating...</p>
                    </div>
                  ) : (
                    <div className="text-center text-gray-500">
                      <Image className="w-12 h-12 mx-auto mb-2" />
                      <p className="text-sm">Shot {selectedShot + 1}</p>
                    </div>
                  )}
                  <div className="absolute top-2 right-2 bg-black/60 px-2 py-1 rounded text-xs text-gray-300">
                    {shots[selectedShot]?.image_status || 'unknown'}
                  </div>
                </div>
                <p className="text-xs text-gray-500 mb-3 text-center">
                  Drag & drop images or videos onto shots, or use the upload buttons below each thumbnail
                </p>
                
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {shots.map((shot, idx) => {
                    const imgKey = `${currentScene.id}-${idx}`
                    const imgSrc = shotImages[imgKey]
                    const isDragOver = dragOverShot === idx
                    const isUploading = uploadingShot === idx
                    const hasVideo = shot.video_path
                    return (
                      <div key={idx} className="flex-shrink-0">
                        <div
                          onClick={() => setSelectedShot(idx)}
                          onDragOver={(e) => handleDragOver(e, idx)}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => handleDrop(e, currentScene.id, idx)}
                          className={`relative w-32 h-20 rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                            isDragOver
                              ? 'border-yellow-400 bg-yellow-400/10 ring-2 ring-yellow-400/50'
                              : idx === selectedShot
                              ? 'border-sky-500 ring-2 ring-sky-500/50'
                              : shot.image_status === 'approved'
                              ? 'border-green-500'
                              : shot.image_status === 'uploaded'
                              ? 'border-purple-500'
                              : 'border-gray-700 hover:border-gray-500'
                          }`}
                        >
                          {isUploading ? (
                            <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                              <Loader2 className="w-5 h-5 animate-spin text-yellow-500" />
                            </div>
                          ) : isDragOver ? (
                            <div className="w-full h-full bg-yellow-400/10 flex items-center justify-center">
                              <UploadCloud className="w-6 h-6 text-yellow-400" />
                            </div>
                          ) : imgSrc ? (
                            <img src={imgSrc} alt={`Shot ${idx + 1}`} className="w-full h-full object-cover" />
                          ) : shot.image_status === 'generating' ? (
                            <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                              <Loader2 className="w-5 h-5 animate-spin text-sky-500" />
                            </div>
                          ) : (
                            <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                              <span className="text-xs text-gray-500">{idx + 1}</span>
                            </div>
                          )}
                          {hasVideo && (
                            <div className="absolute top-1 left-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
                              <Film className="w-3 h-3 text-white" />
                            </div>
                          )}
                          {shot.image_status === 'uploaded' && (
                            <div className="absolute top-1 right-1 w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center">
                              <Upload className="w-3 h-3 text-white" />
                            </div>
                          )}
                          {shot.image_status === 'approved' && (
                            <div className="absolute top-1 right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                              <Check className="w-3 h-3 text-white" />
                            </div>
                          )}
                          {shot.image_status === 'generated' && (
                            <div className="absolute top-1 right-1 w-5 h-5 bg-sky-500 rounded-full flex items-center justify-center">
                              <span className="text-[8px] text-white font-bold">✓</span>
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 mt-1">
                          <button
                            onClick={() => handleRegenerateShot(currentScene.id, idx)}
                            disabled={generating}
                            className="flex-1 p-2 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-400 transition-colors disabled:opacity-50"
                            title="Regenerate with same prompt"
                          >
                            <RefreshCw className={`w-4 h-4 mx-auto ${generating ? 'animate-spin' : ''}`} />
                          </button>
                          <button
                            onClick={() => {
                              setEditingShotPrompt(editingShotPrompt === idx ? null : idx)
                              setEditedShotPrompt(shot.prompt)
                            }}
                            className="flex-1 p-2 bg-gray-800 hover:bg-blue-900/50 rounded text-xs text-blue-400 transition-colors"
                            title="Edit prompt & regenerate"
                          >
                            <Edit3 className="w-4 h-4 mx-auto" />
                          </button>
                          {shot.image_status !== 'approved' && (
                            <button
                              onClick={() => handleApproveShot(currentScene.id, idx)}
                              className="flex-1 p-2 bg-gray-800 hover:bg-green-900/50 rounded text-xs text-green-400 transition-colors"
                              title="Approve"
                            >
                              <Check className="w-4 h-4 mx-auto" />
                            </button>
                          )}
                        </div>
                        <div className="flex gap-1 mt-1">
                          <label
                            className="flex-1 p-2 bg-gray-800 hover:bg-purple-900/50 rounded text-xs text-purple-400 transition-colors cursor-pointer text-center"
                            title="Upload image"
                          >
                            <Image className="w-4 h-4 mx-auto" />
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => handleFileSelect(e, currentScene.id, idx)}
                            />
                          </label>
                          <label
                            className="flex-1 p-2 bg-gray-800 hover:bg-red-900/50 rounded text-xs text-red-400 transition-colors cursor-pointer text-center"
                            title="Upload video"
                          >
                            <Film className="w-4 h-4 mx-auto" />
                            <input
                              type="file"
                              accept="video/*"
                              className="hidden"
                              onChange={(e) => handleFileSelect(e, currentScene.id, idx)}
                            />
                          </label>
                        </div>
                      </div>
                    )
                  })}
                </div>
                
                {editingShotPrompt !== null && (
                  <div className="mt-3 p-3 bg-gray-800 rounded-xl border border-blue-600/50">
                    <label className="text-xs text-gray-400 mb-1 block">
                      Edit prompt for Shot {editingShotPrompt + 1}:
                    </label>
                    <textarea
                      value={editedShotPrompt}
                      onChange={(e) => setEditedShotPrompt(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2 text-sm text-white resize-none focus:border-blue-500 focus:outline-none"
                      rows={3}
                    />
                    <div className="flex gap-2 mt-2 flex-wrap">
                      <button
                        onClick={() => handleRegenerateShot(currentScene.id, editingShotPrompt)}
                        disabled={generating || !editedShotPrompt.trim()}
                        className="flex items-center gap-1 bg-sky-600 hover:bg-sky-700 text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        Regenerate
                      </button>
                      <button
                        onClick={() => setEditingShotPrompt(null)}
                        className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-2 rounded-lg text-xs transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-blue-400" />
                Voiceover
              </h3>
              <button
                onClick={() => handleGenerateVoiceover(currentScene.id)}
                disabled={generatingVoiceover === currentScene.id}
                className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
              >
                {generatingVoiceover === currentScene.id ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : currentScene.voiceover_path ? (
                  <RefreshCw className="w-3 h-3" />
                ) : (
                  <Volume2 className="w-3 h-3" />
                )}
                {currentScene.voiceover_path ? 'Regenerate' : 'Generate Voiceover'}
              </button>
            </div>
            {currentScene.voiceover_path ? (
              <div className="space-y-3">
                <audio
                  controls
                  className="w-full"
                  src={`/output/${id}/${currentScene.voiceover_path?.split(/[/\\]/).pop()}?t=${Date.now()}`}
                  key={currentScene.voiceover_path}
                >
                  Your browser does not support audio.
                </audio>
                <p className="text-sm text-gray-400 line-clamp-3">{currentScene.voiceover_text}</p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-400 mb-3 line-clamp-3">{currentScene.voiceover_text}</p>
              </div>
            )}
          </div>
        </div>
        
        <div className="space-y-4">
          <div className="card">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4 text-yellow-400" />
              Scene Details
            </h3>
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-gray-500">Description:</span>
                <p className="text-gray-300 mt-1">{currentScene.description}</p>
              </div>
              <div>
                <span className="text-gray-500">Duration:</span>
                <span className="ml-2">{currentScene.duration_seconds}s</span>
              </div>
              <div>
                <span className="text-gray-500">Shots:</span>
                <span className="ml-2">{currentScene.shot_count}</span>
              </div>
              <div>
                <span className="text-gray-500">Status:</span>
                <span className={`ml-2 ${currentScene.generated ? 'text-green-400' : 'text-yellow-400'}`}>
                  {currentScene.generated ? 'Approved' : 'Pending'}
                </span>
              </div>
            </div>
          </div>
          
          {shots[selectedShot] && (
            <div className="card">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Eye className="w-4 h-4 text-purple-400" />
                Shot {selectedShot + 1} Details
              </h3>
              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-gray-500">Prompt:</span>
                  <p className="text-gray-300 mt-1 text-xs break-words">{shots[selectedShot].prompt}</p>
                </div>
                <div>
                  <span className="text-gray-500">Seed:</span>
                  <span className="ml-2 font-mono text-xs">{shots[selectedShot].seed}</span>
                </div>
                <div>
                  <span className="text-gray-500">Status:</span>
                  <span className={`ml-2 ${
                    shots[selectedShot].image_status === 'approved' ? 'text-green-400' :
                    shots[selectedShot].image_status === 'generated' ? 'text-blue-400' :
                    shots[selectedShot].image_status === 'generating' ? 'text-yellow-400' :
                    'text-gray-400'
                  }`}>
                    {shots[selectedShot].image_status}
                  </span>
                </div>
                {shots[selectedShot].image_path && (
                  <div>
                    <span className="text-gray-500">File:</span>
                    <span className="ml-2 text-xs text-gray-400 break-all">
                      {shots[selectedShot].image_path?.split(/[/\\]/).pop()}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
          
          <div className="flex gap-3">
            <button
              onClick={goToPrev}
              disabled={currentSceneIdx === 0}
              className="flex-1 flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-xl font-medium transition-colors disabled:opacity-30"
            >
              <ChevronLeft className="w-5 h-5" />
              Previous
            </button>
            <button
              onClick={goToNext}
              disabled={currentSceneIdx === scenes.length - 1}
              className="flex-1 flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-xl font-medium transition-colors disabled:opacity-30"
            >
              Next
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          
          <div className="card">
            <h3 className="font-semibold mb-3">Progress</h3>
            <div className="w-full bg-gray-800 rounded-full h-3 mb-2">
              <div
                className="bg-sky-600 h-3 rounded-full transition-all"
                style={{ width: `${(approvedCount / scenes.length) * 100}%` }}
              />
            </div>
            <p className="text-sm text-gray-400 text-center">
              {approvedCount} / {scenes.length} scenes approved
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Review
