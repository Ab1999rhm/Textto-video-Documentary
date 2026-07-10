import React, { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Video, FolderOpen, Github, Menu, X } from 'lucide-react'

function Navbar() {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  
  const isActive = (path) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }
  
  const navLinks = [
    { to: '/', label: 'New Project', icon: null },
    { to: '/projects', label: 'Projects', icon: FolderOpen },
  ]
  
  return (
    <nav className="bg-gray-950/80 backdrop-blur-xl border-b border-gray-800/50 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 md:h-16">
          <Link to="/" className="flex items-center space-x-2.5 group shrink-0">
            <div className="w-9 h-9 bg-gradient-to-br from-sky-500 to-blue-600 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform shadow-lg shadow-sky-500/20">
              <Video className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="text-lg font-bold text-gradient hidden sm:block">
              TTV
            </span>
          </Link>
          
          {/* Desktop nav */}
          <div className="hidden md:flex items-center space-x-1">
            {navLinks.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center ${
                  isActive(to) 
                    ? 'bg-sky-600/15 text-sky-400' 
                    : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
                }`}
              >
                {Icon && <Icon className="w-4 h-4 mr-2" />}
                {label}
              </Link>
            ))}
            
            <div className="w-px h-5 bg-gray-800 mx-2" />
            
            <a
              href="https://github.com/Ab1999rhm"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-gray-500 hover:text-white hover:bg-gray-800/60 rounded-lg transition-all"
            >
              <Github className="w-4 h-4" />
            </a>
          </div>
          
          {/* Mobile menu button */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 text-gray-400 hover:text-white hover:bg-gray-800/60 rounded-lg transition-all"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>
      
      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-800/50 bg-gray-950/95 backdrop-blur-xl">
          <div className="px-4 py-3 space-y-1">
            {navLinks.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                className={`block px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive(to) 
                    ? 'bg-sky-600/15 text-sky-400' 
                    : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
                }`}
              >
                {label}
              </Link>
            ))}
            <a
              href="https://github.com/Ab1999rhm"
              target="_blank"
              rel="noopener noreferrer"
              className="block px-4 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800/60 transition-all"
            >
              GitHub
            </a>
          </div>
        </div>
      )}
    </nav>
  )
}

export default Navbar
