from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Depends, WebSocket, WebSocketDisconnect, Query, BackgroundTasks, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update
from typing import Optional, List, Dict, Any
from datetime import datetime
import asyncio
import copy
import json
import os
import logging
import uuid
import time
from pathlib import Path

from .config import settings
from .database import init_db, get_db, Project, Scene, GenerationLog, JobStatus
from .models.schemas import (
    ProjectCreate, ProjectResponse, SceneResponse, SceneUpdate,
    ShotUpdate, ShotApproval, GenerationStatus, GPUInfo, HealthResponse, WebSocketMessage
)
from .services.scene_parser import SceneParser
from .services.video_generator import VideoGenerator, CloudVideoGenerator, VoiceoverGenerator, MusicManager, FFmpegProcessor, GPUManager, TORCH_AVAILABLE
from .services.assembler import VideoAssembler, SubtitleGenerator
from .services.cloud_gpu import CloudImageGenerator, AVAILABLE_MODELS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Production AI Video Generation Engine",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/output", StaticFiles(directory=str(settings.OUTPUT_DIR)), name="output")


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
    
    async def connect(self, websocket: WebSocket, project_id: str):
        await websocket.accept()
        if project_id not in self.active_connections:
            self.active_connections[project_id] = []
        self.active_connections[project_id].append(websocket)
    
    def disconnect(self, websocket: WebSocket, project_id: str):
        if project_id in self.active_connections:
            self.active_connections[project_id].remove(websocket)
            if not self.active_connections[project_id]:
                del self.active_connections[project_id]
    
    async def broadcast(self, project_id: str, message: dict):
        if project_id in self.active_connections:
            dead = []
            for connection in self.active_connections[project_id]:
                try:
                    await connection.send_json(message)
                except:
                    dead.append(connection)
            for conn in dead:
                self.active_connections[project_id].remove(conn)


manager = ConnectionManager()
scene_parser = SceneParser()


@app.on_event("startup")
async def startup():
    await init_db()
    logger.info("Database initialized")


@app.get("/")
async def root():
    return {"name": settings.APP_NAME, "version": settings.APP_VERSION}


@app.get("/api/health", response_model=HealthResponse)
async def health_check():
    gpu_manager = GPUManager()
    gpu_info = gpu_manager.get_device_info()
    
    ffmpeg_ok = False
    try:
        ffmpeg = FFmpegProcessor()
        ffmpeg_ok = True
    except:
        pass
    
    return HealthResponse(
        status="healthy",
        version=settings.APP_VERSION,
        gpu=GPUInfo(**gpu_info),
        database="connected",
        redis="available",
        ffmpeg="available" if ffmpeg_ok else "not found"
    )


@app.get("/api/models")
async def get_models():
    return AVAILABLE_MODELS


@app.post("/api/projects", response_model=ProjectResponse)
async def create_project(
    project_data: ProjectCreate,
    db: AsyncSession = Depends(get_db),
):
    try:
        duration_parts = project_data.target_duration.split(':')
        target_seconds = int(duration_parts[0]) * 3600 + int(duration_parts[1]) * 60 + int(duration_parts[2])
        
        parsed_scenes = scene_parser.parse_script(
            project_data.script_text, target_seconds, project_data.shots_per_scene
        )
        
        project = Project(
            id=str(uuid.uuid4()),
            name=project_data.name,
            script_text=project_data.script_text,
            style=project_data.style,
            target_duration=project_data.target_duration,
            status=JobStatus.REVIEW,
            progress=0.05,
            resolution=project_data.resolution,
            precision=project_data.precision,
            enable_cpu_offload=project_data.enable_cpu_offload,
            enable_voiceover=project_data.enable_voiceover,
            enable_music=project_data.enable_music,
            enable_subtitles=project_data.enable_subtitles,
            enable_upscaling=project_data.enable_upscaling,
            transition_type=project_data.transition_type,
            transition_duration=project_data.transition_duration,
            duration_seconds=target_seconds,
            language=project_data.language,
            gender=project_data.gender,
            voice=project_data.voice,
            rate=project_data.rate,
            aspect_ratio=project_data.aspect_ratio,
            image_model=project_data.image_model,
            review_mode=project_data.review_mode,
            current_review_scene=0,
        )
        
        db.add(project)
        
        for i, scene_data in enumerate(parsed_scenes):
            scene = Scene(
                project_id=project.id,
                scene_number=scene_data["scene_number"],
                description=scene_data["description"],
                duration=scene_data["duration"],
                duration_seconds=scene_data["duration_seconds"],
                prompt=scene_data["prompt"],
                negative_prompt=scene_data["negative_prompt"],
                voiceover_text=scene_data["voiceover_text"],
                background_music=scene_data["background_music"],
                character_tags=scene_data["character_tags"],
                environment_tags=scene_data["environment_tags"],
                transition_in=scene_data["transition_in"],
                transition_out=scene_data["transition_out"],
                seed=scene_data["seed"],
                shots=scene_data.get("shots", []),
                shot_count=scene_data.get("shot_count", project_data.shots_per_scene),
                image_status="pending",
            )
            db.add(scene)
        
        log = GenerationLog(
            project_id=project.id,
            step="parsing",
            status="completed",
            message=f"Parsed {len(parsed_scenes)} scenes with {project_data.shots_per_scene} shots each",
            progress=0.1,
        )
        db.add(log)
        
        await db.commit()
        await db.refresh(project)
        
        response = ProjectResponse(
            **{k: v for k, v in project.__dict__.items() if not k.startswith('_')},
            scenes_count=len(parsed_scenes),
        )
        
        return response
        
    except Exception as e:
        logger.error(f"Project creation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/projects/upload", response_model=ProjectResponse)
async def upload_project(
    file: UploadFile = File(...),
    name: str = Form("Untitled Project"),
    style: str = Form("cinematic"),
    target_duration: str = Form("00:25:00"),
    resolution: str = Form("1024x576"),
    precision: str = Form("fp16"),
    enable_cpu_offload: bool = Form(True),
    enable_voiceover: bool = Form(True),
    enable_music: bool = Form(True),
    enable_subtitles: bool = Form(True),
    enable_upscaling: bool = Form(False),
    transition_type: str = Form("cross_dissolve"),
    transition_duration: float = Form(1.0),
    language: str = Form("en"),
    gender: str = Form("female"),
    voice: Optional[str] = Form(None),
    rate: str = Form("+0%"),
    aspect_ratio: str = Form("16:9"),
    image_model: str = Form("flux-realism"),
    shots_per_scene: int = Form(3),
    db: AsyncSession = Depends(get_db),
):
    try:
        content = await file.read()
        script_text = content.decode('utf-8')
        
        project_data = ProjectCreate(
            name=name,
            script_text=script_text,
            style=style,
            target_duration=target_duration,
            resolution=resolution,
            precision=precision,
            enable_cpu_offload=enable_cpu_offload,
            enable_voiceover=enable_voiceover,
            enable_music=enable_music,
            enable_subtitles=enable_subtitles,
            enable_upscaling=enable_upscaling,
            transition_type=transition_type,
            transition_duration=transition_duration,
            language=language,
            gender=gender,
            voice=voice,
            rate=rate,
            aspect_ratio=aspect_ratio,
            image_model=image_model,
            shots_per_scene=shots_per_scene,
        )
        
        return await create_project(project_data, db)
        
    except Exception as e:
        logger.error(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/projects", response_model=List[ProjectResponse])
async def list_projects(
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Project).order_by(Project.created_at.desc()).offset(skip).limit(limit)
    )
    projects = result.scalars().all()
    
    response = []
    for p in projects:
        scenes_count = await db.execute(
            select(func.count(Scene.id)).where(Scene.project_id == p.id)
        )
        count = scenes_count.scalar() or 0
        response.append(ProjectResponse(
            **{k: v for k, v in p.__dict__.items() if not k.startswith('_')},
            scenes_count=count,
        ))
    
    return response


@app.get("/api/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    scenes_count = await db.execute(
        select(func.count(Scene.id)).where(Scene.project_id == project.id)
    )
    count = scenes_count.scalar() or 0
    
    return ProjectResponse(
        **{k: v for k, v in project.__dict__.items() if not k.startswith('_')},
        scenes_count=count,
    )


@app.delete("/api/projects/{project_id}")
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    import shutil
    project_dir = settings.OUTPUT_DIR / project_id
    if project_dir.exists():
        shutil.rmtree(project_dir, ignore_errors=True)
    
    scenes_result = await db.execute(select(Scene).where(Scene.project_id == project_id))
    for scene in scenes_result.scalars().all():
        await db.delete(scene)
    
    await db.delete(project)
    await db.commit()
    
    return {"status": "deleted"}


@app.get("/api/projects/{project_id}/scenes", response_model=List[SceneResponse])
async def get_scenes(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Scene).where(Scene.project_id == project_id).order_by(Scene.scene_number)
    )
    scenes = result.scalars().all()
    return [SceneResponse(**{k: v for k, v in s.__dict__.items() if not k.startswith('_')}) for s in scenes]


