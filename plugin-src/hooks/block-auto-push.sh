#!/usr/bin/env bash
# PreToolUse(Bash) hook：禁止自动 git push。
# 仅当用户最新一条消息显式包含 push/推送 时放行；否则 exit 2 阻断并把理由反馈给模型。
TG_HOOK_INPUT="$(cat)"
export TG_HOOK_INPUT

DECISION="$(python3 <<'PY'
import json, os

try:
    payload = json.loads(os.environ.get("TG_HOOK_INPUT", "") or "{}")
except Exception:
    payload = {}

cmd = payload.get("tool_input", {}).get("command", "")
if "git push" not in cmd:
    print("allow")
    raise SystemExit(0)

last_user = ""
try:
    with open(payload.get("transcript_path", ""), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except Exception:
                continue
            if entry.get("type") == "user":
                content = entry.get("message", {}).get("content")
                if isinstance(content, str):
                    last_user = content
                elif isinstance(content, list):
                    last_user = "".join(
                        p.get("text", "") for p in content
                        if isinstance(p, dict) and p.get("type") == "text"
                    )
except Exception:
    last_user = ""

text = last_user.lower()
print("allow" if ("push" in text or "推送" in last_user) else "block")
PY
)"

if [ "$DECISION" = "allow" ]; then
  exit 0
fi

echo "技术塔 hook：禁止自动 git push。用户本轮消息未显式要求 push/推送——请停下并提示用户确认，或等待用户显式下达 push 指令后再执行。" >&2
exit 2
