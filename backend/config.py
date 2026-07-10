from pydantic_settings import BaseSettings
from pathlib import Path
import os


class Settings(BaseSettings):
    APP_NAME: str = "TTV - Text to Video"
    APP_VERSION: str = "2.0.0"
    DEBUG: bool = True
    
    BASE_DIR: Path = Path(__file__).parent.parent
    DATABASE_URL: str = "sqlite+aiosqlite:///./ttv.db"
    REDIS_URL: str = "redis://localhost:6379/0"
    
    OUTPUT_DIR: Path = Path(__file__).parent.parent / "output"
    TEMP_DIR: Path = Path(__file__).parent.parent / "temp"
    MODELS_DIR: Path = Path(__file__).parent.parent / "models_cache"
    
    JWT_SECRET: str = "ttv-secret-key-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    
    MAX_VRAM_GB: float = 7.0
    DEFAULT_RESOLUTION: str = "512x512"
    DEFAULT_PRECISION: str = "fp16"
    CPU_OFFLOAD: bool = True
    
    VIDEO_CODEC: str = "libx264"
    VIDEO_CRF: int = 16
    AUDIO_CODEC: str = "aac"
    AUDIO_BITRATE: str = "320k"
    
    TTS_MODEL: str = "tts_models/en/ljspeech/tacotron2-DDC"
    MUSIC_DIR: Path = Path(__file__).parent.parent / "assets" / "music"
    
    CELERY_BROKER_URL: str = "redis://localhost:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/0"
    
    CORS_ORIGINS: list = ["http://localhost:3000", "http://localhost:5173"]

    CLOUDFLARE_ACCOUNT_ID: str = ""
    CLOUDFLARE_API_TOKEN: str = ""
    POLLINATIONS_API_KEY: str = ""
    FLOW_ACCESS_TOKEN: str = ""
    FLOW_COOKIES: str = ""
    HF_TOKEN: str = ""
    PRODIA_API_KEY: str = ""
    USE_CLOUD_GPU: bool = True
    
    class Config:
        env_file = ".env"
        case_sensitive = True
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        self.TEMP_DIR.mkdir(parents=True, exist_ok=True)
        self.MODELS_DIR.mkdir(parents=True, exist_ok=True)
        self.MUSIC_DIR.mkdir(parents=True, exist_ok=True)


settings = Settings()
