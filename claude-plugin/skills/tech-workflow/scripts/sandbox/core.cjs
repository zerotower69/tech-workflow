'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { FORMAT_VERSION, PHASES, CHECKPOINTS, DEFAULT_FILES } = require('./constants.cjs');
const { fail } = require('./errors.cjs');
const {
  now, sha256, json, validateSlug, safeRelative, inside, mkdirp, readText, readJson,
  atomicWrite, recoverTransaction, commitTransaction, withLock, walkFiles,
} = require('./filesystem.cjs');

function manifestPath(root) { return path.join(root, 'sandbox.json'); }
function artifactsPath(root) { return path.join(root, 'artifacts.json'); }
function eventsPath(root) { return path.join(root, 'events.jsonl'); }

function parseEvents(root) {
  return readText(eventsPath(root), '').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { fail('E_EVENT_JSON', `事件日志第 ${index + 1} 行损坏`, { cause: error.message }); }
  });
}

function load(root) {
  recoverTransaction(root);
  const sandbox = readJson(manifestPath(root));
  const artifacts = readJson(artifactsPath(root));
  const events = parseEvents(root);
  return { sandbox, artifacts, events };
}

function eventFor(state, type, payload = {}) {
  const revision = state.sandbox.eventRevision + 1;
  return { revision, type, at: now(), actor: payload.actor || 'agent', ...payload, actor: payload.actor || 'agent' };
}

function handoffText(root, sandbox, artifacts) {
  const active = Object.entries(artifacts.active || {}).map(([type, id]) => {
    const item = artifacts.items.find((x) => x.key === id);
    return item ? `- ${type}: ${item.key} (${item.status})` : `- ${type}: ${id}（缺失）`;
  });
  const tickets = readJson(path.join(root, 'tickets.json'), { tickets: [] }).tickets || [];
  const pending = tickets.filter((x) => !['completed', 'superseded'].includes(x.status));
  const repo = readJson(path.join(root, 'repo.json'), { repositories: [] });
  const repos = (repo.repositories || []).map((r) => `- ${r.id || r.name}: ${r.targetBranch || r.branch || '(detached)'} @ ${r.finalCommit || r.final_commit || r.headCommit || r.head_commit || '未记录'}`);
  const next = allowedNextTargets(sandbox).join(', ') || '无';
  return `# Handoff\n\n` +
    `生成时间：${now()}\n\n` +
    `## 当前目标\n\n${sandbox.title}\n\n` +
    `## 当前状态\n\n- 阶段：${sandbox.phase}\n- 检查点：${sandbox.checkpoint}\n- 状态：${sandbox.status}\n- 事件 revision：${sandbox.eventRevision}\n\n` +
    `## 活跃产物\n\n${active.length ? active.join('\n') : '- 无'}\n\n` +
    `## 待执行事项\n\n${pending.length ? pending.map((t) => `- ${t.id}: ${t.title} (${t.status})`).join('\n') : '- 无'}\n\n` +
    `## 当前仓库与 Commit\n\n${repos.length ? repos.join('\n') : '- 未记录'}\n\n` +
    `## 下一步允许动作\n\n- ${next}\n\n` +
    `## 禁止重复或越权动作\n\n- 不跳过门禁，不覆盖旧 revision，不删除旧 Commit，不自动 git push。\n`;
}

function transactionState(root, state, event, extraWrites = {}) {
  const events = [...state.events, event];
  state.sandbox.eventRevision = event.revision;
  state.sandbox.updatedAt = event.at;
  const writes = {
    'sandbox.json': json(state.sandbox),
    'artifacts.json': json(state.artifacts),
    'events.jsonl': `${events.map((x) => JSON.stringify(x)).join('\n')}\n`,
    'handoff.md': handoffText(root, state.sandbox, state.artifacts),
    ...extraWrites,
  };
  commitTransaction(root, writes);
  return { sandbox: state.sandbox, event };
}

function initialArtifact(root, type, relative, content, extra = {}) {
  const artifactId = extra.artifactId || type;
  const revision = 1;
  const key = `${artifactId}@${revision}`;
  const revisionPath = `revisions/${artifactId}/${revision}/${path.posix.basename(relative)}`;
  return {
    item: {
      key, artifactId, type, revision, status: 'draft', path: safeRelative(relative), revisionPath,
      contentSha256: sha256(Buffer.from(content)), sources: extra.sources || [], dependsOn: extra.dependsOn || [],
      metadata: extra.metadata || {}, createdAt: now(), createdBy: extra.actor || 'agent', approvedAt: null, approvedBy: null,
    },
    writes: { [relative]: content, [revisionPath]: content },
  };
}

