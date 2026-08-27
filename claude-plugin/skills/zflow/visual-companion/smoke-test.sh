#!/usr/bin/env bash
# 技术塔视觉伴侣冒烟测试
# 链路：启动服务器 → cookie 鉴权 → 品牌渲染 → 推送内容页 → WebSocket 模拟点击 → events 落盘 → 停止服务器
# 用法：visual-companion/smoke-test.sh [project-dir]
#   project-dir 缺省用系统临时目录下的新目录（/tmp 下的会话为一次性会话，停止时清理）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="${1:-$(mktemp -d "${TMPDIR:-/tmp}/tg-vc-smoke-XXXXXX")}"

command -v node >/dev/null || { echo "FAIL: 需要 node（>=22，用于 WebSocket 客户端）"; exit 1; }
command -v curl >/dev/null || { echo "FAIL: 需要 curl"; exit 1; }
command -v python3 >/dev/null || { echo "FAIL: 需要 python3"; exit 1; }
node -e 'process.exit(typeof WebSocket === "undefined" ? 1 : 0)' || { echo "FAIL: node 缺少全局 WebSocket（需要 Node 22+）"; exit 1; }

echo "==> 1/9 启动服务器（project-dir: ${PROJECT_DIR}）"
OUT="$("$SCRIPT_DIR/scripts/start-server.sh" --project-dir "$PROJECT_DIR" --background)"
echo "$OUT"
SESSION_DIR="$(printf '%s' "$OUT" | python3 -c 'import sys,json,os;print(os.path.dirname(json.load(sys.stdin)["state_dir"]))')"
STATE_DIR="$SESSION_DIR/state"
INFO="$STATE_DIR/server-info"
for _ in $(seq 1 40); do [ -f "$INFO" ] && break; sleep 0.25; done
[ -f "$INFO" ] || { echo "FAIL: 未生成 server-info"; exit 1; }
URL="$(python3 -c "import json;print(json.load(open('$INFO'))['url'])")"
PORT="$(python3 -c "import json;print(json.load(open('$INFO'))['port'])")"
KEY="${URL##*key=}"
BASE="http://localhost:$PORT"
echo "    URL=$URL"

echo "==> 2/9 引导页 + cookie 鉴权 + 品牌渲染"
COOKIES="$STATE_DIR/.smoke-cookies"
curl -sf -c "$COOKIES" "$URL" -o /dev/null || { echo "FAIL: 引导页请求失败"; exit 1; }
PAGE="$(curl -sf -b "$COOKIES" "$BASE/")" || { echo "FAIL: 根页面请求失败"; exit 1; }
printf '%s' "$PAGE" | grep -q "技术塔视觉伴侣 v" || { echo "FAIL: 品牌未渲染"; exit 1; }
echo "    品牌渲染 OK"

echo "==> 3/9 推送测试内容页"
cat > "$SESSION_DIR/content/smoke-test.html" << 'HTML'
<h2>冒烟测试：选择布局</h2>
<p class="subtitle">smoke-test 内容页</p>
<div class="options">
  <div class="option" data-choice="a" onclick="toggleSelect(this)">
    <div class="letter">A</div>
    <div class="content"><h3>单栏</h3><p>简洁专注</p></div>
  </div>
  <div class="option" data-choice="b" onclick="toggleSelect(this)">
    <div class="letter">B</div>
    <div class="content"><h3>双栏</h3><p>侧边导航</p></div>
  </div>
</div>
HTML
cat > "$SESSION_DIR/design-spec.md" << 'MARKDOWN'
# 冒烟设计决策

采用 **单栏** 作为默认布局。
MARKDOWN
sleep 1.5
PAGE2="$(curl -sf -b "$COOKIES" "$BASE/")" || { echo "FAIL: 内容页请求失败"; exit 1; }
printf '%s' "$PAGE2" | grep -q "冒烟测试：选择布局" || { echo "FAIL: 内容页未被分发"; exit 1; }
printf '%s' "$PAGE2" | grep -q 'data-choice="b"' || { echo "FAIL: 选项标记缺失"; exit 1; }
printf '%s' "$PAGE2" | grep -q 'tt-floating-tools' || { echo "FAIL: 插件化悬浮球未注入"; exit 1; }
echo "    内容页渲染 OK"

