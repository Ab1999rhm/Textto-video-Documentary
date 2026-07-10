# 🎬 Text-to-Video Documentary Generator

An AI-powered web application that converts text scripts into full documentary videos with voiceover, Ken Burns image animations, uploaded video support, and scene management.

---

## ✨ Features

- 📝 **Script to Documentary** — Paste or upload a text script and the app auto-parses it into scenes and shots
- 🖼️ **Upload Images & Videos** — Upload your own media per scene; images get smooth Ken Burns zoom animations, videos play with full motion
- 🎙️ **AI Voiceover** — Automatic text-to-speech narration using Edge TTS (no API key needed)
- 🎬 **Scene Review & Approval** — Review each generated scene before final export
- 🎵 **Background Music** — Optional background music mixing
- 📄 **Auto Subtitles** — SRT subtitle generation and burning
- 🎞️ **Smooth Ken Burns** — Sub-pixel interpolated zoom/pan animations with zero jitter
- ▶️ **Preview & Download** — Stream or download the final documentary MP4

---

## 🖥️ Prerequisites

Before you clone and run this project, make sure you have:

| Requirement | Minimum Version | How to Check |
|---|---|---|
| **Python** | 3.10+ | `python --version` |
| **Node.js** | 18+ | `node --version` |
| **npm** | 8+ | `npm --version` |
| **FFmpeg** | 4.4+ | `ffmpeg -version` |
| **Git** | Any | `git --version` |

### Installing FFmpeg
- **Windows**: Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to system PATH
- **macOS**: `brew install ffmpeg`
- **Ubuntu/Debian**: `sudo apt install ffmpeg`

---

## 🚀 Quick Start (Windows)

### Option 1 — One-click launcher (Recommended)

```bat
# 1. Clone the repository
git clone https://github.com/Ab1999rhm/Textto-video-Documentary.git
cd Textto-video-Documentary

# 2. Create your .env file (see Environment Setup below)

# 3. Double-click start.bat OR run:
start.bat
```

This automatically installs all dependencies and starts both servers.

---

### Option 2 — Manual Setup

#### 1. Clone the repo
```bash
git clone https://github.com/Ab1999rhm/Textto-video-Documentary.git
cd Textto-video-Documentary
```

#### 2. Set up the environment file
Create a `.env` file in the root directory:
```env
# Required: Your Hugging Face API token for image generation
HF_TOKEN=your_huggingface_token_here

# Optional: API keys for additional TTS or image providers
# OPENAI_API_KEY=sk-...
# REPLICATE_API_TOKEN=r8_...
```
> 🔑 Get a free Hugging Face token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)

#### 3. Install backend dependencies
```bash
cd backend
pip install -r requirements.txt
cd ..
```

#### 4. Install frontend dependencies
```bash
cd frontend
npm install
cd ..
```

#### 5. Start the backend
```bash
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

#### 6. Start the frontend (in a new terminal)
```bash
cd frontend
npm run dev
```

#### 7. Open the app
Go to **http://localhost:3000** in your browser.

---

## 🗂️ Project Structure

```
Textto-video-Documentary/
├── backend/
│   ├── main.py                  # FastAPI server & all API endpoints
│   ├── config.py                # App configuration
│   ├── database.py              # SQLite database setup
│   ├── requirements.txt         # Python dependencies
│   ├── models/
│   │   └── schemas.py           # Pydantic data models
│   └── services/
│       ├── video_generator.py   # FFmpeg video processing (Ken Burns, render, etc.)
│       ├── assembler.py         # Final video stitching and subtitle generation
│       ├── scene_parser.py      # Script-to-scene AI parsing
│       └── tts_manager.py       # Text-to-speech voiceover generation
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.jsx         # Project creation page
│   │   │   ├── Projects.jsx     # Projects list
│   │   │   ├── Project.jsx      # Project status & preview
│   │   │   ├── Review.jsx       # Scene review & approval
│   │   │   └── Editor.jsx       # Video editor
│   │   ├── services/api.js      # API client
│   │   └── index.css            # Global styles
│   └── package.json
├── docker-compose.yml           # Docker deployment
├── start.bat                    # One-click Windows launcher
└── .env                         # Your credentials (NOT committed to git)
```

---

## 🔧 How to Use

1. **Create a Project** — Go to the Home page, paste your documentary script or upload a `.txt` file, configure settings (aspect ratio, style, voiceover), and click **Create Project**

2. **Review Scenes** — The app parses your script into scenes. Click **Review** to approve each scene. You can upload your own images or videos per scene shot.

3. **Generate** — Once all scenes are approved, click **Generate**. The app will:
   - Create Ken Burns animation for images
   - Preserve motion in uploaded videos
   - Generate AI voiceover narration
   - Stitch everything into a final MP4

4. **Preview & Download** — Watch the generated documentary in the Preview player and download the final MP4.

---

## 🌐 API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/projects` | Create project from text script |
| `GET` | `/api/projects` | List all projects |
| `GET` | `/api/projects/{id}` | Get project details |
| `GET` | `/api/projects/{id}/scenes` | Get all scenes |
| `PUT` | `/api/projects/{id}/scenes/{scene_id}` | Edit a scene |
| `POST` | `/api/projects/{id}/generate` | Start video generation |
| `GET` | `/api/projects/{id}/status` | Poll generation status |
| `GET` | `/api/projects/{id}/stream` | Stream final video (range requests) |
| `GET` | `/api/projects/{id}/download` | Download final MP4 |
| `POST` | `/api/projects/{id}/scenes/{sid}/shots/{shot}/upload` | Upload image/video for a shot |
| `WS` | `/ws/projects/{id}` | Real-time generation progress |

---

## 🐳 Docker Deployment

```bash
docker-compose up --build
```

- Backend: http://localhost:8000
- Frontend: http://localhost:3000

---

## ❓ Troubleshooting

| Problem | Solution |
|---|---|
| `ffmpeg not found` | Install FFmpeg and add it to your system PATH |
| `HF_TOKEN not set` | Create a `.env` file with your Hugging Face token |
| Backend port 8000 already in use | Kill existing process or change port in `start.bat` |
| Video preview not playing | Use the **Open in new tab** button below the preview player |
| Images jitter or shake | This is fixed in the latest version using sub-pixel `scale+crop` filters |

---

## 📄 License

MIT License — feel free to use, modify, and distribute.
