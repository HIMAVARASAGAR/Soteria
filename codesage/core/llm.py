"""
llm.py — Universal LLM client.

Supports:
  Local:  Ollama, LM Studio, Jan, Text Gen WebUI, GPT4All,
          Kobold.cpp, llama.cpp, LocalAI, AnythingLLM, Custom URL
  Cloud:  Groq, OpenAI, Anthropic, Google Gemini, Mistral,
          DeepSeek, Cohere, OpenRouter, Together AI, Fireworks,
          Perplexity, xAI Grok, Hugging Face, Replicate, AI21

Exponential backoff on 429/503 — 2^n seconds with jitter.
Decision log: HMAC for logs, shlex for command safety.
"""

import json
import time
import random
import logging
import urllib.request
import urllib.error
import subprocess
import shutil

logger = logging.getLogger("codesage.llm")

# ── Provider catalogue ────────────────────────────────────────────────────────

CLOUD_PROVIDERS: dict[str, dict] = {
    "groq": {
        "name": "Groq",
        "url": "https://api.groq.com/openai/v1/chat/completions",
        "key_env": "GROQ_API_KEY",
        "key_url": "https://console.groq.com",
        "default_model": "llama-3.3-70b-versatile",
        "suggested_models": [
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "mixtral-8x7b-32768",
            "gemma2-9b-it",
        ],
        "protocol": "openai",
    },
    "openai": {
        "name": "OpenAI",
        "url": "https://api.openai.com/v1/chat/completions",
        "key_env": "OPENAI_API_KEY",
        "key_url": "https://platform.openai.com/api-keys",
        "default_model": "gpt-4o-mini",
        "suggested_models": ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"],
        "protocol": "openai",
    },
    "anthropic": {
        "name": "Anthropic (Claude)",
        "url": "https://api.anthropic.com/v1/messages",
        "key_env": "ANTHROPIC_API_KEY",
        "key_url": "https://console.anthropic.com",
        "default_model": "claude-3-5-haiku-20241022",
        "suggested_models": [
            "claude-opus-4-5",
            "claude-sonnet-4-5",
            "claude-3-5-haiku-20241022",
        ],
        "protocol": "anthropic",
    },
    "gemini": {
        "name": "Google Gemini",
        "url": "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        "key_env": "GEMINI_API_KEY",
        "key_url": "https://aistudio.google.com/app/apikey",
        "default_model": "gemini-1.5-flash",
        "suggested_models": [
            "gemini-1.5-pro",
            "gemini-1.5-flash",
            "gemini-2.0-flash",
        ],
        "protocol": "gemini",
    },
    "mistral": {
        "name": "Mistral AI",
        "url": "https://api.mistral.ai/v1/chat/completions",
        "key_env": "MISTRAL_API_KEY",
        "key_url": "https://console.mistral.ai",
        "default_model": "mistral-small-latest",
        "suggested_models": [
            "mistral-large-latest",
            "mistral-small-latest",
            "codestral-latest",
        ],
        "protocol": "openai",
    },
    "deepseek": {
        "name": "DeepSeek",
        "url": "https://api.deepseek.com/v1/chat/completions",
        "key_env": "DEEPSEEK_API_KEY",
        "key_url": "https://platform.deepseek.com",
        "default_model": "deepseek-chat",
        "suggested_models": ["deepseek-chat", "deepseek-coder"],
        "protocol": "openai",
    },
    "openrouter": {
        "name": "OpenRouter (200+ models)",
        "url": "https://openrouter.ai/api/v1/chat/completions",
        "key_env": "OPENROUTER_API_KEY",
        "key_url": "https://openrouter.ai/keys",
        "default_model": "meta-llama/llama-3.3-70b-instruct",
        "suggested_models": [
            "meta-llama/llama-3.3-70b-instruct",
            "google/gemma-2-27b-it",
            "mistralai/mixtral-8x7b-instruct",
            "microsoft/phi-4",
        ],
        "protocol": "openai",
    },
    "together": {
        "name": "Together AI",
        "url": "https://api.together.xyz/v1/chat/completions",
        "key_env": "TOGETHER_API_KEY",
        "key_url": "https://api.together.ai",
        "default_model": "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
        "suggested_models": [
            "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
            "mistralai/Mixtral-8x7B-Instruct-v0.1",
        ],
        "protocol": "openai",
    },
    "fireworks": {
        "name": "Fireworks AI",
        "url": "https://api.fireworks.ai/inference/v1/chat/completions",
        "key_env": "FIREWORKS_API_KEY",
        "key_url": "https://fireworks.ai",
        "default_model": "accounts/fireworks/models/llama-v3p1-70b-instruct",
        "suggested_models": [
            "accounts/fireworks/models/llama-v3p1-70b-instruct",
            "accounts/fireworks/models/mixtral-8x7b-instruct",
        ],
        "protocol": "openai",
    },
    "perplexity": {
        "name": "Perplexity AI",
        "url": "https://api.perplexity.ai/chat/completions",
        "key_env": "PERPLEXITY_API_KEY",
        "key_url": "https://www.perplexity.ai/settings/api",
        "default_model": "llama-3.1-sonar-large-128k-online",
        "suggested_models": [
            "llama-3.1-sonar-large-128k-online",
            "llama-3.1-sonar-small-128k-online",
        ],
        "protocol": "openai",
    },
    "xai": {
        "name": "xAI (Grok)",
        "url": "https://api.x.ai/v1/chat/completions",
        "key_env": "XAI_API_KEY",
        "key_url": "https://console.x.ai",
        "default_model": "grok-2-latest",
        "suggested_models": ["grok-2-latest", "grok-beta"],
        "protocol": "openai",
    },
    "cohere": {
        "name": "Cohere",
        "url": "https://api.cohere.ai/v1/chat",
        "key_env": "COHERE_API_KEY",
        "key_url": "https://dashboard.cohere.com/api-keys",
        "default_model": "command-r-plus",
        "suggested_models": ["command-r-plus", "command-r"],
        "protocol": "cohere",
    },
    "huggingface": {
        "name": "Hugging Face Inference",
        "url": "https://api-inference.huggingface.co/models/{model}/v1/chat/completions",
        "key_env": "HF_API_KEY",
        "key_url": "https://huggingface.co/settings/tokens",
        "default_model": "meta-llama/Meta-Llama-3-8B-Instruct",
        "suggested_models": [
            "meta-llama/Meta-Llama-3-8B-Instruct",
            "mistralai/Mixtral-8x7B-Instruct-v0.1",
        ],
        "protocol": "openai",
    },
    "ai21": {
        "name": "AI21 Labs",
        "url": "https://api.ai21.com/studio/v1/chat/completions",
        "key_env": "AI21_API_KEY",
        "key_url": "https://studio.ai21.com/account/api-key",
        "default_model": "jamba-1.5-mini",
        "suggested_models": ["jamba-1.5-large", "jamba-1.5-mini"],
        "protocol": "openai",
    },
    "replicate": {
        "name": "Replicate",
        "url": "https://api.replicate.com/v1/models/{model}/predictions",
        "key_env": "REPLICATE_API_KEY",
        "key_url": "https://replicate.com/account/api-tokens",
        "default_model": "meta/llama-2-70b-chat",
        "suggested_models": ["meta/llama-2-70b-chat"],
        "protocol": "replicate",
    },
}

