import base64
import io
import os
import json
import time
import logging
import asyncio
from typing import Optional, Dict, Any
from pathlib import Path
from urllib.parse import quote
from concurrent.futures import ThreadPoolExecutor

import httpx

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=4)

AVAILABLE_MODELS = {
    "flux": {
        "name": "FLUX Schnell",
        "description": "Fast generation, good quality",
        "provider": "pollinations",
    },
    "flux-realism": {
        "name": "FLUX Realism",
        "description": "Best for realistic faces and scenes",
        "provider": "pollinations",
    },
    "sdxl": {
        "name": "Stable Diffusion XL",
        "description": "Stable, good composition",
        "provider": "pollinations",
    },
    "flux-anime": {
        "name": "FLUX Anime",
        "description": "Anime style images",
        "provider": "pollinations",
    },
    "pollinations-video": {
        "name": "Pollinations Video (Wan 2.6)",
        "description": "Free AI video clips, no signup",
        "provider": "pollinations",
        "type": "video",
    },
    "prodia": {
        "name": "Prodia SDXL",
        "description": "100 free/day, fast",
        "provider": "prodia",
    },
    "craiyon": {
        "name": "Craiyon",
        "description": "Free, no signup needed",
        "provider": "craiyon",
    },
    "huggingface": {
        "name": "HuggingFace FLUX",
        "description": "Free inference, needs token",
        "provider": "huggingface",
    },
}


class CloudflareProvider:
    """Cloudflare Workers AI - Free tier: 10,000 neurons/day (~57 images at 1024x1024)"""

    BASE_URL = "https://api.cloudflare.com/client/v4/accounts"

    def __init__(self, account_id: str, api_token: str):
        self.account_id = account_id
        self.api_token = api_token
        self.model = "@cf/black-forest-labs/flux-1-schnell"

    @property
    def enabled(self) -> bool:
        return bool(self.account_id and self.api_token)

    async def generate_image(
        self,
        prompt: str,
        width: int = 1024,
        height: int = 576,
        steps: int = 4,
        seed: Optional[int] = None,
    ) -> Optional[bytes]:
        if not self.enabled:
            return None

        url = f"{self.BASE_URL}/{self.account_id}/ai/run/{self.model}"

        payload: Dict[str, Any] = {
            "prompt": prompt,
            "steps": steps,
        }
        if seed is not None:
            payload["seed"] = seed

        headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(url, headers=headers, json=payload)
                resp.raise_for_status()

                data = resp.json()
                if data.get("success"):
                    img_b64 = data["result"]["image"]
                    return base64.b64decode(img_b64)
                else:
                    logger.error(f"Cloudflare error: {data.get('errors')}")
                    return None

        except httpx.HTTPStatusError as e:
            logger.error(f"Cloudflare HTTP error {e.response.status_code}: {e.response.text[:200]}")
            return None
        except Exception as e:
            logger.error(f"Cloudflare request failed: {e}")
            return None


class PollinationsProvider:
    """Pollinations.ai - Free tier with Flux/SDXL models"""

    IMAGE_URL = "https://image.pollinations.ai/prompt"

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key
        self.model = "flux-realism"
        self._last_request = 0.0
        self._min_interval = 6.0

    @property
    def enabled(self) -> bool:
        return True

    async def generate_image(
        self,
        prompt: str,
        width: int = 1024,
        height: int = 576,
        seed: Optional[int] = None,
        model: Optional[str] = None,
    ) -> Optional[bytes]:
        elapsed = time.time() - self._last_request
        if elapsed < self._min_interval:
            await asyncio.sleep(self._min_interval - elapsed)

        use_model = model or self.model
        url = f"{self.IMAGE_URL}/{quote(prompt)}"
        params: Dict[str, Any] = {
            "model": use_model,
            "width": width,
            "height": height,
            "nologo": "true",
        }
        if seed is not None:
            params["seed"] = seed
        if self.api_key:
            params["key"] = self.api_key

        try:
            async with httpx.AsyncClient(timeout=180) as client:
                resp = await client.get(url, params=params)
                resp.raise_for_status()

                content_type = resp.headers.get("content-type", "")
                if "image" in content_type or len(resp.content) > 1000:
                    self._last_request = time.time()
                    logger.info(f"Pollinations generated {use_model} image ({len(resp.content)} bytes)")
                    return resp.content

                logger.error(f"Pollinations returned non-image: {content_type}")
                return None

        except httpx.TimeoutException:
            logger.error("Pollinations image request timed out")
            return None
        except Exception as e:
            logger.error(f"Pollinations image failed: {e}")
            return None

    async def generate_video(
        self,
        prompt: str,
        width: int = 1024,
        height: int = 576,
        duration: int = 6,
        model: str = "wan",
        image_url: Optional[str] = None,
    ) -> Optional[bytes]:
        elapsed = time.time() - self._last_request
        if elapsed < self._min_interval:
            await asyncio.sleep(self._min_interval - elapsed)

        url = f"https://gen.pollinations.ai/video/{quote(prompt)}"
        params: Dict[str, Any] = {
            "model": model,
            "width": width,
            "height": height,
            "duration": duration,
            "aspectRatio": "16:9",
        }
        if image_url:
            params["image"] = image_url
        if self.api_key:
            params["key"] = self.api_key

        try:
            async with httpx.AsyncClient(timeout=300) as client:
                resp = await client.get(url, params=params)
                resp.raise_for_status()

                self._last_request = time.time()
                if len(resp.content) > 1000:
                    return resp.content

                return None

        except httpx.TimeoutException:
            logger.error("Pollinations video request timed out")
            return None
        except Exception as e:
            logger.error(f"Pollinations video failed: {e}")
            return None