function createSandbox(root, options = {}) {
  const slug = validateSlug(options.slug || path.basename(root));
  if (fs.existsSync(root) && fs.readdirSync(root).length) fail('E_TARGET_NOT_EMPTY', `目标目录非空: ${root}`);
  mkdirp(root);
  return withLock(root, () => {
    const createdAt = now();
    const context = initialArtifact(root, 'context', DEFAULT_FILES.context,
      `# Ticket Context\n\n状态：draft\n\n请记录任务启动信息并在确认后批准。\n`);
    const knowledge = initialArtifact(root, 'knowledge', DEFAULT_FILES.knowledge,
      `# 知识库参考摘要\n\n状态：pending\n\n## 现有能力\n\n## 工程约束\n\n## 可复用内容\n\n## 冲突与未知项\n`);
    const sandbox = {
      formatVersion: FORMAT_VERSION, sandboxId: slug, title: options.title || slug,
      workflow: 'tech-workflow', phase: 'intake', checkpoint: 'context', status: 'in_progress',
      eventRevision: 0, lease: null, createdAt, updatedAt: createdAt,
    };
    const artifacts = {
      formatVersion: FORMAT_VERSION,
      active: { context: context.item.key, knowledge: knowledge.item.key },
      conflicts: [], items: [context.item, knowledge.item],
    };
    const event = { revision: 1, type: 'sandbox.created', at: createdAt, actor: options.actor || 'agent', sandboxId: slug };
    sandbox.eventRevision = 1;
    commitTransaction(root, {
      'sandbox.json': json(sandbox), 'artifacts.json': json(artifacts),
      'events.jsonl': `${JSON.stringify(event)}\n`, 'decisions.md': '# Decisions\n\n',
      'knowledge/query.yaml': '{\n  "status": "pending",\n  "queries": []\n}\n',
      'knowledge/references.json': json({ formatVersion: 1, references: [] }),
      'tickets.json': json({ schemaVersion: 1, specRevision: null, status: 'draft', tickets: [] }),
      'test-cases.md': '# Test Cases\n\n状态：draft\n',
      'handoff.md': handoffText(root, sandbox, artifacts),
      ...context.writes, ...knowledge.writes,
    });
    return { root, sandbox, event };
  });
}

function currentArtifact(state, typeOrId) {
  const activeKey = state.artifacts.active[typeOrId];
  const item = activeKey
    ? state.artifacts.items.find((x) => x.key === activeKey)
    : state.artifacts.items.filter((x) => x.artifactId === typeOrId || x.key === typeOrId).sort((a, b) => b.revision - a.revision)[0];
  if (!item) fail('E_ARTIFACT_NOT_FOUND', `未找到产物: ${typeOrId}`);
  return item;
}

function reviseArtifact(root, typeOrId, options = {}) {
  return withLock(root, () => {
    const state = load(root);
    let previous;
    try { previous = currentArtifact(state, typeOrId); } catch (error) {
      if (error.code !== 'E_ARTIFACT_NOT_FOUND' || !options.path) throw error;
    }
    const type = previous ? previous.type : typeOrId;
    const artifactId = previous ? previous.artifactId : (options.artifactId || typeOrId);
    const relative = safeRelative(options.path || previous.path || DEFAULT_FILES[type]);
    const content = fs.readFileSync(inside(root, relative));
    const revision = previous ? previous.revision + 1 : 1;
    const key = `${artifactId}@${revision}`;
    const revisionPath = `revisions/${artifactId}/${revision}/${path.posix.basename(relative)}`;
    if (previous && previous.status === 'approved') previous.status = 'superseded';
    const item = {
      key, artifactId, type, revision, status: 'draft', path: relative, revisionPath,
      contentSha256: sha256(content), sources: options.sources || previous?.sources || [],
      dependsOn: options.dependsOn || previous?.dependsOn || [], metadata: { ...(previous?.metadata || {}), ...(options.metadata || {}) },
      createdAt: now(), createdBy: options.actor || 'agent', approvedAt: null, approvedBy: null,
    };
    state.artifacts.items.push(item);
    state.artifacts.active[type] = key;
    const event = eventFor(state, 'artifact.revised', { actor: options.actor, artifact: key, previous: previous?.key || null });
    return transactionState(root, state, event, { [revisionPath]: content });
  });
}

