'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { fail } = require('./errors.cjs');
const { now, sha256, json, safeRelative, inside, mkdirp, atomicWrite, recoverTransaction, walkFiles, readJson } = require('./filesystem.cjs');
const { load, git, migrateRepoV1, validate, regenerateHandoff, recordEvent } = require('./core.cjs');

function payloadId(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(value)) fail('E_REPO_ID', `不安全的仓库 ID: ${String(value)}`);
  return value;
}

function runGit(cwd, args, options = {}) {
  return git(cwd, args, options);
}

function repoDocument(root) {
  const file = path.join(root, 'repo.json');
  if (!fs.existsSync(file)) return { schemaVersion: 2, workspaceRoot: path.resolve(root, '..', '..'), repositories: [] };
  const doc = readJson(file);
  return doc.schema_version === 1 ? migrateRepoV1(doc) : doc;
}

function remoteContains(cwd, sha) {
  const result = runGit(cwd, ['branch', '-r', '--contains', sha], { soft: true });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function collectRepoPayload(root) {
  const doc = repoDocument(root);
  const workspace = doc.workspaceRoot || path.resolve(root, '..', '..');
  const payloads = [];
  for (const repo of doc.repositories || []) {
    payloadId(repo.id);
    const cwd = path.resolve(workspace, repo.path);
    if (!fs.existsSync(path.join(cwd, '.git'))) fail('E_PACK_REPO', `仓库不可用，无法保护: ${repo.id}`);
    const head = runGit(cwd, ['rev-parse', 'HEAD']).stdout.trim();
    const status = runGit(cwd, ['status', '--porcelain=v1', '-z']).stdout;
    const pushed = remoteContains(cwd, head);
    const payload = { id: repo.id, path: repo.path, url: repo.url || null, head, pushed, bundle: null, patch: null, untracked: [] };
    if (!pushed) {
      const tmp = path.join(os.tmpdir(), `zflow-${process.pid}-${Date.now()}-${repo.id}.bundle`);
      const bundle = runGit(cwd, ['bundle', 'create', tmp, '--all'], { soft: true });
      if (bundle.status !== 0 || !fs.existsSync(tmp)) fail('E_PACK_BUNDLE', `无法为未推送 Commit 创建 bundle: ${repo.id}`);
      payload.bundle = fs.readFileSync(tmp).toString('base64');
      fs.unlinkSync(tmp);
    }
    if (status) {
      const patchResult = runGit(cwd, ['diff', '--binary', 'HEAD'], { soft: true });
      if (patchResult.status !== 0) fail('E_PACK_PATCH', `无法保护已跟踪改动: ${repo.id}`);
      if (patchResult.stdout) payload.patch = Buffer.from(patchResult.stdout).toString('base64');
      const untracked = runGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z'], { soft: true });
      if (untracked.status !== 0) fail('E_PACK_UNTRACKED', `无法枚举未跟踪文件: ${repo.id}`);
      for (const relative of untracked.stdout.split('\0').filter(Boolean)) {
        const safe = safeRelative(relative);
        if (safe === '.scratch' || safe.startsWith('.scratch/')) continue;
        const file = inside(cwd, safe);
        const stat = fs.lstatSync(file);
        if (!stat.isFile()) fail('E_PACK_UNTRACKED', `未跟踪项不是普通文件，无法安全保护: ${repo.id}/${safe}`);
        const data = fs.readFileSync(file);
        payload.untracked.push({ path: safe, sha256: sha256(data), data: data.toString('base64') });
      }
    }
    payloads.push(payload);
  }
  return payloads;
}

function packSandbox(root, output) {
  recoverTransaction(root);
  const repositories = collectRepoPayload(root);
  recordEvent(root, 'sandbox.packed', { output: path.basename(output), repositoryCount: repositories.length });
  const state = load(root);
  const files = walkFiles(root, { exclude: ['.sandbox.lock', '.sandbox-transaction.json', 'payload'] }).map((relative) => {
    const data = fs.readFileSync(inside(root, relative));
    return { path: relative, sha256: sha256(data), data: data.toString('base64') };
  });
  const content = { formatVersion: 1, sandboxId: state.sandbox.sandboxId, eventRevision: state.sandbox.eventRevision, createdAt: now(), files, repositories };
  const contentSha256 = sha256(Buffer.from(JSON.stringify(content)));
  const archive = { ...content, contentSha256 };
  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(archive)), { level: 9 });
  atomicWrite(path.resolve(output), compressed);
  return { output: path.resolve(output), archiveSha256: sha256(compressed), contentSha256, files: files.length, repositories: repositories.length };
}

