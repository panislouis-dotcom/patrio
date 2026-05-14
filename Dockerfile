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
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Application code
COPY apps/api/ ./api/
COPY apps/scraper/ ./scraper/

# Data: schema + static reference files only (data/files/ lives on PVC)
COPY data/schema.sql /app/data/schema.sql
COPY data/process/ /app/data/process/

# Frontend bundle
COPY --from=frontend-build /build/dist /app/frontend_dist

RUN chown -R appuser:appuser /app
USER appuser

EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
