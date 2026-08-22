'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const core = require('../../skills/tech-workflow/scripts/sandbox/core.cjs');
const archive = require('../../skills/tech-workflow/scripts/sandbox/archive.cjs');
const f = require('../../skills/tech-workflow/scripts/sandbox/filesystem.cjs');
const { temp, write, approveContext, reachSpec, approveSpec, initRepo, git } = require('./helpers.cjs');

test('TC-101: 创建、状态和重复校验', () => {
  const root = path.join(temp(), 'demo'); core.createSandbox(root, { slug: 'demo', title: 'Demo' });
  for (const name of ['sandbox.json', 'events.jsonl', 'artifacts.json', 'handoff.md', 'ticket_context.md']) assert.equal(fs.existsSync(path.join(root, name)), true);
  assert.equal(core.validate(root, { strict: true }).ok, true); assert.equal(core.validate(root, { strict: true }).ok, true);
});

test('TC-103: 有效锁拒绝第二写者，过期锁可接管', () => {
  const root = temp(); const lock = f.acquireLock(root);
  assert.throws(() => f.acquireLock(root), { code: 'E_LOCKED' }); fs.unlinkSync(lock.lockPath);
  fs.writeFileSync(path.join(root, '.sandbox.lock'), JSON.stringify({ pid: 1, createdAt: '2000-01-01T00:00:00Z' }));
  const takeover = f.acquireLock(root, { takeover: true, staleMs: 1 }); assert.equal(takeover.tookOver, true); fs.unlinkSync(takeover.lockPath);
});

test('TC-104: 知识检查点不能静默绕过', () => {
  const root = path.join(temp(), 'demo'); core.createSandbox(root, { slug: 'demo' }); approveContext(root);
  core.transition(root, 'brainstorm:clarify'); core.transition(root, 'brainstorm:knowledge');
  assert.throws(() => core.transition(root, 'brainstorm:spec'), { code: 'E_GATE' });
  core.approveArtifact(root, 'knowledge', { skipReason: '没有知识源' }); core.transition(root, 'brainstorm:spec');
  assert.equal(core.load(root).sandbox.checkpoint, 'spec');
});

test('TC-104: 未解决冲突阻断 Spec，用户裁决写入 decisions', () => {
  const root = path.join(temp(), 'demo'); core.createSandbox(root, { slug: 'demo' }); reachSpec(root);
  core.addConflict(root, { id: 'KB-1', description: '规则冲突', sources: ['KB-A', 'ANSWER-1'] });
  write(path.join(root, 'spec.md'), '# Spec'); core.reviseArtifact(root, 'spec', { path: 'spec.md' });
  assert.throws(() => core.approveArtifact(root, 'spec'), { code: 'E_CONFLICT' });
  core.resolveConflict(root, 'KB-1', '采用用户本次确认'); core.approveArtifact(root, 'spec');
  assert.match(fs.readFileSync(path.join(root, 'decisions.md'), 'utf8'), /采用用户本次确认/);
});

test('TC-105: 批准产物漂移失败，revise 保留旧版', () => {
  const root = path.join(temp(), 'demo'); core.createSandbox(root, { slug: 'demo' }); approveContext(root);
  write(path.join(root, 'ticket_context.md'), 'changed');
  assert.equal(core.validate(root).ok, false); assert.throws(() => core.approveArtifact(root, 'context'), { code: 'E_ARTIFACT_DRIFT' });
  core.reviseArtifact(root, 'context'); const items = core.load(root).artifacts.items.filter((x) => x.type === 'context');
  assert.equal(items.length, 3); assert.equal(fs.existsSync(path.join(root, items[0].revisionPath)), true);
});

test('TC-106/107: Spec 与 Plan 一对一并完成到 build', () => {
  const root = path.join(temp(), 'demo'); core.createSandbox(root, { slug: 'demo' }); reachSpec(root); const spec = approveSpec(root);
  core.transition(root, 'plan'); write(path.join(root, 'plan.md'), '# Plan');
  core.reviseArtifact(root, 'plan', { path: 'plan.md', dependsOn: [spec.key], metadata: { specRevision: spec.revision } }); core.approveArtifact(root, 'plan');
  write(path.join(root, 'tickets.json'), JSON.stringify({ tickets: [{ id: 'T-1', title: 'x', status: 'pending' }] }));
  core.transition(root, 'build'); assert.equal(core.load(root).sandbox.phase, 'build');
});

