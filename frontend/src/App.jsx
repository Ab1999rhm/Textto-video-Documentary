import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import Home from './pages/Home'
import Project from './pages/Project'
import Projects from './pages/Projects'
import Review from './pages/Review'
import Editor from './pages/Editor'
import Navbar from './components/Navbar'
import Footer from './components/Footer'

function App() {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="min-h-screen bg-gray-950 text-gray-50">
        <Navbar />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/project/:id" element={<Project />} />
          <Route path="/project/:id/review" element={<Review />} />
          <Route path="/project/:id/editor" element={<Editor />} />
        </Routes>
        <Footer />
        <ToastContainer
          position="bottom-right"
          theme="dark"
          autoClose={4000}
          hideProgressBar={false}
          newestOnTop
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
        />
      </div>
    </Router>
  )
}

export default App