echo "==> 4/9 页面列表 + HTML/图片导出资源"
SCREENS="$(curl -sf -b "$COOKIES" "$BASE/api/screens")" || { echo "FAIL: 页面列表接口失败"; exit 1; }
printf '%s' "$SCREENS" | grep -q 'smoke-test.html' || { echo "FAIL: 页面列表缺少测试页"; exit 1; }
curl -sf -b "$COOKIES" "$BASE/assets/html-to-image.js" -o "$STATE_DIR/html-to-image.js" || { echo "FAIL: 图片导出资源失败"; exit 1; }
[ "$(wc -c < "$STATE_DIR/html-to-image.js")" -gt 10000 ] || { echo "FAIL: 图片导出资源异常"; exit 1; }
EXPORTED="$(curl -sf -b "$COOKIES" "$BASE/export/html/smoke-test.html")" || { echo "FAIL: HTML 导出失败"; exit 1; }
printf '%s' "$EXPORTED" | grep -q '冒烟测试：选择布局' || { echo "FAIL: HTML 导出内容异常"; exit 1; }
echo "    页面工具接口 OK"

echo "==> 5/9 导出全部设计交付站"
SITE_RESULT="$(curl -sf -X POST -b "$COOKIES" "$BASE/api/export-site")" || { echo "FAIL: 全量导出接口失败"; exit 1; }
SITE_URL="$(printf '%s' "$SITE_RESULT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["server"]["url"])')"
SITE_PATH="$(printf '%s' "$SITE_RESULT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["path"])')"
[ -f "$SITE_PATH/public/pages/smoke-test.html" ] || { echo "FAIL: 全量导出缺少页面"; exit 1; }
[ -f "$SITE_PATH/public/decisions/design-spec.md" ] || { echo "FAIL: 全量导出缺少设计决策"; exit 1; }
SITE_PAGE="$(curl -sf "$SITE_URL")" || { echo "FAIL: 设计交付站无法访问"; exit 1; }
printf '%s' "$SITE_PAGE" | grep -q '技术塔设计交付站' || { echo "FAIL: 设计交付站内容异常"; exit 1; }
echo "    全量导出 OK: $SITE_URL"

echo "==> 6/9 WebSocket 模拟点击"
node -e '
const [port, key] = process.argv.slice(1);
const ws = new WebSocket(`ws://localhost:${port}/?key=${key}`);
ws.addEventListener("open", () => {
  ws.send(JSON.stringify({ type: "click", choice: "a", text: "选项 A - 单栏", timestamp: Math.floor(Date.now() / 1000) }));
  setTimeout(() => ws.close(), 500);
});
ws.addEventListener("close", () => process.exit(0));
ws.addEventListener("error", () => process.exit(1));
setTimeout(() => process.exit(1), 5000);
' "$PORT" "$KEY" || { echo "FAIL: WebSocket 连接失败"; exit 1; }
sleep 0.5
[ -f "$STATE_DIR/events" ] && grep -q '"choice":"a"' "$STATE_DIR/events" || { echo "FAIL: events 未落盘"; exit 1; }
echo "    事件落盘 OK: $(tail -1 "$STATE_DIR/events")"

echo "==> 7/9 埋点与 Token 统计"
[ -f "$STATE_DIR/analytics.jsonl" ] && grep -q '"type":"click"' "$STATE_DIR/analytics.jsonl" || { echo "FAIL: analytics.jsonl 未持久化点击"; exit 1; }
STATS="$(curl -sf -b "$COOKIES" "$BASE/api/session-stats")" || { echo "FAIL: Token 统计接口失败"; exit 1; }
printf '%s' "$STATS" | grep -q '"estimatedTotalTokens"' || { echo "FAIL: Token 统计缺字段"; exit 1; }
echo "    埋点与 Token 统计 OK"

echo "==> 8/9 停止服务器"
"$SCRIPT_DIR/scripts/stop-server.sh" "$SESSION_DIR" >/dev/null || { echo "FAIL: stop-server 失败"; exit 1; }
sleep 1
if curl -s -m 2 "$BASE/" -o /dev/null 2>/dev/null; then echo "FAIL: 服务器仍在响应"; exit 1; fi
echo "    服务器已停止"

echo "==> 9/9 PASS：视觉伴侣冒烟测试全部通过"
