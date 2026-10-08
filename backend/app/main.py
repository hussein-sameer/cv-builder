"""FastAPI entry point: export endpoints, AI routes and (in production) the built frontend."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote, urlparse

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import __version__, config
from .ai.router import router as ai_router
from .auth import User, current_user
from .auth import router as auth_router
from .config import settings
from .cvs_router import router as cvs_router
from .db import close_db, get_db
from .fonts import font_report
from .layout import TEMPLATES, build_document, file_stem
from .models import CV
from .render_docx import render_docx
from .render_pdf import render_pdf

@asynccontextmanager
async def lifespan(_app: FastAPI):
    get_db()  # create tables / run migrations at boot, not on the first request
    yield
    close_db()


app = FastAPI(title="CV Builder", version=__version__, lifespan=lifespan)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=True,
        expose_headers=["Content-Disposition", "X-Page-Count"],
    )

MAX_BODY = 2 * 1024 * 1024
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


def _origin_allowed(origin: str, request: Request) -> bool:
    if origin in config.settings.cors_origins:
        return True
    host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
    return urlparse(origin).netloc == host


@app.middleware("http")
async def guard(request: Request, call_next):
    """Body-size cap, same-origin check for state-changing API calls (CSRF defence in depth), security headers."""
    if request.url.path.startswith("/api/"):
        size = request.headers.get("content-length")
        if size and size.isdigit() and int(size) > MAX_BODY:
            return JSONResponse({"detail": "Request too large."}, status_code=413)
        origin = request.headers.get("origin")
        if request.method in UNSAFE and origin and not _origin_allowed(origin, request):
            return JSONResponse({"detail": "Cross-site request blocked."}, status_code=403)
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    return response


app.include_router(auth_router)
app.include_router(ai_router)
app.include_router(cvs_router)

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


@app.get("/api/health")
def health():
    return {"status": "ok", "version": __version__}


@app.get("/api/meta")
def meta():
    return {
        "templates": [
            {"key": t.key, "name": t.name, "description": t.description, "defaultFont": t.default_font,
             "headings": t.headings}
            for t in TEMPLATES.values()
        ],
        "pdfFonts": font_report(),
    }


def _attachment(name: str) -> dict:
    """RFC 6266/5987 header: ASCII fallback + UTF-8 name for non-Latin names."""
    ascii_name = name.encode("ascii", "ignore").decode() or "CV"
    return {"Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"}


@app.post("/api/export/docx")
def export_docx(cv: CV, _: User = Depends(current_user)):
    data = render_docx(build_document(cv))
    return Response(data, media_type=DOCX_MIME, headers=_attachment(file_stem(cv) + ".docx"))


@app.post("/api/export/pdf")
def export_pdf(cv: CV, inline: bool = False, _: User = Depends(current_user)):
    data, pages = render_pdf(build_document(cv))
    headers = {"X-Page-Count": str(pages)}
    if not inline:
        headers.update(_attachment(file_stem(cv) + ".pdf"))
    return Response(data, media_type="application/pdf", headers=headers)


# ----------------------------------------------------------------------------- #
# Serve the built React app (production / Docker). In dev, Vite serves it.
# ----------------------------------------------------------------------------- #
_static = Path(settings.static_dir) if settings.static_dir else None
if _static and (_static / "index.html").is_file():
    app.mount("/assets", StaticFiles(directory=_static / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        target = (_static / path).resolve()
        if path and target.is_file() and _static.resolve() in target.parents:
            return FileResponse(target)
        return FileResponse(_static / "index.html")
