'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  classifyRegistryResult,
  publishTagForVersion,
  validateTag,
  validateVersion,
  verifyAncestor,
} = require('../scripts/verify-release.cjs');
const { updatePackageVersion } = require('../scripts/apply-release-version.cjs');
const { verifyPack } = require('../scripts/verify-pack.cjs');

const root = path.resolve(__dirname, '..');

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}`);
  return result.stdout.trim();
}

test('TC-R01: tag 是 SemVer 2.0.0 唯一版本来源', t => {
  assert.equal(validateTag('v1.16.0'), '1.16.0');
  assert.equal(validateTag('v2.0.0-beta.1+build.7'), '2.0.0-beta.1+build.7');
  assert.equal(validateVersion('0.0.0-rc.1'), '0.0.0-rc.1');
  assert.throws(() => validateTag('1.16.0'), { code: 'E_TAG_VERSION' });
  assert.throws(() => validateTag('v01.16.0'), { code: 'E_SEMVER' });
  assert.throws(() => validateTag('v1.16.0-beta.01'), { code: 'E_SEMVER' });
  assert.equal(publishTagForVersion('1.16.0'), 'latest');
  assert.equal(publishTagForVersion('1.16.0+build-7'), 'latest');
  assert.equal(publishTagForVersion('1.17.0-rc.1'), 'next');

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zflow-release-version-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.writeFileSync(path.join(cwd, 'package.json'), '{"name":"@kaitow/zflow","version":"1.0.0"}\n');
  assert.deepEqual(updatePackageVersion(cwd, '2.1.0-beta.2'), {
    package: '@kaitow/zflow',
    previousVersion: '1.0.0',
    version: '2.1.0-beta.2',
  });
  assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).version, '2.1.0-beta.2');
});

test('TC-R02: 只有 main 祖先 commit 可发布', t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zflow-release-git-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  git(cwd, ['init', '-b', 'main']);
  git(cwd, ['config', 'user.name', 'Zflow Test']);
  git(cwd, ['config', 'user.email', 'zflow@example.invalid']);
  fs.writeFileSync(path.join(cwd, 'main.txt'), 'main\n');
  git(cwd, ['add', 'main.txt']);
  git(cwd, ['commit', '-m', 'main']);
  const mainCommit = git(cwd, ['rev-parse', 'HEAD']);
  assert.equal(verifyAncestor(mainCommit, 'main', cwd), mainCommit);

  git(cwd, ['switch', '--orphan', 'isolated']);
  fs.rmSync(path.join(cwd, 'main.txt'), { force: true });
  fs.writeFileSync(path.join(cwd, 'isolated.txt'), 'isolated\n');
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-m', 'isolated']);
  const isolatedCommit = git(cwd, ['rev-parse', 'HEAD']);
  assert.throws(() => verifyAncestor(isolatedCommit, 'main', cwd), { code: 'E_NOT_ON_MAIN' });
});

test('TC-R03: registry 仅 E404 视为可发布', () => {
  assert.equal(classifyRegistryResult({ status: 0, stdout: '"1.15.0"', stderr: '' }), 'exists');
  assert.equal(classifyRegistryResult({ status: 1, stdout: '', stderr: 'npm error code E404' }), 'missing');
  assert.equal(classifyRegistryResult({ status: 1, stdout: '', stderr: 'ECONNRESET' }), 'error');
});

test('TC-R04/R05: workflow 仅 tag 触发且使用 OIDC、顺序正确', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'publish-npm.yml'), 'utf8');
  assert.match(workflow, /tags:\s*\n\s*- ['"]v\*\.\*\.\*['"]/);
  assert.doesNotMatch(workflow, /branches:/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /node-version:\s*['"]24['"]/);
  assert.doesNotMatch(workflow, /secrets\.NPM_TOKEN|NODE_AUTH_TOKEN/);
  assert.doesNotMatch(workflow, /npm_[A-Za-z0-9]{20,}/);
  const verifyIndex = workflow.indexOf('verify-release.cjs');
  const applyIndex = workflow.indexOf('apply-release-version.cjs');
  const testIndex = workflow.indexOf('npm test');
  const linkIndex = workflow.indexOf('npm run test:link');
  const packIndex = workflow.indexOf('verify-pack.cjs');
  const publishIndex = workflow.indexOf('npm publish --access public');
  assert.ok(verifyIndex >= 0 && verifyIndex < applyIndex);
  assert.ok(applyIndex < testIndex);
  assert.ok(testIndex < linkIndex && linkIndex < packIndex && packIndex < publishIndex);
  assert.match(workflow, /npm publish --access public --tag "\$\{\{ steps\.release\.outputs\.npm_tag \}\}"/);
});

test('TC-R06: pack 校验只接受两个产品 skill', () => {
  const good = [{ id: '@kaitow/zflow@1.15.0', files: [
    { path: 'skills/zflow/SKILL.md' },
    { path: 'skills/zflow-vision/SKILL.md' },
    { path: 'README.md' },
  ] }];
  assert.equal(verifyPack(good).ok, true);
  assert.throws(() => verifyPack([{ id: 'bad', files: [...good[0].files, { path: 'installer/SKILL.md' }] }]), /安装器/);
  assert.throws(() => verifyPack([{ id: 'bad', files: [{ path: 'skills/zflow/SKILL.md' }] }]), /skills 异常/);
});
