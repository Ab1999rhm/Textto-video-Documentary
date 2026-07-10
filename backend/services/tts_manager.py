import asyncio
import os
import logging
from typing import Optional, Dict, Any, List
from pathlib import Path

logger = logging.getLogger(__name__)

LANGUAGES = {
    "en": {"name": "English", "voices": {
        "female": "en-US-JennyNeural",
        "male": "en-US-GuyNeural",
    }},
    "am": {"name": "Amharic (አማርኛ)", "voices": {
        "female": "am-ET-MekdesNeural",
        "male": "am-ET-AmehaNeural",
    }},
    "ar": {"name": "Arabic (العربية)", "voices": {
        "female": "ar-SA-ZariyahNeural",
        "male": "ar-SA-HamedNeural",
    }},
    "zh": {"name": "Chinese (中文)", "voices": {
        "female": "zh-CN-XiaoxiaoNeural",
        "male": "zh-CN-YunxiNeural",
    }},
    "fr": {"name": "French (Français)", "voices": {
        "female": "fr-FR-DeniseNeural",
        "male": "fr-FR-HenriNeural",
    }},
    "de": {"name": "German (Deutsch)", "voices": {
        "female": "de-DE-KatjaNeural",
        "male": "de-DE-ConradNeural",
    }},
    "hi": {"name": "Hindi (हिन्दी)", "voices": {
        "female": "hi-IN-SwaraNeural",
        "male": "hi-IN-MadhurNeural",
    }},
    "it": {"name": "Italian (Italiano)", "voices": {
        "female": "it-IT-ElsaNeural",
        "male": "it-IT-DiegoNeural",
    }},
    "ja": {"name": "Japanese (日本語)", "voices": {
        "female": "ja-JP-NanamiNeural",
        "male": "ja-JP-KeitaNeural",
    }},
    "ko": {"name": "Korean (한국어)", "voices": {
        "female": "ko-KR-SunHiNeural",
        "male": "ko-KR-InJoonNeural",
    }},
    "pt": {"name": "Portuguese (Português)", "voices": {
        "female": "pt-BR-FranciscaNeural",
        "male": "pt-BR-AntonioNeural",
    }},
    "ru": {"name": "Russian (Русский)", "voices": {
        "female": "ru-RU-SvetlanaNeural",
        "male": "ru-RU-DmitryNeural",
    }},
    "es": {"name": "Spanish (Español)", "voices": {
        "female": "es-ES-ElviraNeural",
        "male": "es-ES-AlvaroNeural",
    }},
    "sw": {"name": "Swahili (Kiswahili)", "voices": {
        "female": "sw-KE-ZuriNeural",
        "male": "sw-KE-RafikiNeural",
    }},
    "tr": {"name": "Turkish (Türkçe)", "voices": {
        "female": "tr-TR-EmelNeural",
        "male": "tr-TR-AhmetNeural",
    }},
    "vi": {"name": "Vietnamese (Tiếng Việt)", "voices": {
        "female": "vi-VN-HoaiMyNeural",
        "male": "vi-VN-NamMinhNeural",
    }},
    "th": {"name": "Thai (ไทย)", "voices": {
        "female": "th-TH-PremwadeeNeural",
        "male": "th-TH-PattaraNeural",
    }},
    "id": {"name": "Indonesian (Bahasa)", "voices": {
        "female": "id-ID-GadisNeural",
        "male": "id-ID-ArdiNeural",
    }},
    "ms": {"name": "Malay (Bahasa Melayu)", "voices": {
        "female": "ms-MY-YasminNeural",
        "male": "ms-MY-OsmanNeural",
    }},
    "nl": {"name": "Dutch (Nederlands)", "voices": {
        "female": "nl-NL-ColetteNeural",
        "male": "nl-NL-MaartenNeural",
    }},
    "pl": {"name": "Polish (Polski)", "voices": {
        "female": "pl-PL-AgnieszkaNeural",
        "male": "pl-PL-MarekNeural",
    }},
    "sv": {"name": "Swedish (Svenska)", "voices": {
        "female": "sv-SE-SofieNeural",
        "male": "sv-SE-MattiasNeural",
    }},
}


def get_languages() -> Dict[str, str]:
    return {code: lang["name"] for code, lang in LANGUAGES.items()}


def get_voices(language: str) -> Dict[str, str]:
    if language in LANGUAGES:
        return LANGUAGES[language]["voices"]
    return LANGUAGES["en"]["voices"]


def get_default_voice(language: str, gender: str = "female") -> str:
    voices = get_voices(language)
    return voices.get(gender, voices.get("female", "en-US-JennyNeural"))


async def generate_speech(
    text: str,
    voice: Optional[str] = None,
    language: str = "en",
    gender: str = "female",
    output_path: str = "output.mp3",
    rate: str = "+0%",
    volume: str = "+0%",
    pitch: str = "+0Hz",
) -> bool:
    try:
        import edge_tts

        if voice is None:
            voice = get_default_voice(language, gender)

        communicate = edge_tts.Communicate(
            text=text,
            voice=voice,
            rate=rate,
            volume=volume,
            pitch=pitch,
        )

        await communicate.save(output_path)

        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            logger.info(f"TTS generated: {output_path} ({os.path.getsize(output_path)} bytes) voice={voice}")
            return True

        logger.error("TTS generated empty file")
        return False

    except Exception as e:
        logger.error(f"TTS error: {e}")
        return False


async def generate_speech_with_srt(
    text: str,
    audio_path: str,
    srt_path: str,
    voice: Optional[str] = None,
    language: str = "en",
    gender: str = "female",
    rate: str = "+0%",
) -> bool:
    try:
        import edge_tts

        if voice is None:
            voice = get_default_voice(language, gender)

        communicate = edge_tts.Communicate(
            text=text,
            voice=voice,
            rate=rate,
        )

        srt_data = []
        audio_data = b""

        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data += chunk["data"]
            elif chunk["type"] == "WordBoundary":
                srt_data.append(chunk)

        with open(audio_path, "wb") as f:
            f.write(audio_data)

        if srt_data:
            _write_srt(srt_data, srt_path)

        if os.path.exists(audio_path) and os.path.getsize(audio_path) > 0:
            logger.info(f"TTS+SRT generated: {audio_path}")
            return True

        return False

    except Exception as e:
        logger.error(f"TTS+SRT error: {e}")
        return False


def _write_srt(word_boundaries: list, output_path: str):
    try:
        with open(output_path, "w", encoding="utf-8") as f:
            index = 1
            words = []
            for wb in word_boundaries:
                offset_ms = wb.get("offset", 0) / 10000
                duration_ms = wb.get("duration", 0) / 10000
                text = wb.get("text", "")
                words.append({
                    "text": text,
                    "start": offset_ms,
                    "end": offset_ms + duration_ms,
                })

            if not words:
                return

            chunk_size = max(1, len(words) // 20)

            for i in range(0, len(words), chunk_size):
                chunk = words[i:i + chunk_size]
                start_time = _ms_to_srt(chunk[0]["start"])
                end_time = _ms_to_srt(chunk[-1]["end"])
                text = " ".join(w["text"] for w in chunk)

                f.write(f"{index}\n")
                f.write(f"{start_time} --> {end_time}\n")
                f.write(f"{text}\n\n")
                index += 1

    except Exception as e:
        logger.error(f"SRT write error: {e}")


def _ms_to_srt(ms: float) -> str:
    hours = int(ms // 3600000)
    minutes = int((ms % 3600000) // 60000)
    seconds = int((ms % 60000) // 1000)
    millis = int(ms % 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"
