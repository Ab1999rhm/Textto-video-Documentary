import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import { toast } from 'react-toastify'
import { Upload, FileText, Settings, Loader2, ArrowRight, Film, Clock, Palette, Sliders } from 'lucide-react'
import { createProject, getGpuInfo, getLanguages, getModels } from '../services/api'

function Home() {
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(false)
  const [gpuInfo, setGpuInfo] = useState(null)
  const [languages, setLanguages] = useState([])
  const [models, setModels] = useState({})
  const [scriptText, setScriptText] = useState('')
  const [projectName, setProjectName] = useState('')
  
  const [config, setConfig] = useState({
    style: 'cinematic',
    target_duration: '00:01:00',
    resolution: '1024x576',
    precision: 'fp16',
    enable_cpu_offload: true,
    enable_voiceover: true,
    enable_music: true,
    enable_subtitles: true,
    enable_upscaling: false,
    transition_type: 'cross_dissolve',
    transition_duration: 1.0,
    language: 'en',
    gender: 'female',
    aspect_ratio: '16:9',
    image_model: 'flux-realism',
    review_mode: true,
    shots_per_scene: 3,
  })
  
  useEffect(() => {
    fetchGpuInfo()
    fetchLanguages()
    fetchModels()
  }, [])
  
  const fetchGpuInfo = async () => {
    try { setGpuInfo(await getGpuInfo()) } catch {}
  }
  
  const fetchLanguages = async () => {
    try { setLanguages(await getLanguages()) } catch {}
  }
  
  const fetchModels = async () => {
    try { setModels(await getModels()) } catch {}
  }
  
  const onDrop = useCallback(async (acceptedFiles) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0]
      const text = await file.text()
      setScriptText(text)
      if (!projectName) setProjectName(file.name.replace(/\.[^/.]+$/, ''))
      toast.success(`Loaded: ${file.name}`)
    }
  }, [projectName])
  
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/plain': ['.txt'], 'text/markdown': ['.md'], 'text/html': ['.html'] },
    maxFiles: 1,
  })
  
  const handleSubmit = async () => {
    if (!scriptText.trim()) { toast.error('Please enter or upload a script'); return }
    if (scriptText.length < 50) { toast.error('Script too short. Minimum 50 characters required.'); return }
    
    setIsLoading(true)
    try {
      const project = await createProject({ name: projectName || 'Untitled Project', script_text: scriptText, ...config })
      toast.success(`Created ${project.scenes_count} scenes!`)
      navigate(`/project/${project.id}/review`)
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to create project')
    } finally { setIsLoading(false) }
  }
  
  const wordCount = scriptText.split(/\s+/).filter(w => w).length
  const estimatedDuration = Math.ceil(wordCount / 150)
  const estimatedScenes = Math.max(1, Math.ceil(wordCount / 200))
  const estimatedShots = estimatedScenes * config.shots_per_scene
  
  return (
    <div className="page-container">
      <div className="text-center mb-8 md:mb-12">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-3 md:mb-4">
          Text to <span className="text-gradient">Documentary</span>
        </h1>
        <p className="text-gray-400 text-sm sm:text-base md:text-lg max-w-2xl mx-auto leading-relaxed">
          Create documentary-style videos from text. AI generates high-quality images for each scene,
          adds voiceover, and assembles everything for YouTube/TikTok.
        </p>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 md:gap-6">
        <div className="lg:col-span-2 space-y-5 md:space-y-6">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold flex items-center gap-2 text-sm md:text-base">
                <FileText className="w-4 h-4 text-sky-400" />
                Script
              </h2>
              <span className="text-xs text-gray-500">
                {wordCount} words · ~{estimatedDuration}min · {estimatedScenes} scenes
              </span>
            </div>
            
            <textarea
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              placeholder={"Paste your documentary script here...\n\nUse double line breaks to separate scenes.\n\nFor a 25-minute documentary, aim for 3000-5000 words."}
              className="w-full h-48 sm:h-56 md:h-64 bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 text-white placeholder-gray-600 
                         focus:outline-none focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/20 resize-none font-mono text-sm
                         transition-all"
            />
            
            <div
              {...getRootProps()}
              className={`mt-3 border-2 border-dashed rounded-xl p-4 md:p-6 text-center cursor-pointer transition-all ${
                isDragActive
                  ? 'border-sky-500 bg-sky-500/5'
                  : 'border-gray-700/50 hover:border-gray-600 hover:bg-gray-800/30'
              }`}
            >
              <input {...getInputProps()} />
              <Upload className="w-7 h-7 mx-auto mb-2 text-gray-500" />
              <p className="text-gray-400 text-sm">
                {isDragActive ? 'Drop your script here...' : 'Drag & drop a .txt or .md file, or click to browse'}
              </p>
            </div>
          </div>
          
          <div className="card">
            <div className="flex items-center mb-4">
              <Settings className="w-4 h-4 mr-2 text-sky-400" />
              <h2 className="font-semibold text-sm md:text-base">Configuration</h2>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
              <div>
                <label className="label">Project Name</label>
                <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="My Documentary" className="input-field" />
              </div>
              <div>
                <label className="label">Image Model</label>
                <select value={config.image_model} onChange={(e) => setConfig({ ...config, image_model: e.target.value })} className="input-field">
                  {Object.entries(models).map(([key, info]) => (
                    <option key={key} value={key}>{info.name} — {info.description}</option>
                  ))}
                  {Object.keys(models).length === 0 && (
                    <>
                      <option value="flux-realism">FLUX Realism — High quality</option>
                      <option value="pollinations-video">Pollinations Video — Free AI video</option>
                      <option value="huggingface">HuggingFace FLUX — High quality</option>
                    </>
                  )}
                </select>
              </div>
              <div>
                <label className="label">Aspect Ratio</label>
                <select value={config.aspect_ratio} onChange={(e) => setConfig({ ...config, aspect_ratio: e.target.value })} className="input-field">
                  <option value="16:9">16:9 — YouTube</option>
                  <option value="9:16">9:16 — TikTok</option>
                  <option value="1:1">1:1 — Instagram</option>
                </select>
              </div>
              <div>
                <label className="label"><Clock className="w-3 h-3 inline mr-1" />Duration</label>
                <select value={config.target_duration} onChange={(e) => setConfig({ ...config, target_duration: e.target.value })} className="input-field">
                  <option value="00:01:00">1 minute</option>
                  <option value="00:05:00">5 minutes</option>
                  <option value="00:10:00">10 minutes</option>
                  <option value="00:15:00">15 minutes</option>
                  <option value="00:25:00">25 minutes</option>
                  <option value="00:30:00">30 minutes</option>
                  <option value="01:00:00">1 hour</option>
                </select>
              </div>
              <div>
                <label className="label"><Sliders className="w-3 h-3 inline mr-1" />Shots/Scene</label>
                <select value={config.shots_per_scene} onChange={(e) => setConfig({ ...config, shots_per_scene: parseInt(e.target.value) })} className="input-field">
                  <option value={2}>2 shots</option>
                  <option value={3}>3 shots (Recommended)</option>
                  <option value={4}>4 shots</option>
                  <option value={5}>5 shots</option>
                </select>
              </div>
              <div>
                <label className="label">Voice Language</label>
                <select value={config.language} onChange={(e) => setConfig({ ...config, language: e.target.value })} className="input-field">
                  {languages.map((lang) => <option key={lang.code} value={lang.code}>{lang.name}</option>)}
                  {languages.length === 0 && <option value="en">English</option>}
                </select>
              </div>
              <div>
                <label className="label">Voice Gender</label>
                <select value={config.gender} onChange={(e) => setConfig({ ...config, gender: e.target.value })} className="input-field">
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                </select>
              </div>
              <div>
                <label className="label"><Palette className="w-3 h-3 inline mr-1" />Video Style</label>
                <select value={config.style} onChange={(e) => setConfig({ ...config, style: e.target.value })} className="input-field">
                  <option value="cinematic">Cinematic</option>
                  <option value="realistic">Realistic</option>
                  <option value="animated">Animated</option>
                  <option value="anime">Anime</option>
                  <option value="noir">Film Noir</option>
                  <option value="vintage">Vintage</option>
                  <option value="scifi">Sci-Fi</option>
                  <option value="fantasy">Fantasy</option>
                </select>
              </div>
            </div>
            
            <div className="mt-5 grid grid-cols-3 sm:grid-cols-5 gap-2 md:gap-3">
              {[
                { key: 'enable_voiceover', label: 'Voice', icon: '🎙' },
                { key: 'enable_subtitles', label: 'Subs', icon: '📝' },
                { key: 'enable_music', label: 'Music', icon: '🎵' },
                { key: 'review_mode', label: 'Review', icon: '👁' },
                { key: 'enable_upscaling', label: 'Upscale', icon: '✨' },
              ].map(({ key, label, icon }) => (
                <button
                  key={key}
                  onClick={() => setConfig({ ...config, [key]: !config[key] })}
                  className={`flex items-center justify-center gap-1.5 p-2.5 md:p-3 rounded-xl border transition-all text-xs md:text-sm ${
                    config[key]
                      ? 'bg-sky-500/10 border-sky-500/30 text-sky-400'
                      : 'bg-gray-800/50 border-gray-700/50 text-gray-500 hover:border-gray-600'
                  }`}
                >
                  <span>{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        
        <div className="space-y-5 md:space-y-6">
          <div className="card">
            <h3 className="font-semibold mb-4 text-sm">Preview</h3>
            <div className="space-y-2.5 text-sm">
              {[
                ['Scenes', estimatedScenes],
                ['Total Shots', estimatedShots],
                ['Duration', config.target_duration],
                ['Aspect', config.aspect_ratio],
                ['Model', <span className="capitalize">{config.image_model.replace('-', ' ')}</span>],
                ['Style', <span className="capitalize">{config.style}</span>],
                ['Voiceover', <span className={config.enable_voiceover ? 'text-emerald-400' : 'text-gray-600'}>{config.enable_voiceover ? 'On' : 'Off'}</span>],
                ['Review Mode', <span className={config.review_mode ? 'text-sky-400' : 'text-gray-600'}>{config.review_mode ? 'Interactive' : 'Auto'}</span>],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-gray-500">{label}</span>
                  <span className="text-gray-200">{value}</span>
                </div>
              ))}
            </div>
          </div>
          
          <button
            onClick={handleSubmit}
            disabled={!scriptText.trim() || isLoading || scriptText.length < 50}
            className="btn-primary w-full flex items-center justify-center gap-2 py-3.5 text-sm md:text-base"
          >
            {isLoading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</>
            ) : (
              <><span>{config.review_mode ? 'Start Review' : 'Generate'}</span> <ArrowRight className="w-4 h-4" /></>
            )}
          </button>
          
          {scriptText.length > 0 && scriptText.length < 50 && (
            <p className="text-xs text-amber-500 text-center">{scriptText.length}/50 characters minimum</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default Home
