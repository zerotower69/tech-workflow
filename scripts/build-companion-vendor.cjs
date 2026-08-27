#!/usr/bin/env node
'use strict';

// Bundle the two mature npm libraries used by the visual companion so copied
// skills stay offline-capable and do not need their own node_modules tree.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'skills/zflow-vision/visual-companion/scripts/vendor');
fs.mkdirSync(outDir, { recursive: true });

Promise.all([
  esbuild.build({
    entryPoints: [require.resolve('html-to-image')],
    outfile: path.join(outDir, 'html-to-image.js'),
    bundle: true,
    format: 'iife',
    globalName: 'htmlToImage',
    minify: true,
    platform: 'browser',
    target: ['chrome100', 'edge100', 'firefox100', 'safari15.4'],
    legalComments: 'none',
  }),
  esbuild.build({
    stdin: {
      contents: "const { countTokens } = require('gpt-tokenizer/encoding/o200k_base'); module.exports = { countTokens };",
      resolveDir: root,
      sourcefile: 'tokenizer-entry.cjs',
      loader: 'js',
    },
    outfile: path.join(outDir, 'tokenizer.cjs'),
    bundle: true,
    format: 'cjs',
    minify: true,
    platform: 'node',
    target: ['node18'],
    legalComments: 'none',
  }),
]).then(() => {
  const notices = [
    ['html-to-image 1.11.13', 'https://github.com/bubkoo/html-to-image', path.join(root, 'node_modules/html-to-image/LICENSE')],
    ['gpt-tokenizer 4.0.0', 'https://github.com/niieani/gpt-tokenizer', path.join(root, 'node_modules/gpt-tokenizer/LICENSE')],
  ].map(([name, url, license]) => `${name}\n${url}\n\n${fs.readFileSync(license, 'utf8').trim()}`);
  fs.writeFileSync(path.join(outDir, 'THIRD_PARTY_NOTICES.txt'), [
    'Generated bundles are rebuilt with: npm run build:companion-vendor',
    '',
    notices.join('\n\n' + '='.repeat(72) + '\n\n'),
    '',
  ].join('\n'));
  console.log(`visual companion vendor bundles built in ${outDir}`);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
