'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const packageJson = require(path.join(root, 'package.json'));
const skillsCli = process.env.ZFLOW_SKILLS_CLI_SPEC || 'skills@1.5.23';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(args, cwd, env) {
  const result = spawnSync(npx, ['--yes', skillsCli, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `skills CLI failed (${args.join(' ')}):\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout}\n${result.stderr}`;
}

function installedSkills(projectDir) {
  const base = path.join(projectDir, '.agents', 'skills');
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(base, entry.name, 'SKILL.md')))
    .map(entry => entry.name)
    .sort();
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zflow-skills-cli-'));
const projectDir = path.join(tempRoot, 'project');
const isolatedHome = path.join(tempRoot, 'home');
fs.mkdirSync(projectDir, { recursive: true });
fs.mkdirSync(isolatedHome, { recursive: true });

const env = {
  ...process.env,
  HOME: isolatedHome,
  npm_config_cache: path.join(tempRoot, 'npm-cache'),
  npm_config_userconfig: path.join(tempRoot, 'npmrc'),
  DISABLE_TELEMETRY: '1',
};

try {
  const listed = run(['add', root, '--list'], projectDir, env);
  assert.match(listed, /zflow/);
  assert.match(listed, /zflow-vision/);

  run([
    'add', root,
    '--skill', '*',
    '--agent', 'codex', 'claude-code',
    '--yes',
    '--copy',
  ], projectDir, env);

  assert.deepEqual(installedSkills(projectDir), ['zflow', 'zflow-vision']);
  for (const skillName of installedSkills(projectDir)) {
    const skill = fs.readFileSync(path.join(projectDir, '.agents', 'skills', skillName, 'SKILL.md'), 'utf8');
    assert.match(skill, new RegExp(`^name: ${skillName}$`, 'm'));
    assert.match(skill, new RegExp(`^  version: ${packageJson.version.replaceAll('.', '\\.')}$`, 'm'));
  }

  for (const forbidden of ['installer', 'tech-workflow', 'tech-visual-companion']) {
    assert.equal(fs.existsSync(path.join(projectDir, '.agents', 'skills', forbidden)), false);
  }

  console.log(`skills CLI first-install verification passed with ${skillsCli}`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
