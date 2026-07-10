import React, { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, FileText, Loader2 } from 'lucide-react'
import { toast } from 'react-toastify'

function ScriptUploader({ onUpload, isLoading }) {
  const [scriptText, setScriptText] = useState('')
  const [inputMethod, setInputMethod] = useState('paste')

  const onDrop = useCallback(async (acceptedFiles) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0]
      const text = await file.text()
      setScriptText(text)
      setInputMethod('paste')
      toast.success('File loaded successfully')
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/plain': ['.txt'],
      'text/markdown': ['.md'],
    },
    maxFiles: 1,
  })

  const handleSubmit = () => {
    if (!scriptText.trim()) {
      toast.error('Please enter or upload a script')
      return
    }
    onUpload(scriptText)
  }

  return (
    <div className="bg-dark-800 rounded-lg p-4 sm:p-6 border border-gray-700">
      <h2 className="text-lg sm:text-xl font-semibold mb-4 flex items-center">
        <FileText className="w-5 h-5 mr-2 text-primary-500" />
        Script Input
      </h2>

      <div className="flex flex-wrap gap-2 sm:space-x-4 sm:space-x-0 mb-4">
        <button
          onClick={() => setInputMethod('paste')}
          className={`px-4 py-2 rounded-lg transition-colors text-sm ${
            inputMethod === 'paste'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          Paste Text
        </button>
        <button
          onClick={() => setInputMethod('upload')}
          className={`px-4 py-2 rounded-lg transition-colors text-sm ${
            inputMethod === 'upload'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          Upload File
        </button>
      </div>

      {inputMethod === 'paste' ? (
        <textarea
          value={scriptText}
          onChange={(e) => setScriptText(e.target.value)}
          placeholder="Paste your script here...&#10;&#10;Use double line breaks to separate scenes.&#10;&#10;Example:&#10;The old man sat by the fire, his weathered hands trembling as he opened the ancient letter.&#10;&#10;The candle flickered, casting dancing shadows across the worn wooden table."
          className="w-full h-48 sm:h-56 md:h-64 bg-gray-900 border border-gray-600 rounded-lg p-4 text-white placeholder-gray-500 focus:outline-none focus:border-primary-500 resize-none font-mono text-sm"
        />
      ) : (
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-6 sm:p-8 text-center cursor-pointer transition-colors ${
            isDragActive
              ? 'border-primary-500 bg-primary-500/10'
              : 'border-gray-600 hover:border-gray-500'
          }`}
        >
          <input {...getInputProps()} />
          <Upload className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-3 sm:mb-4 text-gray-400" />
          {isDragActive ? (
            <p className="text-primary-400 text-sm sm:text-base">Drop the file here...</p>
          ) : (
            <p className="text-gray-400 text-sm sm:text-base">
              Drag & drop a .txt file here, or click to select
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <span className="text-xs sm:text-sm text-gray-500">
          {scriptText.length} characters ~{Math.ceil(scriptText.split(/\s+/).length / 150)} min read
        </span>
        <button
          onClick={handleSubmit}
          disabled={!scriptText.trim() || isLoading}
          className="w-full sm:w-auto px-6 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : (
            'Generate Video'
          )}
        </button>
      </div>
    </div>
  )
}

export default ScriptUploader