function readArchive(file) {
  let archive;
  try { archive = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')); }
  catch (error) { fail('E_ARCHIVE', '归档无法解压或解析', { cause: error.message }); }
  const { contentSha256, ...content } = archive;
  const actual = sha256(Buffer.from(JSON.stringify(content)));
  if (actual !== contentSha256) fail('E_ARCHIVE_HASH', '归档内容摘要不匹配');
  if (archive.formatVersion !== 1) fail('E_ARCHIVE_VERSION', `不支持的归档版本: ${archive.formatVersion}`);
  for (const item of archive.files || []) {
    safeRelative(item.path);
    const data = Buffer.from(item.data, 'base64');
    if (sha256(data) !== item.sha256) fail('E_FILE_HASH', `文件摘要不匹配: ${item.path}`);
  }
  return archive;
}

function ensureEmpty(dir) {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) fail('E_TARGET_NOT_EMPTY', `恢复目标非空: ${dir}`);
  mkdirp(dir);
}

function restoreRepository(repo, workspaceRoot, payloadRoot) {
  payloadId(repo.id);
  if (!workspaceRoot) return { id: repo.id, status: 'payload-only' };
  mkdirp(workspaceRoot);
  const relative = safeRelative(repo.path);
  if (relative === '.') fail('E_RESTORE_ROOT_REPO', `仓库 ${repo.id} 位于 workspace 根，MVP 不自动覆盖恢复；payload 已保留`);
  const cwd = inside(workspaceRoot, relative);
  const existedBefore = fs.existsSync(cwd);
  if (fs.existsSync(cwd) && fs.readdirSync(cwd).length) fail('E_TARGET_NOT_EMPTY', `仓库恢复目标非空: ${cwd}`);
  mkdirp(path.dirname(cwd));
  try {
    if (repo.url) {
      const clone = runGit(workspaceRoot, ['clone', repo.url, relative], { soft: true });
      if (clone.status !== 0) fail('E_RESTORE_CLONE', `Clone 失败: ${repo.id}`, { stderr: clone.stderr.trim() });
    } else {
      mkdirp(cwd); runGit(cwd, ['init']);
    }
    if (repo.bundle) {
      const bundleFile = path.join(payloadRoot, `${repo.id}.bundle`);
      fs.writeFileSync(bundleFile, Buffer.from(repo.bundle, 'base64'));
      const fetch = runGit(cwd, ['fetch', bundleFile, repo.head], { soft: true });
      if (fetch.status !== 0) fail('E_RESTORE_BUNDLE', `Bundle 恢复失败: ${repo.id}`);
    }
    const checkout = runGit(cwd, ['checkout', '--detach', repo.head], { soft: true });
    if (checkout.status !== 0) fail('E_RESTORE_COMMIT', `Commit 无法恢复: ${repo.id}@${repo.head}`);
    if (repo.patch) {
      const patchFile = path.join(payloadRoot, `${repo.id}.patch`);
      fs.writeFileSync(patchFile, Buffer.from(repo.patch, 'base64'));
      const apply = runGit(cwd, ['apply', '--check', patchFile], { soft: true });
      if (apply.status !== 0) fail('E_RESTORE_CONFLICT', `Patch 与目标仓库冲突: ${repo.id}`);
      runGit(cwd, ['apply', patchFile]);
    }
    for (const item of repo.untracked || []) {
      const target = inside(cwd, item.path);
      if (fs.existsSync(target)) fail('E_RESTORE_CONFLICT', `未跟踪文件将覆盖现有内容: ${repo.id}/${item.path}`);
      const data = Buffer.from(item.data, 'base64');
      if (sha256(data) !== item.sha256) fail('E_FILE_HASH', `未跟踪文件摘要不匹配: ${repo.id}/${item.path}`);
      mkdirp(path.dirname(target)); fs.writeFileSync(target, data);
    }
    return { id: repo.id, status: 'restored', path: cwd, preserveEmpty: existedBefore };
  } catch (error) {
    try {
      fs.rmSync(cwd, { recursive: true, force: true });
      if (existedBefore) mkdirp(cwd);
    } catch { /* 保留原始恢复错误 */ }
    throw error;
  }
}

