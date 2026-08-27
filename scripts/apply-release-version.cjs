#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { publishTagForVersion, validateTag } = require('./verify-release.cjs');

const root = path.resolve(__dirname, '..');

function updatePackageVersion(cwd, version) {
  const packagePath = path.join(cwd, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const previousVersion = pkg.version;
  pkg.version = version;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  return { package: pkg.name, previousVersion, version };
}

function applyReleaseVersion(tag, cwd = root) {
  const version = validateTag(tag);
  const result = updatePackageVersion(cwd, version);
  const sync = spawnSync(process.execPath, ['scripts/sync-version.js'], { cwd, encoding: 'utf8' });
  if (sync.status !== 0) {
    throw new Error(`版本位点同步失败\n${sync.stdout || ''}\n${sync.stderr || ''}`.trim());
  }
  const publishTag = publishTagForVersion(version);
  return { ...result, publishTag, syncOutput: sync.stdout.trim() };
}

function main(argv = process.argv.slice(2)) {
  try {
    const tag = argv[0] || process.env.GITHUB_REF_NAME || '';
    const result = applyReleaseVersion(tag);
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\nnpm_tag=${result.publishTag}\n`);
    }
    if (result.syncOutput) process.stdout.write(`${result.syncOutput}\n`);
    process.stdout.write(`${JSON.stringify({ ...result, syncOutput: undefined })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, message: error.message })}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  applyReleaseVersion,
  updatePackageVersion,
};
