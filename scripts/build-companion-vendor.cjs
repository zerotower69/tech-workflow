#!/usr/bin/env node
'use strict';

// Bundle mature npm libraries used by the visual companion so copied skills
// and exported sites stay offline-capable without their own node_modules tree.
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'skills/zflow-vision/visual-companion/scripts/vendor');
fs.mkdirSync(outDir, { recursive: true });

Promise.all([
  esbuild.build({
    entryPoints: [require.resolve('@popperjs/core')],
    outfile: path.join(outDir, 'popper.js'),
    bundle: true,
    format: 'iife',
    globalName: 'Popper',
    minify: true,
    platform: 'browser',
    target: ['chrome100', 'edge100', 'firefox100', 'safari15.4'],
    legalComments: 'none',
    metafile: true,
  }),
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
    metafile: true,
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
    metafile: true,
  }),
  esbuild.build({
    entryPoints: [require.resolve('express')],
    outfile: path.join(outDir, 'express.cjs'),
    bundle: true,
    format: 'cjs',
    minify: true,
    platform: 'node',
    target: ['node18'],
    legalComments: 'none',
    metafile: true,
  }),
  esbuild.build({
    stdin: {
      contents: `
        const { marked } = require('marked');
        const xss = require('xss');
        function renderMarkdown(value) {
          const rendered = marked.parse(String(value || ''), { gfm: true });
          return xss(rendered, {
            whiteList: {
              ...xss.whiteList,
              a: ['href', 'name', 'title', 'target', 'rel'],
              img: ['src', 'alt', 'title'],
              code: ['class']
            }
          });
        }
        module.exports = { renderMarkdown };
      `,
      resolveDir: root,
      sourcefile: 'markdown-entry.cjs',
      loader: 'js',
    },
    outfile: path.join(outDir, 'markdown.cjs'),
    bundle: true,
    format: 'cjs',
    minify: true,
    platform: 'node',
    target: ['node18'],
    legalComments: 'none',
    metafile: true,
  }),
]).then((builds) => {
  const packageRoots = new Set();
  for (const build of builds) {
    for (const input of Object.keys(build.metafile.inputs)) {
      let directory = path.dirname(path.resolve(root, input));
      while (directory.startsWith(path.join(root, 'node_modules') + path.sep)) {
        if (fs.existsSync(path.join(directory, 'package.json'))) {
          packageRoots.add(directory);
          break;
        }
        const parent = path.dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
    }
  }
  const notices = [...packageRoots].map((packageRoot) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    const licenseFile = fs.readdirSync(packageRoot).find((name) => /^licen[cs]e(?:\.|$)/i.test(name));
    const license = licenseFile
      ? fs.readFileSync(path.join(packageRoot, licenseFile), 'utf8').trim()
      : `License declared by package: ${manifest.license || 'unknown'}`;
    const url = manifest.repository && (typeof manifest.repository === 'string' ? manifest.repository : manifest.repository.url);
    return `${manifest.name} ${manifest.version}\n${url || manifest.homepage || ''}\n\n${license}`;
  }).sort();
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