function restoreSandbox(archiveFile, output, options = {}) {
  const archive = readArchive(archiveFile);
  const finalOutput = path.resolve(output);
  const existedBefore = fs.existsSync(finalOutput);
  if (existedBefore && fs.readdirSync(finalOutput).length) fail('E_TARGET_NOT_EMPTY', `恢复目标非空: ${finalOutput}`);
  const staging = `${finalOutput}.restore-${process.pid}-${Date.now()}`;
  ensureEmpty(staging);
  const restoredRepositories = [];
  try {
    for (const item of archive.files || []) {
      const target = inside(staging, item.path); mkdirp(path.dirname(target)); fs.writeFileSync(target, Buffer.from(item.data, 'base64'));
    }
    if (options.workspaceRoot && fs.existsSync(path.join(staging, 'repo.json'))) {
      const repoDoc = repoDocument(staging);
      repoDoc.workspaceRoot = path.resolve(options.workspaceRoot);
      atomicWrite(path.join(staging, 'repo.json'), json(repoDoc));
    }
    const payloadRoot = path.join(staging, 'payload', 'repositories'); mkdirp(payloadRoot);
    const repoResults = [];
    for (const repo of archive.repositories || []) {
      payloadId(repo.id);
      const record = { ...repo, bundle: repo.bundle ? `${repo.id}.bundle` : null, patch: repo.patch ? `${repo.id}.patch` : null, untracked: (repo.untracked || []).map((x) => ({ path: x.path, sha256: x.sha256 })) };
      fs.writeFileSync(path.join(payloadRoot, `${repo.id}.json`), json(record));
      if (repo.bundle) fs.writeFileSync(path.join(payloadRoot, `${repo.id}.bundle`), Buffer.from(repo.bundle, 'base64'));
      if (repo.patch) fs.writeFileSync(path.join(payloadRoot, `${repo.id}.patch`), Buffer.from(repo.patch, 'base64'));
      for (const item of repo.untracked || []) {
        const data = Buffer.from(item.data, 'base64');
        const target = inside(path.join(payloadRoot, repo.id, 'untracked'), item.path);
        mkdirp(path.dirname(target)); fs.writeFileSync(target, data);
      }
      const restored = restoreRepository(repo, options.workspaceRoot, payloadRoot);
      repoResults.push(restored);
      if (restored.path) restoredRepositories.push(restored);
    }
    regenerateHandoff(staging);
    const result = validate(staging, { strict: false });
    if (!result.ok) fail('E_RESTORE_VALIDATE', '恢复后的沙箱校验失败', result.errors);
    if (existedBefore) fs.rmdirSync(finalOutput);
    fs.renameSync(staging, finalOutput);
    return { output: finalOutput, sandboxId: archive.sandboxId, repositories: repoResults, warnings: result.warnings };
  } catch (error) {
    error.restoreTarget = finalOutput;
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* 保留原始错误 */ }
    for (const restored of restoredRepositories.reverse()) {
      try {
        fs.rmSync(restored.path, { recursive: true, force: true });
        if (restored.preserveEmpty) mkdirp(restored.path);
      } catch { /* 保留原始错误 */ }
    }
    throw error;
  }
}

module.exports = { packSandbox, restoreSandbox, readArchive, collectRepoPayload };