LOCAL_APPS: dict[str, dict] = {
    "ollama": {
        "name": "Ollama",
        "default_url": "http://localhost:11434",
        "chat_path": "/api/chat",
        "models_path": "/api/tags",
        "protocol": "ollama",
        "default_model": "gemma3:4b",
        "pull_cmd": "ollama pull {model}",
        "serve_cmd": "ollama serve",
        "install_url": "https://ollama.com",
    },
    "lmstudio": {
        "name": "LM Studio",
        "default_url": "http://localhost:1234",
        "chat_path": "/v1/chat/completions",
        "models_path": "/v1/models",
        "protocol": "openai",
        "default_model": "local-model",
        "install_url": "https://lmstudio.ai",
    },
    "jan": {
        "name": "Jan",
        "default_url": "http://localhost:1337",
        "chat_path": "/v1/chat/completions",
        "models_path": "/v1/models",
        "protocol": "openai",
        "default_model": "local-model",
        "install_url": "https://jan.ai",
    },
    "textgen": {
        "name": "Text Generation WebUI",
        "default_url": "http://localhost:5000",
        "chat_path": "/v1/chat/completions",
        "models_path": "/v1/models",
        "protocol": "openai",
        "default_model": "local-model",
        "install_url": "https://github.com/oobabooga/text-generation-webui",
    },
    "gpt4all": {
        "name": "GPT4All",
        "default_url": "http://localhost:4891",
        "chat_path": "/v1/chat/completions",
        "models_path": "/v1/models",
        "protocol": "openai",
        "default_model": "local-model",
        "install_url": "https://gpt4all.io",
    },
    "kobold": {
        "name": "Kobold.cpp",
        "default_url": "http://localhost:5001",
        "chat_path": "/v1/chat/completions",
        "models_path": "/v1/models",
        "protocol": "openai",
        "default_model": "local-model",
        "install_url": "https://github.com/LostRuins/koboldcpp",
    },
    "llamacpp": {
        "name": "llama.cpp server",
        "default_url": "http://localhost:8080",
        "chat_path": "/v1/chat/completions",
        "models_path": "/v1/models",
        "protocol": "openai",
        "default_model": "local-model",
        "install_url": "https://github.com/ggerganov/llama.cpp",
    },
    "localai": {
        "name": "LocalAI",
        "default_url": "http://localhost:8080",
        "chat_path": "/v1/chat/completions",
        "models_path": "/v1/models",
        "protocol": "openai",
        "default_model": "local-model",
        "install_url": "https://localai.io",
    },
    "anythingllm": {
        "name": "AnythingLLM",
        "default_url": "http://localhost:3001",
        "chat_path": "/api/v1/openai/chat/completions",
        "models_path": "/api/v1/openai/models",
        "protocol": "openai",
        "default_model": "local-model",
        "install_url": "https://anythingllm.com",
    },
    "custom": {
        "name": "Custom OpenAI-compatible server",
        "default_url": "http://localhost:8080",
        "chat_path": "/v1/chat/completions",
        "models_path": "/v1/models",
        "protocol": "openai",
        "default_model": "local-model",
        "install_url": None,
    },
}


