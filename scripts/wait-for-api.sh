#!/bin/bash
set -e

URL="${1:-http://localhost:8000/health}"
MAX_ATTEMPTS=30

for i in $(seq 1 "$MAX_ATTEMPTS"); do
  echo "Waiting for API... ($i/$MAX_ATTEMPTS)"
  if curl -sf "$URL" >/dev/null; then
    echo "✓ API is ready"
    exit 0
  fi
  sleep 1
done

echo "API did not become ready after $MAX_ATTEMPTS attempts: $URL" >&2
exit 1
