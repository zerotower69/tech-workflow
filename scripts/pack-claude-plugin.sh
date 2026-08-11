#!/usr/bin/env bash
# 从仓库源文件组装 Claude Code 插件包 claude-plugin/（单一事实源，避免双份维护漂移）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/claude-plugin"
TMP="$(mktemp -d)"
SK="$TMP/skills/tech-tower-workflow"

mkdir -p "$TMP/.claude-plugin" "$TMP/hooks" "$SK/references" "$SK/visual-companion"

cp "$ROOT/plugin-src/plugin.json" "$TMP/.claude-plugin/plugin.json"
cp "$ROOT/plugin-src/hooks/hooks.json" "$TMP/hooks/hooks.json"
cp "$ROOT/plugin-src/hooks/block-auto-push.sh" "$TMP/hooks/block-auto-push.sh"
chmod +x "$TMP/hooks/block-auto-push.sh"

# SKILL.md：把根目录路径引用改写为插件内相对路径
sed -e 's|`docs/|`references/|g' \
    -e 's|`workflow/tech-tower-workflow.yaml`|`references/tech-tower-workflow.yaml`|g' \
    -e 's|：`demo.md`|：`references/demo.md`|g' \
    "$ROOT/SKILL.md" > "$SK/SKILL.md"

cp "$ROOT"/docs/*.md "$SK/references/"
cp "$ROOT/workflow/tech-tower-workflow.yaml" "$SK/references/"
cp "$ROOT/demo.md" "$SK/references/"
cp "$ROOT/SOUL.md" "$SK/SOUL.md"
cp "$ROOT/visual-companion/GUIDE.md" "$SK/visual-companion/"
cp "$ROOT/visual-companion/smoke-test.sh" "$SK/visual-companion/"
cp -R "$ROOT/visual-companion/scripts" "$SK/visual-companion/scripts"

mkdir -p "$OUT"
rsync -a --delete "$TMP/" "$OUT/"
rm -rf "$TMP"
echo "packed: $OUT (v$(python3 -c 'import json;print(json.load(open("'"$OUT"'/.claude-plugin/plugin.json"))["version"])'))"
