#!/usr/bin/env node
// 把 package.json 的 version 同步到全部版本位点（regex 替换，保留原文件格式）。
// 由 npm version 钩子触发（见 package.json scripts.version），也可手工运行校验：
//   node scripts/sync-version.js
// 位点清单见 .version-bump.json。
// 注意：SKILL.md「版本历史」条目为手工维护，本脚本不改写历史记录。

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;

if (!/^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(version)) {
  console.error(`❌ package.json 版本格式异常: ${version}`);
  process.exit(1);
}

const changed = [];

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

// 只允许恰好命中 1 处的替换，防止误伤同名文本
function replaceOnce(content, re, build, file, label) {
  const globalRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const matches = content.match(globalRe);
  const count = matches ? matches.length : 0;
  if (count !== 1) fail(`${file}: 「${label}」匹配到 ${count} 处（预期 1 处），已中止`);
  return content.replace(re, build);
}

function apply(path, transform, label) {
  const file = resolve(root, path);
  if (!existsSync(file)) fail(`文件不存在: ${path}`);
  const before = readFileSync(file, 'utf8');
  const after = transform(before, path);
  // 位点存在但已是目标版本 → 幂等跳过（脚本可重复运行做校验）
  if (after === before) {
    changed.push(`${path}（${label}，已是 v${version}）`);
    return;
  }
  writeFileSync(file, after);
  changed.push(`${path}（${label}）`);
}

// SKILL.md frontmatter：只处理首个 --- ... --- 块，避免误伤正文
function replaceFrontmatterVersion(content, file) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) fail(`${file}: 未找到 frontmatter`);
  let hit = false;
  const fm = m[1].replace(/^(\s*version:\s*).+$/m, (s, p1) => {
    hit = true;
    return p1 + version;
  });
  if (!hit) fail(`${file}: frontmatter 内未找到 version 字段`);
  return content.replace(m[0], `---\n${fm}\n---`);
}

const jsonVersionRe = /("version"\s*:\s*")[^"]+(")/;
const installEchoRe = /(\(v)\d+\.\d+\.\d+(\))/;

// 1. skills/tech-tower-workflow/SKILL.md：frontmatter version + 标题版本
apply('skills/tech-tower-workflow/SKILL.md', (c, f) => {
  c = replaceFrontmatterVersion(c, f);
  return replaceOnce(c, /^# 技术塔工作流 v.+$/m, `# 技术塔工作流 v${version}`, f, '标题版本');
}, 'frontmatter+标题');

// 2. skills/tech-tower-installer/SKILL.md：frontmatter version
apply('skills/tech-tower-installer/SKILL.md', (c, f) => replaceFrontmatterVersion(c, f), 'frontmatter');

// 3. README.md：「当前版本」行
apply('README.md', (c, f) =>
  replaceOnce(c, /(当前版本\s*\*\*v)[^*]+(\*\*)/, (m, p1, p2) => p1 + version + p2, f, '当前版本行'),
'当前版本');

// 4. plugin-src/plugin.json
apply('plugin-src/plugin.json', (c, f) =>
  replaceOnce(c, jsonVersionRe, (m, p1, p2) => p1 + version + p2, f, 'version 字段'),
'version 字段');

// 5. .claude-plugin/marketplace.json
apply('.claude-plugin/marketplace.json', (c, f) =>
  replaceOnce(c, jsonVersionRe, (m, p1, p2) => p1 + version + p2, f, 'plugins.0.version'),
'plugins.0.version');

// 6/7. install.sh / install.ps1 的 installed 提示
apply('install.sh', (c, f) =>
  replaceOnce(c, installEchoRe, (m, p1, p2) => p1 + version + p2, f, 'installed echo'),
'installed echo');
apply('install.ps1', (c, f) =>
  replaceOnce(c, installEchoRe, (m, p1, p2) => p1 + version + p2, f, 'installed output'),
'installed output');

console.log(`✅ 版本已同步到 v${version}：`);
for (const item of changed) console.log(`   - ${item}`);
console.log('   提示：SKILL.md「版本历史」条目需手工补写。');
