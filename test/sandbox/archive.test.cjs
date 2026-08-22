'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const core = require('../../skills/tech-workflow/scripts/sandbox/core.cjs');
const archive = require('../../skills/tech-workflow/scripts/sandbox/archive.cjs');
const { temp, write, initRepo, git } = require('./helpers.cjs');

function fixture({ pushed = true, dirty = false } = {}) {
  const workspace = temp(); const remote = path.join(workspace, 'remote.git'); git(workspace, ['init', '--bare', remote]);
  const repo = path.join(workspace, '.repository', 'app'); const base = initRepo(repo); git(repo, ['remote', 'add', 'origin', remote]); git(repo, ['push', '-u', 'origin', 'main']);
  write(path.join(repo, 'feature.txt'), 'feature\n'); git(repo, ['add', 'feature.txt']); git(repo, ['commit', '-m', 'feature']); const head = git(repo, ['rev-parse', 'HEAD']);
  if (pushed) git(repo, ['push', 'origin', 'main']);
  if (dirty) { write(path.join(repo, 'feature.txt'), 'dirty\n'); write(path.join(repo, 'untracked.bin'), Buffer.from([0, 1, 2, 3])); }
  const root = path.join(workspace, '.scratch', 'demo'); core.createSandbox(root, { slug: 'demo' });
  write(path.join(root, 'repo.json'), JSON.stringify({ schemaVersion: 2, workspaceRoot: workspace, repositories: [{ id: 'app', path: '.repository/app', url: remote, remote: 'origin', baseBranch: 'main', baseCommit: base, targetBranch: 'main', headCommit: head, finalCommit: head, pushStatus: pushed ? 'pushed' : 'unpushed' }] }));
  return { workspace, root, repo, remote, base, head };
}

test('TC-115: 干净已推送仓库生成轻量包并恢复', () => {
  const f = fixture(); const out = path.join(temp(), 'demo.tws'); const packed = archive.packSandbox(f.root, out); assert.equal(packed.repositories, 1);
  const parsed = archive.readArchive(out); assert.equal(parsed.repositories[0].bundle, null); assert.equal(parsed.repositories[0].patch, null);
  const restoredSandbox = path.join(temp(), 'sandbox'); const restoredWorkspace = temp();
  const result = archive.restoreSandbox(out, restoredSandbox, { workspaceRoot: restoredWorkspace }); assert.equal(result.repositories[0].status, 'restored');
  assert.equal(git(path.join(restoredWorkspace, '.repository', 'app'), ['rev-parse', 'HEAD']), f.head);
});

test('TC-116/117: 未推送 Commit、patch 和 untracked 都进入归档', () => {
  const f = fixture({ pushed: false, dirty: true }); const out = path.join(temp(), 'demo.tws'); archive.packSandbox(f.root, out);
  const parsed = archive.readArchive(out); assert.ok(parsed.repositories[0].bundle); assert.ok(parsed.repositories[0].patch); assert.equal(parsed.repositories[0].untracked.length, 1);
  const restoredSandbox = path.join(temp(), 'sandbox'); const restoredWorkspace = temp(); archive.restoreSandbox(out, restoredSandbox, { workspaceRoot: restoredWorkspace });
  const repo = path.join(restoredWorkspace, '.repository', 'app'); assert.equal(fs.readFileSync(path.join(repo, 'feature.txt'), 'utf8'), 'dirty\n'); assert.deepEqual(fs.readFileSync(path.join(repo, 'untracked.bin')), Buffer.from([0, 1, 2, 3]));
});

test('TC-119: 摘要损坏和路径穿越在写入前被拒绝', () => {
  const f = fixture(); const out = path.join(temp(), 'demo.tws'); archive.packSandbox(f.root, out);
  const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(out))); raw.files[0].path = '../escape';
  const { contentSha256: ignored, ...content } = raw;
  raw.contentSha256 = require('crypto').createHash('sha256').update(JSON.stringify(content)).digest('hex');
  const bad = path.join(temp(), 'bad.tws'); fs.writeFileSync(bad, zlib.gzipSync(Buffer.from(JSON.stringify(raw))));
  const target = path.join(temp(), 'target'); assert.throws(() => archive.restoreSandbox(bad, target), { code: 'E_PATH' });
  assert.equal(fs.existsSync(target), false);
});

test('TC-120: 非空恢复目标被拒绝', () => {
  const f = fixture(); const out = path.join(temp(), 'demo.tws'); archive.packSandbox(f.root, out);
  const target = temp(); write(path.join(target, 'keep.txt'), 'keep'); assert.throws(() => archive.restoreSandbox(out, target), { code: 'E_TARGET_NOT_EMPTY' });
  assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'keep');
});

test('TC-120: Patch 冲突清理暂存沙箱和新建仓库', () => {
  const f = fixture({ pushed: true, dirty: true }); const out = path.join(temp(), 'demo.tws'); archive.packSandbox(f.root, out);
  const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(out))); raw.repositories[0].patch = Buffer.from('not a git patch').toString('base64');
  const { contentSha256: ignored, ...content } = raw;
  raw.contentSha256 = require('crypto').createHash('sha256').update(JSON.stringify(content)).digest('hex');
  const bad = path.join(temp(), 'conflict.tws'); fs.writeFileSync(bad, zlib.gzipSync(Buffer.from(JSON.stringify(raw))));
  const restoredSandbox = path.join(temp(), 'sandbox'); const restoredWorkspace = temp();
  assert.throws(() => archive.restoreSandbox(bad, restoredSandbox, { workspaceRoot: restoredWorkspace }), { code: 'E_RESTORE_CONFLICT' });
  assert.equal(fs.existsSync(restoredSandbox), false); assert.equal(fs.existsSync(path.join(restoredWorkspace, '.repository', 'app')), false);
});
