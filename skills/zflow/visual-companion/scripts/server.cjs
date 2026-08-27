const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ========== WebSocket Protocol (RFC 6455) ==========

const OPCODES = { TEXT: 0x01, CLOSE: 0x08, PING: 0x09, PONG: 0x0A };
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME_PAYLOAD_BYTES = 10 * 1024 * 1024;

function computeAcceptKey(clientKey) {
  return crypto.createHash('sha1').update(clientKey + WS_MAGIC).digest('base64');
}

function encodeFrame(opcode, payload) {
  const fin = 0x80;
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = fin | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = fin | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = fin | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;

  const secondByte = buffer[1];
  const opcode = buffer[0] & 0x0F;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLen = secondByte & 0x7F;
  let offset = 2;

  if (!masked) throw new Error('Client frames must be masked');

  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    const extendedLen = buffer.readBigUInt64BE(2);
    if (extendedLen > BigInt(MAX_FRAME_PAYLOAD_BYTES)) {
      throw new Error('WebSocket frame payload exceeds maximum allowed size');
    }
    payloadLen = Number(extendedLen);
    offset = 10;
  }

  if (payloadLen > MAX_FRAME_PAYLOAD_BYTES) {
    throw new Error('WebSocket frame payload exceeds maximum allowed size');
  }

  const maskOffset = offset;
  const dataOffset = offset + 4;
  const totalLen = dataOffset + payloadLen;
  if (buffer.length < totalLen) return null;

  const mask = buffer.slice(maskOffset, dataOffset);
  const data = Buffer.alloc(payloadLen);
  for (let i = 0; i < payloadLen; i++) {
    data[i] = buffer[dataOffset + i] ^ mask[i % 4];
  }

  return { opcode, payload: data, bytesConsumed: totalLen };
}

// ========== Configuration ==========

const PORT_FILE = process.env.BRAINSTORM_PORT_FILE || null;
const randomPort = () => 49152 + Math.floor(Math.random() * 16383);
// Prefer an explicit port, else the port this session last bound (so a restart
// reuses it and an already-open browser tab reconnects), else a random high port.
function preferredPort() {
  if (process.env.BRAINSTORM_PORT) return Number(process.env.BRAINSTORM_PORT);
  if (PORT_FILE) {
    try {
      const p = Number(fs.readFileSync(PORT_FILE, 'utf-8').trim());
      if (Number.isInteger(p) && p > 1023 && p < 65536) return p;
    } catch (e) { /* no prior port recorded */ }
  }
  return randomPort();
}
let PORT = preferredPort();
const HOST = process.env.BRAINSTORM_HOST || '127.0.0.1';
const URL_HOST = process.env.BRAINSTORM_URL_HOST || (HOST === '127.0.0.1' ? 'localhost' : HOST);
const SESSION_DIR = process.env.BRAINSTORM_DIR || '/tmp/brainstorm';
const CONTENT_DIR = path.join(SESSION_DIR, 'content');
const STATE_DIR = path.join(SESSION_DIR, 'state');
const ANALYTICS_FILE = path.join(STATE_DIR, 'analytics.jsonl');
const TOKEN_USAGE_FILE = path.join(STATE_DIR, 'token-usage.jsonl');
const ANALYTICS_ENDPOINT = process.env.BRAINSTORM_ANALYTICS_ENDPOINT || '';
const ANALYTICS_PROJECT = process.env.BRAINSTORM_ANALYTICS_PROJECT || '';
const COMPANION_NAME = '技术塔视觉伴侣';
const COMPANION_VERSION = (() => {
  try {
    const skill = fs.readFileSync(path.resolve(__dirname, '..', '..', 'SKILL.md'), 'utf-8');
    return skill.match(/^\s*version:\s*([^\s]+)\s*$/m)?.[1] || 'unknown';
  } catch (e) { return 'unknown'; }
})();
const COMPANION_REPO_URL = 'https://github.com/zerotower69/tech-workflow';
let ownerPid = process.env.BRAINSTORM_OWNER_PID ? Number(process.env.BRAINSTORM_OWNER_PID) : null;

let countTokens;
try {
  ({ countTokens } = require('./vendor/tokenizer.cjs'));
} catch (e) {
  // The bundled tokenizer should always ship with the skill. Keep a conservative
  // fallback for hand-copied legacy installs instead of breaking the server.
  countTokens = (value) => Math.ceil(Buffer.byteLength(String(value), 'utf8') / 3);
}

