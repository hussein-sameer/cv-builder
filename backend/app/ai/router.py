"""/api/ai/* routes (signed-in users only)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from .. import config
from ..auth import User, current_user
from ..db import get_db
from ..models import CV
from . import keys, prompts
from .providers import PROVIDER_INFO, AIError, ProviderConfig, chat, effective_base_url, list_models, resolve

router = APIRouter(prefix="/api/ai", tags=["ai"])


def make_client() -> httpx.AsyncClient:
    """Factory so tests can inject a mock transport. Redirects are not followed (SSRF hygiene)."""
    return httpx.AsyncClient(timeout=httpx.Timeout(config.settings.ai_timeout, connect=10), follow_redirects=False)


class ModelsRequest(BaseModel):
    provider: ProviderConfig


class KeyRequest(BaseModel):
    provider: ProviderConfig


class GenerateRequest(BaseModel):
    provider: ProviderConfig
    task: Literal["summary", "bullets"]
    cv: CV
    options: prompts.GenerateOptions = prompts.GenerateOptions()


def _err(e: AIError) -> JSONResponse:
    return JSONResponse({"detail": e.message}, status_code=e.status_code)


def _account_key(user: User, provider: str):
    """Lookup for resolve(): the user's saved key for the base URL the request will use."""
    return lambda base: keys.get_key(user.id, provider, base)


def _count_server_key_use(user: User) -> int | None:
    """Count one generation on the shared server key; returns remaining, or None if unlimited."""
    limit = config.settings.ai_daily_limit
    if limit <= 0 or user.is_admin:
        return None
    day = datetime.now(timezone.utc).date().isoformat()
    with get_db().tx() as c:
        row = c.one(
            "INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1) "
            "ON CONFLICT (user_id, day) DO UPDATE SET count = ai_usage.count + 1 RETURNING count",
            (user.id, day),
        )
    used = int(row["count"]) if row else limit + 1
    if used > limit:
        raise AIError(
            f"You've used today's {limit} AI generations on the shared key. "
            "Add your own API key in AI settings to keep going, or try again tomorrow.",
            429,
        )
    return limit - used


@router.get("/config")
def ai_config(_: User = Depends(current_user)):
    """Provider catalogue + which providers have a server-side key (never the key itself)."""
    s = config.settings
    return {
        "defaultProvider": s.default_provider,
        "allowCustomBaseUrls": s.allow_custom_base_urls,
        "allowPrivateBaseUrls": s.allow_private_base_urls,
        "dailyLimit": s.ai_daily_limit,
        "keyStorage": keys.available(),
        "providers": [
            {
                "type": t,
                **info,
                "defaultBaseUrl": s.providers[t].base_url,
                "defaultModel": s.providers[t].model,
                "serverKey": bool(s.providers[t].api_key),
            }
            for t, info in PROVIDER_INFO.items()
        ],
    }


@router.get("/keys")
def list_keys(user: User = Depends(current_user)):
    """The user's saved keys: provider, base URL and a hint, never the key itself."""
    return keys.list_keys(user.id)


@router.put("/keys")
def save_key(req: KeyRequest, user: User = Depends(current_user)):
    """Save (or replace) the user's key for this provider and base URL, encrypted."""
    api_key = req.provider.apiKey.strip()
    try:
        if not api_key:
            raise AIError("Paste an API key to save.", 400)
        base, _custom = effective_base_url(req.provider)
        return keys.save_key(user.id, req.provider.type, base, api_key)
    except AIError as e:
        return _err(e)


@router.delete("/keys/{key_id}", status_code=204)
def delete_key(key_id: str, user: User = Depends(current_user)):
    if not keys.delete_key(user.id, key_id):
        raise HTTPException(404, "Saved key not found.")


@router.post("/models")
async def ai_models(req: ModelsRequest, user: User = Depends(current_user)):
    try:
        cfg, _server = await run_in_threadpool(resolve, req.provider, False, _account_key(user, req.provider.type))
        async with make_client() as client:
            models = await list_models(cfg, client)
    except AIError as e:
        return _err(e)
    return {"models": models}


@router.post("/generate")
async def ai_generate(req: GenerateRequest, user: User = Depends(current_user)):
    remaining = None
    try:
        cfg, server_key = await run_in_threadpool(resolve, req.provider, True, _account_key(user, req.provider.type))
        if req.task == "summary":
            system, user_prompt = prompts.summary_prompts(req.cv, req.options)
        else:
            try:
                system, user_prompt = prompts.bullets_prompts(req.cv, req.options)
            except ValueError as e:
                raise AIError(str(e), 400) from e
        if server_key:
            remaining = await run_in_threadpool(_count_server_key_use, user)
        async with make_client() as client:
            raw = await chat(cfg, system, user_prompt, client)
    except AIError as e:
        return _err(e)

    if req.task == "summary":
        text = prompts.clean_summary(raw)
        if not text:
            return _err(AIError("The model returned an empty answer. Try again or pick another model."))
        return {"text": text, "model": cfg.model, "remaining": remaining}
    bullets = prompts.clean_bullets(raw)
    if not bullets:
        return _err(AIError("The model returned no bullet points. Try again or pick another model."))
    return {"bullets": bullets, "model": cfg.model, "remaining": remaining}
