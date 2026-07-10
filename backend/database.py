from sqlalchemy import create_engine, Column, Integer, String, Float, Text, Boolean, DateTime, JSON, ForeignKey, Enum as SQLEnum
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from datetime import datetime
from typing import Optional, List
import enum
import uuid

from .config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=settings.DEBUG)
async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
Base = declarative_base()


class JobStatus(str, enum.Enum):
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


class Project(Base):
    __tablename__ = "projects"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    script_text = Column(Text, nullable=False)
    style = Column(String(100), default="cinematic")
    target_duration = Column(String(20), default="01:00:00")
    status = Column(String(20), default=JobStatus.PENDING)
    progress = Column(Float, default=0.0)
    error_message = Column(Text, nullable=True)
    
    resolution = Column(String(20), default="1024x576")
    precision = Column(String(10), default="fp16")
    enable_cpu_offload = Column(Boolean, default=True)
    enable_voiceover = Column(Boolean, default=True)
    enable_music = Column(Boolean, default=True)
    enable_subtitles = Column(Boolean, default=True)
    enable_upscaling = Column(Boolean, default=False)
    
    transition_type = Column(String(50), default="cross_dissolve")
    transition_duration = Column(Float, default=1.0)
    
    language = Column(String(10), default="en")
    gender = Column(String(20), default="female")
    voice = Column(String(100), nullable=True)
    rate = Column(String(20), default="+0%")
    
    video_path = Column(String(500), nullable=True)
    subtitle_path = Column(String(500), nullable=True)
    duration_seconds = Column(Float, default=0.0)
    file_size_bytes = Column(Integer, default=0)
    
    aspect_ratio = Column(String(10), default="16:9")
    image_model = Column(String(50), default="flux-realism")
    
    review_mode = Column(Boolean, default=True)
    current_review_scene = Column(Integer, default=0)
    
    editor_state = Column(JSON, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    
    scenes = relationship("Scene", back_populates="project", cascade="all, delete-orphan")
    generation_logs = relationship("GenerationLog", back_populates="project", cascade="all, delete-orphan")


class Scene(Base):
    __tablename__ = "scenes"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    scene_number = Column(Integer, nullable=False)
    
    description = Column(Text, nullable=False)
    duration = Column(String(20), default="00:00:08")
    duration_seconds = Column(Float, default=8.0)
    
    prompt = Column(Text, nullable=False)
    negative_prompt = Column(Text, default="blurry, low quality, artifacts, watermark")
    
    voiceover_text = Column(Text, nullable=True)
    voiceover_path = Column(String(500), nullable=True)
    voiceover_duration = Column(Float, default=0.0)
    
    video_path = Column(String(500), nullable=True)
    video_clip_path = Column(String(500), nullable=True)
    
    background_music = Column(String(100), default="ambient")
    music_path = Column(String(500), nullable=True)
    
    character_tags = Column(JSON, default=list)
    environment_tags = Column(JSON, default=list)
    
    transition_in = Column(String(50), default="cross_dissolve")
    transition_out = Column(String(50), default="cross_dissolve")
    
    seed = Column(Integer, default=42)
    generated = Column(Boolean, default=False)
    
    shots = Column(JSON, default=list)
    shot_count = Column(Integer, default=3)
    image_status = Column(String(20), default="pending")
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    project = relationship("Project", back_populates="scenes")


class GenerationLog(Base):
    __tablename__ = "generation_logs"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    scene_number = Column(Integer, nullable=True)
    
    step = Column(String(50), nullable=False)
    status = Column(String(20), default="running")
    message = Column(Text, nullable=True)
    
    progress = Column(Float, default=0.0)
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    duration_seconds = Column(Float, default=0.0)
    
    error = Column(Text, nullable=True)
    metadata_json = Column(JSON, nullable=True)
    
    project = relationship("Project", back_populates="generation_logs")


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
