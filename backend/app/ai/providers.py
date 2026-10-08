"""Thin REST adapters for LLM providers (no vendor SDKs).

* openai    – any OpenAI-compatible /chat/completions endpoint: OpenAI, OpenRouter,
              Groq, DeepSeek, Mistral, Together, LM Studio, vLLM, Ollama's /v1 ...
* anthropic – Anthropic Messages API
* gemini    – Google Gemini generateContent API
* ollama    – Ollama native /api/chat (local models)
"""

from __future__ import annotations

import ipaddress
import socket
from typing import Callable, Literal
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel, Field

from .. import config

ProviderType = Literal["openai", "anthropic", "gemini", "ollama"]

PROVIDER_INFO = {
    "openai": {
        "label": "OpenAI-compatible",
        "hint": "OpenAI, OpenRouter, Groq, DeepSeek, Mistral, LM Studio, vLLM… set the base URL.",
        "needsKey": True,
        "presets": [
            {"name": "OpenAI", "baseUrl": "https://api.openai.com/v1"},
            {"name": "OpenRouter", "baseUrl": "https://openrouter.ai/api/v1"},
            {"name": "Groq", "baseUrl": "https://api.groq.com/openai/v1"},
            {"name": "DeepSeek", "baseUrl": "https://api.deepseek.com/v1"},
            {"name": "Mistral", "baseUrl": "https://api.mistral.ai/v1"},
            {"name": "LM Studio (local)", "baseUrl": "http://localhost:1234/v1"},
        ],
    },
    "anthropic": {"label": "Anthropic (Claude)", "hint": "Uses the Messages API.", "needsKey": True, "presets": []},
    "gemini": {"label": "Google Gemini", "hint": "Key from Google AI Studio.", "needsKey": True, "presets": []},
    "ollama": {
        "label": "Ollama (local)",
        "hint": "Runs models on your machine. In Docker use http://host.docker.internal:11434.",
        "needsKey": False,
        "presets": [],
    },
}


class ProviderConfig(BaseModel):
    type: ProviderType = "openai"
    baseUrl: str = Field(default="", max_length=500)
    apiKey: str = Field(default="", max_length=500)
    model: str = Field(default="", max_length=200)
    temperature: float | None = Field(default=None, ge=0, le=2)


class AIError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


# Hosted APIs that always need a key (self-hosted OpenAI-compatible servers may not).
_CLOUD_HOSTS = (
    "api.openai.com", "openrouter.ai", "api.groq.com", "api.deepseek.com", "api.mistral.ai",
    "api.anthropic.com", "googleapis.com", "api.together.xyz",
)


# --------------------------------------------------------------------------- #
def _host_ips(host: str) -> set[str]:
    return {info[4][0] for info in socket.getaddrinfo(host, None)}


def _assert_public_host(url: str) -> None:
    """On a shared server, refuse AI endpoints on private/internal networks (SSRF protection)."""
    host = urlparse(url).hostname
    if not host:
        raise AIError("Invalid base URL.", 400)
    try:
        ips = _host_ips(host)
    except (socket.gaierror, UnicodeError) as exc:
        raise AIError(f"Can't resolve the AI host '{host}'.", 400) from exc
    for ip in ips:
        if not ipaddress.ip_address(ip.split("%")[0]).is_global:
            raise AIError(
                "This server doesn't allow AI endpoints on local or private addresses (such as Ollama on "
                "localhost). Use a hosted API, or run CV Builder on your own machine for local models.",
                400,
            )


def effective_base_url(cfg: ProviderConfig) -> tuple[str, bool]:
    """The base URL a request will use (blank = server default), after the base-URL policy.

    Returns (base_url, custom) where ``custom`` means it differs from the server's default.
    """
    s = config.settings
    default_base = s.providers[cfg.type].base_url.strip().rstrip("/")
    requested = cfg.baseUrl.strip().rstrip("/")
    custom = bool(requested) and requested != default_base
    if custom and not s.allow_custom_base_urls:
        raise AIError("Custom base URLs are disabled on this server (ALLOW_CUSTOM_BASE_URLS=false).", 400)
    base = requested or default_base
    if not base.startswith(("http://", "https://")):
        raise AIError("Base URL must start with http:// or https://", 400)
    if not s.allow_private_base_urls:
        _assert_public_host(base)
    return base, custom


