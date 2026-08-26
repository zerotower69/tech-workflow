'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const core = require('../../skills/zflow/scripts/sandbox/core.cjs');

function temp(prefix = 'tech-workflow-test-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function write(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
function run(cwd, command, args) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')}\n${result.stderr}`);
  return result.stdout.trim();
}
function git(cwd, args) { return run(cwd, 'git', args); }
function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true }); git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Test']); git(dir, ['config', 'user.email', 'test@example.com']);
  write(path.join(dir, 'README.md'), 'base\n'); git(dir, ['add', 'README.md']); git(dir, ['commit', '-m', 'init']);
  return git(dir, ['rev-parse', 'HEAD']);
}
function approveContext(root) {
  write(path.join(root, 'ticket_context.md'), '# Ticket Context\n\nconfirmed\n');
  core.reviseArtifact(root, 'context'); core.approveArtifact(root, 'context');
}
function reachSpec(root) {
  approveContext(root); core.transition(root, 'brainstorm:clarify'); core.transition(root, 'brainstorm:knowledge');
  core.approveArtifact(root, 'knowledge', { skipReason: '测试无外部知识源' }); core.transition(root, 'brainstorm:spec');
}
function approveSpec(root, content = '# Spec\n\napproved\n') {
  write(path.join(root, 'spec.md'), content); core.reviseArtifact(root, 'spec', { path: 'spec.md' }); core.approveArtifact(root, 'spec');
  return core.load(root).artifacts.items.filter((x) => x.type === 'spec').at(-1);
}

module.exports = { temp, write, run, git, initRepo, approveContext, reachSpec, approveSpec };