@app.put("/api/projects/{project_id}/scenes/{scene_id}", response_model=SceneResponse)
async def update_scene(
    project_id: str,
    scene_id: int,
    update_data: SceneUpdate,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Scene).where(Scene.project_id == project_id, Scene.id == scene_id)
    )
    scene = result.scalar_one_or_none()
    
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    
    update_dict = update_data.model_dump(exclude_unset=True)
    
    prompt_changed = "prompt" in update_dict and update_dict["prompt"] != scene.prompt
    seed_changed = "seed" in update_dict and update_dict["seed"] != scene.seed
    desc_changed = "description" in update_dict and update_dict["description"] != scene.description
    text_changed = "voiceover_text" in update_dict and update_dict["voiceover_text"] != scene.voiceover_text
    
    for key, value in update_dict.items():
        setattr(scene, key, value)
    
    if prompt_changed or seed_changed or desc_changed:
        import copy
        new_shots = copy.deepcopy(scene.shots or [])
        new_seed = update_dict.get("seed", scene.seed)
        new_prompt = update_dict.get("prompt", scene.prompt)
        for shot in new_shots:
            if prompt_changed:
                shot["prompt"] = new_prompt
            if seed_changed:
                shot["seed"] = new_seed + shot.get("id", 0)
            shot["image_path"] = None
            shot["image_status"] = "pending"
        await db.execute(
            update(Scene).where(Scene.id == scene.id).values(
                shots=new_shots, image_status="pending"
            )
        )
    
    if text_changed:
        await db.execute(
            update(Scene).where(Scene.id == scene.id).values(
                voiceover_path=None, voiceover_duration=0.0
            )
        )
    
    await db.commit()
    await db.refresh(scene)
    
    return SceneResponse(**{k: v for k, v in scene.__dict__.items() if not k.startswith('_')})


@app.post("/api/projects/{project_id}/scenes/{scene_id}/shots/generate")
async def generate_scene_shots(
    project_id: str,
    scene_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    scene_result = await db.execute(
        select(Scene).where(Scene.project_id == project_id, Scene.id == scene_id)
    )
    scene = scene_result.scalar_one_or_none()
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    
    project_dir = settings.OUTPUT_DIR / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    
    cloud_config = {
        "cloudflare_account_id": settings.CLOUDFLARE_ACCOUNT_ID,
        "cloudflare_api_token": settings.CLOUDFLARE_API_TOKEN,
        "pollinations_api_key": settings.POLLINATIONS_API_KEY,
        "resolution": project.aspect_ratio,
        "image_model": project.image_model,
    }
    cloud_gen = CloudVideoGenerator(cloud_config)
    
    width, height = (1024, 576) if project.aspect_ratio == "16:9" else (576, 1024)
    
    shots = scene.shots or []
    scene.image_status = "generating"
    await db.commit()
    
    def _gen_one_shot(shot):
        shot_idx = shot.get("id", 0)
        shot_path = str(project_dir / f"scene_{scene.scene_number:03d}_shot_{shot_idx:03d}.png")
        logger.info(f"Generating shot {shot_idx} for scene {scene.scene_number}...")
        
        frame = cloud_gen.generate_frame(
            prompt=shot["prompt"],
            negative_prompt=scene.negative_prompt,
            width=width, height=height,
            seed=shot.get("seed", scene.seed + shot_idx),
            model=project.image_model,
        )
        
        if frame:
            frame.save(shot_path, "PNG")
            return shot_idx, shot_path, "generated"
        return shot_idx, None, "failed"
    
    for shot in shots:
        idx, path, status = await asyncio.to_thread(_gen_one_shot, shot)
        shot["image_status"] = status
        if path:
            shot["image_path"] = path
    
    new_status = "generated" if any(s.get("image_status") == "generated" for s in shots) else "failed"
    await db.execute(
        update(Scene)
        .where(Scene.id == scene.id)
        .values(shots=shots, image_status=new_status)
    )
    await db.commit()
    await db.refresh(scene)
    
    return SceneResponse(**{k: v for k, v in scene.__dict__.items() if not k.startswith('_')})


@app.post("/api/projects/{project_id}/scenes/{scene_id}/shots/{shot_id}/regenerate")
async def regenerate_shot(
    project_id: str,
    scene_id: int,
    shot_id: int,
    shot_update: Optional[ShotUpdate] = None,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    scene_result = await db.execute(
        select(Scene).where(Scene.project_id == project_id, Scene.id == scene_id)
    )
    scene = scene_result.scalar_one_or_none()
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    
    shots = scene.shots or []
    if shot_id >= len(shots):
        raise HTTPException(status_code=404, detail="Shot not found")
    
    shot = shots[shot_id]
    
    if shot_update:
        if shot_update.prompt:
            shot["prompt"] = shot_update.prompt
        if shot_update.seed is not None:
            shot["seed"] = shot_update.seed
    
    project_dir = settings.OUTPUT_DIR / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    
    cloud_config = {
        "cloudflare_account_id": settings.CLOUDFLARE_ACCOUNT_ID,
        "cloudflare_api_token": settings.CLOUDFLARE_API_TOKEN,
        "pollinations_api_key": settings.POLLINATIONS_API_KEY,
        "resolution": project.aspect_ratio,
        "image_model": project.image_model,
    }
    cloud_gen = CloudVideoGenerator(cloud_config)
    width, height = (1024, 576) if project.aspect_ratio == "16:9" else (576, 1024)
    
    shot_path = str(project_dir / f"scene_{scene.scene_number:03d}_shot_{shot_id:03d}.png")
    
    frame = await asyncio.to_thread(
        cloud_gen.generate_frame,
        shot["prompt"], scene.negative_prompt,
        width, height, 4, 7.5,
        shot.get("seed", scene.seed + shot_id),
        project.image_model,
    )
    
    if frame:
        frame.save(shot_path, "PNG")
        shot["image_path"] = shot_path
        shot["image_status"] = "generated"
    else:
        shot["image_status"] = "failed"
    
    await db.execute(
        update(Scene)
        .where(Scene.id == scene.id)
        .values(shots=shots)
    )
    await db.commit()
    await db.refresh(scene)
    
    return SceneResponse(**{k: v for k, v in scene.__dict__.items() if not k.startswith('_')})


@app.post("/api/projects/{project_id}/scenes/{scene_id}/shots/{shot_id}/approve")
async def approve_shot(
    project_id: str,
    scene_id: int,
    shot_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Scene).where(Scene.project_id == project_id, Scene.id == scene_id)
    )
    scene = result.scalar_one_or_none()
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    
    shots = scene.shots or []
    if shot_id >= len(shots):
        raise HTTPException(status_code=404, detail="Shot not found")
    
    shots[shot_id]["image_status"] = "approved"
    scene.shots = shots
    await db.commit()
    
    return {"status": "approved", "shot_id": shot_id}


@app.post("/api/projects/{project_id}/scenes/{scene_id}/shots/{shot_id}/upload")
async def upload_shot_image(
    project_id: str,
    scene_id: int,
    shot_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Scene).where(Scene.project_id == project_id, Scene.id == scene_id)
    )
    scene = result.scalar_one_or_none()
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    shots = scene.shots or []
    if shot_id >= len(shots):
        raise HTTPException(status_code=404, detail="Shot not found")

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "png"
    if ext not in ("png", "jpg", "jpeg", "webp", "bmp", "gif"):
        raise HTTPException(status_code=400, detail="Unsupported image format")

    project_dir = settings.OUTPUT_DIR / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    filepath = project_dir / f"scene_{scene.scene_number:03d}_shot_{shot_id:03d}.{ext}"

    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)

    shots[shot_id]["image_path"] = str(filepath)
    shots[shot_id]["image_status"] = "uploaded"
    shots[shot_id]["source_type"] = "uploaded"
    new_shots = copy.deepcopy(shots)
    await db.execute(
        update(Scene)
        .where(Scene.id == scene.id)
        .values(shots=new_shots)
    )
    await db.commit()

    return {"status": "uploaded", "shot_id": shot_id, "path": str(filepath)}


@app.post("/api/projects/{project_id}/scenes/{scene_id}/shots/{shot_id}/upload-video")
async def upload_shot_video(
    project_id: str,
    scene_id: int,
    shot_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Scene).where(Scene.project_id == project_id, Scene.id == scene_id)
    )
    scene = result.scalar_one_or_none()
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    shots = scene.shots or []
    if shot_id >= len(shots):
        raise HTTPException(status_code=404, detail="Shot not found")

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "mp4"
    if ext not in ("mp4", "mov", "avi", "mkv", "webm"):
        raise HTTPException(status_code=400, detail="Unsupported video format")

    project_dir = settings.OUTPUT_DIR / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    filepath = project_dir / f"scene_{scene.scene_number:03d}_shot_{shot_id:03d}.{ext}"

    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)

    shots[shot_id]["video_path"] = str(filepath)
    shots[shot_id]["image_status"] = "uploaded"
    shots[shot_id]["source_type"] = "video"
    new_shots = copy.deepcopy(shots)
    await db.execute(
        update(Scene)
        .where(Scene.id == scene.id)
        .values(shots=new_shots)
    )
    await db.commit()

    return {"status": "uploaded", "shot_id": shot_id, "path": str(filepath)}