def resolve(
    cfg: ProviderConfig, need_model: bool = True, account_key: Callable[[str], str | None] | None = None
) -> tuple[ProviderConfig, bool]:
    """Fill gaps from server-side env defaults and enforce the base-URL policy.

    Key precedence: a key typed in the request, then the user's own saved key for this
    exact base URL (``account_key(base)``), then the server's shared key.
    Returns the effective config and whether the *server's* API key is being used.
    The server key is only ever sent to the server's own configured endpoint, never
    to a base URL supplied by the user.
    """
    d = config.settings.providers[cfg.type]
    base, custom = effective_base_url(cfg)
    user_key = cfg.apiKey.strip() or (account_key(base) if account_key else None) or ""
    server_key = not user_key and not custom and bool(d.api_key)
    key = user_key or (d.api_key if server_key else "")
    model = cfg.model.strip() or d.model
    if PROVIDER_INFO[cfg.type]["needsKey"] and not key and any(h in base for h in _CLOUD_HOSTS):
        raise AIError(f"No API key set for {PROVIDER_INFO[cfg.type]['label']}. Add one in AI settings.", 400)
    if need_model and not model:
        raise AIError("Choose a model in AI settings (use 'Load models' to list them).", 400)
    return ProviderConfig(type=cfg.type, baseUrl=base, apiKey=key, model=model, temperature=cfg.temperature), server_key


def _error_message(resp: httpx.Response) -> str:
    try:
        data = resp.json()
    except ValueError:
        return resp.text[:300] or resp.reason_phrase
    err = data.get("error") if isinstance(data, dict) else None
    if isinstance(err, dict):
        return str(err.get("message") or err)[:300]
    if isinstance(err, str):
        return err[:300]
    return str(data)[:300]


async def _request(client: httpx.AsyncClient, method: str, url: str, **kw) -> dict:
    try:
        resp = await client.request(method, url, **kw)
    except httpx.TimeoutException as exc:
        raise AIError(f"The AI provider timed out ({url.split('?')[0]}).", 504) from exc
    except httpx.HTTPError as exc:
        raise AIError(f"Could not reach the AI provider at {url.split('?')[0]}: {exc.__class__.__name__}.", 502) from exc
    if resp.status_code in (401, 403):
        raise AIError(f"Authentication failed ({resp.status_code}): {_error_message(resp)}", 401)
    if resp.status_code == 429:
        raise AIError(f"Rate limited by the provider: {_error_message(resp)}", 429)
    if resp.status_code >= 400:
        raise AIError(f"Provider error {resp.status_code}: {_error_message(resp)}", 400 if resp.status_code < 500 else 502)
    try:
        return resp.json()
    except ValueError as exc:
        raise AIError("Provider returned a non-JSON response.", 502) from exc


# --------------------------------------------------------------------------- #
# Chat
# --------------------------------------------------------------------------- #
async def chat(cfg: ProviderConfig, system: str, user: str, client: httpx.AsyncClient) -> str:
    if cfg.type == "openai":
        return await _openai_chat(cfg, system, user, client)
    if cfg.type == "anthropic":
        return await _anthropic_chat(cfg, system, user, client)
    if cfg.type == "gemini":
        return await _gemini_chat(cfg, system, user, client)
    if cfg.type == "ollama":
        return await _ollama_chat(cfg, system, user, client)
    raise AIError(f"Unknown provider {cfg.type}", 400)


