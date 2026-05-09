# Stage 1: Build React frontend
FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY apps/web/package*.json ./
RUN npm ci
COPY apps/web/ ./
# Empty VITE_API_BASE → relative URLs → same-origin requests to /api/*
RUN VITE_API_BASE="" npm run build

# Stage 2: Python API serving API + frontend static files
FROM python:3.12-slim AS production
# Mirror local dev working directory: uvicorn runs from /app/apps → api is the package
WORKDIR /app/apps
COPY apps/api/requirements.txt ./api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt
COPY apps/api/ ./api/
COPY data/ /app/data/
COPY --from=frontend-build /build/dist /app/frontend_dist

EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
