#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zflow-link-test-'));
const prefix = path.join(tempRoot, 'prefix');
const consumer = path.join(tempRoot, 'consumer');
const home = path.join(tempRoot, 'home');
const cache = path.join(tempRoot, 'cache');
const userConfig = path.join(tempRoot, 'npmrc');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const npmEnv = {
  ...process.env,
  npm_config_prefix: prefix,
  npm_config_userconfig: userConfig,
  npm_config_cache: cache,
};

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function skillNames(base) {
  return fs.readdirSync(base, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(base, entry.name, 'SKILL.md')))
    .map(entry => entry.name)
    .sort();
}

try {
  fs.mkdirSync(prefix, { recursive: true });
  fs.mkdirSync(path.join(consumer, '.codex'), { recursive: true });
  fs.mkdirSync(path.join(consumer, '.claude'), { recursive: true });
  fs.mkdirSync(home, { recursive: true });

  run(npm, ['config', 'set', 'prefix', prefix, '--location=user'], root, npmEnv);
  run(npm, ['link'], root, npmEnv);
  run(npm, ['init', '-y'], consumer, npmEnv);
  run(npm, ['link', '@kaitow/zflow'], consumer, npmEnv);

  const executable = path.join(consumer, 'node_modules', '.bin', process.platform === 'win32' ? 'zflow.cmd' : 'zflow');
  const env = { ...process.env, HOME: home, CODEX_HOME: path.join(home, '.codex') };
  run(executable, ['--tool', 'codex'], consumer, env);
  run(executable, ['--tool', 'claude'], consumer, env);

  for (const agentDir of ['.codex', '.claude']) {
    const skillsBase = path.join(consumer, agentDir, 'skills');
    const names = skillNames(skillsBase);
    if (JSON.stringify(names) !== JSON.stringify(['zflow', 'zflow-vision'])) {
      throw new Error(`${agentDir} installed unexpected skills: ${names.join(', ')}`);
    }
    for (const name of names) {
      const content = fs.readFileSync(path.join(skillsBase, name, 'SKILL.md'), 'utf8');
      if (!content.includes(`name: ${name}`) || !content.includes(`version: ${version}`)) {
        throw new Error(`${agentDir}/${name} frontmatter mismatch`);
      }
    }
    for (const forbidden of ['tech-workflow', 'tech-visual-companion', 'installer']) {
      if (fs.existsSync(path.join(skillsBase, forbidden))) {
        throw new Error(`${agentDir} contains forbidden skill directory: ${forbidden}`);
      }
    }
  }

  console.log(`✅ npm link 首次安装通过：Codex/Claude 均仅识别 zflow 与 zflow-vision (v${version})`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