def _openai_headers(cfg: ProviderConfig) -> dict:
    h = {"Content-Type": "application/json"}
    if cfg.apiKey:
        h["Authorization"] = f"Bearer {cfg.apiKey}"
    if "openrouter.ai" in cfg.baseUrl:
        h["X-Title"] = "CV Builder"
    return h


async def _openai_chat(cfg, system, user, client) -> str:
    body: dict = {
        "model": cfg.model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    if cfg.temperature is not None:
        body["temperature"] = cfg.temperature
    url = f"{cfg.baseUrl}/chat/completions"
    try:
        data = await _request(client, "POST", url, json=body, headers=_openai_headers(cfg))
    except AIError as e:
        # Some reasoning models reject a custom temperature – retry once without it.
        if "temperature" in body and e.status_code == 400 and "temperature" in e.message.lower():
            body.pop("temperature")
            data = await _request(client, "POST", url, json=body, headers=_openai_headers(cfg))
        else:
            raise
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise AIError("Unexpected response format from the OpenAI-compatible provider.") from exc
    if isinstance(content, list):  # some gateways return content parts
        content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
    return content or ""


async def _anthropic_chat(cfg, system, user, client) -> str:
    body: dict = {
        "model": cfg.model,
        "max_tokens": 1500,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    if cfg.temperature is not None:
        body["temperature"] = min(cfg.temperature, 1.0)
    headers = {"x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json"}
    data = await _request(client, "POST", f"{cfg.baseUrl}/v1/messages", json=body, headers=headers)
    blocks = data.get("content") or []
    return "".join(b.get("text", "") for b in blocks if b.get("type") == "text")


def _gemini_model(model: str) -> str:
    return model.removeprefix("models/")


async def _gemini_chat(cfg, system, user, client) -> str:
    body: dict = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
    }
    if cfg.temperature is not None:
        body["generationConfig"] = {"temperature": cfg.temperature}
    url = f"{cfg.baseUrl}/v1beta/models/{_gemini_model(cfg.model)}:generateContent"
    data = await _request(client, "POST", url, json=body, headers={"x-goog-api-key": cfg.apiKey})
    cands = data.get("candidates") or []
    if not cands:
        reason = (data.get("promptFeedback") or {}).get("blockReason", "no candidates returned")
        raise AIError(f"Gemini returned no text ({reason}).")
    parts = (cands[0].get("content") or {}).get("parts") or []
    return "".join(p.get("text", "") for p in parts if not p.get("thought"))


async def _ollama_chat(cfg, system, user, client) -> str:
    body: dict = {
        "model": cfg.model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "stream": False,
    }
    if cfg.temperature is not None:
        body["options"] = {"temperature": cfg.temperature}
    data = await _request(client, "POST", f"{cfg.baseUrl}/api/chat", json=body)
    return (data.get("message") or {}).get("content", "")


# --------------------------------------------------------------------------- #
# Model listing (doubles as a connection test)
# --------------------------------------------------------------------------- #
async def list_models(cfg: ProviderConfig, client: httpx.AsyncClient) -> list[str]:
    if cfg.type == "openai":
        data = await _request(client, "GET", f"{cfg.baseUrl}/models", headers=_openai_headers(cfg))
        models = [m.get("id", "") for m in data.get("data", [])]
    elif cfg.type == "anthropic":
        headers = {"x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01"}
        data = await _request(client, "GET", f"{cfg.baseUrl}/v1/models?limit=100", headers=headers)
        models = [m.get("id", "") for m in data.get("data", [])]
    elif cfg.type == "gemini":
        data = await _request(
            client, "GET", f"{cfg.baseUrl}/v1beta/models?pageSize=200", headers={"x-goog-api-key": cfg.apiKey}
        )
        models = [
            _gemini_model(m.get("name", ""))
            for m in data.get("models", [])
            if "generateContent" in (m.get("supportedGenerationMethods") or [])
        ]
    else:
        data = await _request(client, "GET", f"{cfg.baseUrl}/api/tags")
        models = [m.get("name", "") for m in data.get("models", [])]
    return sorted({m for m in models if m})
