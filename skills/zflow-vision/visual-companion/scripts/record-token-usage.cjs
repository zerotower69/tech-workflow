#!/usr/bin/env node
'use strict';

// Record provider-reported usage when the host exposes exact token counts.
// Estimates are automatic; this optional path keeps exact usage clearly separate.
const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  console.error(message);
  process.exit(1);
}

const options = { input: 0, output: 0, cachedInput: 0, model: 'unknown', source: 'provider' };
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--state-dir') options.stateDir = args[++index];
  else if (arg === '--input') options.input = args[++index];
  else if (arg === '--output') options.output = args[++index];
  else if (arg === '--cached-input') options.cachedInput = args[++index];
  else if (arg === '--model') options.model = args[++index];
  else if (arg === '--source') options.source = args[++index];
  else fail(`未知参数: ${arg}`);
}

if (!options.stateDir) fail('缺少 --state-dir');
const stateDir = path.resolve(options.stateDir);
if (!fs.existsSync(stateDir) || !fs.statSync(stateDir).isDirectory()) fail('state_dir 不存在');

function tokenCount(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) fail(`${name} 必须是非负数字`);
  return Math.round(number);
}

const row = {
  schema: 'tech-tower.visual-companion.token-usage.v1',
  occurredAt: new Date().toISOString(),
  source: String(options.source).slice(0, 80),
  model: String(options.model).slice(0, 120),
  inputTokens: tokenCount(options.input, '--input'),
  outputTokens: tokenCount(options.output, '--output'),
  cachedInputTokens: tokenCount(options.cachedInput, '--cached-input'),
};

const output = path.join(stateDir, 'token-usage.jsonl');
fs.appendFileSync(output, JSON.stringify(row) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ status: 'ok', path: output, usage: row }));