test('TC-108: 非法迁移不修改事件和状态', () => {
  const root = path.join(temp(), 'demo'); core.createSandbox(root, { slug: 'demo' }); const before = fs.readFileSync(path.join(root, 'events.jsonl'));
  assert.throws(() => core.transition(root, 'plan'), { code: 'E_TRANSITION' }); assert.deepEqual(fs.readFileSync(path.join(root, 'events.jsonl')), before);
});

test('TC-109: 回退到 Spec 传播 stale 且保留 Commit 证据文件', () => {
  const root = path.join(temp(), 'demo'); core.createSandbox(root, { slug: 'demo' }); reachSpec(root); const spec = approveSpec(root);
  core.transition(root, 'plan'); write(path.join(root, 'plan.md'), '# Plan');
  core.reviseArtifact(root, 'plan', { path: 'plan.md', dependsOn: [spec.key], metadata: { specRevision: spec.revision } }); core.approveArtifact(root, 'plan');
  write(path.join(root, 'tickets.json'), JSON.stringify({ tickets: [{ id: 'T-1', title: 'x', status: 'pending' }] })); core.transition(root, 'build');
  write(path.join(root, 'commits.jsonl'), '{"commit":"' + 'a'.repeat(40) + '"}\n'); core.rollback(root, 'brainstorm:spec', '需求变化');
  const state = core.load(root); assert.equal(state.sandbox.phase, 'brainstorm');
  assert.equal(state.artifacts.items.find((x) => x.type === 'plan').status, 'stale'); assert.equal(fs.existsSync(path.join(root, 'commits.jsonl')), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'tickets.json'))).tickets[0].status, 'stale');
  assert.equal(state.events.at(-1).type, 'workflow.rolled_back');
});

test('TC-111: 真实 Git 边界验证短 SHA、祖先与 HEAD', () => {
  const workspace = temp(); const repo = path.join(workspace, 'app'); const base = initRepo(repo);
  write(path.join(repo, 'x.txt'), 'x'); git(repo, ['add', 'x.txt']); git(repo, ['commit', '-m', 'x']); const head = git(repo, ['rev-parse', 'HEAD']);
  const root = path.join(workspace, '.scratch', 'demo'); core.createSandbox(root, { slug: 'demo' });
  write(path.join(root, 'repo.json'), JSON.stringify({ schemaVersion: 2, workspaceRoot: workspace, repositories: [{ id: 'app', path: 'app', baseCommit: base, headCommit: head, finalCommit: head }] }));
  assert.equal(core.validateRepositories(root).ok, true);
  const doc = JSON.parse(fs.readFileSync(path.join(root, 'repo.json'))); doc.repositories[0].baseCommit = base.slice(0, 7); write(path.join(root, 'repo.json'), JSON.stringify(doc));
  assert.equal(core.validateRepositories(root).ok, false);
});

test('TC-114: handoff 可从机器状态重建', () => {
  const root = path.join(temp(), 'demo'); core.createSandbox(root, { slug: 'demo' }); const before = core.regenerateHandoff(root);
  fs.unlinkSync(path.join(root, 'handoff.md')); const after = core.regenerateHandoff(root);
  assert.match(after, /当前状态/); assert.match(after, /事件 revision：1/); assert.equal(after.replace(/生成时间：[^\n]+/, ''), before.replace(/生成时间：[^\n]+/, ''));
});

