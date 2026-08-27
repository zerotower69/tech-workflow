# 技术塔视觉伴侣指南（Visual Companion Guide）

Browser-based visual brainstorming companion for showing mockups, diagrams, and options.

## When to Use

Decide per-question, not per-session. The test: **would the user understand this better by seeing it than reading it?**

**Use the browser** when the content itself is visual:

- **UI mockups** — wireframes, layouts, navigation structures, component designs
- **Architecture diagrams** — system components, data flow, relationship maps
- **Side-by-side visual comparisons** — comparing two layouts, two color schemes, two design directions
- **Design polish** — when the question is about look and feel, spacing, visual hierarchy
- **Spatial relationships** — state machines, flowcharts, entity relationships rendered as diagrams

**Use the terminal** when the content is text or tabular:

- **Requirements and scope questions** — "what does X mean?", "which features are in scope?"
- **Conceptual A/B/C choices** — picking between approaches described in words
- **Tradeoff lists** — pros/cons, comparison tables
- **Technical decisions** — API design, data modeling, architectural approach selection
- **Clarifying questions** — anything where the answer is words, not a visual preference

A question *about* a UI topic is not automatically a visual question. "What kind of wizard do you want?" is conceptual — use the terminal. "Which of these wizard layouts feels right?" is visual — use the browser.

## How It Works

The server watches a directory for HTML files and serves the newest one to the browser. You write HTML content to `screen_dir`, the user sees it in their browser and can click to select options. Selections are recorded to `state_dir/events` that you read on your next turn.

**Content fragments vs full documents:** If your HTML file starts with `<!DOCTYPE` or `<html`, the server serves it as-is (just injects the helper script). Otherwise, the server automatically wraps your content in the frame template — adding the header, CSS theme, connection status, and all interactive infrastructure. **Write content fragments by default.** Only write full documents when you need complete control over the page.

The companion bundles two mature npm libraries into the skill so sessions work
offline after installation: `html-to-image` powers one-click PNG export and
`gpt-tokenizer` estimates visual-session tokens with the `o200k_base` encoding.
Agents should use the built-in tools instead of generating per-export scripts or
re-reading screenshots merely to save them; this keeps repeated prompt/token
overhead low.

## Starting a Session

```bash
# Start AFTER the user approves the companion. --open auto-opens their browser on
# the first screen; --project-dir persists mockups and enables same-port restart.
scripts/start-server.sh --project-dir /path/to/project --open

# Returns: {"type":"server-started","port":52341,
#           "url":"http://localhost:52341/?key=ab12…",
#           "screen_dir":"/path/to/project/.tech-tower/brainstorm/12345-1706000000/content",
#           "state_dir":"/path/to/project/.tech-tower/brainstorm/12345-1706000000/state"}
```

Save `screen_dir` and `state_dir` from the response. With `--open`, the browser opens itself when you push the first screen — you don't need to ask the user to open it, but still share the URL as a fallback (headless/remote setups won't auto-open).

**The URL contains a session key (`?key=…`).** The server rejects any request
without it, so always give the user the **complete** URL from the `url` field —
never strip the query string, and never hand out a bare `http://host:port`. The
key gates HTTP and WebSocket access so a stray browser tab or another machine on
the network can't read the screens or inject events. After the first load the
browser remembers the key via a cookie, so reloads and `/files/*` assets work
without repeating it.

**Finding connection info:** The server writes its startup JSON to `$STATE_DIR/server-info`. If you launched the server in the background and didn't capture stdout, read that file to get the URL and port. When using `--project-dir`, check `<project>/.tech-tower/brainstorm/` for the session directory.

**Note:** Pass the project root as `--project-dir` so mockups persist in `.tech-tower/brainstorm/` and survive server restarts. Without it, files go to `/tmp` and get cleaned up. Remind the user to add `.tech-tower/` to `.gitignore` if it's not already there.

**Launching the server by platform:**

**Claude Code:**
```bash
# Default mode works — the script backgrounds the server itself.
scripts/start-server.sh --project-dir /path/to/project --open
```

On Windows, the script auto-detects and switches to foreground mode (which blocks the tool call). Use `run_in_background: true` on the Bash tool call so the server survives across conversation turns, then read `$STATE_DIR/server-info` on the next turn to get the URL and port.

