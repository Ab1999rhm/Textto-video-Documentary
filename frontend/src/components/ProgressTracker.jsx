import React from 'react'
import { Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'

const statusSteps = [
  { key: 'pending', label: 'Queued', icon: AlertCircle },
  { key: 'parsing', label: 'Parsing Script', icon: AlertCircle },
  { key: 'generating', label: 'Generating Video', icon: Loader2 },
  { key: 'voiceover', label: 'Voiceover', icon: Loader2 },
  { key: 'stitching', label: 'Stitching Clips', icon: Loader2 },
  { key: 'completed', label: 'Completed', icon: CheckCircle2 },
]

function ProgressTracker({ status, progress, message }) {
  const getStepStatus = (stepKey) => {
    const currentIndex = statusSteps.findIndex(s => s.key === status)
    const stepIndex = statusSteps.findIndex(s => s.key === stepKey)

    if (status === 'failed') return 'failed'
    if (stepIndex < currentIndex) return 'completed'
    if (stepIndex === currentIndex) return 'current'
    return 'pending'
  }

  const statusColors = {
    completed: 'text-green-500',
    current: 'text-primary-500',
    pending: 'text-gray-500',
    failed: 'text-red-500',
  }

  const bgColor = {
    completed: 'bg-green-500/20 border-green-500',
    current: 'bg-primary-500/20 border-primary-500',
    pending: 'bg-gray-800 border-gray-700',
    failed: 'bg-red-500/20 border-red-500',
  }

  return (
    <div className="bg-dark-800 rounded-lg p-6 border border-gray-700">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Generation Progress</h2>
        <span className="text-sm text-gray-400">
          {Math.round(progress * 100)}%
        </span>
      </div>

      <div className="relative mb-8">
        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary-600 to-primary-400 transition-all duration-500"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {statusSteps.map((step) => {
          const stepStatus = getStepStatus(step.key)
          const Icon = step.key === status && status !== 'completed' ? Loader2 : step.icon

          return (
            <div
              key={step.key}
              className={`p-3 rounded-lg border ${bgColor[stepStatus]} transition-all`}
            >
              <div className={`flex items-center justify-center mb-2 ${statusColors[stepStatus]}`}>
                <Icon
                  className={`w-5 h-5 ${
                    step.key === status && status !== 'completed' ? 'animate-spin' : ''
                  }`}
                />
              </div>
              <div className="text-xs text-center font-medium">{step.label}</div>
            </div>
          )
        })}
      </div>

      {message && (
        <div className={`p-3 rounded-lg ${
          status === 'failed' ? 'bg-red-900/30 text-red-400' : 'bg-gray-800 text-gray-300'
        }`}>
          {status === 'failed' ? (
            <div className="flex items-center">
              <XCircle className="w-4 h-4 mr-2" />
              {message}
            </div>
          ) : (
            <div className="flex items-center">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {message}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ProgressTracker
