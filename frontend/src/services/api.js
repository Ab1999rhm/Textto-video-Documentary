import axios from 'axios'

const API_BASE_URL = '/api'

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 300000,
})

api.interceptors.request.use((config) => {
  if (!(config.data instanceof FormData)) {
    config.headers['Content-Type'] = 'application/json'
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error.response?.data?.detail || error.message || 'An error occurred'
    console.error('API Error:', message)
    return Promise.reject(error)
  }
)

export const createProject = async (data) => {
  const response = await api.post('/projects', data)
  return response.data
}

export const uploadScript = async (file, options = {}) => {
  const formData = new FormData()
  formData.append('file', file)
  
  Object.entries(options).forEach(([key, value]) => {
    formData.append(key, String(value))
  })
  
  const response = await api.post('/projects/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return response.data
}

export const listProjects = async (skip = 0, limit = 50) => {
  const response = await api.get(`/projects?skip=${skip}&limit=${limit}`)
  return response.data
}

export const getProject = async (projectId) => {
  const response = await api.get(`/projects/${projectId}`)
  return response.data
}

export const deleteProject = async (projectId) => {
  const response = await api.delete(`/projects/${projectId}`)
  return response.data
}

export const getScenes = async (projectId) => {
  const response = await api.get(`/projects/${projectId}/scenes`)
  return response.data
}

export const updateScene = async (projectId, sceneId, updates) => {
  const response = await api.put(`/projects/${projectId}/scenes/${sceneId}`, updates)
  return response.data
}

export const generateSceneShots = async (projectId, sceneId) => {
  const response = await api.post(`/projects/${projectId}/scenes/${sceneId}/shots/generate`)
  return response.data
}

export const regenerateShot = async (projectId, sceneId, shotId, updateData = null) => {
  const response = await api.post(
    `/projects/${projectId}/scenes/${sceneId}/shots/${shotId}/regenerate`,
    updateData
  )
  return response.data
}

export const approveShot = async (projectId, sceneId, shotId) => {
  const response = await api.post(`/projects/${projectId}/scenes/${sceneId}/shots/${shotId}/approve`)
  return response.data
}

export const uploadShotImage = async (projectId, sceneId, shotId, file) => {
  const formData = new FormData()
  formData.append('file', file)
  const response = await api.post(
    `/projects/${projectId}/scenes/${sceneId}/shots/${shotId}/upload`,
    formData
  )
  return response.data
}

export const uploadShotVideo = async (projectId, sceneId, shotId, file) => {
  const formData = new FormData()
  formData.append('file', file)
  const response = await api.post(
    `/projects/${projectId}/scenes/${sceneId}/shots/${shotId}/upload-video`,
    formData
  )
  return response.data
}

export const getShotVideo = async (projectId, sceneId, shotId, cacheBust) => {
  const ts = cacheBust || Date.now()
  const response = await api.get(
    `/projects/${projectId}/scenes/${sceneId}/shots/${shotId}/video?t=${ts}`,
    { responseType: 'blob' }
  )
  return URL.createObjectURL(response.data)
}

export const getEditorState = async (projectId) => {
  const response = await api.get(`/projects/${projectId}/editor`)
  return response.data
}

export const saveEditorState = async (projectId, state) => {
  const response = await api.put(`/projects/${projectId}/editor`, state)
  return response.data
}

export const uploadMedia = async (projectId, file) => {
  const formData = new FormData()
  formData.append('file', file)
  const response = await api.post(`/projects/${projectId}/upload-media`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
  return response.data
}

export const exportVideo = async (projectId, config) => {
  const response = await api.post(`/projects/${projectId}/editor/export`, config)
  return response.data
}

export const generateVoiceover = async (projectId, sceneId) => {
  const response = await api.post(`/projects/${projectId}/scenes/${sceneId}/voiceover/generate`)
  return response.data
}

export const regenerateProject = async (projectId) => {
  const response = await api.post(`/projects/${projectId}/regenerate`)
  return response.data
}

export const approveScene = async (projectId, sceneId) => {
  const response = await api.post(`/projects/${projectId}/scenes/${sceneId}/approve`)
  return response.data
}

export const approveAllScenes = async (projectId) => {
  const response = await api.post(`/projects/${projectId}/approve-all`)
  return response.data
}

export const startGeneration = async (projectId) => {
  const response = await api.post(`/projects/${projectId}/generate`)
  return response.data
}

export const getGenerationStatus = async (projectId) => {
  const response = await api.get(`/projects/${projectId}/status`)
  return response.data
}

export const downloadVideo = async (projectId) => {
  const response = await api.get(`/projects/${projectId}/download`, {
    responseType: 'blob',
  })
  return response.data
}

export const getVideoStreamUrl = (projectId) => {
  return `/api/projects/${projectId}/stream`
}

export const getScenePreview = async (projectId, sceneId) => {
  const response = await api.get(`/projects/${projectId}/preview/${sceneId}`, {
    responseType: 'blob',
  })
  return response.data
}

export const getShotImage = async (projectId, sceneId, shotId, cacheBust) => {
  const ts = cacheBust || Date.now()
  const response = await api.get(`/projects/${projectId}/scenes/${sceneId}/shots/${shotId}/image?t=${ts}`, {
    responseType: 'blob',
  })
  return URL.createObjectURL(response.data)
}

export const getGpuInfo = async () => {
  const response = await api.get('/gpu/info')
  return response.data
}

export const getCloudStatus = async () => {
  const response = await api.get('/cloud/status')
  return response.data
}

export const getLanguages = async () => {
  const response = await api.get('/languages')
  return response.data
}

export const getModels = async () => {
  const response = await api.get('/models')
  return response.data
}

export const healthCheck = async () => {
  const response = await api.get('/health')
  return response.data
}

export class WebSocketManager {
  constructor() {
    this.connections = new Map()
  }
  
  connect(projectId, onMessage, onError, onClose) {
    const existing = this.connections.get(projectId)
    if (existing) {
      try { existing.close() } catch (e) {}
      this.connections.delete(projectId)
    }
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/${projectId}`
    
    const ws = new WebSocket(wsUrl)
    
    ws.onopen = () => {
      console.log(`WebSocket connected for project ${projectId}`)
      this.connections.set(projectId, ws)
    }
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        onMessage(data)
      } catch (e) {
        console.error('WebSocket message parse error:', e)
      }
    }
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
      if (onError) onError(error)
    }
    
    ws.onclose = () => {
      console.log(`WebSocket closed for project ${projectId}`)
      this.connections.delete(projectId)
      if (onClose) onClose()
    }
    
    return ws
  }
  
  disconnect(projectId) {
    const ws = this.connections.get(projectId)
    if (ws) {
      ws.close()
      this.connections.delete(projectId)
    }
  }
  
  send(projectId, data) {
    const ws = this.connections.get(projectId)
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data))
    }
  }
  
  disconnectAll() {
    this.connections.forEach((ws) => ws.close())
    this.connections.clear()
  }
}

export const wsManager = new WebSocketManager()
