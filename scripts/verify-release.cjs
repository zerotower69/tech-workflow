#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
// SemVer 2.0.0 官方建议的 ECMAScript 兼容正则：支持 prerelease 与 build metadata。
const RELEASE_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

class ReleaseError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function parseArgs(argv) {
  const result = {
    tag: process.env.GITHUB_REF_NAME || '',
    branch: 'origin/main',
    commit: '',
    skipRegistry: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tag') result.tag = argv[++i] || '';
    else if (arg === '--branch') result.branch = argv[++i] || '';
    else if (arg === '--commit') result.commit = argv[++i] || '';
    else if (arg === '--skip-registry') result.skipRegistry = true;
    else throw new ReleaseError('E_ARGUMENT', `未知参数: ${arg}`);
  }
  return result;
}

function validateVersion(version) {
  if (!RELEASE_VERSION_RE.test(version)) {
    throw new ReleaseError('E_SEMVER', `版本不是合法 SemVer 2.0.0: ${version || '<empty>'}`);
  }
  return version;
}

function validateTag(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('v')) {
    throw new ReleaseError('E_TAG_VERSION', `发布 tag 必须使用 v<semver>: ${tag || '<empty>'}`);
  }
  return validateVersion(tag.slice(1));
}

function publishTagForVersion(version) {
  validateVersion(version);
  const match = RELEASE_VERSION_RE.exec(version);
  return match[4] ? 'next' : 'latest';
}

function run(command, args, cwd = root) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' });
}

function resolveCommit(ref, cwd = root) {
  const result = run('git', ['rev-parse', `${ref}^{commit}`], cwd);
  if (result.status !== 0) {
    throw new ReleaseError('E_GIT_REF', `无法解析 Git 引用: ${ref}`, result.stderr.trim());
  }
  return result.stdout.trim();
}

function verifyAncestor(commitRef, branchRef, cwd = root) {
  const commit = resolveCommit(commitRef, cwd);
  resolveCommit(branchRef, cwd);
  const result = run('git', ['merge-base', '--is-ancestor', commit, branchRef], cwd);
  if (result.status === 1) {
    throw new ReleaseError('E_NOT_ON_MAIN', `${commit} 尚未合入 ${branchRef}`);
  }
  if (result.status !== 0) {
    throw new ReleaseError('E_GIT_ANCESTRY', `无法验证 ${commit} 与 ${branchRef} 的祖先关系`, result.stderr.trim());
  }
  return commit;
}

function classifyRegistryResult(result) {
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status === 0) return 'exists';
  if (/\bE404\b|404 Not Found/i.test(combined)) return 'missing';
  return 'error';
}

function verifyRegistryVersion(packageName, version, cwd = root) {
  const spec = `${packageName}@${version}`;
  const result = run('npm', ['view', spec, 'version', '--json'], cwd);
  const state = classifyRegistryResult(result);
  if (state === 'exists') {
    throw new ReleaseError('E_VERSION_EXISTS', `${spec} 已存在，npm 版本不可覆盖`);
  }
  if (state === 'error') {
    throw new ReleaseError('E_REGISTRY', `无法确认 ${spec} 是否已发布`, `${result.stdout || ''}\n${result.stderr || ''}`.trim());
  }
  return 'missing';
}

function verifyRelease(options, cwd = root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  const version = validateTag(options.tag);
  const commit = verifyAncestor(options.commit || options.tag, options.branch, cwd);
  const registry = options.skipRegistry ? 'skipped' : verifyRegistryVersion(pkg.name, version, cwd);
  return {
    ok: true,
    package: pkg.name,
    version,
    sourceVersion: pkg.version,
    publishTag: publishTagForVersion(version),
    tag: options.tag,
    commit,
    branch: options.branch,
    registry,
  };
}

function main(argv = process.argv.slice(2)) {
  try {
    const result = verifyRelease(parseArgs(argv));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const payload = {
      ok: false,
      code: error.code || 'E_INTERNAL',
      message: error.message,
      details: error.details || null,
    };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  ReleaseError,
  classifyRegistryResult,
  parseArgs,
  publishTagForVersion,
  validateTag,
  validateVersion,
  verifyAncestor,
  verifyRegistryVersion,
  verifyRelease,
};
