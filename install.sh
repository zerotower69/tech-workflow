#!/usr/bin/env bash
# 安装 skills/ 下全部 skill 到 $CODEX_HOME/skills（默认 ~/.codex）
# 每个 skill 镜像覆盖安装（rsync --delete），互不影响。
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST_BASE="${CODEX_HOME:-$HOME/.codex}/skills"
count=0
for skill_dir in "$SRC"/skills/*/; do
  name="$(basename "$skill_dir")"
  [ -f "$skill_dir/SKILL.md" ] || continue
  dest="$DEST_BASE/$name"
  mkdir -p "$dest"
  rsync -a --delete --delete-excluded --exclude '.DS_Store' "$skill_dir" "$dest/"
  count=$((count + 1))
done
echo "installed: $count skills → $DEST_BASE (v1.10.0)"
