#!/usr/bin/env bash
# First-time VM setup for Refigan.
# Run via: task setup
# Or manually: bash deploy/setup.sh /opt/refigan
set -euo pipefail

DEPLOY_PATH="${1:-/opt/refigan}"

echo "▸ Installing Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

echo "▸ Installing Task (taskfile runner)..."
if ! command -v task &>/dev/null; then
  sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin
fi

echo "▸ Creating deploy directory: $DEPLOY_PATH"
mkdir -p "$DEPLOY_PATH"

echo "▸ Setting up firewall (ufw)..."
if command -v ufw &>/dev/null; then
  ufw allow 22/tcp   # SSH
  ufw allow 80/tcp   # HTTP
  ufw allow 443/tcp  # HTTPS (Cloudflare / Certbot)
  ufw --force enable
fi

echo "▸ Done. Next steps:"
echo "  1. Copy .env.example to $DEPLOY_PATH/.env and fill in production values"
echo "  2. Run: task deploy"