function unresolvedConflicts(artifacts) {
  return (artifacts.conflicts || []).filter((x) => !x.resolvedAt);
}

function approveArtifact(root, typeOrId, options = {}) {
  return withLock(root, () => {
    const state = load(root);
    const item = currentArtifact(state, typeOrId);
    const content = fs.readFileSync(inside(root, item.path));
    if (sha256(content) !== item.contentSha256) fail('E_ARTIFACT_DRIFT', `${item.path} 已变化，请先创建新 revision`);
    if (item.type === 'spec') {
      const knowledge = currentArtifact(state, 'knowledge');
      if (knowledge.status !== 'approved') fail('E_GATE', 'Spec 批准前必须完成或显式跳过知识参考');
      if (unresolvedConflicts(state.artifacts).length) fail('E_CONFLICT', '存在未解决的信息冲突');
    }
    if (item.type === 'plan') {
      const spec = currentArtifact(state, 'spec');
      if (spec.status !== 'approved' || item.metadata.specRevision !== spec.revision) {
        fail('E_SPEC_PLAN', 'Plan 必须且只能引用当前批准的 Spec revision');
      }
      const other = state.artifacts.items.find((x) => x.type === 'plan' && x.key !== item.key && x.status === 'approved' && x.metadata.specRevision === spec.revision);
      if (other) fail('E_SPEC_PLAN', `Spec revision ${spec.revision} 已有批准的 Plan: ${other.key}`);
    }
    item.status = 'approved';
    item.approvedAt = now();
    item.approvedBy = options.actor || 'user';
    if (item.type === 'knowledge') item.metadata.disposition = options.skipReason ? 'skipped' : 'completed';
    if (options.skipReason) item.metadata.skipReason = options.skipReason;
    const event = eventFor(state, 'artifact.approved', { actor: options.actor || 'user', artifact: item.key, disposition: item.metadata.disposition || 'approved' });
    return transactionState(root, state, event);
  });
}

function addConflict(root, conflict, options = {}) {
  if (!conflict || !conflict.id || !conflict.description) fail('E_CONFLICT_RECORD', '冲突需要 id 和 description');
  return withLock(root, () => {
    const state = load(root);
    if ((state.artifacts.conflicts || []).some((x) => x.id === conflict.id)) fail('E_CONFLICT_RECORD', `冲突 ID 已存在: ${conflict.id}`);
    const item = { id: conflict.id, description: conflict.description, sources: conflict.sources || [], createdAt: now(), resolvedAt: null, decision: null };
    state.artifacts.conflicts.push(item);
    const event = eventFor(state, 'knowledge.conflict_recorded', { actor: options.actor, conflictId: item.id });
    return transactionState(root, state, event);
  });
}

function resolveConflict(root, id, decision, options = {}) {
  if (!decision || !String(decision).trim()) fail('E_CONFLICT_DECISION', '解决冲突必须提供用户决定');
  return withLock(root, () => {
    const state = load(root);
    const item = (state.artifacts.conflicts || []).find((x) => x.id === id);
    if (!item) fail('E_CONFLICT_NOT_FOUND', `未找到冲突: ${id}`);
    if (item.resolvedAt) fail('E_CONFLICT_RESOLVED', `冲突已解决: ${id}`);
    item.resolvedAt = now(); item.resolvedBy = options.actor || 'user'; item.decision = String(decision);
    const relative = 'decisions.md';
    const content = `${readText(path.join(root, relative), '# Decisions\n\n')}## ${id}\n\n- 决定：${item.decision}\n- 确认人：${item.resolvedBy}\n- 时间：${item.resolvedAt}\n\n`;
    const event = eventFor(state, 'knowledge.conflict_resolved', { actor: item.resolvedBy, conflictId: id, decision: item.decision });
    return transactionState(root, state, event, { [relative]: content });
  });
}

