import React, { useState } from 'react'
import { Settings, Monitor, Cpu, Music } from 'lucide-react'

function ConfigurationPanel({ config, onChange }) {
  const [expandedSection, setExpandedSection] = useState('general')

  const styles = [
    { value: 'cinematic', label: 'Cinematic' },
    { value: 'realistic', label: 'Realistic' },
    { value: 'animated', label: 'Animated' },
    { value: 'noir', label: 'Film Noir' },
    { value: 'vintage', label: 'Vintage' },
    { value: 'scifi', label: 'Sci-Fi' },
  ]

  const resolutions = [
    { value: '256x256', label: '256x256 (Fast)', desc: 'Lower quality, faster generation' },
    { value: '512x512', label: '512x512 (Balanced)', desc: 'Recommended for most use cases' },
    { value: '768x768', label: '768x768 (Quality)', desc: 'Higher quality, more VRAM needed' },
  ]

  const durations = [
    { value: '00:05:00', label: '5 minutes' },
    { value: '00:10:00', label: '10 minutes' },
    { value: '00:15:00', label: '15 minutes' },
    { value: '00:30:00', label: '30 minutes' },
    { value: '01:00:00', label: '1 hour' },
  ]

  const transitions = [
    { value: 'cross_dissolve', label: 'Cross Dissolve' },
    { value: 'fade', label: 'Fade' },
    { value: 'wipe', label: 'Wipe' },
    { value: 'slide', label: 'Slide' },
  ]

  const handleConfigChange = (key, value) => {
    onChange({ ...config, [key]: value })
  }

  const handleNestedChange = (parent, key, value) => {
    onChange({
      ...config,
      [parent]: {
        ...config[parent],
        [key]: value,
      },
    })
  }

  const toggleSection = (section) => {
    setExpandedSection(expandedSection === section ? null : section)
  }

  return (
    <div className="bg-dark-800 rounded-lg border border-gray-700">
      <div className="p-3 sm:p-4 border-b border-gray-700">
        <h2 className="text-lg sm:text-xl font-semibold flex items-center">
          <Settings className="w-5 h-5 mr-2 text-primary-500" />
          Configuration
        </h2>
      </div>

      <div className="divide-y divide-gray-700">
        <div>
          <button
            onClick={() => toggleSection('general')}
            className="w-full p-3 sm:p-4 flex items-center justify-between hover:bg-gray-700/50 transition-colors"
          >
            <span className="font-medium">General Settings</span>
            <span className={`transform transition-transform ${expandedSection === 'general' ? 'rotate-180' : ''}`}>
              ▼
            </span>
          </button>
          
          {expandedSection === 'general' && (
            <div className="p-4 pt-0 space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">Video Style</label>
                <select
                  value={config.style || 'cinematic'}
                  onChange={(e) => handleConfigChange('style', e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2 text-white focus:outline-none focus:border-primary-500"
                >
                  {styles.map((style) => (
                    <option key={style.value} value={style.value}>
                      {style.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Target Duration</label>
                <select
                  value={config.targetDuration || '01:00:00'}
                  onChange={(e) => handleConfigChange('targetDuration', e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2 text-white focus:outline-none focus:border-primary-500"
                >
                  {durations.map((dur) => (
                    <option key={dur.value} value={dur.value}>
                      {dur.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Transition Type</label>
                <select
                  value={config.transitionType || 'cross_dissolve'}
                  onChange={(e) => handleConfigChange('transitionType', e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2 text-white focus:outline-none focus:border-primary-500"
                >
                  {transitions.map((trans) => (
                    <option key={trans.value} value={trans.value}>
                      {trans.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <div>
          <button
            onClick={() => toggleSection('gpu')}
            className="w-full p-3 sm:p-4 flex items-center justify-between hover:bg-gray-700/50 transition-colors"
          >
            <span className="font-medium flex items-center">
              <Cpu className="w-4 h-4 mr-2" />
              GPU Settings
            </span>
            <span className={`transform transition-transform ${expandedSection === 'gpu' ? 'rotate-180' : ''}`}>
              ▼
            </span>
          </button>
          
          {expandedSection === 'gpu' && (
            <div className="p-4 pt-0 space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">Resolution</label>
                <div className="space-y-2">
                  {resolutions.map((res) => (
                    <label
                      key={res.value}
                      className={`block p-3 rounded-lg border cursor-pointer transition-colors ${
                        config.gpuConfig?.base_resolution === res.value
                          ? 'border-primary-500 bg-primary-500/10'
                          : 'border-gray-600 hover:border-gray-500'
                      }`}
                    >
                      <input
                        type="radio"
                        name="resolution"
                        value={res.value}
                        checked={config.gpuConfig?.base_resolution === res.value}
                        onChange={(e) => handleNestedChange('gpuConfig', 'base_resolution', e.target.value)}
                        className="hidden"
                      />
                      <div className="font-medium">{res.label}</div>
                      <div className="text-sm text-gray-500">{res.desc}</div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">CPU Offloading</div>
                  <div className="text-sm text-gray-500">Use when VRAM is limited</div>
                </div>
                <button
                  onClick={() => handleNestedChange('gpuConfig', 'enable_cpu_offload', !config.gpuConfig?.enable_cpu_offload)}
                  className={`w-12 h-6 rounded-full transition-colors ${
                    config.gpuConfig?.enable_cpu_offload ? 'bg-primary-600' : 'bg-gray-600'
                  }`}
                >
                  <div
                    className={`w-5 h-5 bg-white rounded-full transform transition-transform ${
                      config.gpuConfig?.enable_cpu_offload ? 'translate-x-6' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">FP16 Precision</div>
                  <div className="text-sm text-gray-500">Faster, uses less VRAM</div>
                </div>
                <button
                  onClick={() => handleNestedChange('gpuConfig', 'precision', config.gpuConfig?.precision === 'FP16' ? 'FP32' : 'FP16')}
                  className={`w-12 h-6 rounded-full transition-colors ${
                    config.gpuConfig?.precision === 'FP16' ? 'bg-primary-600' : 'bg-gray-600'
                  }`}
                >
                  <div
                    className={`w-5 h-5 bg-white rounded-full transform transition-transform ${
                      config.gpuConfig?.precision === 'FP16' ? 'translate-x-6' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}
        </div>

        <div>
          <button
            onClick={() => toggleSection('audio')}
            className="w-full p-3 sm:p-4 flex items-center justify-between hover:bg-gray-700/50 transition-colors"
          >
            <span className="font-medium flex items-center">
              <Music className="w-4 h-4 mr-2" />
              Audio Settings
            </span>
            <span className={`transform transition-transform ${expandedSection === 'audio' ? 'rotate-180' : ''}`}>
              ▼
            </span>
          </button>
          
          {expandedSection === 'audio' && (
            <div className="p-4 pt-0 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Enable Voiceover</div>
                  <div className="text-sm text-gray-500">Generate narration for each scene</div>
                </div>
                <button
                  onClick={() => handleConfigChange('enableVoiceover', !config.enableVoiceover)}
                  className={`w-12 h-6 rounded-full transition-colors ${
                    config.enableVoiceover ? 'bg-primary-600' : 'bg-gray-600'
                  }`}
                >
                  <div
                    className={`w-5 h-5 bg-white rounded-full transform transition-transform ${
                      config.enableVoiceover ? 'translate-x-6' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Enable Subtitles</div>
                  <div className="text-sm text-gray-500">Add synchronized subtitles</div>
                </div>
                <button
                  onClick={() => handleConfigChange('enableSubtitles', !config.enableSubtitles)}
                  className={`w-12 h-6 rounded-full transition-colors ${
                    config.enableSubtitles ? 'bg-primary-600' : 'bg-gray-600'
                  }`}
                >
                  <div
                    className={`w-5 h-5 bg-white rounded-full transform transition-transform ${
                      config.enableSubtitles ? 'translate-x-6' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Enable Background Music</div>
                  <div className="text-sm text-gray-500">Add ambient music to scenes</div>
                </div>
                <button
                  onClick={() => handleConfigChange('enableMusic', !config.enableMusic)}
                  className={`w-12 h-6 rounded-full transition-colors ${
                    config.enableMusic ? 'bg-primary-600' : 'bg-gray-600'
                  }`}
                >
                  <div
                    className={`w-5 h-5 bg-white rounded-full transform transition-transform ${
                      config.enableMusic ? 'translate-x-6' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ConfigurationPanel
