import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'react-toastify'
import { FolderOpen, Plus, Clock, Film, Loader2, Trash2, Eye, RefreshCw } from 'lucide-react'
import { listProjects, deleteProject, regenerateProject } from '../services/api'

function Projects() {
  const [projects, setProjects] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  
  useEffect(() => { fetchProjects() }, [])
  
  const fetchProjects = async () => {
    try { setProjects(await listProjects()) }
    catch { toast.error('Failed to load projects') }
    finally { setIsLoading(false) }
  }
  
  const getStatusBadge = (status) => {
    const map = {
      completed: 'badge-success', generating: 'badge-warning', voiceover: 'badge-warning',
      stitching: 'badge-warning', parsing: 'badge-info', pending: 'badge-info', failed: 'badge-error',
    }
    return <span className={`badge ${map[status] || 'badge-info'}`}>{status}</span>
  }
  
  const formatDate = (dateString) => {
    const d = new Date(dateString)
    const mins = Math.floor((Date.now() - d) / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    if (days < 7) return `${days}d ago`
    return d.toLocaleDateString()
  }
  
  const handleDelete = async (e, projectId) => {
    e.preventDefault(); e.stopPropagation()
    if (!window.confirm('Delete this project? This cannot be undone.')) return
    try {
      await deleteProject(projectId)
      setProjects(prev => prev.filter(p => p.id !== projectId))
      toast.success('Project deleted')
    } catch { toast.error('Failed to delete project') }
  }
  
  const handleRegenerate = async (e, projectId) => {
    e.preventDefault(); e.stopPropagation()
    if (!window.confirm('Regenerate this project? Uploaded clips will be preserved, AI clips will be regenerated.')) return
    try {
      await regenerateProject(projectId)
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, status: 'generating', progress: 0.1 } : p))
      toast.success('Regeneration started')
    } catch { toast.error('Failed to regenerate') }
  }
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
      </div>
    )
  }
  
  return (
    <div className="page-container">
      <div className="flex items-center justify-between mb-6 md:mb-8 gap-4">
        <div className="min-w-0">
          <h1 className="section-title truncate">Projects</h1>
          <p className="text-gray-500 text-sm mt-0.5 hidden sm:block">Manage your video generation projects</p>
        </div>
        <Link to="/" className="btn-primary flex items-center gap-2 shrink-0 text-sm">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New Project</span>
        </Link>
      </div>
      
      {projects.length === 0 ? (
        <div className="card text-center py-12 md:py-16">
          <FolderOpen className="w-12 h-12 md:w-16 md:h-16 mx-auto mb-4 text-gray-700" />
          <h2 className="text-lg md:text-xl font-semibold mb-2">No projects yet</h2>
          <p className="text-gray-500 mb-5 text-sm">Create your first video project to get started</p>
          <Link to="/" className="btn-primary inline-flex items-center gap-2 text-sm">
            <Plus className="w-4 h-4" /> Create Project
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {projects.map((project) => (
            <Link key={project.id} to={`/project/${project.id}`} className="card-hover group">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate group-hover:text-sky-400 transition-colors text-sm md:text-base">{project.name}</h3>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{project.script_text.slice(0, 80)}...</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {getStatusBadge(project.status)}
                  {project.status === 'completed' && (
                    <button onClick={(e) => handleRegenerate(e, project.id)}
                      className="p-1.5 rounded-lg text-gray-600 hover:text-sky-400 hover:bg-sky-500/10 transition-colors opacity-0 group-hover:opacity-100"
                      title="Regenerate (keeps uploaded clips)">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={(e) => handleDelete(e, project.id)}
                    className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                    title="Delete project">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              
              <div className="flex items-center justify-between text-xs text-gray-500">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1"><Film className="w-3 h-3" />{project.scenes_count} scenes</span>
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{project.target_duration}</span>
                </div>
                <span>{formatDate(project.created_at)}</span>
              </div>
              
              {project.status === 'generating' && (
                <div className="mt-3">
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-sky-500 rounded-full transition-all duration-500" style={{ width: `${project.progress * 100}%` }} />
                  </div>
                  <div className="text-[10px] text-gray-600 mt-1 text-right">{Math.round(project.progress * 100)}%</div>
                </div>
              )}
              
              {project.status === 'completed' && project.video_path && (
                <div className="mt-3 pt-3 border-t border-gray-800/50">
                  <div className="flex items-center text-emerald-400/80 text-xs"><Eye className="w-3 h-3 mr-1" />Ready to download</div>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default Projects