function parseTarget(target) {
  const [phase, checkpoint] = String(target).split(':');
  if (!PHASES.includes(phase)) fail('E_TARGET', `未知阶段: ${target}`);
  const cp = checkpoint || CHECKPOINTS[phase][0];
  if (!CHECKPOINTS[phase].includes(cp)) fail('E_TARGET', `未知检查点: ${target}`);
  return { phase, checkpoint: cp };
}

function phaseIndex(phase) { return PHASES.indexOf(phase); }
function activeByType(state, type) {
  try { return currentArtifact(state, type); } catch { return null; }
}

function repoList(root) { return readJson(path.join(root, 'repo.json'), { repositories: [] }).repositories || []; }
function reviews(root) { return readText(path.join(root, 'reviews.jsonl'), '').split(/\r?\n/).filter(Boolean).map((x) => JSON.parse(x)); }

function gatesFor(root, state, target) {
  const missing = [];
  const context = activeByType(state, 'context');
  const knowledge = activeByType(state, 'knowledge');
  const spec = activeByType(state, 'spec');
  const plan = activeByType(state, 'plan');
  if (target.phase === 'brainstorm' && context?.status !== 'approved') missing.push('ticket_context 未批准');
  if (target.phase === 'brainstorm' && target.checkpoint === 'spec' && knowledge?.status !== 'approved') missing.push('知识参考未完成或未显式跳过');
  if (target.phase === 'plan' && spec?.status !== 'approved') missing.push('当前 Spec revision 未批准');
  if (target.phase === 'build') {
    if (plan?.status !== 'approved') missing.push('当前 Plan revision 未批准');
    if (!fs.existsSync(path.join(root, 'test-cases.md'))) missing.push('test-cases.md 缺失');
    const tickets = readJson(path.join(root, 'tickets.json'), { tickets: [] }).tickets || [];
    if (!tickets.length) missing.push('Tickets 缺失');
    if (tickets.some((x) => x.status === 'stale')) missing.push('Tickets 因上游变更已失效');
  }
  if (target.phase === 'review') {
    const repos = repoList(root);
    if (!repos.length) missing.push('repo.json 未记录仓库');
    if (repos.some((r) => !(r.baseCommit || r.base_commit) || !(r.finalCommit || r.final_commit))) missing.push('仓库 base/final Commit 不完整');
  }
  if (target.phase === 'pr') {
    const lastRollback = state.sandbox.lastRollbackRevision || 0;
    if (!reviews(root).some((r) => r.type === 'integration' && r.status === 'approved' && (r.eventRevision || 0) > lastRollback)) missing.push('当前 revision 的 Integration Review 未通过');
    const strict = validate(root, { strict: true });
    if (!strict.ok) missing.push(...strict.errors.map((error) => `strict validate: ${error}`));
  }
  if (unresolvedConflicts(state.artifacts).length) missing.push('存在未解决的信息冲突');
  return missing;
}

function allowedNextTargets(sandbox) {
  if (sandbox.phase === 'intake') return ['brainstorm:clarify'];
  if (sandbox.phase === 'brainstorm' && sandbox.checkpoint === 'clarify') return ['brainstorm:knowledge'];
  if (sandbox.phase === 'brainstorm' && sandbox.checkpoint === 'knowledge') return ['brainstorm:spec'];
  if (sandbox.phase === 'brainstorm') return ['plan'];
  const index = phaseIndex(sandbox.phase);
  return index >= 0 && index < PHASES.length - 1 ? [PHASES[index + 1]] : [];
}

function transition(root, targetText, options = {}) {
  return withLock(root, () => {
    const state = load(root);
    const target = parseTarget(targetText);
    const allowed = allowedNextTargets(state.sandbox);
    const canonical = target.phase === 'brainstorm' ? `${target.phase}:${target.checkpoint}` : target.phase;
    if (!allowed.includes(canonical)) fail('E_TRANSITION', `不允许从 ${state.sandbox.phase}:${state.sandbox.checkpoint} 前往 ${canonical}`, { allowed });
    const missing = gatesFor(root, state, target);
    if (missing.length) fail('E_GATE', '阶段门禁未满足', { missing });
    const from = { phase: state.sandbox.phase, checkpoint: state.sandbox.checkpoint };
    state.sandbox.phase = target.phase;
    state.sandbox.checkpoint = target.checkpoint;
    state.sandbox.status = target.phase === 'pr' ? 'completed' : 'in_progress';
    const event = eventFor(state, 'workflow.transitioned', { actor: options.actor, from, to: target });
    return transactionState(root, state, event);
  });
}

