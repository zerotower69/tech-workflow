'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { temp } = require('./helpers.cjs');

const bin = path.resolve(__dirname, '../../bin/zflow-sandbox.js');

function cli(args, cwd = temp()) { return spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' }); }

test('TC-107/121: CLI create/status/validate JSON 输出和退出码稳定', () => {
  const cwd = temp(); const created = cli(['create', 'demo', '--root', cwd, '--json'], cwd); assert.equal(created.status, 0);
  const first = JSON.parse(created.stdout); assert.match(first.sandbox.sandboxId, /^\d{8}001-demo$/);
  const root = first.root; const status = cli(['status', root, '--json'], cwd); assert.equal(status.status, 0); assert.equal(JSON.parse(status.stdout).phase, 'intake');
  const valid = cli(['validate', root, '--json'], cwd); assert.equal(valid.status, 0); assert.equal(JSON.parse(valid.stdout).ok, true);
  const second = cli(['create', 'another', '--root', cwd, '--json'], cwd); assert.equal(second.status, 0);
  assert.match(JSON.parse(second.stdout).sandbox.sandboxId, /^\d{8}002-another$/);
});

test('TC-201: CLI 门禁错误是结构化且不泄露堆栈', () => {
  const cwd = temp(); const created = cli(['create', 'demo', '--root', cwd, '--json'], cwd); const result = cli(['transition', 'plan', JSON.parse(created.stdout).root], cwd);
  assert.equal(result.status, 1); const error = JSON.parse(result.stderr); assert.equal(error.code, 'E_TRANSITION'); assert.doesNotMatch(result.stderr, /at .*\.cjs:/);
});