// Per-session secret key. The companion is reachable by any local browser tab
// and, when bound to a non-loopback host, by any host that can route to it.
// The key authenticates the real client uniformly across loopback, tunnel, and
// remote binds — and defeats DNS rebinding — where a Host/Origin allowlist
// cannot. It rides the served URL as ?key= and is mirrored into a cookie on
// first load so same-origin subresources and the WebSocket carry it for free.
// Persisted alongside the port (BRAINSTORM_TOKEN_FILE) so a restart keeps the
// same key and an already-open tab's cookie still validates.
const TOKEN_FILE = process.env.BRAINSTORM_TOKEN_FILE || null;
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function chmodOwnerOnly(file) {
  try { fs.chmodSync(file, 0o600); } catch (e) { /* best effort */ }
}

function initialToken() {
  if (process.env.BRAINSTORM_TOKEN) {
    return { value: process.env.BRAINSTORM_TOKEN, source: 'env' };
  }
  if (TOKEN_FILE) {
    try {
      const t = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
      if (/^[0-9a-f]{32,}$/i.test(t)) {
        chmodOwnerOnly(TOKEN_FILE);
        return { value: t, source: 'file' };
      }
    } catch (e) { /* no prior token recorded */ }
  }
  return { value: generateToken(), source: 'generated' };
}

const tokenInfo = initialToken();
let TOKEN = tokenInfo.value;
let tokenSource = tokenInfo.source;
let COOKIE_NAME = 'brainstorm-key-' + PORT; // refined to the actual bound port in onListen

const MIME_TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml'
};

// ========== Templates and Constants ==========

