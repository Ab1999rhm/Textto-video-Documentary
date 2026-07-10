# TTV - Text to Video

AI-powered video generation from text scripts.

## Features

- Script parsing and scene segmentation
- AI video generation with consistent style
- Voiceover generation with Coqui TTS
- Automatic subtitles and stitching
- GPU optimization (FP16, CPU offloading)

## Quick Start

### Backend (FastAPI)

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend (React)

```bash
cd frontend
npm install
npm run dev
```

The frontend will be available at http://localhost:3000

## API Endpoints

- `POST /api/projects` - Create project from text
- `POST /api/projects/upload` - Upload script file
- `GET /api/projects/{id}` - Get project details
- `GET /api/projects/{id}/scenes` - Get scenes
- `PUT /api/projects/{id}/scenes/{scene_id}` - Update scene
- `POST /api/projects/{id}/generate` - Start generation
- `GET /api/projects/{id}/status` - Get generation status
- `GET /api/projects/{id}/download` - Download video

## Configuration

The app supports GPU optimization with:
- FP16 precision
- CPU offloading for 7GB+ GPUs
- Configurable resolution (256x256, 512x512, 768x768)

## Output

Generated videos include:
- Stitched clips with transitions
- Synchronized voiceover
- SRT subtitles
- Background music (optional)
