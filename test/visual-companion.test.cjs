'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn, spawnSync } = require('node:child_process');
const readline = require('node:readline');

const root = path.resolve(__dirname, '..');
const scripts = path.join(root, 'skills/zflow-vision/visual-companion/scripts');

function loadHelperPureApi() {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(scripts, 'helper.js'), 'utf8'), {
    module,
    console,
  });
  return module.exports;
}

test('TC-V01: floating tool helper keeps pure utilities testable', () => {
  const helper = loadHelperPureApi();
  assert.equal(helper.nextReconnectDelay(500, 30000), 1000);
  assert.equal(helper.nextReconnectDelay(20000, 30000), 30000);
  assert.equal(helper.rgbToHex('rgba(12, 34, 56, 1)'), '#0C2238');
  assert.equal(helper.rgbToHex('rgba(12, 34, 56, 0)'), null);
});

test('TC-V02: mature npm capabilities are shipped as offline bundles', () => {
  const imageBundle = path.join(scripts, 'vendor/html-to-image.js');
  const tokenizerBundle = path.join(scripts, 'vendor/tokenizer.cjs');
  const expressBundle = path.join(scripts, 'vendor/express.cjs');
  const markdownBundle = path.join(scripts, 'vendor/markdown.cjs');
  assert.ok(fs.statSync(imageBundle).size > 10000);
  assert.ok(fs.statSync(tokenizerBundle).size > 100000);
  assert.ok(fs.statSync(expressBundle).size > 100000);
  assert.ok(fs.statSync(markdownBundle).size > 50000);
  const { countTokens } = require(tokenizerBundle);
  assert.ok(countTokens('技术塔视觉伴侣 token test') >= 5);
  const helper = fs.readFileSync(path.join(scripts, 'helper.js'), 'utf8');
  assert.match(helper, /brainstorm\.plugins|registerPlugin/);
  assert.match(helper, /htmlToImage\.toPng/);
  assert.match(helper, /EyeDropper/);
  assert.match(helper, /export-site/);
});

test('TC-V03: analytics payload excludes page text and sensitive ad-hoc fields', () => {
  const server = require(path.join(scripts, 'server.cjs'));
  const event = server.compactAnalyticsEvent({
    type: 'click', screen: 'layout.html', choice: 'a', text: 'private design copy',
    sessionKey: 'secret', filePath: '/private/project', plugin: 'core',
  }, 'browser');
  assert.equal(event.type, 'click');
  assert.equal(event.screen, 'layout.html');
  assert.equal(event.choice, 'a');
  assert.equal(event.text, undefined);
  assert.equal(event.sessionKey, undefined);
  assert.equal(event.filePath, undefined);
  assert.ok(event.estimatedTokens > 0);
});

test('TC-V04: exact provider usage recorder appends schema-valid JSONL', t => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zflow-token-usage-'));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [
    path.join(scripts, 'record-token-usage.cjs'), '--state-dir', stateDir,
    '--source', 'test-provider', '--model', 'test-model', '--input', '1200',
    '--output', '340', '--cached-input', '800',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const row = JSON.parse(fs.readFileSync(path.join(stateDir, 'token-usage.jsonl'), 'utf8').trim());
  assert.deepEqual([row.inputTokens, row.outputTokens, row.cachedInputTokens], [1200, 340, 800]);
  assert.equal(row.schema, 'tech-tower.visual-companion.token-usage.v1');
});

test('TC-V05: export all builds a portable, sanitized design site', async t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'zflow-design-site-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const session = path.join(fixture, 'session');
  const content = path.join(session, 'content');
  const state = path.join(session, 'state');
  const output = path.join(fixture, 'site');
  fs.mkdirSync(content, { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(content, 'layout.html'), '<div data-tt-screen><h1>Layout A</h1></div>');
  fs.writeFileSync(path.join(content, 'layout-v2.html'), '<div data-tt-screen><h1>Layout B</h1></div>');
  fs.writeFileSync(path.join(session, 'design-spec.md'), '# 决策\n\n采用 **B**。\n\n<script>alert(1)</script>');
  fs.writeFileSync(path.join(state, 'analytics.jsonl'), '{"type":"page_view","plugin":"core"}\n{"type":"export_image","plugin":"export-image"}\n');

  const exported = spawnSync(process.execPath, [
    path.join(scripts, 'export-design-site.cjs'), '--session-dir', session, '--out', output,
  ], { encoding: 'utf8' });
  assert.equal(exported.status, 0, exported.stderr);
  const result = JSON.parse(exported.stdout);
  assert.deepEqual([result.pages, result.decisions, result.analyticsEvents], [2, 1, 2]);
  assert.equal(fs.existsSync(path.join(output, 'serve.cjs')), true);
  assert.equal(fs.existsSync(path.join(output, '_runtime', 'express.cjs')), true);
  assert.equal(fs.existsSync(path.join(output, 'public', 'pages', 'layout-v2.html')), true);
  const index = fs.readFileSync(path.join(output, 'public', 'index.html'), 'utf8');
  assert.match(index, /设计交付站/);
  assert.ok(index.includes('采用 \\u003cstrong>B\\u003c/strong>'));
  assert.doesNotMatch(index, /<script>alert\(1\)<\/script>/);

  const child = spawn(process.execPath, [path.join(output, 'serve.cjs'), '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { try { child.kill(); } catch (error) {} });
  const lines = readline.createInterface({ input: child.stdout });
  const info = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('site server timeout')), 5000);
    lines.once('line', (line) => { clearTimeout(timer); resolve(JSON.parse(line)); });
    child.once('error', reject);
  });
  const response = await fetch(info.url);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Layout|设计交付站/);
  assert.equal((await fetch(`http://127.0.0.1:${info.port}/healthz`)).status, 200);
});