function downstream(artifacts, roots) {
  const affected = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of artifacts.items) {
      if (affected.has(item.key)) continue;
      if ((item.dependsOn || []).some((dep) => roots.has(dep) || affected.has(dep))) {
        affected.add(item.key); changed = true;
      }
    }
  }
  return affected;
}

function rollback(root, targetText, reason, options = {}) {
  if (!reason || !String(reason).trim()) fail('E_REASON', '回退必须提供原因');
  return withLock(root, () => {
    const state = load(root);
    const target = parseTarget(targetText);
    if (phaseIndex(target.phase) > phaseIndex(state.sandbox.phase)) fail('E_ROLLBACK', '回退目标不能晚于当前阶段');
    const targetType = target.phase === 'intake' ? 'context' : target.phase === 'brainstorm' ? (target.checkpoint === 'knowledge' ? 'knowledge' : 'spec') : target.phase;
    const authority = activeByType(state, targetType);
    const roots = new Set(authority ? [authority.key] : []);
    const affected = downstream(state.artifacts, roots);
    for (const item of state.artifacts.items) if (affected.has(item.key) && item.status !== 'superseded') item.status = 'stale';
    let revisionWrite = {};
    let newRevision = null;
    if (authority) {
      const content = fs.readFileSync(inside(root, authority.path));
      const revision = authority.revision + 1;
      const key = `${authority.artifactId}@${revision}`;
      const revisionPath = `revisions/${authority.artifactId}/${revision}/${path.posix.basename(authority.path)}`;
      newRevision = { ...authority, key, revision, revisionPath, status: 'draft', contentSha256: sha256(content), createdAt: now(), createdBy: options.actor || 'agent', approvedAt: null, approvedBy: null };
      authority.status = authority.status === 'approved' ? 'superseded' : authority.status;
      state.artifacts.items.push(newRevision);
      state.artifacts.active[authority.type] = key;
      revisionWrite[revisionPath] = content;
    }
    const from = { phase: state.sandbox.phase, checkpoint: state.sandbox.checkpoint };
    state.sandbox.phase = target.phase; state.sandbox.checkpoint = target.checkpoint; state.sandbox.status = 'in_progress';
    const event = eventFor(state, 'workflow.rolled_back', {
      actor: options.actor, from, to: target, reason: String(reason), affected: [...affected].sort(), newRevision: newRevision?.key || null,
    });
    state.sandbox.lastRollbackRevision = event.revision;
    if (phaseIndex(target.phase) <= phaseIndex('plan')) {
      const ticketDoc = readJson(path.join(root, 'tickets.json'), { schemaVersion: 1, tickets: [] });
      ticketDoc.tickets = (ticketDoc.tickets || []).map((ticket) => ({ ...ticket, status: 'stale', staleAt: event.at, staleReason: String(reason) }));
      revisionWrite['tickets.json'] = json(ticketDoc);
    }
    return transactionState(root, state, event, revisionWrite);
  });
}

function validate(root, options = {}) {
  const state = load(root);
  const errors = []; const warnings = [];
  if (state.sandbox.formatVersion !== FORMAT_VERSION) errors.push('不支持的 sandbox formatVersion');
  state.events.forEach((event, index) => { if (event.revision !== index + 1) errors.push(`事件 revision 在第 ${index + 1} 条断裂`); });
  if (state.sandbox.eventRevision !== state.events.length) errors.push('sandbox.eventRevision 与事件日志尾部不一致');
  for (const [type, key] of Object.entries(state.artifacts.active || {})) {
    const item = state.artifacts.items.find((x) => x.key === key);
    if (!item) { errors.push(`活跃产物缺失: ${type}=${key}`); continue; }
    const file = inside(root, item.path);
    if (!fs.existsSync(file)) { errors.push(`产物文件缺失: ${item.path}`); continue; }
    const actual = sha256(fs.readFileSync(file));
    if (actual !== item.contentSha256) errors.push(`产物内容漂移: ${item.path}`);
  }
  for (const item of state.artifacts.items) for (const dep of item.dependsOn || []) {
    if (!state.artifacts.items.some((x) => x.key === dep)) errors.push(`${item.key} 引用了不存在的依赖 ${dep}`);
  }
  if (phaseIndex(state.sandbox.phase) >= phaseIndex('build') || fs.existsSync(path.join(root, 'repo.json'))) {
    const repoResult = validateRepositories(root, { strict: options.strict, soft: true });
    errors.push(...repoResult.errors); warnings.push(...repoResult.warnings);
  }
  if (phaseIndex(state.sandbox.phase) >= phaseIndex('build') || fs.existsSync(path.join(root, 'skill-lock.yaml'))) {
    const lockResult = validateSkillLock(root, { strict: options.strict, soft: true });
    errors.push(...lockResult.errors); warnings.push(...lockResult.warnings);
  }
  if (options.strict && warnings.length) errors.push(...warnings.splice(0));
  return { ok: errors.length === 0, errors, warnings, sandbox: state.sandbox };
}

