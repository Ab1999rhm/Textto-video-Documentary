import os
import logging
from typing import List, Optional, Dict, Any
from pathlib import Path
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class SubtitleGenerator:
    def __init__(self):
        self.format = "srt"
    
    def generate_srt(
        self,
        scenes: List[Dict[str, Any]],
        output_path: str,
    ) -> bool:
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                current_time = 0.0
                
                for i, scene in enumerate(scenes):
                    duration = scene.get("duration_seconds", 8.0)
                    text = scene.get("voiceover_text", scene.get("description", ""))
                    
                    if not text:
                        current_time += duration
                        continue
                    
                    start_time = self._seconds_to_srt_time(current_time)
                    end_time = self._seconds_to_srt_time(current_time + duration)
                    
                    sentences = self._split_into_sentences(text)
                    
                    if len(sentences) <= 2:
                        f.write(f"{i + 1}\n")
                        f.write(f"{start_time} --> {end_time}\n")
                        f.write(f"{text}\n\n")
                    else:
                        chunk_duration = duration / len(sentences)
                        for j, sentence in enumerate(sentences):
                            chunk_start = current_time + (j * chunk_duration)
                            chunk_end = current_time + ((j + 1) * chunk_duration)
                            
                            f.write(f"{i * 100 + j + 1}\n")
                            f.write(f"{self._seconds_to_srt_time(chunk_start)} --> {self._seconds_to_srt_time(chunk_end)}\n")
                            f.write(f"{sentence}\n\n")
                    
                    current_time += duration
            
            return os.path.exists(output_path)
            
        except Exception as e:
            logger.error(f"SRT generation error: {e}")
            return False
    
    def generate_ass(
        self,
        scenes: List[Dict[str, Any]],
        output_path: str,
        resolution: tuple = (1920, 1080),
    ) -> bool:
        try:
            width, height = resolution
            
            header = f"""[Script Info]
Title: TTV Generated Subtitles
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,10,10,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
            
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(header)
                
                current_time = 0.0
                
                for i, scene in enumerate(scenes):
                    duration = scene.get("duration_seconds", 8.0)
                    text = scene.get("voiceover_text", scene.get("description", ""))
                    
                    if not text:
                        current_time += duration
                        continue
                    
                    start = self._seconds_to_ass_time(current_time)
                    end = self._seconds_to_ass_time(current_time + duration)
                    
                    sentences = self._split_into_sentences(text)
                    
                    if len(sentences) <= 2:
                        f.write(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}\n")
                    else:
                        chunk_duration = duration / len(sentences)
                        for j, sentence in enumerate(sentences):
                            chunk_start = self._seconds_to_ass_time(current_time + (j * chunk_duration))
                            chunk_end = self._seconds_to_ass_time(current_time + ((j + 1) * chunk_duration))
                            f.write(f"Dialogue: 0,{chunk_start},{chunk_end},Default,,0,0,0,,{sentence}\n")
                    
                    current_time += duration
            
            return os.path.exists(output_path)
            
        except Exception as e:
            logger.error(f"ASS generation error: {e}")
            return False
    
    def _split_into_sentences(self, text: str) -> List[str]:
        import re
        sentences = re.split(r'(?<=[.!?])\s+', text)
        return [s.strip() for s in sentences if s.strip()]
    
    def _seconds_to_srt_time(self, seconds: float) -> str:
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millis = int((seconds % 1) * 1000)
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
    
    def _seconds_to_ass_time(self, seconds: float) -> str:
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        centis = int((seconds % 1) * 100)
        return f"{hours}:{minutes:02d}:{secs:02d}.{centis:02d}"


class VideoAssembler:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.output_dir = Path(config.get("output_dir", "output"))
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        from .video_generator import FFmpegProcessor
        self.ffmpeg = FFmpegProcessor()
        self.subtitle_gen = SubtitleGenerator()
    
    def assemble_video(
        self,
        project_id: str,
        scenes: List[Dict[str, Any]],
        clip_paths: List[str],
        audio_paths: Optional[List[str]] = None,
        music_paths: Optional[List[str]] = None,
        output_name: str = "final_video.mp4",
    ) -> Optional[str]:
        try:
            project_dir = self.output_dir / project_id
            project_dir.mkdir(parents=True, exist_ok=True)
            
            temp_dir = project_dir / "temp"
            temp_dir.mkdir(exist_ok=True)
            
            concat_video = str(temp_dir / "concat_video.mp4")
            
            logger.info(f"Concatenating {len(clip_paths)} clips")
            if not self.ffmpeg.concatenate_videos(
                clip_paths,
                concat_video,
                transition_type=self.config.get("transition_type", "cross_dissolve"),
                transition_duration=self.config.get("transition_duration", 1.0),
            ):
                logger.error("Video concatenation failed")
                return None
            
            current_video = concat_video
            
            if self.config.get("enable_voiceover", True) and audio_paths:
                logger.info("Mixing audio")
                mixed_audio = str(temp_dir / "mixed_audio.mp3")
                
                if self.ffmpeg.concatenate_audio(audio_paths, mixed_audio):
                    audio_video = str(temp_dir / "with_audio.mp4")
                    if self.ffmpeg.add_audio(current_video, mixed_audio, audio_video):
                        current_video = audio_video
            
            if self.config.get("enable_subtitles", True):
                logger.info("Generating subtitles")
                srt_path = str(project_dir / "subtitles.srt")
                
                if self.subtitle_gen.generate_srt(scenes, srt_path):
                    subtitled_video = str(temp_dir / "subtitled.mp4")
                    if self.ffmpeg.add_subtitles(current_video, srt_path, subtitled_video):
                        current_video = subtitled_video
            
            if self.config.get("enable_upscaling", False):
                logger.info("Upscaling video")
                upscaled_video = str(temp_dir / "upscaled.mp4")
                if self.ffmpeg.upscale_video(current_video, upscaled_video, scale_factor=2):
                    current_video = upscaled_video
            
            final_path = str(project_dir / output_name)
            
            if current_video != final_path:
                import shutil
                shutil.move(current_video, final_path)
            
            self._cleanup_temp(temp_dir)
            
            if os.path.exists(final_path):
                file_size = os.path.getsize(final_path)
                duration = self.ffmpeg.get_duration(final_path)
                
                logger.info(f"Final video: {final_path} ({file_size / (1024*1024):.1f} MB, {duration:.1f}s)")
                
                return final_path
            
            return None
            
        except Exception as e:
            logger.error(f"Assembly error: {e}")
            return None
    
    def _cleanup_temp(self, temp_dir: Path):
        try:
            for f in temp_dir.glob("*"):
                try:
                    f.unlink()
                except:
                    pass
            try:
                temp_dir.rmdir()
            except:
                pass
        except:
            pass