**Codex:**
```bash
# Codex reaps background processes. The script auto-detects CODEX_CI and
# switches to foreground mode. Run it normally — no extra flags needed.
scripts/start-server.sh --project-dir /path/to/project --open
```

**Gemini CLI:**
```bash
# Use --foreground and set is_background: true on your shell tool call
# so the process survives across turns
scripts/start-server.sh --project-dir /path/to/project --open --foreground
```

**Copilot CLI:**
```bash
# Use --foreground and start the server via the bash tool with mode: "async"
# so the process survives across turns. Capture the returned shellId for
# read_bash / stop_bash if you need to interact with it later.
scripts/start-server.sh --project-dir /path/to/project --open --foreground
```

**Other environments:** The server must keep running in the background across conversation turns. If your environment reaps detached processes, use `--foreground` and launch the command with your platform's background execution mechanism.

If the URL is unreachable from your browser (common in remote/containerized setups), bind a non-loopback host:

```bash
scripts/start-server.sh \
  --project-dir /path/to/project \
  --host 0.0.0.0 \
  --url-host localhost
```

Use `--url-host` to control what hostname is printed in the returned URL JSON.

Optional privacy-filtered analytics reporting is opt-in. Local analytics is
always written, while remote reporting happens only when an endpoint is supplied:

```bash
scripts/start-server.sh \
  --project-dir /path/to/project \
  --analytics-endpoint https://analytics.example.com/visual-events \
  --analytics-project my-project
```

The remote payload excludes page HTML, clicked text, the session key, file paths,
and design assets. Do not put credentials in the endpoint URL; place an
authenticated same-machine collector in front when authentication is required.

## The Loop

1. **Check server is alive**, then **write HTML** to a new file in `screen_dir`:
   - **Required: confirm the server is alive before referring to the URL or pushing a screen.** Check that `$STATE_DIR/server-info` exists and `$STATE_DIR/server-stopped` does not. If it has shut down, restart it with `start-server.sh` using the **same `--project-dir`** — it reuses the same port, so the user's open tab reconnects on its own (it shows a "paused" overlay while the server is down) and you don't need to send a new URL. The server auto-exits after 4 hours idle (configurable with `--idle-timeout-minutes`).
   - Use semantic filenames: `platform.html`, `visual-style.html`, `layout.html`
   - **Never reuse filenames** — each screen gets a fresh file
   - Use your file-creation tool — **never use cat/heredoc** (dumps noise into terminal)
   - Server automatically serves the newest file

2. **Tell user what to expect and end your turn:**
   - Remind them of the URL (every step, not just first)
   - Give a brief text summary of what's on screen (e.g., "Showing 3 layout options for the homepage")
   - Ask them to respond in the terminal: "Take a look and let me know what you think. Click to select an option if you'd like."

3. **On your next turn** — after the user responds in the terminal:
   - Read `$STATE_DIR/events` if it exists — this contains the user's browser interactions (clicks, selections) as JSON lines
   - Merge with the user's terminal text to get the full picture
   - The terminal message is the primary feedback; `state_dir/events` provides structured interaction data

4. **Iterate or advance** — if feedback changes current screen, write a new file (e.g., `layout-v2.html`). Only move to the next question when the current step is validated.

5. **Unload when returning to terminal** — when the next step doesn't need the browser (e.g., a clarifying question, a tradeoff discussion), push a waiting screen to clear the stale content:

   ```html
   <!-- filename: waiting.html (or waiting-2.html, etc.) -->
   <div style="display:flex;align-items:center;justify-content:center;min-height:60vh">
     <p class="subtitle">Continuing in terminal...</p>
   </div>
   ```

   This prevents the user from staring at a resolved choice while the conversation has moved on. When the next visual question comes up, push a new content file as usual.

6. Repeat until done.

## Writing Content Fragments

Write just the content that goes inside the page. The server wraps it in the frame template automatically (header, theme CSS, connection status, and all interactive infrastructure).

**Minimal example:**

```html
<h2>Which layout works better?</h2>
<p class="subtitle">Consider readability and visual hierarchy</p>

<div class="options">
  <div class="option" data-choice="a" onclick="toggleSelect(this)">
    <div class="letter">A</div>
    <div class="content">
      <h3>Single Column</h3>
      <p>Clean, focused reading experience</p>
    </div>
  </div>
  <div class="option" data-choice="b" onclick="toggleSelect(this)">
    <div class="letter">B</div>
    <div class="content">
      <h3>Two Column</h3>
      <p>Sidebar navigation with main content</p>
    </div>
  </div>
</div>
```

