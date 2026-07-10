import React, { useState } from 'react'
import { Edit3, Clock, Music, Tag, Save, X } from 'lucide-react'

function SceneEditor({ scene, onSave, onCancel }) {
  const [editedScene, setEditedScene] = useState({ ...scene })

  const handleSave = () => {
    onSave(editedScene)
  }

  const handleChange = (field, value) => {
    setEditedScene({ ...editedScene, [field]: value })
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-600">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center">
          <Edit3 className="w-4 h-4 mr-2 text-primary-500" />
          Edit Scene {scene.scene_id}
        </h3>
        <div className="flex space-x-2">
          <button
            onClick={onCancel}
            className="p-2 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          <button
            onClick={handleSave}
            className="p-2 text-primary-500 hover:text-primary-400 transition-colors"
          >
            <Save className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Description</label>
          <textarea
            value={editedScene.description}
            onChange={(e) => handleChange('description', e.target.value)}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2 text-white text-sm focus:outline-none focus:border-primary-500 resize-none"
            rows={2}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Video Prompt</label>
          <textarea
            value={editedScene.prompt}
            onChange={(e) => handleChange('prompt', e.target.value)}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2 text-white text-sm focus:outline-none focus:border-primary-500 resize-none"
            rows={3}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Voiceover</label>
          <textarea
            value={editedScene.voiceover}
            onChange={(e) => handleChange('voiceover', e.target.value)}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2 text-white text-sm focus:outline-none focus:border-primary-500 resize-none"
            rows={2}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1 flex items-center">
              <Clock className="w-3 h-3 mr-1" />
              Duration
            </label>
            <input
              type="text"
              value={editedScene.duration}
              onChange={(e) => handleChange('duration', e.target.value)}
              placeholder="00:00:08"
              className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2 text-white text-sm focus:outline-none focus:border-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1 flex items-center">
              <Music className="w-3 h-3 mr-1" />
              Background Music
            </label>
            <input
              type="text"
              value={editedScene.background_music}
              onChange={(e) => handleChange('background_music', e.target.value)}
              placeholder="ambient"
              className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2 text-white text-sm focus:outline-none focus:border-primary-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1 flex items-center">
            <Tag className="w-3 h-3 mr-1" />
            Character Tags
          </label>
          <input
            type="text"
            value={editedScene.character_tags?.join(', ') || ''}
            onChange={(e) => handleChange('character_tags', e.target.value.split(',').map(t => t.trim()))}
            placeholder="protagonist, hiking gear"
            className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2 text-white text-sm focus:outline-none focus:border-primary-500"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1 flex items-center">
            <Tag className="w-3 h-3 mr-1" />
            Environment Tags
          </label>
          <input
            type="text"
            value={editedScene.environment_tags?.join(', ') || ''}
            onChange={(e) => handleChange('environment_tags', e.target.value.split(',').map(t => t.trim()))}
            placeholder="mountains, sunrise, golden hour"
            className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2 text-white text-sm focus:outline-none focus:border-primary-500"
          />
        </div>
      </div>
    </div>
  )
}

export default SceneEditor
