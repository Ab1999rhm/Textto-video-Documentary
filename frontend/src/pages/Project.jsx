import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  ArrowLeft, Play, Pause, Download, Loader2, CheckCircle2, XCircle,
  Clock, Film, Music, FileText, Settings, RefreshCw, Trash2, Edit3,
  ChevronDown, ChevronUp, Volume2, Subtitles, Scissors, Eye, Image
} from 'lucide-react'
import {
  getProject, getScenes, updateScene, startGeneration,
  getGenerationStatus, downloadVideo, wsManager, getShotImage
} from '../services/api'

function Project() {
  const { id } = useParams()
  const navigate = useNavigate()
  
  const [project, setProject] = useState(null)
  const [scenes, setScenes] = useState([])
  const [status, setStatus] = useState(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [expandedScene, setExpandedScene] = useState(null)
  const [editingScene, setEditingScene] = useState(null)
  const [editedData, setEditedData] = useState({})
  const [videoUrl, setVideoUrl] = useState(null)
  const [shotImages, setShotImages] = useState({})
  const [showSidebar, setShowSidebar] = useState(true)
  
  const wsRef = useRef(null)
  
  useEffect(() => {
    fetchProject()
    fetchScenes()
    
    return () => {
      wsManager.disconnect(id)
    }
  }, [id])
  
  useEffect(() => {
    if (status?.status === 'generating' || status?.status === 'voiceover' || 
        status?.status === 'stitching' || status?.status === 'parsing') {
      const interval = setInterval(fetchStatus, 2000)
      return () => clearInterval(interval)
    }
  }, [status?.status])
  
  useEffect(() => {
    scenes.forEach(scene => {
      const shots = scene.shots || []
      shots.forEach((shot, idx) => {
        if ((shot.image_status === 'generated' || shot.image_status === 'approved') && !shotImages[`${scene.id}-${idx}`]) {
          getShotImage(id, scene.id, idx)
            .then(url => setShotImages(prev => ({ ...prev, [`${scene.id}-${idx}`]: url })))
            .catch(() => {})
        }
      })
    })
  }, [scenes, id, shotImages])
  
  const connectWebSocket = useCallback(() => {
    wsManager.connect(
      id,
      (message) => {
        if (message.type === 'progress') {
          setStatus({
            status: message.status,
            progress: message.progress,
            message: message.message,
          })
          
          setProject(prev => prev ? {
            ...prev,
            status: message.status,
            progress: message.progress,
          } : prev)
        } else if (message.type === 'completed') {
          setStatus({
            status: 'completed',
            progress: 1.0,
            message: message.message,
          })
          fetchProject()
          toast.success('Video generation complete!')
        } else if (message.type === 'error') {
          setStatus({
            status: 'failed',
            progress: 0,
            message: message.message,
          })
          toast.error(message.message)
        }
      },
      (error) => console.error('WS error:', error),
      () => console.log('WS closed')
    )
  }, [id])
  
  const fetchProject = async () => {
    try {
      const data = await getProject(id)
      setProject(data)
      setStatus({
        status: data.status,
        progress: data.progress,
        message: '',
      })
      
      if (data.video_path) {
        setVideoUrl(`/api/projects/${id}/stream`)
      }
      
      if (data.status === 'generating' || data.status === 'voiceover' || data.status === 'stitching') {
        connectWebSocket()
      }
    } catch (error) {
      toast.error('Failed to load project')
      navigate('/')
    }
  }
  
  const fetchScenes = async () => {
    try {
      const data = await getScenes(id)
      setScenes(data)
    } catch (error) {
      console.error('Failed to fetch scenes:', error)
    }
  }
  
  const fetchStatus = async () => {
    try {
      const data = await getGenerationStatus(id)
      setStatus(data)
      
      if (data.status === 'completed') {
        fetchProject()
      }
    } catch (error) {
      console.error('Status error:', error)
    }
  }
  
  const handleStartGeneration = async () => {
    setIsGenerating(true)
    try {
      await startGeneration(id)
      connectWebSocket()
      toast.success('Generation started!')
      fetchStatus()
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to start generation')
    } finally {
      setIsGenerating(false)
    }
  }
  
  const handleDownload = async () => {
    setIsDownloading(true)
    try {
      const blob = await downloadVideo(id)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${project.name || id}.mp4`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success('Download started')
    } catch (error) {
      toast.error('Failed to download video')
    } finally {
      setIsDownloading(false)
    }
  }
  
  const handleEditScene = (scene) => {
    setEditingScene(scene.id)
    setEditedData({
      description: scene.description,
      prompt: scene.prompt,
      voiceover_text: scene.voiceover_text,
      duration: scene.duration,
      background_music: scene.background_music,
      seed: scene.seed,
    })
  }
  
  const handleSaveScene = async () => {
    try {
      await updateScene(id, editingScene, editedData)
      setEditingScene(null)
      setEditedData({})
      fetchScenes()
      toast.success('Scene updated')
    } catch (error) {
      toast.error('Failed to update scene')
    }
  }
  
  const handleCancelEdit = () => {
    setEditingScene(null)
    setEditedData({})
  }
  
  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="w-5 h-5 text-green-400" />
      case 'failed': return <XCircle className="w-5 h-5 text-red-400" />
      case 'generating':
      case 'voiceover':
      case 'stitching':
      case 'parsing': return <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
      default: return <Clock className="w-5 h-5 text-gray-400" />
    }
  }
  
  const statusSteps = [
    { key: 'parsing', label: 'Parsing', icon: FileText },
    { key: 'generating', label: 'Generating', icon: Film },
    { key: 'voiceover', label: 'Voiceover', icon: Volume2 },
    { key: 'stitching', label: 'Stitching', icon: Scissors },
    { key: 'completed', label: 'Complete', icon: CheckCircle2 },
  ]
  
  const getStepStatus = (stepKey) => {
    const currentIndex = statusSteps.findIndex(s => s.key === status?.status)
    const stepIndex = statusSteps.findIndex(s => s.key === stepKey)
    
    if (status?.status === 'failed') return 'failed'
    if (stepIndex < currentIndex) return 'completed'
    if (stepIndex === currentIndex) return 'current'
    return 'pending'
  }
  
  if (!project) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
      </div>
    )
  }
  
  const totalShots = scenes.reduce((sum, s) => sum + (s.shots?.length || s.shot_count || 3), 0)

  return (
    <div className="page-container">
      <div className="mb-5 md:mb-6 flex items-center justify-between gap-3">
        <button onClick={() => navigate('/')} className="flex items-center text-gray-400 hover:text-white transition-colors text-sm shrink-0">
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          <span className="hidden sm:inline">Back</span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setShowSidebar(s => !s)} className="lg:hidden p-2 text-gray-400 hover:text-white hover:bg-gray-800/60 rounded-lg transition-all">
            <Settings className="w-4 h-4" />
          </button>
          {(project.status === 'review' || project.status === 'pending') && (
            <button onClick={() => navigate(`/project/${id}/review`)}
              className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-700 text-white px-3 md:px-4 py-2 rounded-xl text-xs md:text-sm font-medium transition-colors">
              <Eye className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Review</span>
            </button>
          )}
          {project.status === 'completed' && (
            <button onClick={() => navigate(`/project/${id}/editor`)}
              className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-700 text-white px-3 md:px-4 py-2 rounded-xl text-xs md:text-sm font-medium transition-colors">
              <Film className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Edit Video</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 md:gap-6">
        <div className={`lg:col-span-1 space-y-5 md:space-y-6 ${showSidebar ? '' : 'hidden lg:block'}`}>
          <div className="card">
            <h1 className="text-2xl font-bold mb-4 truncate">{project.name}</h1>
            
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Status</span>
                <div className="flex items-center space-x-2">
                  {getStatusIcon(status?.status)}
                  <span className="capitalize">{status?.status || 'pending'}</span>
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Scenes</span>
                <span>{scenes.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Total Shots</span>
                <span>{totalShots}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Duration</span>
                <span>{project.target_duration}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Model</span>
                <span className="capitalize">{(project.image_model || 'flux-realism').replace('-', ' ')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Aspect</span>
                <span>{project.aspect_ratio || '16:9'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Style</span>
                <span className="capitalize">{project.style}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Features</span>
                <div className="flex flex-wrap justify-end gap-1">
                  {project.enable_voiceover && <span className="badge badge-info text-xs">Voice</span>}
                  {project.enable_subtitles && <span className="badge badge-info text-xs">Subs</span>}
                  {project.enable_music && <span className="badge badge-info text-xs">Music</span>}
                </div>
              </div>
            </div>
            
            <div className="mt-6 space-y-3">
              {(status?.status === 'completed' || project.status === 'completed') ? (
                <button
                  onClick={handleDownload}
                  disabled={isDownloading}
                  className="btn-primary w-full flex items-center justify-center space-x-2"
                >
                  {isDownloading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Download className="w-5 h-5" />
                  )}
                  <span>{isDownloading ? 'Downloading...' : 'Download Video'}</span>
                </button>
              ) : (status?.status === 'generating' || status?.status === 'voiceover' || 
                    status?.status === 'stitching' || status?.status === 'parsing') ? (
                <div className="text-center py-4">
                  <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-2" />
                  <p className="text-sm text-gray-400">{status?.message}</p>
                </div>
              ) : project.status === 'review' ? (
                <button
                  onClick={() => navigate(`/project/${id}/review`)}
                  className="w-full flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-700 text-white py-3 rounded-xl font-semibold transition-colors"
                >
                  <Eye className="w-5 h-5" />
                  <span>Review & Approve Scenes</span>
                </button>
              ) : project.status === 'completed' ? (
                <button
                  onClick={() => navigate(`/project/${id}/editor`)}
                  className="w-full flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-semibold transition-colors"
                >
                  <Film className="w-5 h-5" />
                  <span>Open in Editor</span>
                </button>
              ) : (
                <button
                  onClick={handleStartGeneration}
                  disabled={isGenerating}
                  className="btn-primary w-full flex items-center justify-center space-x-2"
                >
                  <Play className="w-5 h-5" />
                  <span>Start Generation</span>
                </button>
              )}
            </div>
          </div>
          
          {(status?.status === 'generating' || status?.status === 'voiceover' || 
            status?.status === 'stitching' || status?.status === 'parsing' || 
            status?.status === 'completed' || status?.status === 'failed') && (
            <div className="card">
              <h3 className="font-semibold mb-4">Progress</h3>
              
              <div className="mb-4">
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-sky-600 to-sky-400 transition-all duration-500"
                    style={{ width: `${(status?.progress || 0) * 100}%` }}
                  />
                </div>
                <div className="text-xs text-gray-500 mt-1 text-right">
                  {Math.round((status?.progress || 0) * 100)}%
                </div>
              </div>
              
              <div className="space-y-2">
                {statusSteps.map((step, idx) => {
                  const stepStatus = getStepStatus(step.key)
                  const Icon = step.key === status?.status ? Loader2 : step.icon
                  
                  return (
                    <div
                      key={step.key}
                      className={`flex items-center space-x-3 p-2 rounded-lg transition-all ${
                        stepStatus === 'current' ? 'bg-sky-500/10' :
                        stepStatus === 'completed' ? 'bg-green-900/20' : ''
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${
                        stepStatus === 'current' ? 'text-sky-400 animate-spin' :
                        stepStatus === 'completed' ? 'text-green-400' :
                        stepStatus === 'failed' ? 'text-red-400' : 'text-gray-500'
                      }`} />
                      <span className={`text-sm ${
                        stepStatus === 'current' ? 'text-white' :
                        stepStatus === 'completed' ? 'text-green-400' : 'text-gray-500'
                      }`}>
                        {step.label}
                      </span>
                    </div>
                  )
                })}
              </div>
              
              {status?.message && (
                <div className="mt-4 p-3 bg-gray-800 rounded-lg text-sm text-gray-400">
                  {status.message}
                </div>
              )}
            </div>
          )}
          
          {videoUrl && (status?.status === 'completed' || project.status === 'completed') && (
            <div className="card" style={{ position: 'relative', zIndex: 1 }}>
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Film className="w-4 h-4 text-sky-400" />
                Preview
              </h3>
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  backgroundColor: '#000',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  zIndex: 2,
                }}
              >
                <video
                  key={videoUrl}
                  src={videoUrl}
                  controls
                  playsInline
                  preload="metadata"
                  style={{
                    display: 'block',
                    width: '100%',
                    maxHeight: '300px',
                    backgroundColor: '#000',
                    outline: 'none',
                    pointerEvents: 'auto',
                    position: 'relative',
                    zIndex: 3,
                  }}
                />
              </div>
              <div className="flex gap-2 mt-3">
                <a
                  href={videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-center text-xs py-2 px-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
                >
                  Open in new tab ↗
                </a>
              </div>
            </div>
          )}
        </div>
        
        <div className="lg:col-span-2">
          <div className="card">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold flex items-center">
                <Film className="w-5 h-5 mr-2 text-sky-400" />
                Scenes ({scenes.length}) · {totalShots} shots
              </h2>
            </div>
            
            <div className="space-y-4 max-h-[800px] overflow-y-auto">
              {scenes.map((scene) => {
                const shots = scene.shots || []
                return (
                  <div
                    key={scene.id}
                    className={`border rounded-xl transition-all ${
                      editingScene === scene.id ? 'border-blue-500 bg-gray-800/50' : 'border-gray-700 hover:border-gray-600'
                    }`}
                  >
                    <div
                      className="flex items-center justify-between p-4 cursor-pointer"
                      onClick={() => setExpandedScene(expandedScene === scene.id ? null : scene.id)}
                    >
                      <div className="flex items-center space-x-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${
                          scene.generated ? 'bg-emerald-600' : 'bg-sky-600'
                        }`}>
                          {scene.scene_number}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate max-w-[400px]">{scene.description}</div>
                          <div className="flex items-center space-x-4 text-sm text-gray-400 mt-1">
                            <span className="flex items-center">
                              <Clock className="w-3 h-3 mr-1" />
                              {scene.duration_seconds}s
                            </span>
                            <span className="flex items-center">
                              <Image className="w-3 h-3 mr-1" />
                              {shots.length || scene.shot_count || 3} shots
                            </span>
                            {scene.generated && (
                              <span className="text-green-400 flex items-center">
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                Approved
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleEditScene(scene)
                          }}
                          className="p-2 text-gray-400 hover:text-sky-400 hover:bg-sky-500/10 rounded-lg transition-colors"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        {expandedScene === scene.id ? (
                          <ChevronUp className="w-5 h-5 text-gray-400" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-gray-400" />
                        )}
                      </div>
                    </div>
                    
                    {expandedScene === scene.id && (
                      <div className="px-4 pb-4 space-y-3 border-t border-gray-700 pt-4">
                        {editingScene === scene.id ? (
                          <div className="space-y-3">
                            <div>
                              <label className="label">Description</label>
                              <textarea
                                value={editedData.description}
                                onChange={(e) => setEditedData({ ...editedData, description: e.target.value })}
                                className="input-field resize-none"
                                rows={2}
                              />
                            </div>
                            <div>
                              <label className="label">Video Prompt</label>
                              <textarea
                                value={editedData.prompt}
                                onChange={(e) => setEditedData({ ...editedData, prompt: e.target.value })}
                                className="input-field resize-none"
                                rows={3}
                              />
                            </div>
                            <div>
                              <label className="label">Voiceover Text</label>
                              <textarea
                                value={editedData.voiceover_text}
                                onChange={(e) => setEditedData({ ...editedData, voiceover_text: e.target.value })}
                                className="input-field resize-none"
                                rows={2}
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="label">Duration</label>
                                <input
                                  type="text"
                                  value={editedData.duration}
                                  onChange={(e) => setEditedData({ ...editedData, duration: e.target.value })}
                                  className="input-field"
                                />
                              </div>
                              <div>
                                <label className="label">Seed</label>
                                <input
                                  type="number"
                                  value={editedData.seed}
                                  onChange={(e) => setEditedData({ ...editedData, seed: parseInt(e.target.value) })}
                                  className="input-field"
                                />
                              </div>
                            </div>
                            <div className="flex space-x-2">
                              <button onClick={handleSaveScene} className="btn-primary flex-1">
                                Save Changes
                              </button>
                              <button onClick={handleCancelEdit} className="btn-secondary flex-1">
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {shots.length > 0 && (
                              <div className="flex gap-2 overflow-x-auto pb-2">
                                {shots.map((shot, idx) => {
                                  const imgSrc = shotImages[`${scene.id}-${idx}`]
                                  return (
                                    <div key={idx} className="flex-shrink-0 w-32">
                                      <div className={`w-full h-20 rounded-lg border-2 overflow-hidden ${
                                        shot.image_status === 'approved' ? 'border-green-500' :
                                        shot.image_status === 'generated' ? 'border-blue-500' : 'border-gray-700'
                                      } bg-gray-800 flex items-center justify-center`}>
                                        {imgSrc ? (
                                          <img src={imgSrc} alt={`Shot ${idx + 1}`} className="w-full h-full object-cover" />
                                        ) : (
                                          <Image className="w-6 h-6 text-gray-600" />
                                        )}
                                      </div>
                                      <p className="text-xs text-gray-500 mt-1 text-center truncate">
                                        Shot {idx + 1}
                                      </p>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                            <div className="bg-gray-800 rounded-lg p-3">
                              <div className="text-xs text-gray-500 mb-1">Prompt</div>
                              <div className="text-sm">{scene.prompt}</div>
                            </div>
                            <div className="bg-gray-800 rounded-lg p-3">
                              <div className="text-xs text-gray-500 mb-1">Voiceover</div>
                              <div className="text-sm">{scene.voiceover_text}</div>
                            </div>
                            {scene.character_tags?.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {scene.character_tags.map((tag, idx) => (
                                  <span key={idx} className="badge badge-info">{tag}</span>
                                ))}
                              </div>
                            )}
                            {scene.environment_tags?.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {scene.environment_tags.map((tag, idx) => (
                                  <span key={idx} className="badge bg-green-900/50 text-green-400 border border-green-800">{tag}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Project
