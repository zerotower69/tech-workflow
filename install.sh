#!/usr/bin/env bash
# 安装 tech-tower-workflow skill 到 $CODEX_HOME/skills（默认 ~/.codex）
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${CODEX_HOME:-$HOME/.codex}/skills/tech-tower-workflow"
mkdir -p "$DEST"
rsync -a --delete --delete-excluded --exclude '.git' --exclude 'node_modules' \
  --exclude '/claude-plugin' --exclude '/.claude-plugin' "$SRC/" "$DEST/"
echo "installed: $DEST (v1.5.2)"