class CloudImageGenerator:
    """Google Flow (labs.google) - Free image generation via Google Labs session"""

    ENDPOINT = "https://aisandbox-pa.googleapis.com/v1:runImageFx"

    MODELS = {
        "imagen4": "IMAGEN_3_1",
        "banana": "GEM_PIX",
    }

    ASPECT_MAP = {
        "1:1": "IMAGE_ASPECT_RATIO_SQUARE",
        "16:9": "IMAGE_ASPECT_RATIO_LANDSCAPE",
        "9:16": "IMAGE_ASPECT_RATIO_PORTRAIT",
    }

    def __init__(self, access_token: Optional[str] = None, cookies: Optional[str] = None):
        self.access_token = access_token or os.getenv("FLOW_ACCESS_TOKEN", "")
        self.cookies = cookies or os.getenv("FLOW_COOKIES", "")
        self._last_request = 0.0
        self._min_interval = 3.0

    @property
    def enabled(self) -> bool:
        return bool(self.access_token)

    def _aspect_key(self, width: int, height: int) -> str:
        if width > height:
            return "16:9"
        elif height > width:
            return "9:16"
        return "1:1"

    def _parse_cookies(self) -> Dict[str, str]:
        if not self.cookies:
            return {}
        result = {}
        for part in self.cookies.split(";"):
            part = part.strip()
            if "=" in part:
                k, v = part.split("=", 1)
                result[k.strip()] = v.strip()
        return result

    async def generate_image(
        self,
        prompt: str,
        width: int = 1024,
        height: int = 576,
        seed: Optional[int] = None,
        model: str = "imagen4",
    ) -> Optional[bytes]:
        if not self.enabled:
            return None

        elapsed = time.time() - self._last_request
        if elapsed < self._min_interval:
            await asyncio.sleep(self._min_interval - elapsed)

        model_key = "imagen4" if model == "flow-imagen4" else "banana"
        aspect = self._aspect_key(width, height)

        payload = {
            "userInput": {
                "candidatesCount": 1,
                "prompts": [prompt],
                "isExpandedPrompt": False,
                "seed": (seed if seed is not None else int(time.time())) % 1000000,
            },
            "clientContext": {
                "sessionId": ";" + str(int(time.time() * 1000)),
                "tool": "IMAGE_FX",
            },
            "aspectRatio": self.ASPECT_MAP.get(aspect, "IMAGE_ASPECT_RATIO_LANDSCAPE"),
            "modelInput": {
                "modelNameType": self.MODELS.get(model_key, "IMAGEN_3_1"),
            },
        }

        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
            "Origin": "https://labs.google",
            "Referer": "https://labs.google/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        }

        cookies = self._parse_cookies()

        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    self.ENDPOINT,
                    headers=headers,
                    json=payload,
                    cookies=cookies,
                )
                resp.raise_for_status()

                data = resp.json()
                panels = data.get("imagePanels", [])
                if panels and panels[0].get("generatedImages"):
                    img_b64 = panels[0]["generatedImages"][0]["encodedImage"]
                    self._last_request = time.time()
                    logger.info(f"Flow generated image ({len(img_b64)} base64 chars)")
                    return base64.b64decode(img_b64)

                logger.error(f"Flow: No images: {json.dumps(data)[:300]}")
                return None

        except httpx.HTTPStatusError as e:
            logger.error(f"Flow HTTP error {e.response.status_code}: {e.response.text[:200]}")
            return None
        except Exception as e:
            logger.error(f"Flow request failed: {e}")
            return None


