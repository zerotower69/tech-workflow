(function() {
  'use strict';

  const MIN_RECONNECT_MS = 500;
  const MAX_RECONNECT_MS = 30000;
  const TOMBSTONE_AFTER_MS = 15000;

  function nextReconnectDelay(current, max) {
    return Math.min(current * 2, max);
  }

  function rgbToHex(value) {
    if (!value || value === 'transparent') return null;
    if (/^#[0-9a-f]{3,8}$/i.test(value)) return value.toUpperCase();
    const match = value.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)(?:\D+(\d*(?:\.\d+)?))?\s*\)$/i);
    if (!match || (match[4] !== undefined && Number(match[4]) === 0)) return null;
    return '#' + [match[1], match[2], match[3]]
      .map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))).toString(16).padStart(2, '0'))
      .join('').toUpperCase();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { nextReconnectDelay, rgbToHex, MIN_RECONNECT_MS, MAX_RECONNECT_MS, TOMBSTONE_AFTER_MS };
  }
  if (typeof window === 'undefined') return;

  const context = window.__TT_COMPANION__ || {};
  const plugins = new Map();
  let ws = null;
  let eventQueue = [];
  let reconnectDelay = MIN_RECONNECT_MS;
  let reconnectTimer = null;
  let disconnectedSince = null;
  let everConnected = false;
  let tombstoneShown = false;
  let toolRoot = null;
  let toolPanel = null;
  let toolContent = null;

  function sessionKey() {
    try { return window.sessionStorage && window.sessionStorage.getItem('brainstorm-session-key'); }
    catch (e) { return null; }
  }

  function websocketUrl() {
    const key = sessionKey();
    return 'ws://' + window.location.host + (key ? '/?key=' + encodeURIComponent(key) : '');
  }

  function reloadAfterRecovery() {
    const key = sessionKey();
    if (key) window.location.replace('/?key=' + encodeURIComponent(key));
    else window.location.reload();
  }

  function setStatus(state) {
    const el = document.querySelector('.status');
    if (!el) return;
    const map = {
      connecting: ['Connecting…', 'var(--text-tertiary)'],
      connected: ['Connected', 'var(--success)'],
      reconnecting: ['Reconnecting…', 'var(--warning)'],
      disconnected: ['Disconnected', 'var(--error)']
    };
    const current = map[state] || map.disconnected;
    el.textContent = current[0];
    el.style.setProperty('--status-color', current[1]);
  }

  function showTombstone() {
    if (tombstoneShown) return;
    tombstoneShown = true;
    const el = document.createElement('div');
    el.id = 'bs-tombstone';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:2rem;text-align:center;background:rgba(20,20,22,.92);color:#f5f5f7;font-family:system-ui,sans-serif';
    el.innerHTML = '<div style="max-width:480px"><h2 style="margin:0 0 .5rem;font-weight:600">Companion paused</h2><p style="margin:0;opacity:.85">Ask your coding agent to bring it back. This page reconnects automatically.</p></div>';
    if (document.body) document.body.appendChild(el);
  }

  function connect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    setStatus(everConnected ? 'reconnecting' : 'connecting');
    ws = new WebSocket(websocketUrl());
    ws.onopen = () => {
      const recovered = tombstoneShown;
      everConnected = true;
      disconnectedSince = null;
      reconnectDelay = MIN_RECONNECT_MS;
      tombstoneShown = false;
      setStatus('connected');
      eventQueue.forEach((event) => ws.send(JSON.stringify(event)));
      eventQueue = [];
      if (recovered) reloadAfterRecovery();
    };
    ws.onmessage = (message) => {
      let data;
      try { data = JSON.parse(message.data); } catch (e) { return; }
      if (data.type === 'reload') window.location.reload();
    };
    ws.onclose = () => {
      ws = null;
      if (disconnectedSince === null) disconnectedSince = Date.now();
      if (Date.now() - disconnectedSince >= TOMBSTONE_AFTER_MS) {
        setStatus('disconnected');
        showTombstone();
      } else setStatus('reconnecting');
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = nextReconnectDelay(reconnectDelay, MAX_RECONNECT_MS);
    };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }

  function sendEvent(event) {
    const payload = { screen: context.screen || null, timestamp: Date.now(), ...event };
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    else eventQueue.push(payload);
  }

  function toast(message) {
    let el = document.getElementById('tt-tool-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tt-tool-toast';
      el.dataset.ttCompanionChrome = '';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function copyText(text) {
    const done = () => toast('已复制 ' + text);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(done);
    }
    const input = document.createElement('textarea');
    input.value = text;
    input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    done();
    return Promise.resolve();
  }

  function screenRegion() {
    return document.querySelector('[data-tt-screen]') || document.querySelector('#frame-content') || document.body;
  }

  function fileStem() {
    return (context.screen || 'visual-companion').replace(/\.html$/i, '').replace(/[^A-Za-z0-9._-]+/g, '-');
  }

  function download(url, name) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function exportPng() {
    if (!window.htmlToImage || !window.htmlToImage.toPng) throw new Error('图片导出组件未加载');
    const target = screenRegion();
    const rect = target.getBoundingClientRect();
    const pixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1, Math.sqrt(16000000 / Math.max(1, rect.width * rect.height))));
    const background = getComputedStyle(target).backgroundColor;
    const dataUrl = await window.htmlToImage.toPng(target, {
      cacheBust: true,
      pixelRatio,
      backgroundColor: background === 'rgba(0, 0, 0, 0)' ? '#FFFFFF' : background,
      filter: (node) => !(node.dataset && node.dataset.ttCompanionChrome !== undefined),
    });
    download(dataUrl, fileStem() + '.png');
    sendEvent({ type: 'export_image', format: 'png', plugin: 'export-image', status: 'ok' });
    toast('PNG 已导出');
  }

  function exportStandaloneHtml() {
    if (!context.screen) throw new Error('当前没有可导出的页面');
    download('/export/html/' + encodeURIComponent(context.screen), context.screen);
    sendEvent({ type: 'export_html_requested', format: 'html', plugin: 'export-html', status: 'ok' });
    toast('HTML 已导出');
  }

  async function exportAllSite(container) {
    container.innerHTML = '<div class="tt-view-head"><strong>导出所有</strong></div><p class="tt-hint">正在生成页面索引、独立 HTML、设计决策与 Express 预览站点…</p>';
    const response = await fetch('/api/export-site', { method: 'POST' });
    const result = await response.json();
    if (!response.ok || result.status !== 'ok') throw new Error(result.error || '全量导出失败');
    container.innerHTML = '<div class="tt-view-head"><strong>全量站点已生成</strong></div>';
    const summary = document.createElement('div');
    summary.className = 'tt-site-result';
    const counts = document.createElement('p');
    counts.textContent = `${result.pages} 个页面 · ${result.decisions} 份设计决策 · ${result.analyticsEvents} 条分析事件`;
    const output = document.createElement('code');
    output.textContent = result.path;
    const link = document.createElement('a');
    link.href = result.server.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = '打开设计交付站 ↗';
    summary.append(counts, output, link);
    container.appendChild(summary);
    sendEvent({ type: 'export_site_requested', format: 'site', plugin: 'export-site', status: 'ok' });
    toast('全量设计站点已生成');
  }

  function collectColors() {
    const counts = new Map();
    const add = (value) => {
      const hex = rgbToHex(value);
      if (hex) counts.set(hex, (counts.get(hex) || 0) + 1);
    };
    const region = screenRegion();
    [region, ...region.querySelectorAll('*')].slice(0, 2500).forEach((node) => {
      const style = getComputedStyle(node);
      add(style.color);
      add(style.backgroundColor);
      add(style.borderTopColor);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
  }

  function beginElementPicker() {
    collapseTools();
    toast('点击页面任意元素提取颜色');
    const handler = (event) => {
      if (event.target.closest('[data-tt-companion-chrome]')) return;
      event.preventDefault();
      event.stopPropagation();
      const style = getComputedStyle(event.target);
      const color = rgbToHex(style.backgroundColor) || rgbToHex(style.color) || rgbToHex(style.borderTopColor);
      document.removeEventListener('click', handler, true);
      if (!color) { toast('此处未识别到颜色'); return; }
      copyText(color);
      sendEvent({ type: 'color_pick', color, method: 'element', plugin: 'color-picker', status: 'ok' });
    };
    document.addEventListener('click', handler, true);
  }

  async function useEyeDropper() {
    if (!window.EyeDropper) { beginElementPicker(); return; }
    const result = await new window.EyeDropper().open();
    const color = result.sRGBHex.toUpperCase();
    await copyText(color);
    sendEvent({ type: 'color_pick', color, method: 'eyedropper', plugin: 'color-picker', status: 'ok' });
  }

  function renderColorPlugin(container) {
    const colors = collectColors();
    container.innerHTML = '<div class="tt-view-head"><strong>参考颜色</strong><button type="button" data-eye>屏幕取色</button></div><div class="tt-swatches"></div><p class="tt-hint">点击色块复制；“屏幕取色”支持像素级取色，不支持时回退到元素取色。</p>';
    const swatches = container.querySelector('.tt-swatches');
    colors.forEach(([color, count]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tt-swatch';
      button.innerHTML = `<i style="--swatch:${color}"></i><span>${color}</span><small>${count}</small>`;
      button.addEventListener('click', () => {
        copyText(color);
        sendEvent({ type: 'color_copy', color, method: 'palette', plugin: 'color-picker', status: 'ok' });
      });
      swatches.appendChild(button);
    });
    container.querySelector('[data-eye]').addEventListener('click', () => useEyeDropper().catch((error) => toast(error.message)));
  }

  async function renderPagesPlugin(container) {
    const response = await fetch('/api/screens');
    const data = await response.json();
    container.innerHTML = '<div class="tt-view-head"><strong>页面</strong></div><div class="tt-page-list"></div>';
    const list = container.querySelector('.tt-page-list');
    data.screens.forEach((screen, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tt-page-item' + (screen.name === context.screen ? ' active' : '');
      const number = document.createElement('span');
      const name = document.createElement('b');
      number.textContent = String(index + 1);
      name.textContent = screen.name;
      button.append(number, name);
      button.addEventListener('click', () => {
        sendEvent({ type: 'page_change', action: screen.name, plugin: 'pages', status: 'ok' });
        window.location.href = '/?screen=' + encodeURIComponent(screen.name);
      });
      list.appendChild(button);
    });
  }

  function compactNumber(value) {
    return value >= 1000 ? (value / 1000).toFixed(value >= 10000 ? 0 : 1) + 'k' : String(value);
  }

  async function renderStatsPlugin(container) {
    const response = await fetch('/api/session-stats');
    const stats = await response.json();
    container.innerHTML = `<div class="tt-view-head"><strong>会话统计</strong></div>
      <div class="tt-stat-grid">
        <div><b>≈ ${compactNumber(stats.estimatedTotalTokens)}</b><span>视觉会话 Token 估算</span></div>
        <div><b>${stats.screenCount}</b><span>页面</span></div>
        <div><b>${stats.analyticsEvents}</b><span>埋点事件</span></div>
        <div><b>${compactNumber(stats.reportedTotalTokens)}</b><span>已上报官方用量</span></div>
        <div><b>${stats.analyticsReporting ? '已开启' : '仅本地'}</b><span>埋点模式</span></div>
      </div>
      <p class="tt-hint">估算仅覆盖页面 HTML 与浏览器交互，不等同于 Codex 账单；若宿主能取得官方 usage，可调用 brainstorm.tokenUsage(...) 写入精确值。</p>`;
  }

  function injectToolStyles() {
    const style = document.createElement('style');
    style.dataset.ttCompanionChrome = '';
    style.textContent = `
      #tt-floating-tools{position:fixed;right:22px;bottom:22px;z-index:2147483000;font:13px/1.4 system-ui,-apple-system,sans-serif;color:#19191b;pointer-events:none}
      #tt-floating-tools *{box-sizing:border-box}#tt-floating-tools button{font:inherit}
      #tt-tool-ball{pointer-events:auto;width:48px;height:48px;border:1px solid rgba(255,255,255,.3);border-radius:50%;background:#17171a;color:white;box-shadow:0 8px 28px rgba(0,0,0,.28);cursor:grab;display:grid;place-items:center;font-weight:750;letter-spacing:-.06em;user-select:none;touch-action:none}
      #tt-tool-ball:hover{transform:translateY(-1px)}#tt-tool-ball:focus-visible{outline:3px solid #6d8cff;outline-offset:3px}
      #tt-tool-panel{pointer-events:auto;position:absolute;right:0;bottom:58px;width:min(340px,calc(100vw - 28px));max-height:min(560px,calc(100vh - 100px));overflow:auto;background:rgba(255,255,255,.96);backdrop-filter:blur(18px);border:1px solid rgba(0,0,0,.12);border-radius:18px;box-shadow:0 18px 54px rgba(0,0,0,.24);padding:12px;transform-origin:bottom right;transition:.16s ease}
      #tt-floating-tools[data-side="left"] #tt-tool-panel{left:0;right:auto;transform-origin:bottom left}
      #tt-tool-panel[hidden]{display:block;opacity:0;visibility:hidden;transform:scale(.94) translateY(8px);pointer-events:none}
      .tt-panel-head{display:flex;align-items:center;justify-content:space-between;padding:2px 2px 10px}.tt-panel-head strong{font-size:14px}.tt-panel-head button{border:0;background:transparent;cursor:pointer;font-size:18px;color:#666}
      .tt-plugin-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.tt-plugin{min-width:0;border:1px solid #e2e2e6;background:#f7f7f9;border-radius:11px;padding:9px 4px;cursor:pointer;color:#242428}.tt-plugin:hover{background:#eeeef2;border-color:#c9c9d0}.tt-plugin i{display:block;font-style:normal;font-size:17px;margin-bottom:3px}.tt-plugin span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px}
      #tt-tool-content{border-top:1px solid #e5e5e8;margin-top:11px;padding-top:11px}.tt-view-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}.tt-view-head button{border:1px solid #d4d4d8;background:white;border-radius:8px;padding:5px 8px;cursor:pointer}
      .tt-swatches{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}.tt-swatch{border:1px solid #e2e2e6;background:white;border-radius:9px;padding:6px;display:grid;grid-template-columns:22px 1fr auto;gap:6px;align-items:center;text-align:left;cursor:pointer}.tt-swatch i{width:22px;height:22px;border-radius:6px;background:var(--swatch);border:1px solid rgba(0,0,0,.12)}.tt-swatch small{color:#999}
      .tt-page-list{display:grid;gap:5px}.tt-page-item{border:1px solid #e2e2e6;background:white;border-radius:9px;padding:7px;display:grid;grid-template-columns:24px 1fr;align-items:center;text-align:left;cursor:pointer}.tt-page-item span{width:22px;height:22px;display:grid;place-items:center;border-radius:6px;background:#eeeef2;color:#666}.tt-page-item b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tt-page-item.active{border-color:#5577ef;background:#f2f5ff}
      .tt-stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.tt-stat-grid div{background:#f5f5f7;border-radius:10px;padding:10px}.tt-stat-grid b,.tt-stat-grid span{display:block}.tt-stat-grid b{font-size:18px}.tt-stat-grid span{font-size:11px;color:#6f6f76;margin-top:3px}.tt-hint{font-size:11px;color:#777;margin:9px 2px 0}
      .tt-site-result{display:grid;gap:9px}.tt-site-result p{margin:0;color:#5f6678}.tt-site-result code{display:block;overflow:auto;background:#f2f3f7;border-radius:8px;padding:8px;font-size:10px}.tt-site-result a{display:block;text-align:center;text-decoration:none;background:#5368f5;color:#fff;border-radius:9px;padding:8px;font-weight:650}
      #tt-tool-toast{position:fixed;left:50%;bottom:24px;z-index:2147483647;transform:translate(-50%,12px);opacity:0;background:#18181b;color:#fff;border-radius:999px;padding:9px 14px;font:13px system-ui;pointer-events:none;transition:.16s}#tt-tool-toast.show{opacity:1;transform:translate(-50%,0)}
      @media(prefers-color-scheme:dark){#tt-tool-panel{background:rgba(28,28,31,.96);color:#f5f5f7;border-color:#46464d}.tt-plugin,.tt-swatch,.tt-page-item,.tt-view-head button{background:#35353a;color:#f5f5f7;border-color:#4b4b52}.tt-plugin:hover{background:#414148}.tt-stat-grid div{background:#35353a}.tt-hint,.tt-stat-grid span{color:#aaa}.tt-page-item.active{background:#26335a;border-color:#6d8cff}#tt-tool-content{border-color:#46464d}}
    `;
    document.head.appendChild(style);
  }

  function renderPluginButtons() {
    if (!toolRoot) return;
    const grid = toolRoot.querySelector('.tt-plugin-grid');
    grid.innerHTML = '';
    [...plugins.values()].sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((plugin) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tt-plugin';
      button.title = plugin.label;
      const icon = document.createElement('i');
      const label = document.createElement('span');
      icon.textContent = plugin.icon || '•';
      label.textContent = plugin.label;
      button.append(icon, label);
      button.addEventListener('click', async () => {
        sendEvent({ type: 'plugin_open', plugin: plugin.id, status: 'ok' });
        toolContent.innerHTML = '';
        try {
          if (plugin.render) await plugin.render(toolContent, window.brainstorm);
          else if (plugin.run) await plugin.run(window.brainstorm);
        } catch (error) {
          sendEvent({ type: 'plugin_error', plugin: plugin.id, error: error.message, status: 'error' });
          toast(error.message || '工具执行失败');
        }
      });
      grid.appendChild(button);
    });
  }

  function registerPlugin(plugin) {
    if (!plugin || !/^[a-z0-9][a-z0-9-]{1,48}$/i.test(plugin.id || '') || !plugin.label) {
      throw new Error('插件需要合法的 id 与 label');
    }
    plugins.set(plugin.id, { ...plugin });
    renderPluginButtons();
    return () => { plugins.delete(plugin.id); renderPluginButtons(); };
  }

  function collapseTools() {
    if (toolPanel) toolPanel.hidden = true;
  }

  function makeDraggable(ball) {
    let start = null;
    ball.addEventListener('pointerdown', (event) => {
      start = { x: event.clientX, y: event.clientY, right: parseFloat(getComputedStyle(toolRoot).right), bottom: parseFloat(getComputedStyle(toolRoot).bottom), moved: false };
      ball.setPointerCapture(event.pointerId);
    });
    ball.addEventListener('pointermove', (event) => {
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) start.moved = true;
      toolRoot.style.right = Math.max(8, Math.min(window.innerWidth - 56, start.right - dx)) + 'px';
      toolRoot.style.bottom = Math.max(8, Math.min(window.innerHeight - 56, start.bottom - dy)) + 'px';
    });
    ball.addEventListener('pointerup', (event) => {
      if (!start) return;
      const moved = start.moved;
      start = null;
      ball.releasePointerCapture(event.pointerId);
      const rect = ball.getBoundingClientRect();
      const dockLeft = rect.left + rect.width / 2 < window.innerWidth / 2;
      toolRoot.dataset.side = dockLeft ? 'left' : 'right';
      toolRoot.style.right = (dockLeft ? window.innerWidth - rect.right : 10) + 'px';
      try { localStorage.setItem('tt-floating-tools-position', JSON.stringify({ right: toolRoot.style.right, bottom: toolRoot.style.bottom, side: toolRoot.dataset.side })); } catch (e) {}
      if (!moved) toolPanel.hidden = !toolPanel.hidden;
    });
  }

  function buildFloatingTools() {
    injectToolStyles();
    toolRoot = document.createElement('div');
    toolRoot.id = 'tt-floating-tools';
    toolRoot.dataset.ttCompanionChrome = '';
    toolRoot.innerHTML = `<section id="tt-tool-panel" hidden><div class="tt-panel-head"><strong>视觉工具</strong><button type="button" aria-label="收起">−</button></div><div class="tt-plugin-grid"></div><div id="tt-tool-content"></div></section><button id="tt-tool-ball" type="button" aria-label="打开视觉工具" title="视觉工具">TT</button>`;
    document.body.appendChild(toolRoot);
    toolPanel = toolRoot.querySelector('#tt-tool-panel');
    toolContent = toolRoot.querySelector('#tt-tool-content');
    toolRoot.querySelector('.tt-panel-head button').addEventListener('click', collapseTools);
    const ball = toolRoot.querySelector('#tt-tool-ball');
    try {
      const saved = JSON.parse(localStorage.getItem('tt-floating-tools-position'));
      if (saved && saved.right && saved.bottom) {
        toolRoot.style.right = saved.right;
        toolRoot.style.bottom = saved.bottom;
        toolRoot.dataset.side = saved.side === 'left' ? 'left' : 'right';
      }
    } catch (e) {}
    makeDraggable(ball);
    document.addEventListener('pointerdown', (event) => {
      if (!toolPanel.hidden && !toolRoot.contains(event.target)) collapseTools();
    });
    registerPlugin({ id: 'pages', label: '页面', icon: '▤', order: 10, render: renderPagesPlugin });
    registerPlugin({ id: 'export-image', label: '导出 PNG', icon: '▧', order: 20, run: exportPng });
    registerPlugin({ id: 'export-html', label: '导出 HTML', icon: '</>', order: 30, run: exportStandaloneHtml });
    registerPlugin({ id: 'export-site', label: '导出所有', icon: '▦', order: 35, render: exportAllSite });
    registerPlugin({ id: 'color-picker', label: '取色器', icon: '◉', order: 40, render: renderColorPlugin });
    registerPlugin({ id: 'session-stats', label: 'Token', icon: '≈', order: 50, render: renderStatsPlugin });
  }

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-choice]');
    if (!target) return;
    sendEvent({ type: 'click', text: target.textContent.trim(), choice: target.dataset.choice, id: target.id || null });
  });

  window.selectedChoice = null;
  window.toggleSelect = function(el) {
    const container = el.closest('.options') || el.closest('.cards');
    const multi = container && container.dataset.multiselect !== undefined;
    if (container && !multi) container.querySelectorAll('.option,.card').forEach((item) => item.classList.remove('selected'));
    if (multi) el.classList.toggle('selected'); else el.classList.add('selected');
    window.selectedChoice = el.dataset.choice;
  };

  window.brainstorm = {
    send: sendEvent,
    choice: (value, metadata = {}) => sendEvent({ type: 'choice', value, ...metadata }),
    tokenUsage: (usage = {}) => sendEvent({ type: 'token_usage', ...usage }),
    plugins: { register: registerPlugin, list: () => [...plugins.keys()] },
    tools: { open: () => { toolPanel.hidden = false; }, close: collapseTools },
  };

  buildFloatingTools();
  sendEvent({ type: 'page_view', plugin: 'core', status: 'ok' });
  window.dispatchEvent(new CustomEvent('tech-tower:ready', { detail: window.brainstorm }));
  connect();
})();