That's it. No `<html>`, no CSS, no `<script>` tags needed. The server provides all of that.

## CSS Classes Available

The frame template provides these CSS classes for your content:

### Options (A/B/C choices)

```html
<div class="options">
  <div class="option" data-choice="a" onclick="toggleSelect(this)">
    <div class="letter">A</div>
    <div class="content">
      <h3>Title</h3>
      <p>Description</p>
    </div>
  </div>
</div>
```

**Multi-select:** Add `data-multiselect` to the container to let users select multiple options. Each click toggles the item's selected styling.

```html
<div class="options" data-multiselect>
  <!-- same option markup — users can select/deselect multiple -->
</div>
```

### Cards (visual designs)

```html
<div class="cards">
  <div class="card" data-choice="design1" onclick="toggleSelect(this)">
    <div class="card-image"><!-- mockup content --></div>
    <div class="card-body">
      <h3>Name</h3>
      <p>Description</p>
    </div>
  </div>
</div>
```

### Mockup container

```html
<div class="mockup">
  <div class="mockup-header">Preview: Dashboard Layout</div>
  <div class="mockup-body"><!-- your mockup HTML --></div>
</div>
```

### Split view (side-by-side)

```html
<div class="split">
  <div class="mockup"><!-- left --></div>
  <div class="mockup"><!-- right --></div>
</div>
```

### Pros/Cons

```html
<div class="pros-cons">
  <div class="pros"><h4>Pros</h4><ul><li>Benefit</li></ul></div>
  <div class="cons"><h4>Cons</h4><ul><li>Drawback</li></ul></div>
</div>
```

### Mock elements (wireframe building blocks)

```html
<div class="mock-nav">Logo | Home | About | Contact</div>
<div style="display: flex;">
  <div class="mock-sidebar">Navigation</div>
  <div class="mock-content">Main content area</div>
</div>
<button class="mock-button">Action Button</button>
<input class="mock-input" placeholder="Input field">
<div class="placeholder">Placeholder area</div>
```

### Typography and sections

- `h2` — page title
- `h3` — section heading
- `.subtitle` — secondary text below title
- `.section` — content block with bottom margin
- `.label` — small uppercase label text

## Browser Events Format

When the user clicks options in the browser, their interactions are recorded to `$STATE_DIR/events` (one JSON object per line). The file is cleared automatically when you push a new screen.

```jsonl
{"type":"click","choice":"a","text":"Option A - Simple Layout","timestamp":1706000101}
{"type":"click","choice":"c","text":"Option C - Complex Grid","timestamp":1706000108}
{"type":"click","choice":"b","text":"Option B - Hybrid","timestamp":1706000115}
```

The full event stream shows the user's exploration path — they may click multiple options before settling. The last `choice` event is typically the final selection, but the pattern of clicks can reveal hesitation or preferences worth asking about.

If `$STATE_DIR/events` doesn't exist, the user didn't interact with the browser — use only their terminal text.

## Floating Tool Plugins

Every page gets a collapsed `TT` floating ball. It can be dragged and docks to
either side, stays outside `data-tt-screen`, and is excluded from PNG exports.
Opening it exposes these built-ins:

- **页面** — visit any individual semantic HTML screen in the session.
- **导出 PNG** — browser-side export of only the app-page region.
- **导出 HTML** — one standalone HTML file per screen; local `/files/*` image,
  font, CSS, and script references are embedded as data URLs where possible.
- **导出所有** — package every screen, design-decision document, and a privacy-
  preserving analytics summary into a portable Express-powered review site.
- **取色器** — frequently used reference colors plus the browser `EyeDropper`
  pixel picker, with computed-style element picking as a fallback.
- **Token** — visual-session estimate, exact provider usage when supplied, screen
  count, and analytics-event count.

Add tools without editing the floating-ball shell. A page script can register a
plugin after the ready event:

```js
window.addEventListener('tech-tower:ready', ({ detail: api }) => {
  api.plugins.register({
    id: 'spacing-audit',
    label: '间距检查',
    icon: '↔',
    order: 60,
    render(container) {
      container.textContent = 'Plugin result';
    }
  });
});
```

