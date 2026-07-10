import React from 'react'
import { Mail, Phone, Code } from 'lucide-react'

export default function Footer() {
  return (
    <footer className="border-t border-gray-800 bg-gray-950/80 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-400">
          <div className="flex items-center gap-2 text-gray-300 font-medium">
            <Code className="w-4 h-4 text-sky-500" />
            Designed & Developed by <span className="text-white">Abraham Fikadu</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="mailto:fikaduabraham093@gmail.com" className="flex items-center gap-1.5 hover:text-sky-400 transition-colors">
              <Mail className="w-3.5 h-3.5" />
              fikaduabraham093@gmail.com
            </a>
            <a href="tel:+251929570426" className="flex items-center gap-1.5 hover:text-sky-400 transition-colors">
              <Phone className="w-3.5 h-3.5" />
              0929570426
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
