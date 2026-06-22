# Stage 1: Build React frontend
FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY apps/web/package*.json ./
RUN npm ci
COPY apps/web/ ./
RUN VITE_API_BASE="" npm run build

# Stage 2: Python API
FROM python:3.12-slim AS production

# Install Python deps + Playwright browser while still root
WORKDIR /app/apps
COPY apps/api/requirements.txt ./api/requirements.txt
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
COPY apps/api/ ./api/
COPY apps/scraper/ ./scraper/

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