test('TC-112: Commit/Test/Review 证据链追加并驱动 PR 门禁', () => {
  const root = path.join(temp(), 'demo'); core.createSandbox(root, { slug: 'demo' });
  core.recordCommit(root, { ticketId: 'T-01', repositoryId: 'app', commit: 'a'.repeat(40), tests: ['npm test'], pushed: false });
  core.recordReview(root, { id: 'REVIEW-1', type: 'integration', status: 'approved', findings: [] });
  assert.equal(fs.readFileSync(path.join(root, 'commits.jsonl'), 'utf8').trim().length > 0, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'reviews.jsonl'), 'utf8')).status, 'approved');
  assert.throws(() => core.recordCommit(root, { ticketId: 'T-02', repositoryId: 'app', commit: 'abc' }), { code: 'E_COMMIT_RECORD' });
});

test('TC-113: Skill Lock 生成并检测摘要漂移', () => {
  const root = path.join(temp(), 'demo'); core.createSandbox(root, { slug: 'demo' }); const skill = path.join(temp(), 'skill');
  write(path.join(skill, 'SKILL.md'), '---\nname: demo\n---\n');
  core.writeSkillLock(root, [{ name: 'demo', path: skill, version: '1.0.0', source: 'local', usedBy: ['review'] }]);
  assert.equal(core.validateSkillLock(root, { strict: true }).ok, true);
  write(path.join(skill, 'SKILL.md'), 'changed');
  assert.equal(core.validateSkillLock(root, { strict: false }).warnings.length, 1);
  assert.equal(core.validateSkillLock(root, { strict: true }).ok, false);
});

test('TC-123: 创建到交付、回退重做、打包恢复完整生命周期', () => {
  const workspace = temp(); const repo = path.join(workspace, '.repository', 'app'); const base = initRepo(repo);
  write(path.join(repo, 'feature.txt'), 'done'); git(repo, ['add', 'feature.txt']); git(repo, ['commit', '-m', 'feature']); const head = git(repo, ['rev-parse', 'HEAD']);
  const root = path.join(workspace, '.scratch', 'demo'); core.createSandbox(root, { slug: 'demo' }); reachSpec(root); let spec = approveSpec(root);
  core.transition(root, 'plan'); write(path.join(root, 'plan.md'), '# Plan v1');
  core.reviseArtifact(root, 'plan', { path: 'plan.md', dependsOn: [spec.key], metadata: { specRevision: spec.revision } }); core.approveArtifact(root, 'plan');
  write(path.join(root, 'tickets.json'), JSON.stringify({ tickets: [{ id: 'T-1', title: 'x', status: 'completed' }] })); core.transition(root, 'build');
  write(path.join(root, 'repo.json'), JSON.stringify({ schemaVersion: 2, workspaceRoot: workspace, repositories: [{ id: 'app', path: '.repository/app', url: null, baseCommit: base, headCommit: head, finalCommit: head }] }));
  const skill = path.join(workspace, 'skill'); write(path.join(skill, 'SKILL.md'), 'demo'); core.writeSkillLock(root, [{ name: 'demo', path: skill, version: '1.0.0' }]);
  core.transition(root, 'review'); core.recordReview(root, { id: 'IR-1', type: 'integration', status: 'approved' }); core.transition(root, 'pr');
  core.rollback(root, 'brainstorm:spec', '补充约束'); spec = core.load(root).artifacts.items.filter((x) => x.type === 'spec').at(-1); core.approveArtifact(root, 'spec');
  core.transition(root, 'plan'); write(path.join(root, 'plan.md'), '# Plan v2'); core.reviseArtifact(root, 'plan', { dependsOn: [spec.key], metadata: { specRevision: spec.revision } }); core.approveArtifact(root, 'plan');
  write(path.join(root, 'tickets.json'), JSON.stringify({ tickets: [{ id: 'T-2', title: 'redo', status: 'completed' }] }));
  core.transition(root, 'build'); core.transition(root, 'review'); core.recordReview(root, { id: 'IR-2', type: 'integration', status: 'approved' }); core.transition(root, 'pr');
  const out = path.join(temp(), 'demo.tws'); archive.packSandbox(root, out); const restored = path.join(temp(), 'sandbox'); archive.restoreSandbox(out, restored);
  assert.equal(core.validate(restored).ok, true); assert.equal(core.load(restored).sandbox.phase, 'pr');
});
