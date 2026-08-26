'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const core = require('../../skills/zflow/scripts/sandbox/core.cjs');
const f = require('../../skills/zflow/scripts/sandbox/filesystem.cjs');
const { temp, write } = require('./helpers.cjs');

test('TC-001/008: slug 与归档路径拒绝越界', () => {
  assert.equal(f.validateSlug('ticket-01'), 'ticket-01');
  for (const value of ['..', '../x', '/tmp/x', 'C:\\tmp\\x', '\\\\server\\x']) assert.throws(() => f.safeRelative(value), { code: 'E_PATH' });
});

test('TC-002: 事件 revision 连续性可检测', () => {
  const root = path.join(temp(), 'demo'); core.createSandbox(root, { slug: 'demo' });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'sandbox.json'))); manifest.eventRevision = 9;
  fs.writeFileSync(path.join(root, 'sandbox.json'), f.json(manifest));
  const result = core.validate(root); assert.equal(result.ok, false); assert.match(result.errors.join('\n'), /eventRevision/);
});

test('TC-004: 依赖图只传播到下游并处理循环', () => {
  const artifacts = { items: [
    { key: 'spec@1', dependsOn: [] }, { key: 'plan@1', dependsOn: ['spec@1'] },
    { key: 'ticket@1', dependsOn: ['plan@1', 'ticket@2'] }, { key: 'ticket@2', dependsOn: ['ticket@1'] },
    { key: 'unrelated@1', dependsOn: [] },
  ] };
  assert.deepEqual([...core.downstream(artifacts, new Set(['spec@1']))].sort(), ['plan@1', 'ticket@1', 'ticket@2']);
});

test('TC-005: SHA-256 对字节变化敏感', () => {
  assert.equal(f.sha256(Buffer.from('a')), f.sha256(Buffer.from('a')));
  assert.notEqual(f.sha256(Buffer.from('a')), f.sha256(Buffer.from('a\n')));
});

test('TC-006/007: Git URL 脱敏且只接受完整 SHA', () => {
  assert.equal(core.redactRemote('https://user:token@example.com/repo.git?token=abc'), 'https://<redacted>@example.com/repo.git?token=<redacted>');
  assert.equal(core.fullSha('a'.repeat(40)), true); assert.equal(core.fullSha('a'.repeat(7)), false);
});

test('TC-110: repo schema v1 迁移保留边界', () => {
  const old = { schema_version: 1, ticket: 'x', workspace_root: '/tmp/w', created_at: 'x', repositories: [{ name: 'app', path: 'app', branch: 'main', remotes: [{ name: 'origin', url: 'https://u:p@example.com/r.git' }], base_commit: 'a'.repeat(40), head_commit: 'b'.repeat(40), final_commit: null }] };
  const next = core.migrateRepoV1(old); assert.equal(next.schemaVersion, 2); assert.equal(next.repositories[0].baseCommit, 'a'.repeat(40)); assert.doesNotMatch(next.repositories[0].url, /u:p/);
});

test('TC-102: 未完成事务可幂等恢复', () => {
  const root = temp(); write(path.join(root, '.sandbox-transaction.json'), f.json({ writes: [{ path: 'x.txt', base64: Buffer.from('ok').toString('base64') }] }));
  assert.equal(f.recoverTransaction(root), true); assert.equal(fs.readFileSync(path.join(root, 'x.txt'), 'utf8'), 'ok'); assert.equal(f.recoverTransaction(root), false);
});