function git(cwd, args, options = {}) {
  const result = spawnSync('git', args, { cwd, encoding: options.encoding || 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0 && !options.soft) fail('E_GIT', `git ${args.join(' ')} 失败`, { stderr: String(result.stderr || '').trim() });
  return result;
}

function redactRemote(url) {
  if (!url) return url;
  let value = String(url).replace(/(https?:\/\/)[^/@\s]+@/i, '$1<redacted>@');
  value = value.replace(/([?&](?:token|signature|x-amz-signature|access_token)=)[^&]+/ig, '$1<redacted>');
  return value;
}

function fullSha(value) { return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value); }

function migrateRepoV1(document) {
  if (document.schemaVersion === 2) return document;
  if (document.schema_version !== 1) fail('E_REPO_SCHEMA', '不支持的 repo.json schema');
  return {
    schemaVersion: 2, sandboxId: document.ticket, workspaceRoot: document.workspace_root,
    createdAt: document.created_at, updatedAt: now(),
    repositories: (document.repositories || []).map((r) => ({
      id: r.name, path: r.path, url: redactRemote(r.remotes?.[0]?.url || null), remote: r.remotes?.[0]?.name || null,
      baseBranch: r.branch, baseCommit: r.base_commit, targetBranch: r.branch,
      headCommit: r.head_commit, finalCommit: r.final_commit, pushStatus: 'unpushed', lastVerifiedAt: null,
      statusAtBase: r.status_at_base || [], statusAtFinal: r.status_at_final || [], excludedDirtyPaths: r.excluded_dirty_paths || [],
      checkpoints: r.checkpoints || [],
    })),
    changes: [...(document.changes || []), { at: now(), type: 'schema-migrated', from: 1, to: 2 }],
  };
}

function validateRepositories(root, options = {}) {
  const file = path.join(root, 'repo.json');
  if (!fs.existsSync(file)) return { ok: true, errors: [], warnings: ['repo.json 尚未创建'] };
  let doc = readJson(file); if (doc.schema_version === 1) doc = migrateRepoV1(doc);
  const errors = []; const warnings = [];
  const workspace = doc.workspaceRoot || path.resolve(root, '..', '..');
  for (const repo of doc.repositories || []) {
    for (const field of ['baseCommit', 'headCommit']) if (!fullSha(repo[field])) errors.push(`${repo.id}.${field} 必须是完整 40 位 SHA`);
    if (repo.finalCommit !== null && !fullSha(repo.finalCommit)) errors.push(`${repo.id}.finalCommit 必须是完整 40 位 SHA 或 null`);
    const cwd = path.resolve(workspace, repo.path);
    if (!fs.existsSync(path.join(cwd, '.git'))) { warnings.push(`仓库不可用: ${repo.id} (${cwd})`); continue; }
    if (fullSha(repo.baseCommit) && fullSha(repo.finalCommit)) {
      const ancestor = git(cwd, ['merge-base', '--is-ancestor', repo.baseCommit, repo.finalCommit], { soft: true });
      if (ancestor.status !== 0) errors.push(`${repo.id}: finalCommit 不是 baseCommit 的后代`);
    }
    const actual = git(cwd, ['rev-parse', 'HEAD'], { soft: true });
    if (actual.status === 0 && repo.finalCommit && actual.stdout.trim() !== repo.finalCommit) errors.push(`${repo.id}: 实际 HEAD 与 finalCommit 不一致`);
  }
  return { ok: !errors.length, errors, warnings };
}

