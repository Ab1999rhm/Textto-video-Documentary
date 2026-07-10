import gc
import io
import os
import asyncio
from typing import Optional, Dict, Any, List
from pathlib import Path
import subprocess
import json
import time
import logging

logger = logging.getLogger(__name__)

try:
    import torch
    TORCH_AVAILABLE = True
except ImportError:
    torch = None
    TORCH_AVAILABLE = False


class GPUManager:
    def __init__(self, max_vram_gb: float = 7.0):
        self.max_vram_gb = max_vram_gb
        if TORCH_AVAILABLE:
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            self.dtype = torch.float16 if self.device == "cuda" else torch.float32
            if self.device == "cuda":
                torch.cuda.empty_cache()
                logger.info(f"GPU: {torch.cuda.get_device_name(0)}")
                logger.info(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / (1024**3):.1f} GB")
        else:
            self.device = "cpu"
            self.dtype = None
    
    def get_device_info(self) -> Dict[str, Any]:
        info = {
            "device": self.device,
            "cuda_available": torch.cuda.is_available() if TORCH_AVAILABLE else False,
            "torch_version": torch.__version__ if TORCH_AVAILABLE else "not installed",
            "dtype": "fp16" if self.dtype == (torch.float16 if TORCH_AVAILABLE else None) else "fp32",
        }
        
        if self.device == "cuda" and TORCH_AVAILABLE:
            props = torch.cuda.get_device_properties(0)
            free, total = torch.cuda.mem_get_info(0)
            info.update({
                "name": props.name,
                "total_vram_gb": total / (1024**3),
                "free_vram_gb": free / (1024**3),
            })
        
        return info
    
    def check_memory(self, required_gb: float = 2.0) -> bool:
        if self.device != "cuda" or not TORCH_AVAILABLE:
            return True
        free = torch.cuda.mem_get_info(0)[0] / (1024**3)
        return free >= required_gb
    
    def clear_cache(self):
        if self.device == "cuda" and TORCH_AVAILABLE:
            torch.cuda.empty_cache()
        gc.collect()
    
    def offload_model(self, model):
        if self.device == "cuda":
            model.cpu()
            self.clear_cache()
        return model
    
    def load_model(self, model, move_to_gpu: bool = True):
        if self.device == "cuda" and move_to_gpu and TORCH_AVAILABLE:
            model = model.to(device=self.device, dtype=self.dtype)
        return model


class VideoGenerator:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.gpu_manager = GPUManager(
            max_vram_gb=config.get("max_vram_gb", 7.0)
        )
        self.resolution = config.get("resolution", "512x512")
        self.precision = config.get("precision", "fp16")
        self.enable_cpu_offload = config.get("enable_cpu_offload", True)
        
        self.pipe = None
        self.pipe_name = None
        self.models_dir = Path(config.get("models_dir", "models_cache"))
        self.models_dir.mkdir(parents=True, exist_ok=True)
    
    def load_pipeline(self, pipeline_name: str = "stable-diffusion-v1-5/stable-diffusion-v1-5"):
        if not TORCH_AVAILABLE:
            logger.warning("PyTorch not available - using placeholder generation")
            return False
            
        if self.pipe_name == pipeline_name and self.pipe is not None:
            return True
        
        try:
            self.unload_pipeline()
            
            dtype = torch.float32 if self.gpu_manager.device == "cpu" else self.gpu_manager.dtype
            
            from diffusers import AutoPipelineForText2Image
            
            self.pipe = AutoPipelineForText2Image.from_pretrained(
                pipeline_name,
                torch_dtype=dtype,
                cache_dir=str(self.models_dir),
                safety_checker=None,
                requires_safety_checker=False,
            )
            
            if self.enable_cpu_offload and self.gpu_manager.device == "cuda":
                self.pipe.enable_model_cpu_offload()
            else:
                self.pipe = self.pipe.to(self.gpu_manager.device)
            
            self.pipe_name = pipeline_name
            logger.info(f"Loaded pipeline: {pipeline_name}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to load pipeline: {e}")
            self.gpu_manager.clear_cache()
            self.pipe = None
            return False
    
    def unload_pipeline(self):
        if self.pipe is not None:
            del self.pipe
            self.pipe = None
            self.pipe_name = None
            self.gpu_manager.clear_cache()
    
    def generate_frame(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: int = 512,
        height: int = 512,
        num_inference_steps: int = 25,
        guidance_scale: float = 7.5,
        seed: int = 42,
    ) -> Optional[Any]:
        if not TORCH_AVAILABLE:
            return self._create_placeholder_frame(width, height, seed)
            
        if self.pipe is None:
            if not self.load_pipeline():
                return self._create_placeholder_frame(width, height, seed)
        
        try:
            generator = torch.Generator(device=self.gpu_manager.device).manual_seed(seed)
            
            with torch.no_grad():
                result = self.pipe(
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    width=width,
                    height=height,
                    num_inference_steps=num_inference_steps,
                    guidance_scale=guidance_scale,
                    generator=generator,
                )
            
            return result.images[0]
            
        except Exception as e:
            logger.error(f"Generation error: {e}")
            self.gpu_manager.clear_cache()
            return self._create_placeholder_frame(width, height, seed)
    
    def _create_placeholder_frame(self, width: int, height: int, seed: int):
        from PIL import Image
        import hashlib
        
        hash_val = int(hashlib.md5(str(seed).encode()).hexdigest()[:8], 16)
        
        r = (hash_val >> 16) & 0xFF
        g = (hash_val >> 8) & 0xFF
        b = hash_val & 0xFF
        
        r = max(20, min(180, r))
        g = max(20, min(180, g))
        b = max(40, min(200, b))
        
        return Image.new("RGB", (width, height), (r, g, b))
    
    def generate_clip_frames(
        self,
        prompt: str,
        negative_prompt: str,
        num_frames: int = 24,
        width: int = 512,
        height: int = 512,
        seed: int = 42,
        guidance_scale: float = 7.5,
    ) -> List[Any]:
        frames = []
        base_seed = seed
        
        for i in range(num_frames):
            frame_seed = base_seed + i
            
            frame = self.generate_frame(
                prompt=prompt,
                negative_prompt=negative_prompt,
                width=width,
                height=height,
                seed=frame_seed,
                guidance_scale=guidance_scale,
            )
            
            if frame is not None:
                frames.append(frame)
            else:
                from PIL import Image
                frames.append(Image.new("RGB", (width, height), (30, 30, 50)))
        
        return frames
    
    def cleanup(self):
        self.unload_pipeline()
        self.gpu_manager.clear_cache()


