#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="session-manager-web.service"
TARGET_DIR="$HOME/.config/systemd/user"
SOURCE_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/$SERVICE_NAME"

echo "[1/4] Ensuring systemd user directory exists ($TARGET_DIR)..."
mkdir -p "$TARGET_DIR"

echo "[2/4] Copying unit file ($SERVICE_NAME)..."
cp "$SOURCE_FILE" "$TARGET_DIR/$SERVICE_NAME"

echo "[3/4] Reloading systemd user daemon..."
systemctl --user daemon-reload

echo "[4/4] Enabling and starting $SERVICE_NAME..."
systemctl --user enable "$SERVICE_NAME"
systemctl --user restart "$SERVICE_NAME"

echo ""
echo "✅ $SERVICE_NAME successfully installed and started!"
echo "--------------------------------------------------------"
systemctl --user status "$SERVICE_NAME" --no-pager || true
echo "--------------------------------------------------------"
