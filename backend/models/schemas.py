from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime
from enum import Enum


class JobStatus(str, Enum):
    PENDING = "pending"
    PARSING = "parsing"
    REVIEW = "review"
    GENERATING = "generating"
    VOICEOVER = "voiceover"
    MUSIC = "music"
    STITCHING = "stitching"
    SUBTITLES = "subtitles"
    UPSCALING = "upscaling"
    COMPLETED = "completed"
    FAILED = "failed"


class ShotInfo(BaseModel):
    id: int = 0
    prompt: str = ""
    description: str = ""
    duration_seconds: float = 0.0
    image_path: Optional[str] = None
    video_path: Optional[str] = None
    image_status: str = "pending"
    source_type: str = "generated"
    seed: int = 42


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    script_text: str = Field(..., min_length=10)
    style: str = "cinematic"
    target_duration: str = "00:25:00"
    resolution: str = "1024x576"
    precision: str = "fp16"
    enable_cpu_offload: bool = True
    enable_voiceover: bool = True
    enable_music: bool = True
    enable_subtitles: bool = True
    enable_upscaling: bool = False
    transition_type: str = "cross_dissolve"
    transition_duration: float = 1.0
    language: str = "en"
    gender: str = "female"
    voice: Optional[str] = None
    rate: str = "+0%"
    aspect_ratio: str = "16:9"
    image_model: str = "flux-realism"
    review_mode: bool = True
    shots_per_scene: int = 3


class ProjectResponse(BaseModel):
    id: str
    name: str
    script_text: str
    style: str
    target_duration: str
    status: str
    progress: float
    error_message: Optional[str] = None
    
    resolution: str
    precision: str
    enable_cpu_offload: bool
    enable_voiceover: bool
    enable_music: bool
    enable_subtitles: bool
    enable_upscaling: bool
    
    transition_type: str
    transition_duration: float
    
    language: str = "en"
    gender: str = "female"
    voice: Optional[str] = None
    rate: str = "+0%"
    
    aspect_ratio: str = "16:9"
    image_model: str = "flux-realism"
    review_mode: bool = True
    current_review_scene: int = 0
    
    video_path: Optional[str] = None
    subtitle_path: Optional[str] = None
    duration_seconds: float
    file_size_bytes: int
    
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None
    
    scenes_count: int = 0
    
    class Config:
        from_attributes = True


class SceneResponse(BaseModel):
    id: int
    scene_number: int
    description: str
    duration: str
    duration_seconds: float
    prompt: str
    negative_prompt: str
    voiceover_text: Optional[str] = None
    voiceover_path: Optional[str] = None
    voiceover_duration: float
    video_path: Optional[str] = None
    video_clip_path: Optional[str] = None
    background_music: str
    music_path: Optional[str] = None
    character_tags: List[str]
    environment_tags: List[str]
    transition_in: str
    transition_out: str
    seed: int
    generated: bool
    shots: List[Dict[str, Any]] = []
    shot_count: int = 3
    image_status: str = "pending"
    
    class Config:
        from_attributes = True


class SceneUpdate(BaseModel):
    description: Optional[str] = None
    duration: Optional[str] = None
    prompt: Optional[str] = None
    negative_prompt: Optional[str] = None
    voiceover_text: Optional[str] = None
    background_music: Optional[str] = None
    character_tags: Optional[List[str]] = None
    environment_tags: Optional[List[str]] = None
    transition_in: Optional[str] = None
    transition_out: Optional[str] = None
    seed: Optional[int] = None
    shot_count: Optional[int] = None


class ShotUpdate(BaseModel):
    prompt: Optional[str] = None
    description: Optional[str] = None
    seed: Optional[int] = None


class ShotApproval(BaseModel):
    approved: bool


class GenerationStatus(BaseModel):
    project_id: str
    status: str
    progress: float
    message: str
    current_step: Optional[str] = None
    scene_progress: Optional[Dict[str, Any]] = None
    estimated_time_remaining: Optional[float] = None


class WebSocketMessage(BaseModel):
    type: str
    project_id: str
    data: Dict[str, Any]


class GPUInfo(BaseModel):
    device: str
    name: Optional[str] = None
    total_vram_gb: Optional[float] = None
    free_vram_gb: Optional[float] = None
    dtype: str
    cuda_available: bool
    torch_version: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    version: str
    gpu: GPUInfo
    database: str
    redis: str
    ffmpeg: str


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: Optional[Dict[str, Any]] = None
