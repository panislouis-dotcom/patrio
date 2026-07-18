#!/bin/bash
set -e
for f in $(find /docker-seeds -name "seed_*.sql" | sort); do
  echo "  seeding $f"
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$f"
done