function digestDirectory(dir) {
  const files = walkFiles(dir, { exclude: ['.git', 'node_modules'] });
  const hash = require('crypto').createHash('sha256');
  for (const relative of files) { hash.update(relative); hash.update('\0'); hash.update(fs.readFileSync(path.join(dir, relative))); hash.update('\0'); }
  return hash.digest('hex');
}

function writeSkillLock(root, skills) {
  const entries = skills.map((skill) => {
    const dir = path.resolve(skill.path);
    const commit = git(dir, ['rev-parse', 'HEAD'], { soft: true });
    return { name: skill.name, source: skill.source || null, version: skill.version || null, commit: commit.status === 0 ? commit.stdout.trim() : null, digest: `sha256:${digestDirectory(dir)}`, localPath: dir, usedBy: skill.usedBy || [] };
  });
  atomicWrite(path.join(root, 'skill-lock.yaml'), json({ formatVersion: 1, skills: entries }));
  if (fs.existsSync(manifestPath(root))) recordEvent(root, 'skill.locked', { skills: entries.map((x) => x.name) });
  return entries;
}

function validateSkillLock(root, options = {}) {
  const file = path.join(root, 'skill-lock.yaml');
  if (!fs.existsSync(file)) return { ok: true, errors: [], warnings: ['skill-lock.yaml 尚未创建'] };
  const doc = readJson(file); const errors = []; const warnings = [];
  for (const skill of doc.skills || []) {
    const localPath = skill.localPath || skill.path;
    if (!localPath || !fs.existsSync(localPath)) { warnings.push(`Skill 本地路径不可用: ${skill.name}`); continue; }
    const actual = `sha256:${digestDirectory(localPath)}`;
    if (actual !== skill.digest) (options.strict ? errors : warnings).push(`Skill 摘要变化: ${skill.name}`);
  }
  return { ok: !errors.length, errors, warnings };
}

function regenerateHandoff(root) {
  const state = load(root); const text = handoffText(root, state.sandbox, state.artifacts);
  atomicWrite(path.join(root, 'handoff.md'), text); return text;
}

function recordEvent(root, type, payload = {}) {
  return withLock(root, () => {
    const state = load(root);
    const event = eventFor(state, type, payload);
    return transactionState(root, state, event);
  });
}

function recordCommit(root, record, options = {}) {
  if (!record || !record.ticketId || !record.repositoryId || !fullSha(record.commit)) fail('E_COMMIT_RECORD', 'Commit 记录需要 ticketId、repositoryId 和完整 40 位 SHA');
  return withLock(root, () => {
    const state = load(root);
    const item = { ...record, tests: Array.isArray(record.tests) ? record.tests : [], pushed: Boolean(record.pushed), createdAt: record.createdAt || now() };
    const relative = 'commits.jsonl';
    const content = `${readText(path.join(root, relative), '')}${JSON.stringify(item)}\n`;
    const event = eventFor(state, 'repository.commit_recorded', { actor: options.actor, ticketId: item.ticketId, repositoryId: item.repositoryId, commit: item.commit });
    return transactionState(root, state, event, { [relative]: content });
  });
}

function recordReview(root, record, options = {}) {
  if (!record || !record.id || !['plan', 'integration'].includes(record.type) || !['approved', 'changes_required'].includes(record.status)) {
    fail('E_REVIEW_RECORD', 'Review 记录需要 id、type(plan|integration) 和 status(approved|changes_required)');
  }
  return withLock(root, () => {
    const state = load(root);
    const item = { ...record, eventRevision: state.sandbox.eventRevision + 1, createdAt: record.createdAt || now() };
    const relative = 'reviews.jsonl';
    const content = `${readText(path.join(root, relative), '')}${JSON.stringify(item)}\n`;
    const event = eventFor(state, 'review.recorded', { actor: options.actor, reviewId: item.id, reviewType: item.type, status: item.status });
    return transactionState(root, state, event, { [relative]: content });
  });
}

module.exports = {
  createSandbox, load, reviseArtifact, approveArtifact, addConflict, resolveConflict, transition, rollback, validate,
  allowedNextTargets, gatesFor, downstream, parseTarget, regenerateHandoff,
  recordEvent,
  recordCommit, recordReview,
  redactRemote, fullSha, migrateRepoV1, validateRepositories, writeSkillLock, validateSkillLock,
  git, digestDirectory,
};
