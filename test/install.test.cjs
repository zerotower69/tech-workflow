'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateVersion } = require('../scripts/verify-release.cjs');

const root = path.resolve(__dirname, '..');
const packageJson = require(path.join(root, 'package.json'));

function skillNames(base) {
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(base, entry.name, 'SKILL.md')))
    .map(entry => entry.name)
    .sort();
}

test('TC-001: npm package only exposes runtime command, installation uses skills CLI', () => {
  assert.equal(packageJson.name, '@kaitow/zflow');
  assert.doesNotThrow(() => validateVersion(packageJson.version));
  assert.equal(packageJson.publishConfig.access, 'public');
  assert.deepEqual(packageJson.bin, { 'zflow-sandbox': 'bin/zflow-sandbox.js' });
  assert.equal(fs.existsSync(path.join(root, 'bin', 'zflow.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'install.sh')), false);
  assert.equal(fs.existsSync(path.join(root, 'install.ps1')), false);
});

test('TC-007/009: package and README contain no installer skill prompt', () => {
  assert.equal(packageJson.files.includes('installer/'), false);
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /npx skills add zerotower69\/tech-workflow/);
  assert.doesNotMatch(readme, /npx @kaitow\/zflow(?:\s|`)/);
  assert.doesNotMatch(readme, /installer\/SKILL|tech-workflow-installer|AI 自动安装/);
  assert.deepEqual(skillNames(path.join(root, 'skills')), ['zflow', 'zflow-vision']);
});
