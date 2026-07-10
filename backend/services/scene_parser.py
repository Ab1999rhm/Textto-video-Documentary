import re
from typing import List, Tuple, Optional
from ..database import Scene
import hashlib
import random


class SceneParser:
    def __init__(self):
        self.min_scene_duration = 10
        self.max_scene_duration = 30
        self.target_fps = 24
        self.default_shots_per_scene = 3
    
    def parse_script(self, script_text: str, target_duration_seconds: int = 1500, shots_per_scene: int = 3) -> List[dict]:
        paragraphs = self._split_into_scenes(script_text, target_duration_seconds)
        
        if not paragraphs:
            paragraphs = [script_text[:500]] if script_text else ["Default scene"]
        
        scenes = self._create_scenes(paragraphs, target_duration_seconds, shots_per_scene)
        scenes = self._assign_durations(scenes, target_duration_seconds)
        scenes = self._generate_shots(scenes, shots_per_scene)
        
        return scenes
    
    def _split_into_scenes(self, text: str, target_duration: int) -> List[str]:
        text = re.sub(r'\n{3,}', '\n\n', text)
        paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
        
        if len(paragraphs) < 3 and len(text) > 500:
            sentences = re.split(r'(?<=[.!?])\s+', text)
            paragraphs = []
            current = []
            current_len = 0
            
            for sentence in sentences:
                current.append(sentence)
                current_len += len(sentence)
                
                if current_len > 200:
                    paragraphs.append(' '.join(current))
                    current = []
                    current_len = 0
            
            if current:
                paragraphs.append(' '.join(current))
        
        words = len(text.split())
        words_per_minute = 150
        estimated_minutes = words / words_per_minute
        target_minutes = target_duration / 60
        ideal_scenes = max(8, int(target_minutes * 1.5))
        
        if len(paragraphs) < ideal_scenes // 2:
            expanded = []
            for p in paragraphs:
                sentences = re.split(r'(?<=[.!?])\s+', p)
                chunk_size = max(1, len(sentences) // 2)
                for i in range(0, len(sentences), chunk_size):
                    chunk = ' '.join(sentences[i:i+chunk_size])
                    if chunk.strip():
                        expanded.append(chunk.strip())
            paragraphs = expanded if expanded else paragraphs
        
        return paragraphs
    
    def _create_scenes(self, paragraphs: List[str], target_duration: int, shots_per_scene: int) -> List[dict]:
        scenes = []
        
        for i, paragraph in enumerate(paragraphs):
            scene_hash = hashlib.md5(paragraph.encode()).hexdigest()[:8]
            seed = int(scene_hash, 16) % 10000
            
            scene = {
                "scene_number": i + 1,
                "description": paragraph[:800],
                "voiceover_text": paragraph,
                "prompt": "",
                "negative_prompt": "blurry, low quality, artifacts, watermark, text, deformed, disfigured, bad anatomy, extra fingers, mutated hands, low resolution, oversaturated, underexposed",
                "character_tags": self._extract_character_tags(paragraph),
                "environment_tags": self._extract_environment_tags(paragraph),
                "background_music": self._determine_music_type(paragraph),
                "seed": seed,
                "shot_count": shots_per_scene,
                "transition_in": "cross_dissolve" if i > 0 else "fade",
                "transition_out": "cross_dissolve" if i < len(paragraphs) - 1 else "fade",
            }
            scenes.append(scene)
        
        return scenes
    
    def _assign_durations(self, scenes: List[dict], target_duration: int) -> List[dict]:
        num_scenes = len(scenes)
        if num_scenes == 0:
            return scenes
        
        avg_duration = target_duration / num_scenes
        base_duration = max(self.min_scene_duration, min(self.max_scene_duration, int(avg_duration)))
        
        for i, scene in enumerate(scenes):
            text_length = len(scene["voiceover_text"])
            words = len(scene["voiceover_text"].split())
            estimated_speech_duration = words / 2.5
            
            duration = max(self.min_scene_duration, min(self.max_scene_duration, 
                         max(base_duration, int(estimated_speech_duration) + 5)))
            
            minutes = duration // 60
            seconds = duration % 60
            scene["duration"] = f"00:{minutes:02d}:{seconds:02d}"
            scene["duration_seconds"] = duration
        
        return scenes
    
    def _generate_shots(self, scenes: List[dict], shots_per_scene: int) -> List[dict]:
        shot_types = [
            ("wide establishing shot", "wide angle lens, establishing shot, panoramic view, cinematic composition"),
            ("medium shot", "medium shot, eye level, subject centered, natural framing"),
            ("close-up detail shot", "close-up shot, macro detail, shallow depth of field, bokeh background"),
            ("overhead aerial view", "aerial view, bird's eye perspective, top-down angle, vast landscape"),
            ("dramatic low angle", "low angle shot, dramatic upward perspective, powerful composition"),
            ("tracking shot", "dynamic tracking shot, motion blur, cinematic movement, action scene"),
            ("over the shoulder", "over the shoulder perspective, depth of field, character focus"),
            ("extreme close-up", "extreme close-up, intimate framing, emotional detail, texture visible"),
        ]
        
        for scene in scenes:
            description = scene["description"]
            visual_elements = self._extract_visual_elements(description)
            lighting = self._determine_lighting(description)
            mood = self._determine_mood(description)
            
            base_prompt_parts = [
                "cinematic photograph, award-winning documentary photography",
                lighting,
                mood,
                ", ".join(visual_elements[:4]),
                "professional photography, National Geographic style, ultra detailed, 8k"
            ]
            base_prompt = ", ".join([p for p in base_prompt_parts if p])
            
            shots = []
            for j in range(shots_per_scene):
                shot_type, shot_keywords = shot_types[j % len(shot_types)]
                sentences = re.split(r'(?<=[.!?])\s+', description)
                sentence_idx = min(j, len(sentences) - 1) if sentences else 0
                sentence_context = sentences[sentence_idx].strip() if sentences else description[:100]
                
                shot_prompt = f"{base_prompt}, {shot_keywords}, {sentence_context}"
                
                shot = {
                    "id": j,
                    "prompt": shot_prompt,
                    "description": f"Shot {j+1}: {shot_type} - {sentence_context[:100]}",
                    "duration_seconds": scene["duration_seconds"] / shots_per_scene,
                    "image_path": None,
                    "image_status": "pending",
                    "seed": scene["seed"] + j,
                }
                shots.append(shot)
            
            scene["shots"] = shots
            scene["prompt"] = shots[0]["prompt"]
        
        return scenes
    
    def _extract_visual_elements(self, text: str) -> List[str]:
        elements = []
        
        patterns = {
            "people": r'\b(man|woman|child|boy|girl|person|people|figure|character|priest|soldier|farmer|king|queen|doctor|teacher)\b',
            "nature": r'\b(forest|mountain|ocean|river|lake|desert|field|garden|tree|flower|cliff|valley|canyon|waterfall)\b',
            "weather": r'\b(sun|rain|snow|wind|cloud|storm|fog|mist|thunder|lightning)\b',
            "time": r'\b(sunrise|sunset|dawn|dusk|noon|midnight|night|morning|evening|twilight)\b',
            "indoor": r'\b(room|house|building|office|kitchen|bedroom|hall|church|temple|palace|cave)\b',
            "objects": r'\b(car|house|book|letter|fire|candle|table|chair|door|window|sword|shield|boat|ship|horse)\b',
            "landscape": r'\b(landscape|horizon|sky|sea|coast|island|plateau|plain|tundra|glacier)\b',
            "culture": r'\b(temple|church|mosque|market|village|city|town|tower|castle|fortress|ruins)\b',
        }
        
        for category, pattern in patterns.items():
            matches = re.findall(pattern, text, re.IGNORECASE)
            elements.extend(matches[:2])
        
        return list(dict.fromkeys(elements))[:8]
    
    def _extract_character_tags(self, text: str) -> List[str]:
        tags = []
        patterns = [
            r'\b(old|young|elderly|tall|short|large|small|brave|wise|gentle|fierce)\s+(man|woman|person|king|queen|warrior|priest)\b',
            r'\b(wearing|dressed in|clothed in|adorned with)\s+([^,.]+)',
            r'\b(with)\s+(white|black|brown|blonde|red|grey|silver)\s+(hair|beard|eyes|cloak|armor)\b',
        ]
        
        for pattern in patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            for match in matches:
                if isinstance(match, tuple):
                    tags.extend([m for m in match if m])
                else:
                    tags.append(match)
        
        return tags[:5]
    
    def _extract_environment_tags(self, text: str) -> List[str]:
        tags = []
        patterns = [
            r'\b(indoor|outdoor|inside|outside)\b',
            r'\b(day|night|morning|evening|sunset|sunrise|dawn|dusk|twilight)\b',
            r'\b(rain|snow|sunny|cloudy|windy|foggy|misty|stormy)\b',
            r'\b(forest|mountain|beach|city|street|village|countryside|desert|tundra|jungle)\b',
        ]
        
        for pattern in patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            tags.extend(matches)
        
        return list(dict.fromkeys(tags))[:5]
    
    def _determine_music_type(self, text: str) -> str:
        text_lower = text.lower()
        
        if any(w in text_lower for w in ['sad', 'cry', 'death', 'loss', 'grief', 'mourn', 'tragic', 'sorrow']):
            return "melancholic piano"
        elif any(w in text_lower for w in ['happy', 'joy', 'laugh', 'celebrate', 'dance', 'triumph', 'victory']):
            return "upbeat orchestral"
        elif any(w in text_lower for w in ['action', 'chase', 'fight', 'run', 'escape', 'battle', 'war']):
            return "dramatic tension"
        elif any(w in text_lower for w in ['love', 'romance', 'kiss', 'embrace', 'heart']):
            return "romantic strings"
        elif any(w in text_lower for w in ['mystery', 'dark', 'secret', 'shadow', 'night', 'ancient', 'forbidden']):
            return "mysterious ambient"
        elif any(w in text_lower for w in ['nature', 'forest', 'mountain', 'river', 'ocean', 'wildlife']):
            return "nature ambient"
        elif any(w in text_lower for w in ['city', 'street', 'building', 'urban', 'modern']):
            return "urban ambient"
        elif any(w in text_lower for w in ['epic', 'grand', 'majestic', 'legend', 'hero', 'quest']):
            return "epic orchestral"
        else:
            return "soft ambient"
    
    def _determine_lighting(self, text: str) -> str:
        text_lower = text.lower()
        
        if any(w in text_lower for w in ['sunrise', 'sunset', 'golden', 'dawn', 'dusk', 'golden hour']):
            return "golden hour lighting, warm tones"
        elif any(w in text_lower for w in ['night', 'dark', 'moon', 'star', 'midnight', 'midnight']):
            return "dark atmospheric lighting, moonlight"
        elif any(w in text_lower for w in ['bright', 'sunny', 'noon', 'day', 'clear sky']):
            return "bright natural lighting, clear day"
        elif any(w in text_lower for w in ['candle', 'fire', 'lamp', 'glow', 'hearth']):
            return "warm firelight, intimate glow"
        elif any(w in text_lower for w in ['neon', 'city', 'urban', 'street', 'modern']):
            return "urban lighting, mixed color temperature"
        elif any(w in text_lower for w in ['storm', 'rain', 'cloudy', 'overcast']):
            return "overcast diffused lighting, cool tones"
        elif any(w in text_lower for w in ['fog', 'mist', 'haze']):
            return "soft diffused lighting, ethereal"
        else:
            return "soft cinematic lighting, natural tones"
    
    def _determine_camera_angle(self, text: str) -> str:
        text_lower = text.lower()
        
        if any(w in text_lower for w in ['close', 'face', 'eye', 'hand', 'detail', 'intimate']):
            return "close-up shot"
        elif any(w in text_lower for w in ['wide', 'landscape', 'city', 'panorama', 'vista', 'vast']):
            return "wide establishing shot"
        elif any(w in text_lower for w in ['overhead', 'above', 'bird', 'aerial', 'from above']):
            return "aerial overhead shot"
        elif any(w in text_lower for w in ['low', 'ground', 'looking up', 'towering']):
            return "low angle shot"
        elif any(w in text_lower for w in ['tracking', 'following', 'walking', 'running', 'moving']):
            return "tracking shot"
        elif any(w in text_lower for w in ['static', 'still', 'sitting', 'standing', 'quiet']):
            return "static medium shot"
        elif any(w in text_lower for w in ['dramatic', 'epic', 'majestic', 'grand']):
            return "dramatic wide shot"
        else:
            return "medium shot, cinematic"
    
    def _determine_mood(self, text: str) -> str:
        text_lower = text.lower()
        
        if any(w in text_lower for w in ['peaceful', 'calm', 'serene', 'quiet', 'gentle', 'tranquil']):
            return "serene peaceful atmosphere"
        elif any(w in text_lower for w in ['tense', 'nervous', 'anxious', 'worry', 'danger', 'fear']):
            return "tense suspenseful atmosphere"
        elif any(w in text_lower for w in ['dramatic', 'epic', 'grand', 'majestic', 'legendary']):
            return "dramatic epic atmosphere"
        elif any(w in text_lower for w in ['scary', 'fear', 'horror', 'terrify', 'haunted']):
            return "eerie dark atmosphere"
        elif any(w in text_lower for w in ['love', 'warm', 'tender', 'soft', 'affection']):
            return "intimate warm atmosphere"
        elif any(w in text_lower for w in ['joy', 'celebrate', 'happy', 'festive', 'cheerful']):
            return "joyful vibrant atmosphere"
        elif any(w in text_lower for w in ['sad', 'loss', 'grief', 'mourn', 'sorrow']):
            return "somber reflective atmosphere"
        elif any(w in text_lower for w in ['mystery', 'secret', 'hidden', 'unknown', 'curious']):
            return "mysterious intriguing atmosphere"
        else:
            return "cinematic documentary atmosphere"