class FlowProvider:
    """Google Flow (labs.google) - Free image generation via Google Labs session"""

    ENDPOINT = "https://aisandbox-pa.googleapis.com/v1:runImageFx"

    MODELS = {
        "imagen4": "IMAGEN_3_1",
        "banana": "GEM_PIX",
    }

    ASPECT_MAP = {
        "1:1": "IMAGE_ASPECT_RATIO_SQUARE",
        "16:9": "IMAGE_ASPECT_RATIO_LANDSCAPE",
        "9:16": "IMAGE_ASPECT_RATIO_PORTRAIT",
    }

    def __init__(self, access_token: Optional[str] = None, cookies: Optional[str] = None):
        self.access_token = access_token or os.getenv("FLOW_ACCESS_TOKEN", "")
        self.cookies = cookies or os.getenv("FLOW_COOKIES", "")
        self._last_request = 0.0
        self._min_interval = 3.0

    @property
    def enabled(self) -> bool:
        return bool(self.access_token)

    def _aspect_key(self, width: int, height: int) -> str:
        if width > height:
            return "16:9"
        elif height > width:
            return "9:16"
        return "1:1"

    def _parse_cookies(self) -> Dict[str, str]:
        if not self.cookies:
            return {}
        result = {}
        for part in self.cookies.split(";"):
            part = part.strip()
            if "=" in part:
                k, v = part.split("=", 1)
                result[k.strip()] = v.strip()
        return result

    async def generate_image(
        self,
        prompt: str,
        width: int = 1024,
        height: int = 576,
        seed: Optional[int] = None,
        model: str = "imagen4",
    ) -> Optional[bytes]:
        if not self.enabled:
            return None

        elapsed = time.time() - self._last_request
        if elapsed < self._min_interval:
            await asyncio.sleep(self._min_interval - elapsed)

        model_key = "imagen4" if model == "flow-imagen4" else "banana"
        aspect = self._aspect_key(width, height)

        payload = {
            "userInput": {
                "candidatesCount": 1,
                "prompts": [prompt],
                "isExpandedPrompt": False,
                "seed": (seed if seed is not None else int(time.time())) % 1000000,
            },
            "clientContext": {
                "sessionId": ";" + str(int(time.time() * 1000)),
                "tool": "IMAGE_FX",
            },
            "aspectRatio": self.ASPECT_MAP.get(aspect, "IMAGE_ASPECT_RATIO_LANDSCAPE"),
            "modelInput": {
                "modelNameType": self.MODELS.get(model_key, "IMAGEN_3_1"),
            },
        }

        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
            "Origin": "https://labs.google",
            "Referer": "https://labs.google/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        }

        cookies = self._parse_cookies()

        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    self.ENDPOINT,
                    headers=headers,
                    json=payload,
                    cookies=cookies,
                )
                resp.raise_for_status()

                data = resp.json()
                panels = data.get("imagePanels", [])
                if panels and panels[0].get("generatedImages"):
                    img_b64 = panels[0]["generatedImages"][0]["encodedImage"]
                    self._last_request = time.time()
                    logger.info(f"Flow generated image ({len(img_b64)} base64 chars)")
                    return base64.b64decode(img_b64)

                logger.error(f"Flow: No images: {json.dumps(data)[:300]}")
                return None

        except httpx.HTTPStatusError as e:
            logger.error(f"Flow HTTP error {e.response.status_code}: {e.response.text[:200]}")
            return None
        except Exception as e:
            logger.error(f"Flow request failed: {e}")
            return None