function waitingPage() {
  return renderBranding(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Brainstorm Companion</title>
<style>
body { font-family: system-ui, sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; }
h1 { color: #333; } p { color: #666; }
.brand { display: flex; align-items: center; min-width: 0; overflow: hidden; margin-bottom: 1.5rem; color: #666; font-size: 0.9rem; line-height: 1; }
.brand a { color: inherit; text-decoration: none; display: flex; align-items: center; gap: 0.5rem; min-width: 0; max-width: 100%; line-height: 1; }
.brand-copy { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1; transform: translateY(-1px); }
.brand-logo { display: block; height: 1em; width: auto; max-width: 180px; filter: invert(1); }
</style>
</head>
<body><!-- BRANDING --><h1>Brainstorm Companion</h1>
<p>Waiting for the agent to push a screen...</p></body></html>`);
}

const FORBIDDEN_PAGE = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Session key required</title>
<style>body { font-family: system-ui, sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; }
h1 { color: #333; } p { color: #666; } code { background: #f0f0f0; padding: 0.1em 0.3em; border-radius: 4px; }</style>
</head>
<body><h1>Session key required</h1>
<p>This page needs the full URL your coding agent gave you, including the
<code>?key=&hellip;</code> part. Copy the complete URL and open it again.</p></body></html>`;

function bootstrapPage(key) {
  const jsonKey = JSON.stringify(String(key));
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Opening Brainstorm Companion</title></head>
<body>
<script>
try { sessionStorage.setItem('brainstorm-session-key', ${jsonKey}); } catch (e) {}
location.replace('/');
</script>
</body>
</html>`;
}

// 优先读会话目录内的模板/脚本副本（start-server.sh 启动时已复制，工程内自包含），
// 缺失时回退 skill 自带版本（如直接 node server.cjs 手工启动）
function loadSessionAsset(name) {
  try {
    const sessionCopy = path.join(SESSION_DIR, name);
    if (fs.existsSync(sessionCopy)) return fs.readFileSync(sessionCopy, 'utf-8');
  } catch (e) { /* fall through */ }
  return fs.readFileSync(path.join(__dirname, name), 'utf-8');
}
const frameTemplate = loadSessionAsset('frame-template.html');
const helperScript = loadSessionAsset('helper.js');
const helperInjection = '<script>\n' + helperScript + '\n</script>';

// ========== Helper Functions ==========



function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function brandMarkup() {
  const text = escapeHtmlText(COMPANION_NAME + ' v' + COMPANION_VERSION);
  return '<div class="brand"><a href="' + COMPANION_REPO_URL + '"><span class="brand-copy">' + text + '</span></a></div>';
}

function renderBranding(html) {
  return html.split('<!-- BRANDING -->').join(brandMarkup());
}

function isFullDocument(html) {
  const trimmed = html.trimStart().toLowerCase();
  return trimmed.startsWith('<!doctype') || trimmed.startsWith('<html');
}

function wrapInFrame(content) {
  return renderBranding(frameTemplate).replace('<!-- CONTENT -->', content);
}

function listScreens() {
  return fs.readdirSync(CONTENT_DIR)
    .filter(f => !f.startsWith('.') && f.endsWith('.html'))
    .map(f => {
      const filePath = path.join(CONTENT_DIR, f);
      if (!isRegularFileInsideContentDir(filePath)) return null;
      const stat = fs.statSync(filePath);
      return { name: f, path: filePath, mtime: stat.mtime.getTime(), bytes: stat.size };
    })
    .filter(Boolean)
    .sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name));
}

function getNewestScreen() {
  const files = listScreens();
  return files.length > 0 ? files[files.length - 1].path : null;
}

function requestedScreen(url) {
  const q = url.indexOf('?');
  if (q < 0) return null;
  const requested = new URLSearchParams(url.slice(q + 1)).get('screen');
  if (!requested || path.basename(requested) !== requested || !requested.endsWith('.html')) return null;
  const filePath = path.join(CONTENT_DIR, requested);
  return isRegularFileInsideContentDir(filePath) ? filePath : null;
}

function screenClientContext(screenFile) {
  return '<script>window.__TT_COMPANION__=' + JSON.stringify({
    screen: screenFile ? path.basename(screenFile) : null,
  }).replace(/</g, '\\u003c') + ';</script>';
}

function renderScreen(screenFile, { interactive = true } = {}) {
  let html = screenFile
    ? (raw => isFullDocument(raw) ? raw : wrapInFrame(raw))(fs.readFileSync(screenFile, 'utf-8'))
    : waitingPage();
  if (!interactive) return html;
  const injection = screenClientContext(screenFile) +
    '\n<script src="/assets/html-to-image.js"></script>\n' + helperInjection;
  if (html.includes('</body>')) return html.replace('</body>', injection + '\n</body>');
  return html + injection;
}

function inlineContentAssets(html) {
  return html.replace(/(src|href)=(['"])\/files\/([^'"?#]+)(?:[?#][^'"]*)?\2/gi,
    (match, attr, quote, encodedName) => {
      let name;
      try { name = decodeURIComponent(encodedName); } catch (e) { return match; }
      if (!name || path.basename(name) !== name) return match;
      const filePath = path.join(CONTENT_DIR, name);
      if (!isRegularFileInsideContentDir(filePath)) return match;
      const mime = MIME_TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream';
      const data = fs.readFileSync(filePath).toString('base64');
      return `${attr}=${quote}data:${mime};base64,${data}${quote}`;
    });
}

function exportHtml(screenFile) {
  const raw = fs.readFileSync(screenFile, 'utf-8');
  let html = isFullDocument(raw) ? raw : wrapInFrame(raw);
  html = inlineContentAssets(html);
  const exportStyle = '<style>[data-tt-companion-chrome],.header{display:none!important}.main{height:100vh}</style>';
  if (html.includes('</head>')) html = html.replace('</head>', exportStyle + '\n</head>');
  else html = exportStyle + html;
  return html;
}

function urlHostForHttp(host) {
  const h = String(host);
  if (h.startsWith('[') && h.endsWith(']')) return h;
  return h.includes(':') ? '[' + h + ']' : h;
}

function companionUrl() {
  return 'http://' + urlHostForHttp(URL_HOST) + ':' + PORT + '/?key=' + TOKEN;
}

function browserLauncherForPlatform(url, {
  platform = process.platform,
  osRelease = require('os').release(),
  env = process.env
} = {}) {
  const isWSL = platform === 'linux' && /microsoft/i.test(osRelease);
  if (platform === 'darwin') return { bin: 'open', args: [url] };
  if (platform === 'win32' || isWSL) {
    return { bin: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  }
  if (env.DISPLAY || env.WAYLAND_DISPLAY) return { bin: 'xdg-open', args: [url] };
  return null;
}

function isRegularFileInsideContentDir(filePath) {
  let stat, realContentDir, realFilePath;
  try {
    stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) return false;
    if (!stat.isFile()) return false;
    if (stat.nlink !== 1) return false;
    realContentDir = fs.realpathSync(CONTENT_DIR);
    realFilePath = fs.realpathSync(filePath);
  } catch (e) {
    return false;
  }
  return realFilePath.startsWith(realContentDir + path.sep);
}

// ========== Authentication ==========

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

// A request is authorized if it carries the session key as ?key= or as the
// session cookie. Both are compared in constant time.
function isAuthorized(req) {
  const q = req.url.indexOf('?');
  if (q >= 0) {
    const params = new URLSearchParams(req.url.slice(q + 1));
    if (params.has('key')) {
      const key = params.get('key');
      return Boolean(key && timingSafeEqualStr(key, TOKEN));
    }
  }
  const cookie = parseCookies(req.headers['cookie'])[COOKIE_NAME];
  if (cookie && timingSafeEqualStr(cookie, TOKEN)) return true;
  return false;
}

function pathnameOf(url) {
  const q = url.indexOf('?');
  return q >= 0 ? url.slice(0, q) : url;
}

function queryKey(url) {
  const q = url.indexOf('?');
  if (q < 0) return null;
  return new URLSearchParams(url.slice(q + 1)).get('key');
}

function securityHeaders(headers = {}) {
  return {
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...headers
  };
}

function isAllowedWebSocketOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  if (!host) return false;
  return origin === 'http://' + host;
}

// ========== Session Metrics and Analytics ==========

function readJsonLines(file) {
  try {
    return fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (e) {
    return [];
  }
}

function finiteNonNegative(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function compactAnalyticsEvent(event, source) {
  const allowed = ['type', 'screen', 'choice', 'id', 'action', 'method', 'format', 'color', 'plugin', 'status', 'error'];
  const out = {
    schema: 'tech-tower.visual-companion.event.v1',
    eventId: crypto.randomUUID(),
    sessionId: path.basename(SESSION_DIR),
    project: ANALYTICS_PROJECT || undefined,
    source,
    occurredAt: new Date().toISOString(),
  };
  for (const key of allowed) {
    const value = event && event[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = typeof value === 'string' ? value.slice(0, 240) : value;
    }
  }
  out.type = out.type || 'unknown';
  out.estimatedTokens = countTokens(JSON.stringify(out));
  return out;
}

function reportAnalytics(event) {
  if (!ANALYTICS_ENDPOINT) return;
  let endpoint;
  try {
    endpoint = new URL(ANALYTICS_ENDPOINT);
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('unsupported protocol');
  } catch (e) {
    console.error('analytics endpoint ignored:', e.message);
    return;
  }
  fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(5000),
  }).then((response) => {
    if (!response.ok) console.error('analytics report failed:', response.status);
  }).catch((error) => console.error('analytics report failed:', error.message));
}

function recordAnalytics(event, source = 'browser') {
  const compact = compactAnalyticsEvent(event, source);
  fs.appendFileSync(ANALYTICS_FILE, JSON.stringify(compact) + '\n', { mode: 0o600 });
  reportAnalytics(compact);
  return compact;
}

function recordTokenUsage(event) {
  const row = {
    schema: 'tech-tower.visual-companion.token-usage.v1',
    occurredAt: new Date().toISOString(),
    source: String(event.source || 'provider').slice(0, 80),
    model: String(event.model || 'unknown').slice(0, 120),
    inputTokens: finiteNonNegative(event.inputTokens),
    outputTokens: finiteNonNegative(event.outputTokens),
    cachedInputTokens: finiteNonNegative(event.cachedInputTokens),
  };
  fs.appendFileSync(TOKEN_USAGE_FILE, JSON.stringify(row) + '\n', { mode: 0o600 });
  recordAnalytics({ type: 'token_usage_recorded', status: 'ok' }, 'server');
  return row;
}

function sessionStats() {
  const screens = listScreens();
  const screenTokens = screens.reduce((sum, screen) => {
    try { return sum + countTokens(fs.readFileSync(screen.path, 'utf-8')); }
    catch (e) { return sum; }
  }, 0);
  const analytics = readJsonLines(ANALYTICS_FILE);
  const interactionTokens = analytics.reduce((sum, event) => sum + finiteNonNegative(event.estimatedTokens), 0);
  const usage = readJsonLines(TOKEN_USAGE_FILE);
  const reported = usage.reduce((totals, row) => ({
    inputTokens: totals.inputTokens + finiteNonNegative(row.inputTokens),
    outputTokens: totals.outputTokens + finiteNonNegative(row.outputTokens),
    cachedInputTokens: totals.cachedInputTokens + finiteNonNegative(row.cachedInputTokens),
  }), { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });
  return {
    scope: 'visual-companion-session',
    estimate: true,
    screenCount: screens.length,
    screenTokens,
    interactionTokens,
    estimatedTotalTokens: screenTokens + interactionTokens,
    reported,
    reportedTotalTokens: reported.inputTokens + reported.outputTokens,
    analyticsEvents: analytics.length,
    analyticsReporting: Boolean(ANALYTICS_ENDPOINT),
  };
}

function jsonResponse(res, value, status = 200) {
  res.writeHead(status, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
  res.end(JSON.stringify(value));
}

// ========== HTTP Request Handler ==========

function handleRequest(req, res) {
  if (!isAuthorized(req)) {
    res.writeHead(403, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
    res.end(FORBIDDEN_PAGE);
    return;
  }
  touchActivity(); // only authorized requests count as activity

  // Mirror the key into a cookie so same-origin subresources (/files/*) can
  // authenticate after bootstrap. HttpOnly keeps it away from page scripts; the
  // WebSocket Origin check below is what blocks cross-origin localhost injection.
  res.setHeader('Set-Cookie',
    COOKIE_NAME + '=' + TOKEN + '; HttpOnly; SameSite=Strict; Path=/');

  const pathname = pathnameOf(req.url);
  const keyFromQuery = queryKey(req.url);
  if (req.method === 'GET' && pathname === '/' && keyFromQuery && timingSafeEqualStr(keyFromQuery, TOKEN)) {
    res.writeHead(200, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
    res.end(bootstrapPage(keyFromQuery));
  } else if (req.method === 'GET' && pathname === '/') {
    const screenFile = requestedScreen(req.url) || getNewestScreen();
    const html = renderScreen(screenFile);
    res.writeHead(200, securityHeaders({ 'Content-Type': 'text/html; charset=utf-8' }));
    res.end(html);
  } else if (req.method === 'GET' && pathname === '/api/screens') {
    jsonResponse(res, {
      current: path.basename(requestedScreen(req.url) || getNewestScreen() || ''),
      screens: listScreens().map(({ name, mtime, bytes }) => ({ name, mtime, bytes })),
    });
  } else if (req.method === 'GET' && pathname === '/api/session-stats') {
    jsonResponse(res, sessionStats());
  } else if (req.method === 'POST' && pathname === '/api/export-site') {
    exportDesignSite(res);
  } else if (req.method === 'GET' && pathname === '/assets/html-to-image.js') {
    const vendorPath = path.join(__dirname, 'vendor', 'html-to-image.js');
    if (!fs.existsSync(vendorPath)) {
      res.writeHead(404, securityHeaders());
      res.end('Not found');
      return;
    }
    res.writeHead(200, securityHeaders({ 'Content-Type': 'application/javascript; charset=utf-8' }));
    res.end(fs.readFileSync(vendorPath));
  } else if (req.method === 'GET' && pathname.startsWith('/export/html/')) {
    let fileName;
    try { fileName = decodeURIComponent(pathname.slice('/export/html/'.length)); }
    catch (e) { fileName = ''; }
    const filePath = path.join(CONTENT_DIR, fileName);
    if (!fileName || path.basename(fileName) !== fileName || !fileName.endsWith('.html') || !isRegularFileInsideContentDir(filePath)) {
      res.writeHead(404, securityHeaders());
      res.end('Not found');
      return;
    }
    recordAnalytics({ type: 'export_html', screen: fileName, format: 'html', status: 'ok' });
    res.writeHead(200, securityHeaders({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
    }));
    res.end(exportHtml(filePath));
  } else if (req.method === 'GET' && pathname.startsWith('/files/')) {
    const fileName = path.basename(pathname.slice(7));
    const filePath = path.join(CONTENT_DIR, fileName);
    // Reject empty/dotfile names and anything that isn't a regular file —
    // `/files/` would otherwise resolve to CONTENT_DIR and crash readFileSync (EISDIR).
    if (!fileName || fileName.startsWith('.') || !isRegularFileInsideContentDir(filePath)) {
      res.writeHead(404, securityHeaders());
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, securityHeaders({ 'Content-Type': contentType }));
    res.end(fs.readFileSync(filePath));
  } else {
    res.writeHead(404, securityHeaders());
    res.end('Not found');
  }
}

// ========== WebSocket Connection Handling ==========

const clients = new Set();
const designSiteProcesses = new Set();

function handleUpgrade(req, socket) {
  if (!isAuthorized(req) || !isAllowedWebSocketOrigin(req)) { socket.destroy(); return; }

  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  const accept = computeAcceptKey(key);
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );

  let buffer = Buffer.alloc(0);
  clients.add(socket);

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length > 0) {
      let result;
      try {
        result = decodeFrame(buffer);
      } catch (e) {
        socket.end(encodeFrame(OPCODES.CLOSE, Buffer.alloc(0)));
        clients.delete(socket);
        return;
      }
      if (!result) break;
      buffer = buffer.slice(result.bytesConsumed);

      switch (result.opcode) {
        case OPCODES.TEXT:
          handleMessage(result.payload.toString());
          break;
        case OPCODES.CLOSE:
          socket.end(encodeFrame(OPCODES.CLOSE, Buffer.alloc(0)));
          clients.delete(socket);
          return;
        case OPCODES.PING:
          socket.write(encodeFrame(OPCODES.PONG, result.payload));
          break;
        case OPCODES.PONG:
          break;
        default: {
          const closeBuf = Buffer.alloc(2);
          closeBuf.writeUInt16BE(1003);
          socket.end(encodeFrame(OPCODES.CLOSE, closeBuf));
          clients.delete(socket);
          return;
        }
      }
    }
  });

  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
}

function handleMessage(text) {
  let event;
  try {
    event = JSON.parse(text);
  } catch (e) {
    console.error('Failed to parse WebSocket message:', e.message);
    return;
  }
  if (!event || typeof event !== 'object' || Array.isArray(event)) return;
  touchActivity();
  console.log(JSON.stringify({ source: 'user-event', ...event }));
  if (event.type === 'token_usage') {
    recordTokenUsage(event);
    return;
  }
  recordAnalytics(event);
  if (event && event.choice) {
    const eventsFile = path.join(STATE_DIR, 'events');
    fs.appendFileSync(eventsFile, JSON.stringify(event) + '\n');
  }
}

function broadcast(msg) {
  const frame = encodeFrame(OPCODES.TEXT, Buffer.from(JSON.stringify(msg)));
  for (const socket of clients) {
    try { socket.write(frame); } catch (e) { clients.delete(socket); }
  }
}

function exportDesignSite(res) {
  const childProcess = require('node:child_process');
  const exporter = path.join(__dirname, 'export-design-site.cjs');
  const child = childProcess.spawn(process.execPath, [
    exporter, '--session-dir', SESSION_DIR, '--serve', '--port', '0'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  designSiteProcesses.add(child);
  let stdout = '';
  let stderr = '';
  let settled = false;
  const timeout = setTimeout(() => finish(new Error('全量站点导出超时')), 20000);

  function finish(error, payload) {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (error) {
      try { child.kill(); } catch (killError) {}
      designSiteProcesses.delete(child);
      recordAnalytics({ type: 'export_site', format: 'site', status: 'error', error: error.message }, 'server');
      jsonResponse(res, { status: 'error', error: error.message }, 500);
      return;
    }
    recordAnalytics({ type: 'export_site', format: 'site', status: 'ok' }, 'server');
    jsonResponse(res, payload);
  }

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
    const newline = stdout.indexOf('\n');
    if (newline < 0) return;
    try { finish(null, JSON.parse(stdout.slice(0, newline))); }
    catch (error) { finish(new Error('导出器返回了无效结果')); }
  });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString().slice(0, 4000); });
  child.on('error', (error) => finish(error));
  child.on('exit', (code) => {
    designSiteProcesses.delete(child);
    if (!settled) finish(new Error(stderr.trim() || `导出器提前退出 (${code})`));
  });
}

// Best-effort: open the user's browser the first time a screen is actually ready
// to show. Skips when disabled, on a non-loopback (remote) bind, or when a
// browser is already connected. Override the launcher with BRAINSTORM_OPEN_CMD.
let browserOpened = false;
function maybeOpenBrowser() {
  if (browserOpened) return;
  browserOpened = true;
  if (!process.env.BRAINSTORM_OPEN) return; // opt-in: only after the user approves the companion
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') return;
  if (clients.size > 0) return; // the user already opened it
  const url = companionUrl(); // must carry the key or the gate 403s it
  const cp = require('child_process');
  // Operator-provided launcher: run as given (this env var is trusted operator input).
  if (process.env.BRAINSTORM_OPEN_CMD) {
    try { cp.exec(process.env.BRAINSTORM_OPEN_CMD + ' ' + JSON.stringify(url), () => {}); } catch (e) { /* best effort */ }
    return;
  }
  // Platform launchers: pass the URL as an argv element via execFile (no shell),
  // so a url-host containing shell metacharacters can't inject a command.
  const launcher = browserLauncherForPlatform(url);
  if (!launcher) return; // headless: nothing to open
  try { cp.execFile(launcher.bin, launcher.args, () => {}); } catch (e) { /* best effort */ }
}

// ========== Activity Tracking ==========

// Idle timeout: shut down after this long with no activity. Default 4 hours;
// override with BRAINSTORM_IDLE_TIMEOUT_MS (start-server.sh: --idle-timeout-minutes).
const IDLE_TIMEOUT_MS = (() => {
  const ms = Number(process.env.BRAINSTORM_IDLE_TIMEOUT_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : 4 * 60 * 60 * 1000;
})();
// How often the watchdog checks for owner-death / idleness. Configurable mainly
// so tests can run fast; production default is 60s.
const LIFECYCLE_CHECK_MS = (() => {
  const ms = Number(process.env.BRAINSTORM_LIFECYCLE_CHECK_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : 60 * 1000;
})();
let lastActivity = Date.now();

function touchActivity() {
  lastActivity = Date.now();
}

// ========== File Watching ==========

const debounceTimers = new Map();

// ========== Server Startup ==========

function startServer() {
  if (!fs.existsSync(CONTENT_DIR)) fs.mkdirSync(CONTENT_DIR, { recursive: true });
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });

  // Track known files to distinguish new screens from updates.
  // macOS fs.watch reports 'rename' for both new files and overwrites,
  // so we can't rely on eventType alone.
  const knownFiles = new Set(
    fs.readdirSync(CONTENT_DIR).filter(f => !f.startsWith('.') && f.endsWith('.html'))
  );

  const server = http.createServer(handleRequest);
  server.on('upgrade', handleUpgrade);

  const watcher = fs.watch(CONTENT_DIR, (eventType, filename) => {
    if (!filename || filename.startsWith('.') || !filename.endsWith('.html')) return;

    if (debounceTimers.has(filename)) clearTimeout(debounceTimers.get(filename));
    debounceTimers.set(filename, setTimeout(() => {
      debounceTimers.delete(filename);
      const filePath = path.join(CONTENT_DIR, filename);

      if (!fs.existsSync(filePath)) return; // file was deleted
      touchActivity();

      if (!knownFiles.has(filename)) {
        knownFiles.add(filename);
        const eventsFile = path.join(STATE_DIR, 'events');
        if (fs.existsSync(eventsFile)) fs.unlinkSync(eventsFile);
        console.log(JSON.stringify({ type: 'screen-added', file: filePath }));
        recordAnalytics({ type: 'screen_added', screen: filename, status: 'ok' }, 'server');
        maybeOpenBrowser();
      } else {
        console.log(JSON.stringify({ type: 'screen-updated', file: filePath }));
        recordAnalytics({ type: 'screen_updated', screen: filename, status: 'ok' }, 'server');
      }

      broadcast({ type: 'reload' });
    }, 100));
  });
  watcher.on('error', (err) => console.error('fs.watch error:', err.message));

  function shutdown(reason) {
    console.log(JSON.stringify({ type: 'server-stopped', reason }));
    const infoFile = path.join(STATE_DIR, 'server-info');
    if (fs.existsSync(infoFile)) fs.unlinkSync(infoFile);
    fs.writeFileSync(
      path.join(STATE_DIR, 'server-stopped'),
      JSON.stringify({ reason, timestamp: Date.now() }) + '\n'
    );
    watcher.close();
    clearInterval(lifecycleCheck);
    // Close any upgraded WebSocket sockets so server.close() can complete and
    // the process actually exits instead of lingering on an open connection.
    for (const socket of clients) {
      try { socket.destroy(); } catch (e) { /* already gone */ }
    }
    for (const child of designSiteProcesses) {
      try { child.kill(); } catch (e) { /* already gone */ }
    }
    designSiteProcesses.clear();
    server.close(() => process.exit(0));
  }

  function ownerAlive() {
    if (!ownerPid) return true;
    try { process.kill(ownerPid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
  }

  // Periodically exit if the owner process died or we've been idle too long.
  const lifecycleCheck = setInterval(() => {
    if (!ownerAlive()) shutdown('owner process exited');
    else if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) shutdown('idle timeout');
  }, LIFECYCLE_CHECK_MS);
  lifecycleCheck.unref();

  // Validate owner PID at startup. If it's already dead, the PID resolution
  // was wrong (common on WSL, Tailscale SSH, and cross-user scenarios).
  // Disable monitoring and rely on the idle timeout instead.
  if (ownerPid) {
    try { process.kill(ownerPid, 0); }
    catch (e) {
      if (e.code !== 'EPERM') {
        console.log(JSON.stringify({ type: 'owner-pid-invalid', pid: ownerPid, reason: 'dead at startup' }));
        ownerPid = null;
      }
    }
  }

  // If the preferred port is already taken (e.g. a previous server is still
  // alive), fall back to a random port once instead of failing.
  let triedFallback = false;

  function onListen() {
    // Cookie name keys on the ACTUAL bound port (may differ from the preferred
    // one after an EADDRINUSE fallback) so it can't collide with another server's
    // cookie in the shared localhost jar.
    COOKIE_NAME = 'brainstorm-key-' + PORT;
    // Record the bound port AND token so the next restart of this session reuses
    // them — but ONLY when we got our preferred port. On a fallback we bound a
    // *different* port because someone else holds the preferred one; persisting
    // would overwrite the shared files and strand that other session's open tab.
    if (PORT_FILE && !triedFallback) {
      try { fs.writeFileSync(PORT_FILE, String(PORT)); } catch (e) { /* best effort */ }
      if (TOKEN_FILE) {
        try {
          fs.writeFileSync(TOKEN_FILE, TOKEN, { mode: 0o600 });
          chmodOwnerOnly(TOKEN_FILE);
        } catch (e) { /* best effort */ }
      }
    }
    const info = JSON.stringify({
      type: 'server-started', port: Number(PORT), host: HOST,
      url_host: URL_HOST, url: companionUrl(),
      screen_dir: CONTENT_DIR, state_dir: STATE_DIR, idle_timeout_ms: IDLE_TIMEOUT_MS,
      analytics_file: ANALYTICS_FILE, analytics_reporting: Boolean(ANALYTICS_ENDPOINT)
    });
    console.log(info);
    // server-info embeds the key — keep it owner-only.
    fs.writeFileSync(path.join(STATE_DIR, 'server-info'), info + '\n', { mode: 0o600 });
  }

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && !triedFallback) {
      if (tokenSource === 'env') {
        console.error('Server failed to bind: preferred port is in use and BRAINSTORM_TOKEN is set; refusing fallback with explicit token');
        process.exit(1);
      }
      triedFallback = true;
      PORT = randomPort();
      if (tokenSource === 'file') {
        TOKEN = generateToken();
        tokenSource = 'generated-fallback';
      }
      server.listen(PORT, HOST, onListen);
    } else {
      console.error('Server failed to bind:', err.message);
      process.exit(1);
    }
  });
  server.listen(PORT, HOST, onListen);
}

if (require.main === module) {
  startServer();
}

module.exports = {
  computeAcceptKey,
  encodeFrame,
  decodeFrame,
  browserLauncherForPlatform,
  compactAnalyticsEvent,
  exportHtml,
  sessionStats,
  OPCODES,
  MAX_FRAME_PAYLOAD_BYTES
};