Plugins may provide `render(container, api)` for a panel view or `run(api)` for
an immediate action. Registration returns an unregister function.

## Export All as a Design Review Site

The floating-ball **导出所有** plugin builds and opens a complete local review
site. The same operation is available as a reusable script for automation:

```bash
node visual-companion/scripts/export-design-site.cjs \
  --session-dir <会话目录> \
  --out <导出目录> \
  --title "项目设计评审" \
  --serve --open
```

`--out` is optional. Without it, the export is written under
`<会话目录>/exports/design-site-<timestamp>-<pid>/`. Use `--host` and `--port`
to override the loopback-only `127.0.0.1:4173` default; port `0` selects a free
port. An existing non-empty output is never overwritten unless `--clean` is
given, and cleanup is limited to directories carrying this exporter's marker.

The generated directory is self-contained and can be copied elsewhere:

```text
design-site-…/
├── public/
│   ├── index.html
│   ├── pages/*.html
│   ├── decisions/*.md
│   ├── data/analytics-summary.json
│   └── site-manifest.json
├── _runtime/express.cjs
├── serve.cjs
└── README.md
```

Start it later with `node serve.cjs --open`. The server exposes the static site
under a randomized preview path and defaults to loopback. Design decisions are
loaded from `design-spec.md`, `design-decisions.md`, `decisions.md`, or
`spec.md`; Markdown is rendered with `marked` and sanitized with `xss`. Only
aggregated analytics counts are exported—raw event rows and page interaction
text remain in the original session.

## Token Accounting and Analytics

`state/token-usage.jsonl` separates provider-reported usage from estimates.
When the host exposes exact counts, record them either from a page integration:

```js
brainstorm.tokenUsage({
  source: 'openai-api', model: 'gpt-5',
  inputTokens: 1200, outputTokens: 340, cachedInputTokens: 800
});
```

or from the terminal without asking the model to recompute them:

```bash
node scripts/record-token-usage.cjs \
  --state-dir "$STATE_DIR" --source openai-api --model gpt-5 \
  --input 1200 --output 340 --cached-input 800
```

The automatic estimate covers screen HTML plus browser interaction metadata; it
does **not** claim to be the Codex/API bill. The floating panel labels this scope.

All screen, selection, page-view, plugin, export, color, and token-record events
append to `state/analytics.jsonl` using schema
`tech-tower.visual-companion.event.v1`. Unlike `state/events`, this file is not
cleared when a new screen arrives, so it is suitable for later funnel and tool-
usage analysis. Remote reporting uses the same privacy-filtered event object.

## Design Tips

- **Scale fidelity to the question** — wireframes for layout, polish for polish questions
- **Explain the question on each page** — "Which layout feels more professional?" not just "Pick one"
- **Iterate before advancing** — if feedback changes current screen, write a new version
- **2-4 options max** per screen
- **Use real content when it matters** — for a photography portfolio, use actual images (Unsplash). Placeholder content obscures design issues.
- **Keep mockups simple** — focus on layout and structure, not pixel-perfect design

## File Naming

- Use semantic names: `platform.html`, `visual-style.html`, `layout.html`
- Never reuse filenames — each screen must be a new file
- For iterations: append version suffix like `layout-v2.html`, `layout-v3.html`
- Server serves newest file by modification time

## Cleaning Up

```bash
scripts/stop-server.sh $SESSION_DIR
```

If the session used `--project-dir`, mockup files persist in `.tech-tower/brainstorm/` for later reference. Only `/tmp` sessions get deleted on stop.

## Reference

- Frame template (CSS reference): [scripts/frame-template.html](scripts/frame-template.html)
- Helper script (client-side): [scripts/helper.js](scripts/helper.js)
- Session self-containment: every session start copies both files into the session directory (project sessions: `<project>/.tech-tower/brainstorm/<session-id>/`); the server reads the session copies first. Specs/records in the project SHOULD link `<session-dir>/frame-template.html` for later review.

## Snapshot Region Convention

- App-page mockups MUST wrap the page region in `<div data-tt-screen>…</div>`: `scripts/snapshot-prototype.cjs` and browser-MCP element screenshots crop by it, falling back to `#frame-content` when absent.
- Keep only the app page itself inside the region (no outer background or explanatory text) so snapshots serve as clean visual references.
