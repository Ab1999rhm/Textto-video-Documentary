import React, { useState } from 'react'
import { Clock, Music, Edit3, ChevronDown, ChevronUp, Film } from 'lucide-react'
import SceneEditor from './SceneEditor'

function SceneList({ scenes, onUpdateScene }) {
  const [expandedScene, setExpandedScene] = useState(null)
  const [editingScene, setEditingScene] = useState(null)

  const toggleExpand = (sceneId) => {
    setExpandedScene(expandedScene === sceneId ? null : sceneId)
    setEditingScene(null)
  }

  const handleEdit = (sceneId) => {
    setEditingScene(sceneId)
  }

  const handleSave = (updatedScene) => {
    onUpdateScene(updatedScene.scene_id, updatedScene)
    setEditingScene(null)
  }

  const handleCancel = () => {
    setEditingScene(null)
  }

  return (
    <div className="bg-dark-800 rounded-lg border border-gray-700">
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-xl font-semibold flex items-center">
          <Film className="w-5 h-5 mr-2 text-primary-500" />
          Scenes ({scenes.length})
        </h2>
      </div>

      <div className="divide-y divide-gray-700 max-h-[600px] overflow-y-auto scrollbar-thin">
        {scenes.map((scene) => (
          <div key={scene.scene_id} className="p-4">
            {editingScene === scene.scene_id ? (
              <SceneEditor
                scene={scene}
                onSave={handleSave}
                onCancel={handleCancel}
              />
            ) : (
              <>
                <div
                  className="flex items-center justify-between cursor-pointer hover:bg-gray-700/30 p-2 rounded-lg transition-colors"
                  onClick={() => toggleExpand(scene.scene_id)}
                >
                    <div className="flex items-center space-x-2 sm:space-x-3">
                    <div className="w-9 h-9 sm:w-10 sm:h-10 bg-primary-600 rounded-lg flex items-center justify-center font-bold text-sm">
                      {scene.scene_id}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium line-clamp-1 text-sm sm:text-base">{scene.description}</div>
                      <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 text-xs sm:text-sm text-gray-400 mt-1">
                        <span className="flex items-center">
                          <Clock className="w-3 h-3 mr-1" />
                          {scene.duration}
                        </span>
                        <span className="flex items-center">
                          <Music className="w-3 h-3 mr-1" />
                          {scene.background_music}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleEdit(scene.scene_id)
                      }}
                      className="p-2 text-gray-400 hover:text-primary-500 transition-colors"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    {expandedScene === scene.scene_id ? (
                      <ChevronUp className="w-4 h-4 text-gray-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-gray-400" />
                    )}
                  </div>
                </div>

                {expandedScene === scene.scene_id && (
                  <div className="mt-4 space-y-3 pl-12 sm:pl-13">
                    <div className="bg-gray-900 rounded-lg p-3">
                      <div className="text-sm text-gray-400 mb-1">Video Prompt</div>
                      <div className="text-sm">{scene.prompt}</div>
                    </div>

                    <div className="bg-gray-900 rounded-lg p-3">
                      <div className="text-sm text-gray-400 mb-1">Voiceover</div>
                      <div className="text-sm">{scene.voiceover}</div>
                    </div>

                    {scene.character_tags?.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {scene.character_tags.map((tag, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-1 bg-blue-900/50 text-blue-300 rounded text-xs"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {scene.environment_tags?.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {scene.environment_tags.map((tag, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-1 bg-green-900/50 text-green-300 rounded text-xs"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default SceneList