class ProdiaProvider:
    """Prodia - Free tier: 100 images/day"""

    API_URL = "https://api.prodia.com/v1"

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("PRODIA_API_KEY", "")
        self._last_request = 0.0
        self._min_interval = 2.0

    @property
    def enabled(self) -> bool:
        return True

    async def generate_image(
        self,
        prompt: str,
        width: int = 1024,
        height: int = 576,
        seed: Optional[int] = None,
    ) -> Optional[bytes]:
        elapsed = time.time() - self._last_request
        if elapsed < self._min_interval:
            await asyncio.sleep(self._min_interval - elapsed)

        job_url = f"{self.API_URL}/sdxl/generate"
        payload = {
            "prompt": prompt,
            "model": "sdxl-1.0",
            "negative_prompt": "ugly, blurry, low quality",
            "steps": 25,
            "cfg_scale": 7,
            "seed": seed if seed is not None else -1,
        }
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["X-Prodia-Key"] = self.api_key

        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(job_url, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()

                job_id = data.get("job")
                if not job_id:
                    logger.error(f"Prodia: No job ID: {data}")
                    return None

                poll_url = f"{self.API_URL}/job/{job_id}"
                for _ in range(30):
                    await asyncio.sleep(1)
                    poll_resp = await client.get(poll_url, headers=headers)
                    poll_data = poll_resp.json()
                    status = poll_data.get("status")
                    if status == "succeeded":
                        img_url = poll_data.get("imageUrl")
                        if img_url:
                            img_resp = await client.get(img_url)
                            self._last_request = time.time()
                            logger.info(f"Prodia generated image ({len(img_resp.content)} bytes)")
                            return img_resp.content
                    elif status == "failed":
                        logger.error(f"Prodia job failed: {poll_data}")
                        return None

                logger.error("Prodia: Job timed out")
                return None

        except Exception as e:
            logger.error(f"Prodia request failed: {e}")
            return None


class CraiyonProvider:
    """Craiyon - Free, no signup needed"""

    API_URL = "https://api.craiyon.com/v3"

    def __init__(self):
        self._last_request = 0.0
        self._min_interval = 10.0

    @property
    def enabled(self) -> bool:
        return True

    async def generate_image(
        self,
        prompt: str,
        width: int = 1024,
        height: int = 576,
        seed: Optional[int] = None,
    ) -> Optional[bytes]:
        elapsed = time.time() - self._last_request
        if elapsed < self._min_interval:
            await asyncio.sleep(self._min_interval - elapsed)

        payload = {
            "prompt": prompt,
            "model": "craiyon",
            "negative_prompt": "ugly, blurry",
            "token": None,
        }

        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(self.API_URL, json=payload)
                resp.raise_for_status()
                data = resp.json()

                images = data.get("images", [])
                if images:
                    import base64 as b64
                    img_b64 = images[0]
                    self._last_request = time.time()
                    logger.info(f"Craiyon generated image")
                    return b64.b64decode(img_b64)

                logger.error("Craiyon: No images returned")
                return None

        except Exception as e:
            logger.error(f"Craiyon request failed: {e}")
            return None


class HuggingFaceProvider:
    """HuggingFace Inference API - Free tier with token"""

    BASE_URL = "https://router.huggingface.co/hf-inference/models"

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.getenv("HF_TOKEN", "")
        self._last_request = 0.0
        self._min_interval = 2.0

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    async def generate_image(
        self,
        prompt: str,
        width: int = 1024,
        height: int = 576,
        seed: Optional[int] = None,
    ) -> Optional[bytes]:
        if not self.enabled:
            return None

        elapsed = time.time() - self._last_request
        if elapsed < self._min_interval:
            await asyncio.sleep(self._min_interval - elapsed)

        headers = {"Authorization": f"Bearer {self.api_key}"}
        payload = {
            "inputs": prompt,
            "parameters": {
                "width": width,
                "height": height,
            }
        }

        model_id = "black-forest-labs/FLUX.1-schnell"
        url = f"{self.BASE_URL}/{model_id}"

        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
                
                content_type = resp.headers.get("content-type", "")
                if "image" in content_type:
                    self._last_request = time.time()
                    logger.info(f"HuggingFace generated image ({len(resp.content)} bytes)")
                    return resp.content
                
                logger.error(f"HuggingFace: Unexpected content type: {content_type}")
                return None

        except Exception as e:
            logger.error(f"HuggingFace request failed: {e}")
            return None


class CloudImageGenerator:
    """Unified cloud image generator with automatic fallback and multi-model support."""

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        config = config or {}

        self.cloudflare = CloudflareProvider(
            account_id=config.get("cloudflare_account_id", os.getenv("CLOUDFLARE_ACCOUNT_ID", "")),
            api_token=config.get("cloudflare_api_token", os.getenv("CLOUDFLARE_API_TOKEN", "")),
        )
        self.pollinations = PollinationsProvider(
            api_key=config.get("pollinations_api_key", os.getenv("POLLINATIONS_API_KEY", "")),
        )
        self.flow = FlowProvider(
            access_token=config.get("flow_access_token", os.getenv("FLOW_ACCESS_TOKEN", "")),
            cookies=config.get("flow_cookies", os.getenv("FLOW_COOKIES", "")),
        )
        self.prodia = ProdiaProvider(
            api_key=config.get("prodia_api_key", os.getenv("PRODIA_API_KEY", "")),
        )
        self.craiyon = CraiyonProvider()
        self.huggingface = HuggingFaceProvider(
            api_key=config.get("hf_token", os.getenv("HF_TOKEN", "")),
        )
        self.resolution = config.get("resolution", "1024x576")
        self.default_model = config.get("image_model", "flux-realism")
        self.providers_used = []

    def get_provider_status(self) -> Dict[str, Any]:
        return {
            "cloudflare": {
                "enabled": self.cloudflare.enabled,
                "account_id_set": bool(self.cloudflare.account_id),
                "token_set": bool(self.cloudflare.api_token),
            },
            "pollinations": {
                "enabled": self.pollinations.enabled,
                "default_model": self.default_model,
                "available_models": [k for k, v in AVAILABLE_MODELS.items() if v["provider"] == "pollinations"],
            },
            "flow": {
                "enabled": self.flow.enabled,
                "token_set": bool(self.flow.access_token),
                "available_models": [k for k, v in AVAILABLE_MODELS.items() if v["provider"] == "flow"],
            },
            "prodia": {
                "enabled": self.prodia.enabled,
                "available_models": ["prodia"],
            },
            "craiyon": {
                "enabled": self.craiyon.enabled,
                "available_models": ["craiyon"],
            },
            "huggingface": {
                "enabled": self.huggingface.enabled,
                "token_set": bool(self.huggingface.api_key),
                "available_models": ["huggingface"],
            },
        }

    async def generate_image(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 576,
        seed: int = 42,
        guidance_scale: float = 7.5,
        model: Optional[str] = None,
    ) -> Optional[bytes]:
        full_prompt = f"{prompt}, high quality, detailed, sharp focus"
        use_model = model or self.default_model

        if self.huggingface.enabled:
            logger.info(f"Trying HuggingFace for: {prompt[:60]}...")
            img_bytes = await self.huggingface.generate_image(
                prompt=full_prompt, width=width, height=height, seed=seed,
            )
            if img_bytes:
                logger.info(f"HuggingFace succeeded ({len(img_bytes)} bytes)")
                if "huggingface" not in self.providers_used:
                    self.providers_used.append("huggingface")
                return img_bytes
            logger.warning("HuggingFace failed, falling back")

        if self.prodia.enabled:
            logger.info(f"Trying Prodia for: {prompt[:60]}...")
            img_bytes = await self.prodia.generate_image(
                prompt=full_prompt, width=width, height=height, seed=seed,
            )
            if img_bytes:
                logger.info(f"Prodia succeeded ({len(img_bytes)} bytes)")
                if "prodia" not in self.providers_used:
                    self.providers_used.append("prodia")
                return img_bytes
            logger.warning("Prodia failed, falling back")

        if self.cloudflare.enabled:
            logger.info(f"Trying Cloudflare for: {prompt[:60]}...")
            img_bytes = await self.cloudflare.generate_image(
                prompt=full_prompt, width=width, height=height, seed=seed,
            )
            if img_bytes:
                logger.info(f"Cloudflare succeeded ({len(img_bytes)} bytes)")
                if "cloudflare" not in self.providers_used:
                    self.providers_used.append("cloudflare")
                return img_bytes
            logger.warning("Cloudflare failed, falling back")

        if self.craiyon.enabled:
            logger.info(f"Trying Craiyon for: {prompt[:60]}...")
            img_bytes = await self.craiyon.generate_image(
                prompt=full_prompt, width=width, height=height, seed=seed,
            )
            if img_bytes:
                logger.info(f"Craiyon succeeded ({len(img_bytes)} bytes)")
                if "craiyon" not in self.providers_used:
                    self.providers_used.append("craiyon")
                return img_bytes
            logger.warning("Craiyon failed, falling back")

        logger.info(f"Trying Pollinations (final fallback) for: {prompt[:60]}...")
        img_bytes = await self.pollinations.generate_image(
            prompt=full_prompt, width=width, height=height, seed=seed, model=use_model,
        )
        if img_bytes:
            logger.info(f"Pollinations succeeded ({len(img_bytes)} bytes)")
            if "pollinations" not in self.providers_used:
                self.providers_used.append("pollinations")
            return img_bytes

        logger.error("All cloud providers failed")
        return None

    async def generate_video(
        self,
        prompt: str,
        width: int = 1024,
        height: int = 576,
        duration: int = 6,
        model: str = "wan",
    ) -> Optional[bytes]:
        return await self.pollinations.generate_video(
            prompt=prompt, width=width, height=height,
            duration=duration, model=model,
        )

    def generate_image_sync(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 576,
        seed: int = 42,
        model: Optional[str] = None,
    ) -> Optional[bytes]:
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(
                self.generate_image(
                    prompt=prompt, negative_prompt=negative_prompt,
                    width=width, height=height, seed=seed, model=model,
                )
            )
        finally:
            loop.close()
