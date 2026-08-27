'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

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
  assert.ok(fs.statSync(imageBundle).size > 10000);
  assert.ok(fs.statSync(tokenizerBundle).size > 100000);
  const { countTokens } = require(tokenizerBundle);
  assert.ok(countTokens('技术塔视觉伴侣 token test') >= 5);
  const helper = fs.readFileSync(path.join(scripts, 'helper.js'), 'utf8');
  assert.match(helper, /brainstorm\.plugins|registerPlugin/);
  assert.match(helper, /htmlToImage\.toPng/);
  assert.match(helper, /EyeDropper/);
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