class CloudVideoGenerator:
    """Cloud-based video generator using free APIs (Cloudflare + Pollinations)."""

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.resolution = config.get("resolution", "1024x576")
        self.image_model = config.get("image_model", "flux-realism")
        self.cloud = None

    def _get_cloud(self):
        if self.cloud is None:
            from .cloud_gpu import CloudImageGenerator
            self.cloud = CloudImageGenerator(self.config)
        return self.cloud

    def generate_frame(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 576,
        num_inference_steps: int = 4,
        guidance_scale: float = 7.5,
        seed: int = 42,
        model: Optional[str] = None,
    ) -> Optional[Any]:
        from PIL import Image

        cloud = self._get_cloud()
        use_model = model or self.image_model

        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    img_bytes = pool.submit(
                        asyncio.run,
                        cloud.generate_image(
                            prompt=prompt, negative_prompt=negative_prompt,
                            width=width, height=height, seed=seed, model=use_model,
                        ),
                    ).result(timeout=180)
            else:
                img_bytes = loop.run_until_complete(
                    cloud.generate_image(
                        prompt=prompt, negative_prompt=negative_prompt,
                        width=width, height=height, seed=seed, model=use_model,
                    )
                )
        except Exception:
            img_bytes = asyncio.run(
                cloud.generate_image(
                    prompt=prompt, negative_prompt=negative_prompt,
                    width=width, height=height, seed=seed, model=use_model,
                )
            )

        if img_bytes:
            return Image.open(io.BytesIO(img_bytes)).convert("RGB")

        return self._create_fallback_frame(width, height, seed)

    def generate_shot_image(
        self,
        prompt: str,
        output_path: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 576,
        seed: int = 42,
        model: Optional[str] = None,
    ) -> bool:
        frame = self.generate_frame(
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            seed=seed,
            model=model,
        )
        if frame:
            frame.save(output_path, "PNG")
            return True
        return False

    def _create_fallback_frame(self, width: int, height: int, seed: int):
        from PIL import Image, ImageDraw, ImageFont
        import hashlib

        hash_val = int(hashlib.md5(str(seed).encode()).hexdigest()[:8], 16)
        r = max(30, min(160, (hash_val >> 16) & 0xFF))
        g = max(30, min(160, (hash_val >> 8) & 0xFF))
        b = max(50, min(200, hash_val & 0xFF))

        img = Image.new("RGB", (width, height), (r, g, b))
        draw = ImageDraw.Draw(img)
        draw.text((width // 4, height // 2), "TTV", fill=(255, 255, 255))
        return img

    def generate_clip_frames(
        self,
        prompt: str,
        negative_prompt: str,
        num_frames: int = 24,
        width: int = 512,
        height: int = 512,
        seed: int = 42,
        guidance_scale: float = 7.5,
    ) -> List[Any]:
        frame = self.generate_frame(
            prompt=prompt, negative_prompt=negative_prompt,
            width=width, height=height, seed=seed,
            guidance_scale=guidance_scale,
        )

        if frame is None:
            from PIL import Image
            frame = Image.new("RGB", (width, height), (30, 30, 50))

        return [frame.copy() for _ in range(num_frames)]

    def cleanup(self):
        self.cloud = None


class VoiceoverGenerator:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.language = config.get("language", "en")
        self.gender = config.get("gender", "female")
        self.voice = config.get("voice", None)
        self.rate = config.get("rate", "+0%")
    
    def generate_audio(self, text: str, output_path: str) -> bool:
        try:
            from .tts_manager import generate_speech
            return asyncio.run(generate_speech(
                text=text,
                voice=self.voice,
                language=self.language,
                gender=self.gender,
                output_path=output_path,
                rate=self.rate,
            ))
        except Exception as e:
            logger.error(f"Voiceover generation error: {e}")
            return False
    
    def cleanup(self):
        pass


class MusicManager:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.music_dir = Path(config.get("music_dir", "assets/music"))
        self.music_dir.mkdir(parents=True, exist_ok=True)
        
        self.music_library = self._build_music_library()
    
    def _build_music_library(self) -> Dict[str, str]:
        library = {}
        
        music_files = list(self.music_dir.glob("*.mp3")) + list(self.music_dir.glob("*.wav"))
        for f in music_files:
            name = f.stem.lower()
            library[name] = str(f)
        
        default_tracks = {
            "ambient": "soft ambient",
            "melancholic piano": "melancholic piano",
            "upbeat orchestral": "upbeat orchestral",
            "dramatic tension": "dramatic tension",
            "romantic strings": "romantic strings",
            "mysterious ambient": "mysterious ambient",
            "nature ambient": "nature ambient",
            "urban ambient": "urban ambient",
            "soft ambient": "soft ambient",
        }
        
        for key, value in default_tracks.items():
            if key not in library:
                library[key] = value
        
        return library
    
    def get_music_path(self, music_type: str) -> Optional[str]:
        music_type_lower = music_type.lower()
        
        if music_type_lower in self.music_library:
            path = self.music_library[music_type_lower]
            if os.path.exists(path):
                return path
        
        for key, path in self.music_library.items():
            if key in music_type_lower or music_type_lower in key:
                if os.path.exists(path):
                    return path
        
        return None
    
    def generate_silence(self, duration: float, output_path: str) -> bool:
        try:
            import numpy as np
            import soundfile as sf
            
            sample_rate = 44100
            samples = int(duration * sample_rate)
            silence = np.zeros(samples, dtype=np.float32)
            
            sf.write(output_path, silence, sample_rate)
            return True
            
        except Exception as e:
            logger.error(f"Failed to generate silence: {e}")
            return False


class FFmpegProcessor:
    def __init__(self):
        self.ffmpeg_path = self._find_ffmpeg()
    
    def _find_ffmpeg(self) -> str:
        try:
            import imageio_ffmpeg
            return imageio_ffmpeg.get_ffmpeg_exe()
        except ImportError:
            pass
        
        try:
            result = subprocess.run(
                ["ffmpeg", "-version"],
                capture_output=True,
                timeout=5
            )
            if result.returncode == 0:
                return "ffmpeg"
        except:
            pass
        
        raise RuntimeError("FFmpeg not found. Install ffmpeg or imageio-ffmpeg.")
    
    def create_video_from_frames(
        self,
        frames,
        output_path: str,
        fps: int = 24,
        codec: str = "libx264",
        crf: int = 18,
    ) -> bool:
        try:
            import tempfile
            import numpy as np
            from PIL import Image
            
            with tempfile.TemporaryDirectory() as tmpdir:
                for i, frame in enumerate(frames):
                    if isinstance(frame, Image.Image):
                        frame_array = np.array(frame)
                    else:
                        frame_array = frame
                    
                    frame_path = os.path.join(tmpdir, f"frame_{i:04d}.png")
                    Image.fromarray(frame_array).save(frame_path)
                
                cmd = [
                    self.ffmpeg_path, "-y",
                    "-framerate", str(fps),
                    "-i", os.path.join(tmpdir, "frame_%04d.png"),
                    "-c:v", codec,
                    "-crf", str(crf),
                    "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart",
                    output_path
                ]
                
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
                return result.returncode == 0 and os.path.exists(output_path)
                
        except Exception as e:
            logger.error(f"Video creation error: {e}")
            return False
    
    def concatenate_videos(
        self,
        input_paths: List[str],
        output_path: str,
        transition_type: str = "cross_dissolve",
        transition_duration: float = 1.0,
    ) -> bool:
        try:
            if len(input_paths) == 0:
                return False
            
                if len(input_paths) == 1:
                    cmd = [
                        self.ffmpeg_path, "-y",
                        "-i", input_paths[0],
                        "-c:v", "libx264",
                        "-preset", "slow",
                        "-crf", "16",
                        "-c:a", "aac", "-b:a", "320k", "-ar", "44100", "-ac", "2",
                        "-pix_fmt", "yuv420p",
                        "-movflags", "+faststart",
                        output_path
                    ]
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
                return result.returncode == 0 and os.path.exists(output_path)
            
            import tempfile
            
            with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
                concat_list = f.name
                for path in input_paths:
                    f.write(f"file '{path}'\n")
            
            cmd = [
                self.ffmpeg_path, "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", concat_list,
                "-c:v", "libx264",
                "-preset", "slow",
                "-crf", "16",
                "-c:a", "aac",
                "-b:a", "320k",
                "-ar", "44100",
                "-ac", "2",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                output_path
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            
            try:
                os.unlink(concat_list)
            except:
                pass
            
            if result.returncode != 0:
                logger.error(f"FFmpeg concat error: {result.stderr[:500]}")
            
            return result.returncode == 0 and os.path.exists(output_path)
            
        except Exception as e:
            logger.error(f"Video concatenation error: {e}")
            return False
    
    def _build_transition_cmd(
        self,
        input_paths: List[str],
        output_path: str,
        transition_type: str,
        duration: float,
    ) -> List[str]:
        inputs = []
        for path in input_paths:
            inputs.extend(["-i", path])
        
        n = len(input_paths)
        
        clip_durations = []
        for path in input_paths:
            d = self.get_duration(path)
            clip_durations.append(d if d > 0 else 5.0)
        
        min_clip_duration = min(clip_durations) if clip_durations else 5.0
        effective_transition = min(duration, min_clip_duration * 0.4)
        
        if effective_transition < 0.1 or n < 2:
            cmd = [self.ffmpeg_path, "-y"] + inputs + [
                "-filter_complex", f"concat=n={n}:v=1:a=0[out]",
                "-map", "[out]",
                "-c:v", "libx264",
                "-crf", "18",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                output_path
            ]
            return cmd
        
        filter_parts = []
        
        for i in range(n):
            filter_parts.append(f"[{i}:v]setpts=PTS-STARTPTS[v{i}]")
        
        xfade_expr = transition_type
        if transition_type == "cross_dissolve":
            xfade_expr = "fade"
        
        current = "v0"
        for i in range(1, n):
            offset = sum(clip_durations[:i]) - (effective_transition * i)
            offset = max(0.1, offset)
            out_label = f"v{i}"
            filter_parts.append(
                f"[{current}][v{i}]xfade=transition={xfade_expr}:duration={effective_transition}:offset={offset}[{out_label}]"
            )
            current = out_label
        
        filter_complex = ";".join(filter_parts)
        
        cmd = [self.ffmpeg_path, "-y"] + inputs + [
            "-filter_complex", filter_complex,
            "-map", f"[{current}]",
            "-c:v", "libx264",
            "-crf", "18",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            output_path
        ]
        
        return cmd
    
    def add_audio(
        self,
        video_path: str,
        audio_path: str,
        output_path: str,
        audio_codec: str = "aac",
        audio_bitrate: str = "192k",
    ) -> bool:
        try:
            v_dur = self.get_duration(video_path)
            a_dur = self.get_duration(audio_path)
            dur = max(v_dur, a_dur) if a_dur else v_dur
            cmd = [
                self.ffmpeg_path, "-y",
                "-stream_loop", "-1",
                "-i", video_path,
                "-i", audio_path,
                "-filter_complex",
                f"[0:v]setpts=PTS-STARTPTS[v];[1:a]atrim=duration={dur},asetpts=PTS-STARTPTS[a]",
                "-map", "[v]", "-map", "[a]",
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
                "-c:a", audio_codec,
                "-b:a", audio_bitrate,
                "-t", str(dur),
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                output_path
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if result.returncode != 0:
                cmd_simple = [
                    self.ffmpeg_path, "-y",
                    "-i", video_path,
                    "-i", audio_path,
                    "-map", "0:v",
                    "-map", "1:a",
                    "-c:v", "copy",
                    "-c:a", audio_codec,
                    "-b:a", audio_bitrate,
                    "-movflags", "+faststart",
                    output_path
                ]
                result = subprocess.run(cmd_simple, capture_output=True, text=True, timeout=120)
            return result.returncode == 0 and os.path.exists(output_path)
            
        except Exception as e:
            logger.error(f"Audio mixing error: {e}")
            return False
    
    def add_subtitles(
        self,
        video_path: str,
        subtitle_path: str,
        output_path: str,
    ) -> bool:
        try:
            cmd = [
                self.ffmpeg_path, "-y",
                "-i", video_path,
                "-vf", f"subtitles={subtitle_path}:force_style='FontSize=24,PrimaryColour=&Hffffff,OutlineColour=&H000000,Outline=2'",
                "-c:v", "libx264",
                "-crf", "18",
                "-c:a", "copy",
                "-movflags", "+faststart",
                output_path
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            return result.returncode == 0 and os.path.exists(output_path)
            
        except Exception as e:
            logger.error(f"Subtitle error: {e}")
            return False
    
    def concatenate_audio(
        self,
        audio_paths: List[str],
        output_path: str,
        crossfade: float = 0.0,
    ) -> bool:
        try:
            inputs = []
            for path in audio_paths:
                inputs.extend(["-i", path])
            
            n = len(audio_paths)
            
            if n == 1:
                cmd = [self.ffmpeg_path, "-y"] + inputs + [
                    "-c:a", "libmp3lame",
                    "-b:a", "192k",
                    output_path
                ]
            else:
                filter_complex = f"concat=n={n}:v=0:a=1[out]"
                cmd = [self.ffmpeg_path, "-y"] + inputs + [
                    "-filter_complex", filter_complex,
                    "-map", "[out]",
                    "-c:a", "libmp3lame",
                    "-b:a", "192k",
                    output_path
                ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            return result.returncode == 0
            
        except Exception as e:
            logger.error(f"Audio concatenation error: {e}")
            return False
    
    def get_duration(self, file_path: str) -> float:
        try:
            cmd = [
                self.ffmpeg_path,
                "-i", file_path,
                "-f", "null",
                "-"
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            
            for line in result.stderr.split('\n'):
                if 'Duration:' in line:
                    duration_str = line.split('Duration:')[1].split(',')[0].strip()
                    parts = duration_str.split(':')
                    return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
            
            return 0.0
            
        except Exception as e:
            logger.error(f"Duration check error: {e}")
            return 0.0
    
    def upscale_video(
        self,
        input_path: str,
        output_path: str,
        scale_factor: int = 2,
    ) -> bool:
        try:
            cmd = [
                self.ffmpeg_path, "-y",
                "-i", input_path,
                "-vf", f"scale=iw*{scale_factor}:ih*{scale_factor}:flags=lanczos",
                "-c:v", "libx264",
                "-crf", "18",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                output_path
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            return result.returncode == 0 and os.path.exists(output_path)
            
        except Exception as e:
            logger.error(f"Upscaling error: {e}")
            return False

    def create_ken_burns_clip(
        self,
        image_path: str,
        output_path: str,
        duration: float = 10.0,
        width: int = 512,
        height: int = 512,
        fps: int = 24,
    ) -> bool:
        try:
            total_frames = int(duration * fps)
            
            scale_w = f"2*trunc({width}*(1.0+0.15*t/{duration})/2)"
            scale_h = f"2*trunc({height}*(1.0+0.15*t/{duration})/2)"
            
            filters = [
                f"scale=w='{scale_w}':h='{scale_h}':eval=frame",
                f"crop={width}:{height}:'(in_w-out_w)/2':'(in_h-out_h)/2'",
                "format=yuv420p",
            ]
            
            cmd = [
                self.ffmpeg_path, "-y",
                "-loop", "1",
                "-i", image_path,
                "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                "-vf", ",".join(filters),
                "-t", str(duration),
                "-c:v", "libx264",
                "-preset", "slow",
                "-crf", "16",
                "-c:a", "aac",
                "-b:a", "320k",
                "-shortest",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                output_path
            ]
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            
            if result.returncode != 0:
                logger.warning(f"Ken Burns failed, trying simple zoom: {result.stderr[:200]}")
                
                cmd_simple = [
                    self.ffmpeg_path, "-y",
                    "-loop", "1",
                    "-i", image_path,
                    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                    "-vf", f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
                    "-t", str(duration),
                    "-c:v", "libx264",
                    "-preset", "slow",
                    "-crf", "16",
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac",
                    "-b:a", "320k",
                    "-shortest",
                    "-movflags", "+faststart",
                    output_path
                ]
                
                result = subprocess.run(cmd_simple, capture_output=True, text=True, timeout=60)
            
            return result.returncode == 0 and os.path.exists(output_path)
            
        except Exception as e:
            logger.error(f"Ken Burns error: {e}")
            return False

    def create_multi_shot_clip(
        self,
        image_paths: List[str],
        output_path: str,
        total_duration: float = 30.0,
        width: int = 1024,
        height: int = 576,
        fps: int = 24,
        crossfade: float = 0.5,
    ) -> bool:
        try:
            import tempfile
            
            num_shots = len(image_paths)
            if num_shots == 0:
                return False
            
            if num_shots == 1:
                return self.create_ken_burns_clip(
                    image_paths[0], output_path, total_duration, width, height, fps
                )
            
            shot_duration = total_duration / num_shots
            temp_clips = []
            
            with tempfile.TemporaryDirectory() as tmpdir:
                for i, img_path in enumerate(image_paths):
                    clip_path = os.path.join(tmpdir, f"shot_{i:03d}.mp4")
                    style_idx = i % 4
                    if style_idx == 0:
                        zoom_expr = f"(1.0+0.15*t/{shot_duration})"
                        crop_x = "(in_w-out_w)/2"
                        crop_y = "(in_h-out_h)/2"
                    elif style_idx == 1:
                        zoom_expr = f"(1.15-0.15*t/{shot_duration})"
                        crop_x = "(in_w-out_w)/2"
                        crop_y = "(in_h-out_h)/2"
                    elif style_idx == 2:
                        zoom_expr = f"(1.0+0.10*t/{shot_duration})"
                        crop_x = "0"
                        crop_y = "0"
                    else:
                        zoom_expr = f"(1.10-0.10*t/{shot_duration})"
                        crop_x = "in_w-out_w"
                        crop_y = "in_h-out_h"

                    scale_w = f"2*trunc({width}*{zoom_expr}/2)"
                    scale_h = f"2*trunc({height}*{zoom_expr}/2)"
                    total_frames = int(shot_duration * fps)
                    
                    filters = [
                        f"scale=w='{scale_w}':h='{scale_h}':eval=frame",
                        f"crop={width}:{height}:'{crop_x}':'{crop_y}'",
                        "format=yuv420p",
                    ]
                    
                    cmd = [
                        self.ffmpeg_path, "-y",
                        "-loop", "1",
                        "-i", img_path,
                        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                        "-vf", ",".join(filters),
                        "-t", str(shot_duration),
                        "-c:v", "libx264",
                        "-preset", "slow",
                        "-crf", "16",
                        "-c:a", "aac",
                        "-b:a", "320k",
                        "-shortest",
                        "-pix_fmt", "yuv420p",
                        "-movflags", "+faststart",
                        clip_path,
                    ]
                    
                    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
                    
                    if result.returncode != 0:
                        cmd_simple = [
                            self.ffmpeg_path, "-y",
                            "-loop", "1",
                            "-i", img_path,
                            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                            "-vf", f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
                            "-t", str(shot_duration),
                            "-c:v", "libx264", "-preset", "slow", "-crf", "16",
                            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "320k",
                            "-shortest", "-movflags", "+faststart", clip_path,
                        ]
                        result = subprocess.run(cmd_simple, capture_output=True, text=True, timeout=60)
                    
                    if result.returncode == 0 and os.path.exists(clip_path):
                        temp_clips.append(clip_path)
                    else:
                        fallback = os.path.join(tmpdir, f"fallback_{i:03d}.mp4")
                        cmd_fb = [
                            self.ffmpeg_path, "-y",
                            "-f", "lavfi", "-i",
                            f"color=c=0x1e1b4b:s={width}x{height}:d={shot_duration}:r={fps},format=yuv420p",
                            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                            "-t", str(shot_duration),
                            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
                            "-c:a", "aac", "-b:a", "128k",
                            "-pix_fmt", "yuv420p", "-movflags", "+faststart", fallback,
                        ]
                        subprocess.run(cmd_fb, capture_output=True, text=True, timeout=30)
                        if os.path.exists(fallback):
                            temp_clips.append(fallback)
                
                if not temp_clips:
                    return False
                
                if len(temp_clips) == 1:
                    import shutil
                    shutil.copy2(temp_clips[0], output_path)
                    return True
                
                with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
                    concat_list = f.name
                    for path in temp_clips:
                        f.write(f"file '{path}'\n")
                
                cmd = [
                    self.ffmpeg_path, "-y",
                    "-f", "concat",
                    "-safe", "0",
                    "-i", concat_list,
                    "-c:v", "libx264",
                    "-preset", "slow",
                    "-crf", "16",
                    "-c:a", "aac",
                    "-b:a", "320k",
                    "-ar", "44100",
                    "-ac", "2",
                    "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart",
                    output_path,
                ]
                
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
                
                try:
                    os.unlink(concat_list)
                except:
                    pass
                
                if result.returncode != 0:
                    logger.error(f"Multi-shot concat failed: {result.stderr[:300]}")
                    return False
                
                return os.path.exists(output_path)
        
        except Exception as e:
            logger.error(f"Multi-shot Ken Burns error: {e}")
            return False

    def trim_video(self, input_path: str, output_path: str, start_time: float = 0, end_time: float = -1) -> bool:
        try:
            cmd = [self.ffmpeg_path, "-y", "-i", input_path]
            if start_time > 0:
                cmd.extend(["-ss", str(start_time)])
            if end_time > 0:
                cmd.extend(["-to", str(end_time)])
            cmd.extend([
                "-c:v", "libx264", "-crf", "18", "-preset", "medium",
                "-c:a", "aac", "-b:a", "192k",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                output_path
            ])
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            return result.returncode == 0 and os.path.exists(output_path)
        except Exception as e:
            logger.error(f"Trim error: {e}")
            return False

    def change_speed(self, input_path: str, output_path: str, speed: float = 1.0) -> bool:
        try:
            if abs(speed - 1.0) < 0.01:
                import shutil
                shutil.copy2(input_path, output_path)
                return True
            video_filter = f"setpts={1/speed}*PTS"
            audio_filter = f"atempo={speed}" if 0.5 <= speed <= 2.0 else (
                f"atempo=0.5,atempo={speed/0.5}" if speed < 0.5 else
                f"atempo=2.0,atempo={speed/2.0}"
            )
            cmd = [
                self.ffmpeg_path, "-y", "-i", input_path,
                "-vf", video_filter,
                "-af", audio_filter,
                "-c:v", "libx264", "-crf", "18", "-preset", "medium",
                "-c:a", "aac", "-b:a", "192k",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                output_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            return result.returncode == 0 and os.path.exists(output_path)
        except Exception as e:
            logger.error(f"Speed change error: {e}")
            return False

    def apply_color_grading(self, input_path: str, output_path: str,
                           brightness: float = 0, contrast: float = 1.0,
                           saturation: float = 1.0, temperature: float = 0) -> bool:
        try:
            filters = []
            if abs(brightness) > 0.01:
                filters.append(f"eq=brightness={brightness}")
            if abs(contrast - 1.0) > 0.01:
                filters.append(f"eq=contrast={contrast}")
            if abs(saturation - 1.0) > 0.01:
                filters.append(f"eq=saturation={saturation}")
            if abs(temperature) > 0.01:
                r_adj = 1.0 + temperature * 0.1
                b_adj = 1.0 - temperature * 0.1
                filters.append(f"colorbalance=rs={temperature*0.1}:bs={-temperature*0.1}")
            if not filters:
                import shutil
                shutil.copy2(input_path, output_path)
                return True
            cmd = [
                self.ffmpeg_path, "-y", "-i", input_path,
                "-vf", ",".join(filters),
                "-c:v", "libx264", "-crf", "18", "-preset", "medium",
                "-c:a", "copy",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                output_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            return result.returncode == 0 and os.path.exists(output_path)
        except Exception as e:
            logger.error(f"Color grading error: {e}")
            return False

    def add_text_overlay(self, input_path: str, output_path: str,
                        text: str, x: str = "50%", y: str = "90%",
                        font_size: int = 24, font_color: str = "white",
                        bg_color: str = "black@0.5", start_time: float = 0,
                        end_time: float = -1) -> bool:
        try:
            escaped = text.replace("'", "\\'").replace(":", "\\:")
            drawtext = f"drawtext=text='{escaped}':fontsize={font_size}:fontcolor={font_color}"
            drawtext += f":box=1:boxcolor={bg_color}:boxborderw=8"
            if x.endswith('%'):
                drawtext += f":x=(w-text_w)*{float(x[:-1])/100}"
            else:
                drawtext += f":x={x}"
            if y.endswith('%'):
                drawtext += f":y=(h-text_h)*{float(y[:-1])/100}"
            else:
                drawtext += f":y={y}"
            if start_time > 0 or end_time > 0:
                enable = f"between(t,{start_time},{end_time if end_time > 0 else 9999})"
                drawtext += f":enable='{enable}'"
            cmd = [
                self.ffmpeg_path, "-y", "-i", input_path,
                "-vf", drawtext,
                "-c:v", "libx264", "-crf", "18", "-preset", "medium",
                "-c:a", "copy",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                output_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            return result.returncode == 0 and os.path.exists(output_path)
        except Exception as e:
            logger.error(f"Text overlay error: {e}")
            return False

    def apply_transition(self, clip_a: str, clip_b: str, output_path: str,
                        transition_type: str = "fade", duration: float = 0.5) -> bool:
        try:
            dur_a = self.get_duration(clip_a)
            offset = max(0.1, dur_a - duration)
            xfade_map = {
                "fade": "fade", "dissolve": "dissolve",
                "wipe-left": "wipeleft", "wipe-right": "wiperight",
                "slide-left": "slideleft", "slide-right": "slideright",
                "zoom-in": "smoothup", "zoom-out": "smoothdown",
            }
            xfade = xfade_map.get(transition_type, "fade")
            cmd = [
                self.ffmpeg_path, "-y",
                "-i", clip_a, "-i", clip_b,
                "-filter_complex",
                f"[0:v][1:v]xfade=transition={xfade}:duration={duration}:offset={offset}[v];[0:a][1:a]acrossfade=d={duration}[a]",
                "-map", "[v]", "-map", "[a]",
                "-c:v", "libx264", "-crf", "16", "-preset", "slow",
                "-c:a", "aac", "-b:a", "320k", "-ar", "44100", "-ac", "2",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                output_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if result.returncode != 0:
                return self.concatenate_videos([clip_a, clip_b], output_path)
            return os.path.exists(output_path)
        except Exception as e:
            logger.error(f"Transition error: {e}")
            return False

    def mix_audio_tracks(self, video_path: str, audio_tracks: list, output_path: str,
                        master_volume: float = 1.0) -> bool:
        try:
            if not audio_tracks:
                import shutil
                shutil.copy2(video_path, output_path)
                return True
            inputs = ["-i", video_path]
            filter_parts = []
            mix_inputs = "[0:a]"
            for i, track in enumerate(audio_tracks):
                inputs.extend(["-i", track["path"]])
                vol = track.get("volume", 1.0)
                duck = track.get("duck", False)
                loop = track.get("loop", False)
                if loop:
                    if duck:
                        filter_parts.append(f"[{i+1}:a]aloop=loop=-1:size=2e+09,volume={vol},sidechaincompress=threshold=0.02:ratio=4:attack=5:release=500[a{i}]")
                    else:
                        filter_parts.append(f"[{i+1}:a]aloop=loop=-1:size=2e+09,volume={vol}[a{i}]")
                else:
                    if duck:
                        filter_parts.append(f"[{i+1}:a]volume={vol},sidechaincompress=threshold=0.02:ratio=4:attack=5:release=500[a{i}]")
                    else:
                        filter_parts.append(f"[{i+1}:a]volume={vol}[a{i}]")
                mix_inputs += f"[a{i}]"
            n = len(audio_tracks) + 1
            filter_parts.append(f"{mix_inputs}amix=inputs={n}:duration=first:dropout_transition=2[out]")
            filter_complex = ";".join(filter_parts)
            cmd = [
                self.ffmpeg_path, "-y",
            ] + inputs + [
                "-filter_complex", filter_complex,
                "-map", "0:v", "-map", "[out]",
                "-c:v", "copy",
                "-c:a", "aac", "-b:a", "320k", "-ar", "44100", "-ac", "2",
                "-movflags", "+faststart",
                output_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            return result.returncode == 0 and os.path.exists(output_path)
        except Exception as e:
            logger.error(f"Audio mix error: {e}")
            return False

    def mix_audio_timed(self, video_path: str, timed_tracks: list, output_path: str) -> bool:
        try:
            if not timed_tracks:
                import shutil
                shutil.copy2(video_path, output_path)
                return True
            dur = self.get_duration(video_path)
            inputs = ["-i", video_path]
            filter_parts = []
            audio_labels = []
            for i, track in enumerate(timed_tracks):
                inputs.extend(["-i", track["path"]])
                vol = track.get("volume", 1.0)
                start = track.get("start", 0)
                loop = track.get("loop", False)
                delay_ms = int(start * 1000)
                parts = []
                if loop:
                    parts.append(f"aloop=loop=-1:size=2e+09")
                if delay_ms > 0:
                    parts.append(f"adelay={delay_ms}|{delay_ms}")
                parts.append(f"volume={vol}")
                parts.append(f"atrim=0:{dur}")
                filter_parts.append(f"[{i+1}:a]{','.join(parts)}[a{i}]")
                audio_labels.append(f"[a{i}]")
            all_labels = "[0:a]" + "".join(audio_labels)
            n = len(timed_tracks) + 1
            filter_parts.append(f"{all_labels}amix=inputs={n}:duration=first:dropout_transition=2:normalize=0[out]")
            filter_complex = ";".join(filter_parts)
            cmd = [
                self.ffmpeg_path, "-y",
            ] + inputs + [
                "-filter_complex", filter_complex,
                "-map", "0:v", "-map", "[out]",
                "-c:v", "copy",
                "-c:a", "aac", "-b:a", "320k", "-ar", "44100", "-ac", "2",
                "-shortest",
                "-movflags", "+faststart",
                output_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            if result.returncode != 0:
                logger.error(f"mix_audio_timed failed: {result.stderr[:300]}")
            return result.returncode == 0 and os.path.exists(output_path)
        except Exception as e:
            logger.error(f"mix_audio_timed error: {e}")
            return False

    def render_clip(self, source_path: str, output_path: str, duration: float,
                   speed: float = 1.0, trim_start: float = 0, trim_end: float = 0,
                   volume: float = 1.0, width: int = 1920, height: int = 1080,
                   brightness: float = 0, contrast: float = 1.0, saturation: float = 1.0,
                   temperature: float = 0, is_image: bool = False,
                   progress_callback=None) -> bool:
        import tempfile

        def _cb(msg):
            if progress_callback:
                try:
                    progress_callback(msg)
                except:
                    pass

        try:
            if not os.path.exists(source_path):
                _cb(f"Source file missing: {source_path}")
                return False
            ext = os.path.splitext(source_path)[1].lower()
            is_src_image = ext in ('.png', '.jpg', '.jpeg', '.webp', '.bmp')
            work_path = source_path
            with tempfile.TemporaryDirectory() as tmpdir:
                if is_src_image and is_image:
                    _cb("Applying Ken Burns animation...")
                    kb_out = os.path.join(tmpdir, "kb.mp4")
                    self.create_ken_burns_clip(source_path, kb_out, duration, width, height, fps=30)
                    work_path = kb_out
                if trim_start > 0.01 or trim_end > 0.01:
                    _cb("Trimming clip...")
                    trimmed = os.path.join(tmpdir, "trimmed.mp4")
                    dur = self.get_duration(work_path)
                    end = dur - trim_end if trim_end > 0.01 else -1
                    self.trim_video(work_path, trimmed, start_time=trim_start, end_time=end)
                    work_path = trimmed
                if abs(speed - 1.0) > 0.01:
                    _cb("Adjusting speed...")
                    sped = os.path.join(tmpdir, "speed.mp4")
                    self.change_speed(work_path, sped, speed)
                    work_path = sped
                if abs(brightness) > 0.01 or abs(contrast - 1.0) > 0.01 or abs(saturation - 1.0) > 0.01 or abs(temperature) > 0.01:
                    _cb("Applying color grading...")
                    graded = os.path.join(tmpdir, "graded.mp4")
                    self.apply_color_grading(work_path, graded, brightness, contrast, saturation, temperature)
                    work_path = graded
                if abs(volume - 1.0) > 0.01:
                    _cb("Adjusting volume...")
                    vol_out = os.path.join(tmpdir, "vol.mp4")
                    cmd = [
                        self.ffmpeg_path, "-y", "-i", work_path,
                        "-af", f"volume={volume}",
                        "-c:v", "copy",
                        "-c:a", "aac", "-b:a", "192k",
                        "-movflags", "+faststart", vol_out
                    ]
                    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
                    if result.returncode == 0:
                        work_path = vol_out
                _cb("Encoding final clip...")
                scale_filter = f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black"
                if is_src_image:
                    final_cmd = [
                        self.ffmpeg_path, "-y", "-i", work_path,
                        "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=stereo"
                    ]
                    final_cmd += [
                        "-t", str(duration),
                        "-vf", f"{scale_filter},format=yuv420p",
                        "-c:v", "libx264", "-crf", "23", "-preset", "ultrafast",
                        "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
                        "-map", "0:v:0", "-map", "1:a:0",
                        "-pix_fmt", "yuv420p", "-movflags", "+faststart", output_path
                    ]
                else:
                    final_cmd = [
                        self.ffmpeg_path, "-y",
                        "-stream_loop", "-1",
                        "-i", work_path,
                        "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=stereo"
                    ]
                    final_cmd += [
                        "-t", str(duration),
                        "-vf", f"{scale_filter},format=yuv420p",
                        "-c:v", "libx264", "-crf", "23", "-preset", "ultrafast",
                        "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
                        "-map", "0:v:0", "-map", "1:a:0",
                        "-pix_fmt", "yuv420p", "-movflags", "+faststart", output_path
                    ]
                result = subprocess.run(final_cmd, capture_output=True, text=True, timeout=300)
                if result.returncode != 0:
                    _cb(f"FFmpeg encode failed: {result.stderr[:200]}")
                return result.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 1000
        except Exception as e:
            logger.error(f"Render clip error: {e}")
            _cb(f"Error: {str(e)[:200]}")
            return False

    def composite_overlay(self, base_path: str, overlay_path: str, output_path: str,
                         x: str = "50%", y: str = "50%", scale: float = 0.3) -> bool:
        try:
            if x.endswith('%'):
                ox = f"(main_w-overlay_w)*{float(x[:-1])/100}"
            else:
                ox = x
            if y.endswith('%'):
                oy = f"(main_h-overlay_h)*{float(y[:-1])/100}"
            else:
                oy = y
            filter_complex = (
                f"[1:v]scale=iw*{scale}:ih*{scale}[ovr];"
                f"[0:v][ovr]overlay={ox}:{oy}:shortest=1[out]"
            )
            cmd = [
                self.ffmpeg_path, "-y",
                "-i", base_path, "-i", overlay_path,
                "-filter_complex", filter_complex,
                "-map", "[out]", "-map", "0:a?",
                "-c:v", "libx264", "-crf", "18", "-preset", "medium",
                "-c:a", "aac", "-b:a", "192k",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                output_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            return result.returncode == 0 and os.path.exists(output_path)
        except Exception as e:
            logger.error(f"Overlay composite error: {e}")
            return False
