'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const installer = path.join(root, 'bin', 'zflow.js');
const packageJson = require(path.join(root, 'package.json'));

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'zflow-install-'));
  const home = path.join(base, 'home');
  const project = path.join(base, 'project');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  return { base, home, project };
}

function run(args, cwd, home) {
  return spawnSync(process.execPath, [installer, ...args], {
    cwd,
    env: { ...process.env, HOME: home, CODEX_HOME: path.join(home, '.codex') },
    encoding: 'utf8',
  });
}

function skillNames(base) {
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(base, entry.name, 'SKILL.md')))
    .map(entry => entry.name)
    .sort();
}

test('TC-001: scoped package exposes zflow commands', () => {
  assert.equal(packageJson.name, '@kaitow/zflow');
  assert.equal(packageJson.version, '1.15.0');
  assert.equal(packageJson.publishConfig.access, 'public');
  assert.deepEqual(packageJson.bin, {
    zflow: 'bin/zflow.js',
    'zflow-sandbox': 'bin/zflow-sandbox.js',
  });
  for (const args of [['--help'], ['--version']]) {
    const result = run(args, root, os.homedir());
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /zflow/);
  }
});

test('TC-007/009: package and README contain no installer skill prompt', () => {
  assert.equal(packageJson.files.includes('installer/'), false);
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /npx @kaitow\/zflow/);
  assert.doesNotMatch(readme, /installer\/SKILL|tech-workflow-installer|AI 自动安装/);
  assert.deepEqual(skillNames(path.join(root, 'skills')), ['zflow', 'zflow-vision']);
});

test('TC-003/005: Codex fresh install removes only exact legacy skills', t => {
  const f = fixture();
  t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
  const base = path.join(f.project, '.codex', 'skills');
  for (const name of ['tech-workflow', 'tech-visual-companion', 'unrelated-skill']) {
    fs.mkdirSync(path.join(base, name), { recursive: true });
    fs.writeFileSync(path.join(base, name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  }
  const result = run(['--tool', 'codex'], f.project, f.home);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(skillNames(base), ['unrelated-skill', 'zflow', 'zflow-vision']);
  assert.equal(fs.existsSync(path.join(base, 'tech-workflow')), false);
  assert.equal(fs.existsSync(path.join(base, 'tech-visual-companion')), false);
});

test('TC-004: Claude fresh install contains only product skills', t => {
  const f = fixture();
  t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
  const result = run(['--tool', 'claude'], f.project, f.home);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(skillNames(path.join(f.project, '.claude', 'skills')), ['zflow', 'zflow-vision']);
});

test('TC-006: uninstall removes new and legacy names but preserves unrelated skills', t => {
  const f = fixture();
  t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
  const base = path.join(f.project, '.codex', 'skills');
  for (const name of ['zflow', 'zflow-vision', 'tech-workflow', 'tech-visual-companion', 'unrelated-skill']) {
    fs.mkdirSync(path.join(base, name), { recursive: true });
    fs.writeFileSync(path.join(base, name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  }
  const result = run(['--tool', 'codex', '--uninstall'], f.project, f.home);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(skillNames(base), ['unrelated-skill']);
});
