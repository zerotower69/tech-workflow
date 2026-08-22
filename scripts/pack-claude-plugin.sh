#!/usr/bin/env bash
# 从 skills/tech-workflow 源文件组装 Claude Code 插件包 claude-plugin/（单一事实源，避免双份维护漂移）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/skills/tech-workflow"
VISUAL_SRC="$ROOT/skills/tech-visual-companion"
OUT="$ROOT/claude-plugin"
TMP="$(mktemp -d)"
SK="$TMP/skills/tech-workflow"
VISUAL_SK="$TMP/skills/tech-visual-companion"

mkdir -p "$TMP/.claude-plugin" "$TMP/hooks" "$SK/references" "$SK/visual-companion" "$VISUAL_SK"

cp "$ROOT/plugin-src/plugin.json" "$TMP/.claude-plugin/plugin.json"
cp "$ROOT/plugin-src/hooks/hooks.json" "$TMP/hooks/hooks.json"
cp "$ROOT/plugin-src/hooks/block-auto-push.sh" "$TMP/hooks/block-auto-push.sh"
chmod +x "$TMP/hooks/block-auto-push.sh"

# SKILL.md：把根目录路径引用改写为插件内相对路径
sed -e 's|`docs/|`references/|g' \
    -e 's|`workflow/tech-workflow.yaml`|`references/tech-workflow.yaml`|g' \
    -e 's|：`demo.md`|：`references/demo.md`|g' \
    "$SRC/SKILL.md" > "$SK/SKILL.md"

cp "$SRC"/docs/*.md "$SK/references/"
# topology 中的手册路径也需改写为插件内 references/，否则打包后引用失效
sed 's|docs/|references/|g' \
    "$SRC/workflow/tech-workflow.yaml" > "$SK/references/tech-workflow.yaml"
cp "$SRC/demo.md" "$SK/references/"
cp "$SRC/SOUL.md" "$SK/SOUL.md"
cp -R "$SRC/scripts" "$SK/scripts"
cp "$SRC/visual-companion/GUIDE.md" "$SK/visual-companion/"
cp "$SRC/visual-companion/smoke-test.sh" "$SK/visual-companion/"
cp -R "$SRC/visual-companion/scripts" "$SK/visual-companion/scripts"

# 独立 UI 设计 skill（源码自包含，完整复制）
cp -R "$VISUAL_SRC/." "$VISUAL_SK/"

mkdir -p "$OUT"
rsync -a --delete "$TMP/" "$OUT/"
rm -rf "$TMP"
echo "packed: $OUT (v$(python3 -c 'import json;print(json.load(open("'"$OUT"'/.claude-plugin/plugin.json"))["version"])'))"
