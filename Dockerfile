# Stage 1: Build React frontend
FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY app/web/package*.json ./
RUN npm ci
COPY app/web/ ./
RUN VITE_API_BASE="" npm run build
# El mismo floorToSvg que dibuja el editor, empaquetado aparte: lo evalúa
# api/lib/plano_js.py en el Chromium del PDF para que el prospecto no tenga una
# segunda implementación del plano. No lleva VITE_API_BASE — no habla con el API.
RUN npm run build:plano

# Stage 2: Python API
FROM python:3.12-slim AS production

# Install Python deps + Playwright browser while still root
WORKDIR /app
COPY app/api/requirements.txt ./api/requirements.txt
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN pip install --no-cache-dir -r api/requirements.txt && \
    playwright install chromium --with-deps && \
    chmod -R o+rx /ms-playwright

# Non-root user
RUN groupadd -r --gid 999 appuser && useradd -r --uid 999 -g appuser appuser

# Install dbmate for running migrations (K8s Job / init container)
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && curl -fsSL https://github.com/amacneil/dbmate/releases/download/v2.33.0/dbmate-linux-amd64 \
       -o /usr/local/bin/dbmate && chmod +x /usr/local/bin/dbmate \
    && rm -rf /var/lib/apt/lists/*

# Application code
COPY app/api/ ./api/
COPY app/scraper/ ./scraper/

# Va DESPUÉS de COPY app/api/ a propósito: el bundle es artefacto de build (gitignored),
# así que el COPY del código fuente lo pisaría si fuera al revés.
COPY --from=frontend-build /build/dist-plano/plano.iife.js ./api/assets/plano.iife.js

# One-off admin scripts (e.g. scripts/backfill_image_orientation.py), meant to
# be run with `kubectl exec` against a live pod. Locally scripts/ and app/ are
# siblings under the repo root and each script inserts `<repo_root>/app` onto
# sys.path itself; here that root collapses (api/ sits straight under /app), so
# PYTHONPATH takes over that job instead — uvicorn doesn't need it, it resolves
# api.main:app off the cwd on its own.
COPY scripts/ ./scripts/
ENV PYTHONPATH=/app

# DB schema + migrations (used by dbmate)
COPY db/ /app/db/

# Frontend bundle
COPY --from=frontend-build /build/dist /app/frontend_dist

RUN chown -R appuser:appuser /app
USER appuser

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
