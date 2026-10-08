# ---- build the React UI ------------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- API + static UI ---------------------------------------------------------
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    STATIC_DIR=/app/static DATA_DIR=/data
# Metric-compatible fonts so PDFs look like Calibri/Arial/Cambria/Times and embed real text.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-crosextra-carlito fonts-crosextra-caladea fonts-liberation fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY --from=web /web/dist ./static
RUN useradd --system --uid 10001 cvbuilder && mkdir -p /data && chown cvbuilder /data
USER cvbuilder
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import os,urllib.request;urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/api/health')"
# PORT is honoured for hosts that inject it; proxy headers are trusted so HTTPS is detected behind the host's load balancer
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