# ── Exceptions ────────────────────────────────────────────────────────────────

class TransientError(Exception):
    """Temporary — retry with backoff."""

class FatalError(Exception):
    """Permanent — don't retry."""


# ── Main client ───────────────────────────────────────────────────────────────

class LLMClient:
    def __init__(self, config: dict):
        self.config   = config
        self.type     = config["type"]
        self.provider = config["provider"]
        self.model    = config["model"]
        self.api_key  = config.get("api_key", "")
        self.base_url = config.get("base_url", "")

    @property
    def display_name(self) -> str:
        if self.type == "local":
            app = LOCAL_APPS.get(self.provider, {})
            return f"{app.get('name', self.provider)} / {self.model}"
        prov = CLOUD_PROVIDERS.get(self.provider, {})
        return f"{prov.get('name', self.provider)} / {self.model}"

    def chat(self, system_prompt: str, messages: list) -> str:
        """Send with exponential backoff on transient errors."""
        max_retries = 5
        for attempt in range(max_retries):
            try:
                return self._dispatch(system_prompt, messages)
            except TransientError as e:
                if attempt == max_retries - 1:
                    raise
                # Exponential backoff: 2^attempt + jitter (0-1s)
                wait = (2 ** attempt) + random.uniform(0, 1)
                logger.warning(f"Transient error (attempt {attempt+1}): {e}. Retrying in {wait:.1f}s")
                time.sleep(wait)
        raise FatalError("Max retries exceeded")

    def _dispatch(self, system_prompt: str, messages: list) -> str:
        if self.type == "local":
            app = LOCAL_APPS[self.provider]
            if app["protocol"] == "ollama":
                return self._ollama_chat(system_prompt, messages)
            base = self.base_url or app["default_url"]
            return self._openai_chat(system_prompt, messages, base + app["chat_path"])
        else:
            prov = CLOUD_PROVIDERS[self.provider]
            protocol = prov["protocol"]
            if protocol == "anthropic":
                return self._anthropic_chat(system_prompt, messages)
            elif protocol == "gemini":
                return self._gemini_chat(system_prompt, messages)
            elif protocol == "cohere":
                return self._cohere_chat(system_prompt, messages)
            else:
                url = self.base_url or prov["url"]
                return self._openai_chat(system_prompt, messages, url)

    # ── Protocol implementations ───────────────────────────────────────────

    def _openai_chat(self, system_prompt: str, messages: list, url: str) -> str:
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": system_prompt}] + messages,
            "temperature": 0.3,
            "max_tokens": 4096,
        }
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        raw = self._post(url, payload, headers)
        data = json.loads(raw)
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as e:
            raise FatalError(f"Unexpected OpenAI response format: {data}") from e

    def _ollama_chat(self, system_prompt: str, messages: list) -> str:
        app = LOCAL_APPS["ollama"]
        base = self.base_url or app["default_url"]
        url = base + app["chat_path"]
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": system_prompt}] + messages,
            "stream": False,
            "options": {"temperature": 0.3, "num_predict": 4096},
        }
        raw = self._post(url, payload, {"Content-Type": "application/json"})
        data = json.loads(raw)
        try:
            return data["message"]["content"]
        except KeyError as e:
            raise FatalError(f"Unexpected Ollama response: {data}") from e

    def _anthropic_chat(self, system_prompt: str, messages: list) -> str:
        prov = CLOUD_PROVIDERS["anthropic"]
        url = self.base_url or prov["url"]
        payload = {
            "model": self.model,
            "max_tokens": 4096,
            "system": system_prompt,
            "messages": messages,
        }
        headers = {
            "Content-Type": "application/json",
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
        }
        raw = self._post(url, payload, headers)
        data = json.loads(raw)
        try:
            return data["content"][0]["text"]
        except (KeyError, IndexError) as e:
            raise FatalError(f"Unexpected Anthropic response: {data}") from e

    def _gemini_chat(self, system_prompt: str, messages: list) -> str:
        prov = CLOUD_PROVIDERS["gemini"]
        url = prov["url"].replace("{model}", self.model)
        url += f"?key={self.api_key}"
        # Convert to Gemini format
        contents = []
        for msg in messages:
            role = "user" if msg["role"] == "user" else "model"
            contents.append({"role": role, "parts": [{"text": msg["content"]}]})
        payload = {
            "system_instruction": {"parts": [{"text": system_prompt}]},
            "contents": contents,
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 4096},
        }
        raw = self._post(url, payload, {"Content-Type": "application/json"})
        data = json.loads(raw)
        try:
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError) as e:
            raise FatalError(f"Unexpected Gemini response: {data}") from e

    def _cohere_chat(self, system_prompt: str, messages: list) -> str:
        prov = CLOUD_PROVIDERS["cohere"]
        url = self.base_url or prov["url"]
        chat_history = []
        for msg in messages[:-1]:
            role = "USER" if msg["role"] == "user" else "CHATBOT"
            chat_history.append({"role": role, "message": msg["content"]})
        last = messages[-1]["content"] if messages else ""
        payload = {
            "model": self.model,
            "message": last,
            "chat_history": chat_history,
            "preamble": system_prompt,
            "temperature": 0.3,
        }
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        raw = self._post(url, payload, headers)
        data = json.loads(raw)
        try:
            return data["text"]
        except KeyError as e:
            raise FatalError(f"Unexpected Cohere response: {data}") from e

    # ── HTTP layer ─────────────────────────────────────────────────────────

    def _post(self, url: str, payload: dict, headers: dict) -> str:
        import ssl
        import certifi
        if "User-Agent" not in headers and "user-agent" not in {k.lower() for k in headers}:
            headers["User-Agent"] = "CodeSage/1.0 (Security Tester)"
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers)
        context = ssl.create_default_context(cafile=certifi.where())
        try:
            with urllib.request.urlopen(req, timeout=90, context=context) as resp:
                return resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            if e.code in (429, 502, 503, 529):
                raise TransientError(f"HTTP {e.code}: {body[:200]}")
            raise FatalError(f"HTTP {e.code}: {body[:300]}")
        except urllib.error.URLError as e:
            raise TransientError(f"Network error: {e.reason}")
        except TimeoutError:
            raise TransientError("Request timed out (90s)")

    # ── Health check ───────────────────────────────────────────────────────

    def ping(self) -> tuple[bool, str]:
        if self.type == "local":
            return self._ping_local()
        return self._ping_cloud()

    def _ping_local(self) -> tuple[bool, str]:
        app = LOCAL_APPS[self.provider]
        base = self.base_url or app["default_url"]
        try:
            req = urllib.request.Request(base + app["models_path"])
            with urllib.request.urlopen(req, timeout=5):
                pass
            return True, f"Connected to {app['name']} at {base}"
        except Exception as e:
            return False, str(e)

    def _ping_cloud(self) -> tuple[bool, str]:
        import socket
        prov = CLOUD_PROVIDERS.get(self.provider, {})
        url = prov.get("url", "")
        if "{model}" in url:
            url = url.replace("{model}", self.model)
        try:
            host = url.split("/")[2].split("?")[0]
            socket.create_connection((host, 443), timeout=5).close()
            return True, f"Can reach {prov.get('name', self.provider)}"
        except Exception as e:
            return False, f"Cannot reach {url}: {e}"


# ── Ollama helpers ────────────────────────────────────────────────────────────

def ollama_list_models(base_url: str = "http://localhost:11434") -> list[str]:
    try:
        req = urllib.request.Request(f"{base_url}/api/tags")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            return [m["name"] for m in data.get("models", [])]
    except Exception:
        return []


def ollama_is_running(base_url: str = "http://localhost:11434") -> bool:
    try:
        req = urllib.request.Request(f"{base_url}/api/tags")
        with urllib.request.urlopen(req, timeout=3):
            return True
    except Exception:
        return False


def ollama_pull_model(model: str) -> bool:
    if not shutil.which("ollama"):
        return False
    try:
        result = subprocess.run(
            ["ollama", "pull", model],
            timeout=600,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False


def ollama_start_server() -> bool:
    if not shutil.which("ollama"):
        return False
    try:
        subprocess.Popen(
            ["ollama", "serve"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        for _ in range(8):
            time.sleep(1)
            if ollama_is_running():
                return True
        return False
    except Exception:
        return False