@app.post("/api/projects/{project_id}/upload-audio")
async def upload_audio(
    project_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    project_dir = settings.OUTPUT_DIR / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    
    ext = Path(file.filename).suffix or ".mp3"
    filename = f"audio_{int(datetime.utcnow().timestamp())}{ext}"
    filepath = project_dir / filename
    
    with open(filepath, "wb") as f:
        content = await file.read()
        f.write(content)

    url_path = f"/output/{project_id}/{filename}"
    return {"status": "uploaded", "path": url_path, "filename": file.filename}


@app.post("/api/projects/{project_id}/upload-media")
async def upload_media(
    project_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await db.execute(select(Project).where(Project.id == project_id))
        project = result.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        project_dir = settings.OUTPUT_DIR / project_id
        project_dir.mkdir(parents=True, exist_ok=True)

        safe_name = (file.filename or "upload").replace(" ", "_").replace("/", "_").replace("\\", "_")
        ext = Path(safe_name).suffix or ".mp4"
        ts = int(datetime.utcnow().timestamp())
        filename = f"media_{ts}_{safe_name}"
        if not filename.endswith(ext):
            filename += ext
        filepath = project_dir / filename

        content = await file.read()
        with open(filepath, "wb") as f:
            f.write(content)

        url_path = f"/output/{project_id}/{filename}"
        logger.info(f"Uploaded media: {url_path} ({len(content)} bytes)")
        return {"status": "uploaded", "path": url_path, "filename": file.filename}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload media error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@app.post("/api/projects/{project_id}/scenes/{scene_id}/voiceover/generate")
async def generate_voiceover(
    project_id: str,
    scene_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    scene_result = await db.execute(
        select(Scene).where(Scene.project_id == project_id, Scene.id == scene_id)
    )
    scene = scene_result.scalar_one_or_none()
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    
    if not scene.voiceover_text:
        raise HTTPException(status_code=400, detail="No voiceover text for this scene")
    
    project_dir = settings.OUTPUT_DIR / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    
    voiceover_gen = VoiceoverGenerator({
        "language": getattr(project, 'language', 'en'),
        "gender": getattr(project, 'gender', 'female'),
        "voice": getattr(project, 'voice', None),
        "rate": getattr(project, 'rate', '+0%'),
    })
    vov_path = str(project_dir / f"voiceover_{scene.scene_number:03d}.mp3")
    
    success = await asyncio.to_thread(voiceover_gen.generate_audio, scene.voiceover_text, vov_path)
    
    if success and os.path.exists(vov_path):
        scene.voiceover_path = vov_path
        await db.commit()
        await db.refresh(scene)
        return SceneResponse(**{k: v for k, v in scene.__dict__.items() if not k.startswith('_')})
    else:
        raise HTTPException(status_code=500, detail="Voiceover generation failed")


@app.post("/api/projects/{project_id}/scenes/{scene_id}/approve")
async def approve_scene(
    project_id: str,
    scene_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    scene_result = await db.execute(
        select(Scene).where(Scene.project_id == project_id, Scene.id == scene_id)
    )
    scene = scene_result.scalar_one_or_none()
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    
    scene.generated = True
    project.current_review_scene = max(project.current_review_scene or 0, scene.scene_number)
    await db.commit()
    
    return {"status": "approved", "scene_number": scene.scene_number}


@app.post("/api/projects/{project_id}/approve-all")
async def approve_all_scenes(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    scenes_result = await db.execute(
        select(Scene).where(Scene.project_id == project_id)
    )
    scenes = scenes_result.scalars().all()
    
    for scene in scenes:
        scene.generated = True
        if scene.shots:
            for shot in scene.shots:
                shot["image_status"] = "approved"
            scene.shots = scene.shots
    
    project.current_review_scene = len(scenes)
    await db.commit()
    
    return {"status": "all_approved", "scenes_count": len(scenes)}


@app.post("/api/projects/{project_id}/generate")
async def start_generation(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    if project.status in [JobStatus.GENERATING, JobStatus.VOICEOVER, JobStatus.STITCHING]:
        raise HTTPException(status_code=409, detail="Generation already in progress")
    
    editor_state = project.editor_state or {}
    clips = editor_state.get("clips", [])
    uploaded_clip_map = {}
    for clip in clips:
        if clip.get("source_type") == "uploaded" and clip.get("src"):
            scene_id = clip.get("scene_id", 0)
            shot_id = clip.get("shot_id", 0)
            uploaded_clip_map[f"{scene_id}_{shot_id}"] = clip.get("src")
            uploaded_clip_map[str(scene_id)] = clip.get("src")
    
    if uploaded_clip_map:
        editor_state["_preserve_uploads"] = uploaded_clip_map
        project.editor_state = editor_state
        await db.commit()
    
    import threading
    thread = threading.Thread(target=_run_generation_sync, args=(project_id,), daemon=True)
    thread.start()
    
    return GenerationStatus(
        project_id=project_id,
        status=JobStatus.GENERATING,
        progress=0.1,
        message="Generation started",
    )


@app.post("/api/projects/{project_id}/regenerate")
async def regenerate_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    if project.status in [JobStatus.GENERATING, JobStatus.VOICEOVER, JobStatus.STITCHING]:
        raise HTTPException(status_code=409, detail="Generation already in progress")
    
    editor_state = project.editor_state or {}
    clips = editor_state.get("clips", [])
    uploaded_clip_map = {}
    for clip in clips:
        if clip.get("source_type") == "uploaded" and clip.get("src"):
            scene_id = clip.get("scene_id", 0)
            shot_id = clip.get("shot_id", 0)
            uploaded_clip_map[f"{scene_id}_{shot_id}"] = clip.get("src")
            uploaded_clip_map[str(scene_id)] = clip.get("src")
    
    editor_state["_preserve_uploads"] = uploaded_clip_map
    project.editor_state = editor_state
    
    scenes_result = await db.execute(
        select(Scene).where(Scene.project_id == project_id).order_by(Scene.scene_number)
    )
    scenes = scenes_result.scalars().all()
    for scene in scenes:
        scene.video_clip_path = None
        scene.video_path = None
        scene.voiceover_path = None
    await db.commit()
    
    project.status = JobStatus.PENDING
    project.progress = 0.0
    project.error_message = None
    project.video_path = None
    await db.commit()
    
    import threading
    thread = threading.Thread(target=_run_generation_sync, args=(project_id,), daemon=True)
    thread.start()
    
    return GenerationStatus(
        project_id=project_id,
        status=JobStatus.GENERATING,
        progress=0.1,
        message="Regeneration started (uploaded clips preserved)",
    )


@app.get("/api/projects/{project_id}/status", response_model=GenerationStatus)
async def get_generation_status(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    return GenerationStatus(
        project_id=project_id,
        status=project.status,
        progress=project.progress,
        message=project.error_message or f"Status: {project.status}",
    )


@app.get("/api/projects/{project_id}/download")
async def download_video(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    if not project.video_path or not os.path.exists(project.video_path):
        raise HTTPException(status_code=404, detail="Video not ready")
    
    return FileResponse(
        path=project.video_path,
        media_type="video/mp4",
        filename=f"{project.name}.mp4",
    )


@app.get("/api/projects/{project_id}/stream")
async def stream_video(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Stream the final video with HTTP range request support for browser playback."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.video_path or not os.path.exists(project.video_path):
        raise HTTPException(status_code=404, detail="Video not ready")

    video_path = project.video_path
    file_size = os.path.getsize(video_path)
    range_header = request.headers.get("Range")

    if range_header:
        # Parse Range: bytes=start-end
        range_val = range_header.replace("bytes=", "").strip()
        parts = range_val.split("-")
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if parts[1] else file_size - 1
        end = min(end, file_size - 1)
        chunk_size = end - start + 1

        def iter_file():
            with open(video_path, "rb") as f:
                f.seek(start)
                remaining = chunk_size
                while remaining > 0:
                    data = f.read(min(65536, remaining))
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(chunk_size),
            "Content-Type": "video/mp4",
        }
        return StreamingResponse(iter_file(), status_code=206, headers=headers)
    else:
        def iter_full():
            with open(video_path, "rb") as f:
                while True:
                    data = f.read(65536)
                    if not data:
                        break
                    yield data

        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": "video/mp4",
        }
        return StreamingResponse(iter_full(), status_code=200, headers=headers)


@app.get("/api/projects/{project_id}/preview/{scene_id}")
async def get_scene_preview(
    project_id: str,
    scene_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Scene).where(Scene.project_id == project_id, Scene.id == scene_id)
    )
    scene = result.scalar_one_or_none()
    
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    
    if scene.video_clip_path and os.path.exists(scene.video_clip_path):
        return FileResponse(scene.video_clip_path, media_type="video/mp4")
    
    raise HTTPException(status_code=404, detail="Preview not available")


@app.get("/api/projects/{project_id}/scenes/{scene_id}/shots/{shot_id}/image")
async def get_shot_image(
    project_id: str,
    scene_id: int,
    shot_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Scene).where(Scene.project_id == project_id, Scene.id == scene_id)
    )
    scene = result.scalar_one_or_none()
    
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    
    shots = scene.shots or []
    if shot_id >= len(shots):
        raise HTTPException(status_code=404, detail="Shot not found")
    
    shot = shots[shot_id]
    image_path = shot.get("image_path")
    video_path = shot.get("video_path")
    
    if image_path and os.path.exists(image_path):
        return FileResponse(image_path, media_type="image/png")
    
    if video_path and os.path.exists(video_path):
        return FileResponse(video_path, media_type="video/mp4")
    
    raise HTTPException(status_code=404, detail="Image not available")


@app.get("/api/projects/{project_id}/scenes/{scene_id}/shots/{shot_id}/video")
async def get_shot_video(
    project_id: str,
    scene_id: int,
    shot_id: int,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Scene).where(Scene.project_id == project_id, Scene.id == scene_id)
    )
    scene = result.scalar_one_or_none()
    
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    
    shots = scene.shots or []
    if shot_id >= len(shots):
        raise HTTPException(status_code=404, detail="Shot not found")
    
    shot = shots[shot_id]
    video_path = shot.get("video_path")
    
    if video_path and os.path.exists(video_path):
        ext = video_path.rsplit(".", 1)[-1].lower()
        media_type = {"mp4": "video/mp4", "mov": "video/quicktime", "avi": "video/x-msvideo", "mkv": "video/x-matroska", "webm": "video/webm"}.get(ext, "video/mp4")
        return FileResponse(video_path, media_type=media_type)
    
    raise HTTPException(status_code=404, detail="Video not available")


@app.get("/api/gpu/info")
async def get_gpu_info():
    gpu_manager = GPUManager()
    gpu_info = gpu_manager.get_device_info()

    cloud = CloudImageGenerator({
        "cloudflare_account_id": settings.CLOUDFLARE_ACCOUNT_ID,
        "cloudflare_api_token": settings.CLOUDFLARE_API_TOKEN,
        "pollinations_api_key": settings.POLLINATIONS_API_KEY,
        "flow_access_token": settings.FLOW_ACCESS_TOKEN,
        "flow_cookies": settings.FLOW_COOKIES,
        "hf_token": settings.HF_TOKEN,
        "prodia_api_key": settings.PRODIA_API_KEY,
    })

    return {
        **gpu_info,
        "use_cloud_gpu": settings.USE_CLOUD_GPU,
        "cloud_status": cloud.get_provider_status(),
    }


@app.get("/api/cloud/status")
async def get_cloud_status():
    cloud = CloudImageGenerator({
        "cloudflare_account_id": settings.CLOUDFLARE_ACCOUNT_ID,
        "cloudflare_api_token": settings.CLOUDFLARE_API_TOKEN,
        "pollinations_api_key": settings.POLLINATIONS_API_KEY,
        "flow_access_token": settings.FLOW_ACCESS_TOKEN,
        "flow_cookies": settings.FLOW_COOKIES,
        "hf_token": settings.HF_TOKEN,
        "prodia_api_key": settings.PRODIA_API_KEY,
    })
    return {
        "use_cloud_gpu": settings.USE_CLOUD_GPU,
        "providers": cloud.get_provider_status(),
    }


@app.get("/api/languages")
async def get_languages():
    from .services.tts_manager import get_languages as _get_languages, get_voices as _get_voices
    languages = _get_languages()
    result = []
    for code, name in languages.items():
        voices = _get_voices(code)
        result.append({
            "code": code,
            "name": name,
            "voices": voices,
        })
    return result


@app.websocket("/ws/{project_id}")
async def websocket_endpoint(websocket: WebSocket, project_id: str):
    await manager.connect(websocket, project_id)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        manager.disconnect(websocket, project_id)


def _run_generation_sync(project_id: str):
    import asyncio
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(run_generation_pipeline(project_id))
    finally:
        loop.close()


async def run_generation_pipeline(project_id: str):
    from .database import async_session
    from PIL import Image
    
    async with async_session() as db:
        try:
            result = await db.execute(select(Project).where(Project.id == project_id))
            project = result.scalar_one_or_none()
            
            if not project:
                logger.error(f"Project {project_id} not found")
                return
            
            scenes_result = await db.execute(
                select(Scene).where(Scene.project_id == project_id).order_by(Scene.scene_number)
            )
            scenes = scenes_result.scalars().all()
            
            project_dir = settings.OUTPUT_DIR / project_id
            project_dir.mkdir(parents=True, exist_ok=True)
            
            width, height = (1024, 576) if project.aspect_ratio == "16:9" else (576, 1024)
            
            cloud_config = {
                "cloudflare_account_id": settings.CLOUDFLARE_ACCOUNT_ID,
                "cloudflare_api_token": settings.CLOUDFLARE_API_TOKEN,
                "pollinations_api_key": settings.POLLINATIONS_API_KEY,
                "resolution": project.aspect_ratio,
                "image_model": project.image_model,
            }
            cloud_gen = CloudVideoGenerator(cloud_config)
            cloud_img_gen = CloudImageGenerator(cloud_config)
            ffmpeg = FFmpegProcessor()
            use_video = project.image_model == "pollinations-video"
            
            clip_paths = []
            total_scenes = len(scenes)
            
            target_parts = (project.target_duration or "00:25:00").split(':')
            target_seconds = int(target_parts[0]) * 3600 + int(target_parts[1]) * 60 + int(target_parts[2])
            current_total = sum(s.duration_seconds or 0 for s in scenes)
            
            preserve_uploads = dict((project.editor_state or {}).get("_preserve_uploads", {}))
            
            if preserve_uploads:
                editor_state = dict(project.editor_state or {})
                del editor_state["_preserve_uploads"]
                project.editor_state = editor_state
                await db.commit()
            
            await manager.broadcast(project_id, {
                "type": "progress",
                "status": "generating",
                "progress": 0.05,
                "message": f"Starting documentary: {total_scenes} scenes to generate...",
            })
            
            for i, scene in enumerate(scenes):
                progress = 0.1 + (0.65 * (i / total_scenes))
                project.status = JobStatus.GENERATING
                project.progress = progress
                
                log = GenerationLog(
                    project_id=project_id,
                    scene_number=scene.scene_number,
                    step="generating",
                    status="running",
                    message=f"Scene {scene.scene_number}/{total_scenes}: Generating images + voiceover",
                    progress=progress,
                )
                db.add(log)
                await db.commit()
                
                await manager.broadcast(project_id, {
                    "type": "progress",
                    "status": project.status,
                    "progress": progress,
                    "message": f"Scene {scene.scene_number}/{total_scenes}: Generating {scene.shot_count} shots...",
                })
                
                shots = scene.shots or []
                shot_paths = []
                
                for shot in shots:
                    shot_idx = shot.get("id", 0)
                    shot_path = str(project_dir / f"scene_{scene.scene_number:03d}_shot_{shot_idx:03d}.png")
                    video_path = str(project_dir / f"scene_{scene.scene_number:03d}_shot_{shot_idx:03d}.mp4")
                    
                    uploaded_src = preserve_uploads.get(f"{scene.id}_{shot_idx}")
                    if not uploaded_src:
                        uploaded_src = preserve_uploads.get(str(scene.id))
                    
                    if uploaded_src:
                        actual_path = None
                        if uploaded_src.startswith("/output/"):
                            actual_path = str(settings.OUTPUT_DIR) + uploaded_src[len("/output"):]
                        elif uploaded_src.startswith("/") and os.path.exists(uploaded_src):
                            actual_path = uploaded_src
                        if actual_path and os.path.exists(actual_path):
                            ext = os.path.splitext(actual_path)[1].lower()
                            is_vid = ext in ('.mp4', '.mov', '.avi', '.mkv', '.webm')
                            if is_vid:
                                shot["video_path"] = actual_path
                            else:
                                shot["image_path"] = actual_path
                            shot_paths.append(actual_path)
                            logger.info(f"Preserved uploaded {'video' if is_vid else 'image'} for scene {scene.scene_number} shot {shot_idx}: {actual_path}")
                            continue
                    
                    if shot.get("video_path") and os.path.exists(shot.get("video_path", "")):
                        shot_paths.append(shot["video_path"])
                    elif shot.get("image_path") and os.path.exists(shot.get("image_path", "")):
                        shot_paths.append(shot["image_path"])
                    else:
                        video_success = False
                        if use_video:
                            shot_dur = max(4, min(8, scene.duration_seconds / max(1, len(shots))))
                            video_bytes = await cloud_img_gen.generate_video(
                                prompt=shot["prompt"],
                                width=width, height=height,
                                duration=int(shot_dur),
                                model="wan",
                            )
                            if video_bytes and len(video_bytes) > 1000:
                                with open(video_path, "wb") as vf:
                                    vf.write(video_bytes)
                                shot["video_path"] = video_path
                                shot_paths.append(video_path)
                                video_success = True
                                logger.info(f"Generated video shot {shot_idx} for scene {scene.scene_number} ({len(video_bytes)} bytes)")
                        
                        if not video_success:
                            frame = await asyncio.to_thread(
                                cloud_gen.generate_frame,
                                shot["prompt"], scene.negative_prompt,
                                width, height, 4, 7.5,
                                shot.get("seed", scene.seed + shot_idx),
                                project.image_model,
                            )
                            if frame:
                                frame.save(shot_path, "PNG")
                                shot["image_path"] = shot_path
                                shot_paths.append(shot_path)
                                logger.info(f"Generated shot {shot_idx} for scene {scene.scene_number}")
                            else:
                                fallback = Image.new("RGB", (width, height), (30, 30, 50))
                                fallback.save(shot_path, "PNG")
                                shot_paths.append(shot_path)
                
                scene.shots = shots
                
                clip_path = str(project_dir / f"scene_{scene.scene_number:03d}.mp4")
                
                has_video_shots = any(
                    s.get("video_path") and os.path.exists(s.get("video_path", ""))
                    for s in shots
                )
                
                if has_video_shots:
                    all_clips_for_scene = []
                    shot_dur = max(4, min(8, scene.duration_seconds / max(1, len(shots))))
                    for s in shots:
                        sp = s.get("video_path")
                        if sp and os.path.exists(sp):
                            shot_out = str(project_dir / f"scene_{scene.scene_number:03d}_shot_{shots.index(s):03d}_vid_rendered.mp4")
                            ok = await asyncio.to_thread(
                                ffmpeg.render_clip, sp, shot_out, shot_dur,
                                width=width, height=height, is_image=False
                            )
                            if ok and os.path.exists(shot_out):
                                all_clips_for_scene.append(shot_out)
                            else:
                                all_clips_for_scene.append(sp)
                        elif s.get("image_path") and os.path.exists(s["image_path"]):
                            kb_out = str(project_dir / f"scene_{scene.scene_number:03d}_shot_{shots.index(s):03d}_kb.mp4")
                            ok = await asyncio.to_thread(
                                ffmpeg.create_ken_burns_clip,
                                s["image_path"], kb_out,
                                shot_dur, width, height, 24
                            )
                            if ok and os.path.exists(kb_out):
                                all_clips_for_scene.append(kb_out)
                            else:
                                all_clips_for_scene.append(s["image_path"])
                    if len(all_clips_for_scene) == 1:
                        import shutil
                        shutil.copy2(all_clips_for_scene[0], clip_path)
                        success = True
                    elif len(all_clips_for_scene) > 1:
                        success = await asyncio.to_thread(
                            ffmpeg.concatenate_videos,
                            all_clips_for_scene, clip_path,
                        )
                    else:
                        success = False
                elif len(shot_paths) > 1:
                    success = await asyncio.to_thread(
                        ffmpeg.create_multi_shot_clip,
                        shot_paths, clip_path,
                        scene.duration_seconds, width, height, 24, 0.5
                    )
                elif shot_paths:
                    success = await asyncio.to_thread(
                        ffmpeg.create_ken_burns_clip,
                        shot_paths[0], clip_path,
                        scene.duration_seconds, width, height, 24
                    )
                else:
                    success = False
                
                if not success:
                    cmd = [
                        ffmpeg.ffmpeg_path, "-y",
                        "-f", "lavfi", "-i",
                        f"color=c=0x1e1b4b:s={width}x{height}:d={scene.duration_seconds}:r=24,format=yuv420p",
                        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                        "-t", str(scene.duration_seconds),
                        "-c:v", "libx264", "-preset", "ultrafast",
                        "-pix_fmt", "yuv420p",
                        "-movflags", "+faststart",
                        clip_path
                    ]
                    import subprocess
                    proc = await asyncio.to_thread(
                        lambda: subprocess.run(cmd, capture_output=True, text=True, timeout=30)
                    )
                    success = proc.returncode == 0
                
                if success:
                    scene.video_clip_path = clip_path
                    scene.video_path = clip_path
                    clip_paths.append(clip_path)
                    clip_idx = len(clip_paths) - 1
                    log.status = "completed"
                    log.completed_at = datetime.utcnow()
                
                if success and project.enable_voiceover and scene.voiceover_text:
                    await manager.broadcast(project_id, {
                        "type": "progress",
                        "status": project.status,
                        "progress": progress,
                        "message": f"Scene {scene.scene_number}/{total_scenes}: Generating voiceover...",
                    })
                    
                    voiceover_gen = VoiceoverGenerator({
                        "language": getattr(project, 'language', 'en'),
                        "gender": getattr(project, 'gender', 'female'),
                        "voice": getattr(project, 'voice', None),
                        "rate": getattr(project, 'rate', '+0%'),
                    })
                    vov_path = str(project_dir / f"voiceover_{scene.scene_number:03d}.mp3")
                    vov_success = await asyncio.to_thread(
                        voiceover_gen.generate_audio, scene.voiceover_text, vov_path
                    )
                    if vov_success and os.path.exists(vov_path):
                        vov_dur = await asyncio.to_thread(ffmpeg.get_duration, vov_path)
                        if vov_dur and vov_dur > scene.duration_seconds + 1:
                            extra = vov_dur - scene.duration_seconds + 2
                            new_dur = scene.duration_seconds + extra
                            remaining = target_seconds - (current_total - scene.duration_seconds)
                            new_dur = min(new_dur, max(scene.duration_seconds, remaining))
                            old_dur = scene.duration_seconds
                            scene.duration_seconds = new_dur
                            minutes = int(new_dur) // 60
                            seconds = int(new_dur) % 60
                            scene.duration = f"00:{minutes:02d}:{seconds:02d}"
                            current_total = current_total - old_dur + new_dur
                            await db.commit()
                            logger.info(f"Scene {scene.scene_number} extended to {new_dur}s for voiceover ({vov_dur}s), target={target_seconds}s, current_total={current_total}s")
                            shot_dur = new_dur / max(len(scene.shots or []), 1)
                            for s in (scene.shots or []):
                                s["duration_seconds"] = shot_dur
                            await db.commit()
                            new_clip_path = str(project_dir / f"scene_{scene.scene_number:03d}_extended.mp4")
                            shots = scene.shots or []
                            shot_vids = []
                            for si, s in enumerate(shots):
                                sp = s.get("video_path") or s.get("image_path")
                                if sp and os.path.exists(sp):
                                    shot_out = str(project_dir / f"scene_{scene.scene_number:03d}_shot_{si:03d}_ext.mp4")
                                    is_img = sp.lower().endswith(('.png','.jpg','.jpeg','.webp','.bmp'))
                                    await asyncio.to_thread(
                                        ffmpeg.render_clip, sp, shot_out, shot_dur,
                                        width=width, height=height, is_image=is_img,
                                    )
                                    if os.path.exists(shot_out):
                                        shot_vids.append(shot_out)
                            if len(shot_vids) == 1:
                                import shutil
                                shutil.copy2(shot_vids[0], new_clip_path)
                            elif len(shot_vids) > 1:
                                await asyncio.to_thread(ffmpeg.concatenate_videos, shot_vids, new_clip_path)
                            if os.path.exists(new_clip_path) and os.path.getsize(new_clip_path) > 1000:
                                clip_path = new_clip_path
                        elif vov_dur and vov_dur < scene.duration_seconds - 1:
                            trimmed_dur = vov_dur + 1
                            logger.info(f"Scene {scene.scene_number} trimmed to {trimmed_dur}s (voiceover={vov_dur}s)")
                            scene.duration_seconds = trimmed_dur
                            minutes = int(trimmed_dur) // 60
                            seconds = int(trimmed_dur) % 60
                            scene.duration = f"00:{minutes:02d}:{seconds:02d}"
                            shot_dur = trimmed_dur / max(len(scene.shots or []), 1)
                            for s in (scene.shots or []):
                                s["duration_seconds"] = shot_dur
                            await db.commit()
                            new_clip_path = str(project_dir / f"scene_{scene.scene_number:03d}_trimmed.mp4")
                            shots = scene.shots or []
                            shot_vids = []
                            for si, s in enumerate(shots):
                                sp = s.get("video_path") or s.get("image_path")
                                if sp and os.path.exists(sp):
                                    shot_out = str(project_dir / f"scene_{scene.scene_number:03d}_shot_{si:03d}_trim.mp4")
                                    is_img = sp.lower().endswith(('.png','.jpg','.jpeg','.webp','.bmp'))
                                    await asyncio.to_thread(
                                        ffmpeg.render_clip, sp, shot_out, shot_dur,
                                        width=width, height=height, is_image=is_img,
                                    )
                                    if os.path.exists(shot_out):
                                        shot_vids.append(shot_out)
                            if len(shot_vids) == 1:
                                import shutil
                                shutil.copy2(shot_vids[0], new_clip_path)
                            elif len(shot_vids) > 1:
                                await asyncio.to_thread(ffmpeg.concatenate_videos, shot_vids, new_clip_path)
                            if os.path.exists(new_clip_path) and os.path.getsize(new_clip_path) > 1000:
                                clip_path = new_clip_path
                        audio_video = str(project_dir / f"audio_{scene.scene_number:03d}.mp4")
                        mixed = await asyncio.to_thread(
                            ffmpeg.add_audio, clip_path, vov_path, audio_video
                        )
                        if mixed and os.path.exists(audio_video):
                            scene.video_clip_path = audio_video
                            clip_paths[clip_idx] = audio_video
                            logger.info(f"Voiceover added for scene {scene.scene_number}")
                    voiceover_gen.cleanup()
                    scene.voiceover_path = vov_path
                    await db.commit()
            
            project.status = JobStatus.STITCHING
            project.progress = 0.8
            await db.commit()
            
            await manager.broadcast(project_id, {
                "type": "progress",
                "status": "stitching",
                "progress": 0.8,
                "message": f"Assembling {len(clip_paths)} scenes into documentary...",
            })
            
            final_total = sum(s.duration_seconds or 0 for s in scenes)
            if final_total > target_seconds and final_total > 0:
                scale = target_seconds / final_total
                logger.info(f"Scaling scenes from {final_total}s to {target_seconds}s (factor={scale:.2f})")
                for scene in scenes:
                    old_dur = scene.duration_seconds
                    new_dur = max(5, old_dur * scale)
                    scene.duration_seconds = new_dur
                    minutes = int(new_dur) // 60
                    seconds = int(new_dur) % 60
                    scene.duration = f"00:{minutes:02d}:{seconds:02d}"
                    shot_dur = new_dur / max(len(scene.shots or []), 1)
                    for s in (scene.shots or []):
                        s["duration_seconds"] = shot_dur
                await db.commit()
            
            scenes_data = []
            for scene in scenes:
                await db.refresh(scene)
                scenes_data.append({
                    "scene_number": scene.scene_number,
                    "description": scene.description,
                    "duration_seconds": scene.duration_seconds,
                    "voiceover_text": scene.voiceover_text or scene.description,
                    "video_path": scene.video_clip_path,
                })
            
            assembler = VideoAssembler({
                "output_dir": str(settings.OUTPUT_DIR),
                "transition_type": project.transition_type or "cross_dissolve",
                "transition_duration": 0.5,
                "enable_voiceover": False,
                "enable_subtitles": project.enable_subtitles,
                "enable_upscaling": False,
            })
            
            final_path = await asyncio.to_thread(
                assembler.assemble_video,
                project_id=project_id,
                scenes=scenes_data,
                clip_paths=clip_paths,
                audio_paths=None,
            )
            
            if final_path and os.path.exists(final_path):
                project.status = JobStatus.COMPLETED
                project.progress = 1.0
                project.video_path = final_path
                project.file_size_bytes = os.path.getsize(final_path)
                project.completed_at = datetime.utcnow()
                
                log = GenerationLog(
                    project_id=project_id,
                    step="completed",
                    status="completed",
                    message="Documentary complete!",
                    progress=1.0,
                )
                db.add(log)
                
                await manager.broadcast(project_id, {
                    "type": "completed",
                    "status": "completed",
                    "progress": 1.0,
                    "message": "Documentary complete!",
                    "video_url": f"/api/projects/{project_id}/download",
                })
            else:
                project.status = JobStatus.FAILED
                project.error_message = "Failed to assemble final video"
            
            await db.commit()
            cloud_gen.cleanup()
            
        except Exception as e:
            logger.error(f"Pipeline error: {e}", exc_info=True)
            
            try:
                result = await db.execute(select(Project).where(Project.id == project_id))
                project = result.scalar_one_or_none()
                if project:
                    project.status = JobStatus.FAILED
                    project.error_message = str(e)
                    await db.commit()
                
                await manager.broadcast(project_id, {
                    "type": "error",
                    "status": "failed",
                    "progress": 0,
                    "message": str(e),
                })
            except:
                pass


@app.get("/api/projects/{project_id}/editor")
async def get_editor_state(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    scenes_result = await db.execute(
        select(Scene).where(Scene.project_id == project_id).order_by(Scene.scene_number)
    )
    scenes = scenes_result.scalars().all()
    
    editor_state = project.editor_state or {}
    
    clips = editor_state.get("clips", [])
    if not clips:
        for scene in scenes:
            shots = scene.shots or []
            for shot_idx, shot in enumerate(shots):
                clip = {
                    "id": f"scene_{scene.id}_shot_{shot_idx}",
                    "scene_id": scene.id,
                    "shot_id": shot_idx,
                    "type": "video",
                    "source": shot.get("video_path") or shot.get("image_path"),
                    "duration": shot.get("duration_seconds", 5.0),
                    "thumbnail": shot.get("image_path"),
                    "title": f"Scene {scene.scene_number} - Shot {shot_idx + 1}",
                    "prompt": shot.get("prompt", ""),
                    "volume": 1.0,
                    "speed": 1.0,
                    "trim_start": 0,
                    "trim_end": 0,
                    "transitions": {"in": scene.transition_in, "out": scene.transition_out},
                }
                clips.append(clip)
    
    scene_durations = {scene.id: scene.duration_seconds or 5.0 for scene in scenes}
    for clip in clips:
        scene_id = clip.get("scene_id", 0)
        shot_id = clip.get("shot_id", 0)
        if scene_id in scene_durations:
            scene = next((s for s in scenes if s.id == scene_id), None)
            if scene:
                shots = scene.shots or []
                if shot_id < len(shots):
                    correct_dur = shots[shot_id].get("duration_seconds", scene_durations[scene_id])
                    clip["duration"] = correct_dur

    return {
        "project_id": project_id,
        "clips": clips,
        "text_overlays": editor_state.get("text_overlays", []),
        "transitions": editor_state.get("transitions", []),
        "aspect_ratio": project.aspect_ratio or "16:9",
        "resolution": project.resolution or "1920x1080",
        "total_duration": sum(c.get("duration", 5.0) for c in clips),
    }


@app.put("/api/projects/{project_id}/editor")
async def save_editor_state(
    project_id: str,
    state: dict,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    project.editor_state = state
    await db.commit()
    
    return {"status": "saved", "project_id": project_id}


@app.post("/api/projects/{project_id}/editor/export")
async def export_video(
    project_id: str,
    config: dict,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    logger.info(f"Export started for project {project_id} with config {config}")
    asyncio.ensure_future(_run_export_task(project_id, config))
    
    return {"status": "export_started", "project_id": project_id}


async def _run_export_task(project_id: str, config: dict):
    from .database import async_session
    import subprocess
    import shutil
    import tempfile

    try:
        async with async_session() as db:
            try:
                result = await db.execute(select(Project).where(Project.id == project_id))
                project = result.scalar_one_or_none()
                if not project:
                    logger.error(f"Export: project {project_id} not found")
                    return

                output_dir = os.path.join(str(settings.OUTPUT_DIR), project_id)
                os.makedirs(output_dir, exist_ok=True)

                output_path = os.path.join(output_dir, "final_export.mp4")
                width = config.get("width", 1920)
                height = config.get("height", 1080)
                fps = config.get("fps", 30)

                logger.info(f"Export: starting for {project_id}, config={config}")
                await manager.broadcast(project_id, {
                    "type": "export_progress",
                    "progress": 0.05,
                    "message": "Loading project data...",
                })

                editor_state = project.editor_state or {}
                clips = editor_state.get("clips", [])
                text_overlays = editor_state.get("text_overlays", [])

                if not clips:
                    input_file = project.video_path
                    if not input_file or not os.path.exists(input_file):
                        input_file = getattr(project, 'video_clip_path', None)
                    if not input_file or not os.path.exists(input_file):
                        project.status = JobStatus.FAILED
                        project.error_message = "No clips or video available for export"
                        await db.commit()
                        await manager.broadcast(project_id, {
                            "type": "error", "status": "failed",
                            "message": "No clips to export",
                        })
                        return
                    ffmpeg = FFmpegProcessor()
                    scale_filter = f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2"
                    cmd = [
                        ffmpeg.ffmpeg_path, "-y", "-i", input_file,
                        "-vf", scale_filter,
                        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
                        "-c:a", "aac", "-b:a", "320k",
                        "-ar", "44100", "-ac", "2",
                        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                        output_path,
                    ]
                    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
                    if proc.returncode != 0:
                        shutil.copy2(input_file, output_path)
                    if os.path.exists(output_path) and os.path.getsize(output_path) > 1000:
                        project.video_path = output_path
                        project.status = JobStatus.COMPLETED
                        project.file_size_bytes = os.path.getsize(output_path)
                        project.completed_at = datetime.utcnow()
                        await db.commit()
                        await manager.broadcast(project_id, {
                            "type": "export_completed", "progress": 1.0,
                            "message": "Export complete!",
                            "video_url": f"/api/projects/{project_id}/download",
                        })
                    return

                result_scenes = await db.execute(
                    select(Scene).where(Scene.project_id == project_id).order_by(Scene.scene_number)
                )
                scenes = result_scenes.scalars().all()
                scene_map = {s.id: s for s in scenes}

                ffmpeg = FFmpegProcessor()

                with tempfile.TemporaryDirectory() as tmpdir:
                    total = len(clips)
                    rendered_clips = []

                    for idx, clip in enumerate(clips):
                        base_progress = 0.1 + (idx / total) * 0.7
                        next_progress = 0.1 + ((idx + 1) / total) * 0.7
                        await manager.broadcast(project_id, {
                            "type": "export_progress",
                            "progress": base_progress,
                            "message": f"Rendering clip {idx+1}/{total}...",
                        })

                        clip_track = clip.get("track", "video")
                        if clip_track in ("overlay", "video2"):
                            continue

                        scene_id = clip.get("scene_id", 0)
                        shot_id = clip.get("shot_id", 0)
                        clip_type = clip.get("type", "image")
                        clip_duration = clip.get("duration", 5.0)
                        speed = clip.get("speed", 1.0)
                        trim_start = clip.get("trim_start", 0) or clip.get("trimStart", 0)
                        trim_end = clip.get("trim_end", 0) or clip.get("trimEnd", 0)
                        volume = clip.get("volume", 1.0)
                        transition = clip.get("transition", "none")
                        transitions = clip.get("transitions", {})
                        if isinstance(transitions, dict):
                            transition = transitions.get("in", transition)
                        brightness = clip.get("brightness", 0)
                        contrast = clip.get("contrast", 1.0)
                        saturation = clip.get("saturation", 1.0)
                        temperature = clip.get("temperature", 0)
                        is_uploaded = clip.get("source_type") == "uploaded"

                        source_path = None
                        is_image = False

                        if is_uploaded and clip.get("src"):
                            src = clip["src"]
                            if src.startswith("/output/"):
                                actual_path = str(settings.OUTPUT_DIR) + src[len("/output"):]
                                if os.path.exists(actual_path):
                                    source_path = actual_path
                                    ext = os.path.splitext(actual_path)[1].lower()
                                    is_image = ext in ('.png', '.jpg', '.jpeg', '.webp', '.bmp')
                            elif src.startswith("/") or src.startswith("http"):
                                if os.path.exists(src):
                                    source_path = src
                                    ext = os.path.splitext(src)[1].lower()
                                    is_image = ext in ('.png', '.jpg', '.jpeg', '.webp', '.bmp')
                            elif os.path.exists(src):
                                source_path = src
                                ext = os.path.splitext(src)[1].lower()
                                is_image = ext in ('.png', '.jpg', '.jpeg', '.webp', '.bmp')

                        if not source_path:
                            scene = scene_map.get(scene_id)
                            if scene and scene.shots:
                                shots = scene.shots
                                if isinstance(shots, str):
                                    import json as _json
                                    shots = _json.loads(shots)
                                if shot_id < len(shots):
                                    shot = shots[shot_id]
                                    if clip_type == "video" and shot.get("video_path"):
                                        sp = shot["video_path"]
                                        if os.path.exists(sp):
                                            source_path = sp
                                    if not source_path and shot.get("image_path"):
                                        sp = shot["image_path"]
                                        if os.path.exists(sp):
                                            source_path = sp
                                            is_image = True
                                    if not source_path and shot.get("video_path"):
                                        sp = shot["video_path"]
                                        if os.path.exists(sp):
                                            source_path = sp

                        if not source_path:
                            await manager.broadcast(project_id, {
                                "type": "export_progress",
                                "progress": base_progress,
                                "message": f"Creating placeholder for clip {idx+1}/{total}...",
                            })
                            fallback = os.path.join(tmpdir, f"placeholder_{idx:03d}.mp4")
                            cmd = [
                                ffmpeg.ffmpeg_path, "-y",
                                "-f", "lavfi", "-i",
                                f"color=c=0x0f172a:s={width}x{height}:d={clip_duration}:r={fps},format=yuv420p",
                                "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=stereo",
                                "-t", str(clip_duration),
                                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
                                "-c:a", "aac", "-b:a", "192k",
                                "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                                fallback,
                            ]
                            await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True, timeout=60)
                            if os.path.exists(fallback) and os.path.getsize(fallback) > 100:
                                source_path = fallback
                                is_image = False
                            else:
                                logger.warning(f"Export: placeholder creation failed for clip {idx}, skipping")
                                continue

                        clip_out = os.path.join(tmpdir, f"clip_{idx:03d}.mp4")

                        _main_loop = asyncio.get_running_loop()

                        def _clip_progress(msg):
                            try:
                                asyncio.run_coroutine_threadsafe(
                                    manager.broadcast(project_id, {
                                        "type": "export_progress",
                                        "progress": base_progress,
                                        "message": f"Clip {idx+1}/{total}: {msg}",
                                    }),
                                    _main_loop,
                                )
                            except Exception:
                                pass

                        ok = await asyncio.to_thread(
                            ffmpeg.render_clip,
                            source_path, clip_out, clip_duration,
                            speed=speed, trim_start=trim_start, trim_end=trim_end,
                            volume=volume, width=width, height=height,
                            brightness=brightness, contrast=contrast,
                            saturation=saturation, temperature=temperature,
                            is_image=is_image,
                            progress_callback=_clip_progress,
                        )
                        if ok and os.path.exists(clip_out) and os.path.getsize(clip_out) > 1000:
                            rendered_clips.append(clip_out)
                        else:
                            logger.warning(f"Export: clip {idx} render failed, copying source directly")
                            if os.path.exists(source_path) and os.path.getsize(source_path) > 1000:
                                fallback_out = os.path.join(tmpdir, f"fallback_{idx:03d}.mp4")
                                shutil.copy2(source_path, fallback_out)
                                rendered_clips.append(fallback_out)
                            else:
                                logger.warning(f"Export: source also missing for clip {idx}, skipping")
                        await manager.broadcast(project_id, {
                            "type": "export_progress",
                            "progress": next_progress,
                            "message": f"Clip {idx+1}/{total} done",
                        })

                    await manager.broadcast(project_id, {
                        "type": "export_progress",
                        "progress": 0.8,
                        "message": "Concatenating clips with transitions...",
                    })

                    if not rendered_clips:
                        project.status = JobStatus.FAILED
                        project.error_message = "No clips rendered successfully"
                        await db.commit()
                        return

                    if len(rendered_clips) == 1:
                        shutil.copy2(rendered_clips[0], output_path)
                    else:
                        has_transitions = any(
                            (c.get("transition", "none") if isinstance(c, dict) else "none") != "none"
                            for c in clips[:len(rendered_clips)]
                        )
                        if has_transitions:
                            transition_clips = [rendered_clips[0]]
                            for i in range(1, len(rendered_clips)):
                                t_type = clips[i].get("transition", "none") if i < len(clips) else "none"
                                transitions_obj = clips[i].get("transitions", {}) if i < len(clips) else {}
                                if isinstance(transitions_obj, dict):
                                    t_type = transitions_obj.get("in", t_type)
                                if t_type and t_type != "none":
                                    t_dur = 0.5
                                    merged = os.path.join(tmpdir, f"trans_{i:03d}.mp4")
                                    ok = await asyncio.to_thread(ffmpeg.apply_transition, transition_clips[-1], rendered_clips[i], merged, t_type, t_dur)
                                    if ok:
                                        transition_clips[-1] = merged
                                    else:
                                        transition_clips.append(rendered_clips[i])
                                else:
                                    transition_clips.append(rendered_clips[i])

                            if len(transition_clips) == 1:
                                shutil.copy2(transition_clips[0], output_path)
                            else:
                                trans_concat_file = os.path.join(tmpdir, "concat.txt")
                                with open(trans_concat_file, "w", encoding="utf-8") as f:
                                    for p in transition_clips:
                                        fp = p.replace("\\", "/")
                                        f.write(f"file '{fp}'\n")
                                cmd = [
                                    ffmpeg.ffmpeg_path, "-y",
                                    "-f", "concat", "-safe", "0",
                                    "-i", trans_concat_file,
                                    "-c", "copy",
                                    "-movflags", "+faststart",
                                    output_path,
                                ]
                                proc = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True, timeout=600)
                                if proc.returncode != 0 or not os.path.exists(output_path) or os.path.getsize(output_path) < 1000:
                                    logger.warning(f"Export concat with transitions failed, retrying with re-encode: {proc.stderr[:300] if proc else 'no output'}")
                                    with open(os.path.join(tmpdir, "concat_simple.txt"), "w", encoding="utf-8") as f2:
                                        for p in rendered_clips:
                                            fp = p.replace("\\", "/")
                                            f2.write(f"file '{fp}'\n")
                                    cmd_simple = [
                                        ffmpeg.ffmpeg_path, "-y",
                                        "-f", "concat", "-safe", "0",
                                        "-i", os.path.join(tmpdir, "concat_simple.txt"),
                                        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
                                        "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
                                        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                                        output_path,
                                    ]
                                    proc2 = await asyncio.to_thread(subprocess.run, cmd_simple, capture_output=True, text=True, timeout=600)
                                    if proc2.returncode != 0:
                                        logger.error(f"Export concat (re-encode fallback) also failed: {proc2.stderr[:300]}")
                        else:
                            concat_file = os.path.join(tmpdir, "concat.txt")
                            with open(concat_file, "w", encoding="utf-8") as f:
                                for p in rendered_clips:
                                    fp = p.replace("\\", "/")
                                    f.write(f"file '{fp}'\n")
                            cmd = [
                                ffmpeg.ffmpeg_path, "-y",
                                "-f", "concat", "-safe", "0",
                                "-i", concat_file,
                                "-c", "copy",
                                "-movflags", "+faststart",
                                output_path,
                            ]
                            proc = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True, timeout=600)
                            if proc.returncode != 0 or not os.path.exists(output_path) or os.path.getsize(output_path) < 1000:
                                logger.warning(f"Export concat (copy) failed, retrying with re-encode: {proc.stderr[:300] if proc else 'no output'}")
                                cmd_reenc = [
                                    ffmpeg.ffmpeg_path, "-y",
                                    "-f", "concat", "-safe", "0",
                                    "-i", concat_file,
                                    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
                                    "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
                                    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                                    output_path,
                                ]
                                proc2 = await asyncio.to_thread(subprocess.run, cmd_reenc, capture_output=True, text=True, timeout=600)
                                if proc2.returncode != 0:
                                    logger.error(f"Export concat (re-encode) also failed: {proc2.stderr[:300]}")

                    await manager.broadcast(project_id, {
                        "type": "export_progress",
                        "progress": 0.9,
                        "message": "Applying text overlays...",
                    })

                    if text_overlays and os.path.exists(output_path):
                        for text_item in text_overlays:
                            if not text_item.get("text"):
                                continue
                            overlay_out = os.path.join(tmpdir, "overlay_tmp.mp4")
                            ok = await asyncio.to_thread(
                                ffmpeg.add_text_overlay,
                                output_path, overlay_out,
                                text=text_item["text"],
                                x=f"{text_item.get('x', 50)}%",
                                y=f"{text_item.get('y', 90)}%",
                                font_size=text_item.get("fontSize", 24),
                                font_color=text_item.get("color", "white"),
                                start_time=text_item.get("startTime", 0),
                                end_time=text_item.get("endTime", -1),
                            )
                            if ok and os.path.exists(overlay_out):
                                os.replace(overlay_out, output_path)

                    await manager.broadcast(project_id, {
                        "type": "export_progress",
                        "progress": 0.95,
                        "message": "Compositing overlays...",
                    })

                    overlay_clips = [c for c in clips if c.get("track") == "overlay" or c.get("track") == "video2"]
                    if overlay_clips and os.path.exists(output_path):
                        for ov in overlay_clips:
                            ov_scene_id = ov.get("scene_id", 0)
                            ov_shot_id = ov.get("shot_id", 0)
                            ov_source = None
                            scene = scene_map.get(ov_scene_id)
                            if scene and scene.shots:
                                shots = scene.shots
                                if isinstance(shots, str):
                                    import json as _json
                                    shots = _json.loads(shots)
                                if ov_shot_id < len(shots):
                                    shot = shots[ov_shot_id]
                                    for key in ("video_path", "image_path"):
                                        sp = shot.get(key)
                                        if sp and os.path.exists(sp):
                                            ov_source = sp
                                            break
                            if ov_source:
                                ov_rendered = os.path.join(tmpdir, f"ov_{ov_scene_id}_{ov_shot_id}.mp4")
                                await asyncio.to_thread(
                                    ffmpeg.render_clip,
                                    ov_source, ov_rendered, ov.get("duration", 5),
                                    width=width, height=height, is_image=ov.get("type") == "image",
                                )
                                if os.path.exists(ov_rendered):
                                    comp_out = os.path.join(tmpdir, "comp_tmp.mp4")
                                    ov_scale = (ov.get("overlayScale") or 30) / 100.0
                                    ok = await asyncio.to_thread(
                                        ffmpeg.composite_overlay,
                                        output_path, ov_rendered, comp_out,
                                        x=f"{ov.get('overlayX', 50)}%",
                                        y=f"{ov.get('overlayY', 50)}%",
                                        scale=ov_scale,
                                    )
                                    if ok and os.path.exists(comp_out):
                                        os.replace(comp_out, output_path)

                    await manager.broadcast(project_id, {
                        "type": "export_progress",
                        "progress": 0.98,
                        "message": "Mixing audio...",
                    })

                    timed_audio = []

                    clip_time = 0
                    for clip in clips:
                        clip_track = clip.get("track", "video")
                        if clip_track in ("overlay", "video2"):
                            continue
                        clip_duration = clip.get("duration", 5.0)
                        scene_id = clip.get("scene_id", 0)
                        scene = scene_map.get(scene_id)
                        if scene and scene.voiceover_path and os.path.exists(scene.voiceover_path):
                            timed_audio.append({
                                "path": scene.voiceover_path,
                                "volume": 1.0,
                                "start": clip_time,
                                "loop": False,
                            })
                        clip_time += clip_duration

                    audio_clips = editor_state.get("audio_clips", [])
                    for ac in audio_clips:
                        ac_src = ac.get("src", "")
                        ac_vol = ac.get("volume", 0.7)
                        ac_type = ac.get("type", "audio")
                        ac_path = None
                        if ac_src and not ac_src.startswith("blob:"):
                            if ac_src.startswith("/output/"):
                                ac_path = str(settings.OUTPUT_DIR) + ac_src[len("/output"):]
                            else:
                                ac_path = ac_src
                            if ac_path and os.path.exists(ac_path):
                                should_loop = ac_type == "music"
                                timed_audio.append({
                                    "path": ac_path,
                                    "volume": ac_vol,
                                    "start": 0,
                                    "loop": should_loop,
                                })

                    if timed_audio and os.path.exists(output_path):
                        audio_merged = os.path.join(tmpdir, "audio_merged.mp4")
                        ok = await asyncio.to_thread(ffmpeg.mix_audio_timed, output_path, timed_audio, audio_merged)
                        if ok:
                            os.replace(audio_merged, output_path)
                        else:
                            logger.warning("Audio mixing with timing failed, trying simple mix")

                    if os.path.exists(output_path) and os.path.getsize(output_path) > 1000:
                        project.video_path = output_path
                        project.status = JobStatus.COMPLETED
                        project.file_size_bytes = os.path.getsize(output_path)
                        project.completed_at = datetime.utcnow()
                        await db.commit()

                        await manager.broadcast(project_id, {
                            "type": "export_completed",
                            "progress": 1.0,
                            "message": "Export complete!",
                            "video_url": f"/api/projects/{project_id}/download",
                        })
                        logger.info(f"Export complete: {output_path} ({os.path.getsize(output_path)} bytes)")
                    else:
                        project.status = JobStatus.FAILED
                        project.error_message = "Export produced empty file"
                        await db.commit()

            except Exception as e:
                logger.error(f"Export error: {e}", exc_info=True)
                try:
                    result = await db.execute(select(Project).where(Project.id == project_id))
                    project = result.scalar_one_or_none()
                    if project:
                        project.status = JobStatus.FAILED
                        project.error_message = f"Export failed: {str(e)}"
                        await db.commit()
                    await manager.broadcast(project_id, {
                        "type": "error", "status": "failed",
                        "message": f"Export failed: {str(e)}",
                    })
                except:
                    pass
    except Exception as outer_e:
        logger.error(f"Export task outer error: {outer_e}", exc_info=True)
        try:
            async with async_session() as db:
                result = await db.execute(select(Project).where(Project.id == project_id))
                project = result.scalar_one_or_none()
                if project:
                    project.status = JobStatus.FAILED
                    project.error_message = f"Export failed: {str(outer_e)}"
                    await db.commit()
                await manager.broadcast(project_id, {
                    "type": "error", "status": "failed",
                    "message": f"Export failed: {str(outer_e)}",
                })
        except:
            pass
