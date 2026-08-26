#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { SandboxError } = require('./errors.cjs');
const core = require('./core.cjs');
const archive = require('./archive.cjs');
const { atomicWrite, json, readJson } = require('./filesystem.cjs');

function usage() {
  return `技术塔可迁移工作流沙箱\n\n` +
    `用法：\n` +
    `  zflow-sandbox create <slug> [--root <dir>] [--title <text>]\n` +
    `  zflow-sandbox status [dir] [--json]\n` +
    `  zflow-sandbox validate [dir] [--strict] [--json]\n` +
    `  zflow-sandbox revise <artifact> [dir] [--path <file>] [--spec-revision <n>]\n` +
    `  zflow-sandbox approve <artifact> [dir] [--skip-reason <text>]\n` +
    `  zflow-sandbox conflict-add <id> <description> [dir] [--sources <a,b>]\n` +
    `  zflow-sandbox conflict-resolve <id> <decision> [dir]\n` +
    `  zflow-sandbox transition <target> [dir]\n` +
    `  zflow-sandbox rollback <target> [dir] --reason <text>\n` +
    `  zflow-sandbox handoff [dir]\n` +
    `  zflow-sandbox migrate-repo [dir]\n` +
    `  zflow-sandbox verify-repositories [dir]\n` +
    `  zflow-sandbox record-commit <json> [dir]\n` +
    `  zflow-sandbox record-review <json> [dir]\n` +
    `  zflow-sandbox lock-skill <name> <path> [dir] [--version <v>] [--source <uri>]\n` +
    `  zflow-sandbox pack [dir] --output <file.tws>\n` +
    `  zflow-sandbox restore <file.tws> --output <dir> [--workspace-root <dir>]\n`;
}

function parse(argv) {
  const positionals = []; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (!value.startsWith('--')) { positionals.push(value); continue; }
    const name = value.slice(2);
    if (['json', 'strict', 'help'].includes(name)) flags[name] = true;
    else {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new SandboxError('E_ARGS', `--${name} 缺少值`);
      flags[name] = argv[++i];
    }
  }
  return { positionals, flags };
}

function sandboxDir(value) { return path.resolve(value || process.cwd()); }
function print(value, asJson) {
  if (asJson) process.stdout.write(`${JSON.stringify(value)}\n`);
  else if (typeof value === 'string') process.stdout.write(`${value}\n`);
  else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function main(argv = process.argv.slice(2)) {
  const { positionals, flags } = parse(argv);
  const command = positionals.shift();
  if (!command || flags.help || command === 'help') { process.stdout.write(usage()); return 0; }
  let result;
  if (command === 'create') {
    const slug = positionals.shift(); if (!slug) throw new SandboxError('E_ARGS', 'create 需要 slug');
    const root = path.resolve(flags.root || '.scratch', slug);
    result = core.createSandbox(root, { slug, title: flags.title });
  } else if (command === 'status') {
    const root = sandboxDir(positionals.shift()); const state = core.load(root);
    result = { ...state.sandbox, allowedNext: core.allowedNextTargets(state.sandbox) };
  } else if (command === 'validate') {
    result = core.validate(sandboxDir(positionals.shift()), { strict: Boolean(flags.strict) });
    if (!result.ok) { print(result, true); return 2; }
  } else if (command === 'revise') {
    const artifact = positionals.shift(); if (!artifact) throw new SandboxError('E_ARGS', 'revise 需要 artifact');
    const metadata = flags['spec-revision'] ? { specRevision: Number(flags['spec-revision']) } : {};
    result = core.reviseArtifact(sandboxDir(positionals.shift()), artifact, {
      path: flags.path, metadata,
      sources: flags.sources ? flags.sources.split(',').filter(Boolean) : undefined,
      dependsOn: flags['depends-on'] ? flags['depends-on'].split(',').filter(Boolean) : undefined,
    });
  } else if (command === 'approve') {
    const artifact = positionals.shift(); if (!artifact) throw new SandboxError('E_ARGS', 'approve 需要 artifact');
    result = core.approveArtifact(sandboxDir(positionals.shift()), artifact, { skipReason: flags['skip-reason'], actor: 'user' });
  } else if (command === 'conflict-add') {
    const id = positionals.shift(); const description = positionals.shift();
    if (!id || !description) throw new SandboxError('E_ARGS', 'conflict-add 需要 id 和 description');
    result = core.addConflict(sandboxDir(positionals.shift()), { id, description, sources: flags.sources ? flags.sources.split(',').filter(Boolean) : [] });
  } else if (command === 'conflict-resolve') {
    const id = positionals.shift(); const decision = positionals.shift();
    if (!id || !decision) throw new SandboxError('E_ARGS', 'conflict-resolve 需要 id 和 decision');
    result = core.resolveConflict(sandboxDir(positionals.shift()), id, decision, { actor: 'user' });
  } else if (command === 'transition') {
    const target = positionals.shift(); if (!target) throw new SandboxError('E_ARGS', 'transition 需要 target');
    result = core.transition(sandboxDir(positionals.shift()), target);
  } else if (command === 'rollback') {
    const target = positionals.shift(); if (!target) throw new SandboxError('E_ARGS', 'rollback 需要 target');
    result = core.rollback(sandboxDir(positionals.shift()), target, flags.reason);
  } else if (command === 'handoff') {
    result = core.regenerateHandoff(sandboxDir(positionals.shift()));
  } else if (command === 'migrate-repo') {
    const root = sandboxDir(positionals.shift()); const file = path.join(root, 'repo.json');
    result = core.migrateRepoV1(readJson(file)); atomicWrite(file, json(result));
  } else if (command === 'verify-repositories') {
    result = core.validateRepositories(sandboxDir(positionals.shift()));
  } else if (command === 'record-commit') {
    const record = positionals.shift(); if (!record) throw new SandboxError('E_ARGS', 'record-commit 需要 JSON');
    result = core.recordCommit(sandboxDir(positionals.shift()), JSON.parse(record));
  } else if (command === 'record-review') {
    const record = positionals.shift(); if (!record) throw new SandboxError('E_ARGS', 'record-review 需要 JSON');
    result = core.recordReview(sandboxDir(positionals.shift()), JSON.parse(record));
  } else if (command === 'lock-skill') {
    const name = positionals.shift(); const skillPath = positionals.shift();
    if (!name || !skillPath) throw new SandboxError('E_ARGS', 'lock-skill 需要 name 和 path');
    const root = sandboxDir(positionals.shift());
    result = core.writeSkillLock(root, [{ name, path: path.resolve(skillPath), version: flags.version, source: flags.source, usedBy: ['workflow'] }]);
  } else if (command === 'pack') {
    const root = sandboxDir(positionals.shift()); if (!flags.output) throw new SandboxError('E_ARGS', 'pack 需要 --output');
    result = archive.packSandbox(root, flags.output);
  } else if (command === 'restore') {
    const file = positionals.shift(); if (!file || !flags.output) throw new SandboxError('E_ARGS', 'restore 需要归档文件和 --output');
    result = archive.restoreSandbox(path.resolve(file), path.resolve(flags.output), { workspaceRoot: flags['workspace-root'] ? path.resolve(flags['workspace-root']) : null });
  } else throw new SandboxError('E_ARGS', `未知命令: ${command}`);
  print(result, flags.json);
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) {
    const payload = error instanceof SandboxError
      ? { ok: false, code: error.code, message: error.message, details: error.details }
      : { ok: false, code: 'E_INTERNAL', message: error.message };
    process.stderr.write(`${JSON.stringify(payload)}\n`); process.exitCode = 1;
  }
}

module.exports = { main, parse, usage };
