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
  const root = path.join(cwd, 'demo'); const status = cli(['status', root, '--json'], cwd); assert.equal(status.status, 0); assert.equal(JSON.parse(status.stdout).phase, 'intake');
  const valid = cli(['validate', root, '--json'], cwd); assert.equal(valid.status, 0); assert.equal(JSON.parse(valid.stdout).ok, true);
});

test('TC-201: CLI 门禁错误是结构化且不泄露堆栈', () => {
  const cwd = temp(); cli(['create', 'demo', '--root', cwd], cwd); const result = cli(['transition', 'plan', path.join(cwd, 'demo')], cwd);
  assert.equal(result.status, 1); const error = JSON.parse(result.stderr); assert.equal(error.code, 'E_TRANSITION'); assert.doesNotMatch(result.stderr, /at .*\.cjs:/);
});

test('TC-121: 原安装器 help/version 仍可运行', () => {
  const installer = path.resolve(__dirname, '../../bin/zflow.js');
  for (const args of [['--help'], ['--version']]) { const result = spawnSync(process.execPath, [installer, ...args], { encoding: 'utf8' }); assert.equal(result.status, 0); }
});
