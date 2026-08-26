#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const expectedSkills = ['skills/zflow-vision/SKILL.md', 'skills/zflow/SKILL.md'];

function verifyPack(payload) {
  const pack = Array.isArray(payload) ? payload[0] : payload;
  if (!pack || !Array.isArray(pack.files)) throw new Error('npm pack JSON 缺少 files');
  const paths = pack.files.map(file => file.path);
  const forbidden = paths.filter(file => file.startsWith('installer/') || file.includes('tech-workflow-installer'));
  if (forbidden.length) throw new Error(`发布包包含安装器 skill/prompt: ${forbidden.join(', ')}`);
  const productSkills = paths.filter(file => /^skills\/[^/]+\/SKILL\.md$/.test(file)).sort();
  if (JSON.stringify(productSkills) !== JSON.stringify(expectedSkills)) {
    throw new Error(`发布包产品 skills 异常: ${productSkills.join(', ')}`);
  }
  return { ok: true, package: pack.id, productSkills };
}

function main(argv = process.argv.slice(2)) {
  const input = argv[0];
  if (!input) {
    process.stderr.write('用法: node scripts/verify-pack.cjs <npm-pack.json>\n');
    process.exitCode = 1;
    return;
  }
  try {
    const result = verifyPack(JSON.parse(fs.readFileSync(input, 'utf8')));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: 'E_PACK_CONTENT', message: error.message })}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { expectedSkills, verifyPack };
