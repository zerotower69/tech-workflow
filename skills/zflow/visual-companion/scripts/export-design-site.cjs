#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MARKER = '.tech-tower-design-site.json';

function fail(message) {
  throw new Error(message);
}

function parseArgs(args) {
  const options = { host: '127.0.0.1', port: 4173, serve: false, open: false, clean: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--session-dir') options.sessionDir = args[++index];
    else if (arg === '--out') options.out = args[++index];
    else if (arg === '--title') options.title = args[++index];
    else if (arg === '--host') options.host = args[++index];
    else if (arg === '--port') options.port = Number(args[++index]);
    else if (arg === '--serve') options.serve = true;
    else if (arg === '--open') options.open = true;
    else if (arg === '--clean') options.clean = true;
    else fail(`未知参数: ${arg}`);
  }
  if (!options.sessionDir) fail('缺少 --session-dir');
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    fail('--port 必须是 0-65535 的整数');
  }
  return options;
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function isRegularFile(file) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1;
  } catch (error) { return false; }
}

function prepareOutput(output, clean) {
  const resolved = path.resolve(output);
  if ([path.parse(resolved).root, os.homedir()].includes(resolved)) fail('拒绝使用过宽的导出目录');
  if (fs.existsSync(resolved)) {
    const entries = fs.readdirSync(resolved);
    if (entries.length && !clean) fail(`导出目录非空: ${resolved}；如需重建请加 --clean`);
    if (entries.length && clean) {
      const marker = path.join(resolved, MARKER);
      if (!isRegularFile(marker)) fail('--clean 只允许清理由本脚本创建且带标记的目录');
      const value = JSON.parse(fs.readFileSync(marker, 'utf8'));
      if (value.schema !== 'tech-tower.design-site.v1') fail('导出目录标记不匹配，拒绝清理');
      for (const entry of entries) fs.rmSync(path.join(resolved, entry), { recursive: true, force: true });
    }
  }
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function readJsonLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch (error) { return []; }
    });
  } catch (error) { return []; }
}

function analyticsSummary(events) {
  const summary = { total: events.length, byType: {}, byPlugin: {} };
  for (const event of events) {
    const type = typeof event.type === 'string' ? event.type : 'unknown';
    summary.byType[type] = (summary.byType[type] || 0) + 1;
    if (typeof event.plugin === 'string') summary.byPlugin[event.plugin] = (summary.byPlugin[event.plugin] || 0) + 1;
  }
  return summary;
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function buildSite(options) {
  const sessionDir = fs.realpathSync(path.resolve(options.sessionDir));
  const contentDir = path.join(sessionDir, 'content');
  const stateDir = path.join(sessionDir, 'state');
  if (!fs.existsSync(contentDir) || !fs.statSync(contentDir).isDirectory()) fail(`会话缺少 content/: ${sessionDir}`);

  const defaultOut = path.join(sessionDir, 'exports', `design-site-${timestampSlug()}-${process.pid}`);
  const output = prepareOutput(options.out || defaultOut, options.clean);
  if (output === sessionDir || output.startsWith(contentDir + path.sep)) fail('导出目录不能覆盖会话或 content 目录');
  const publicDir = path.join(output, 'public');
  const pagesDir = path.join(publicDir, 'pages');
  const decisionsDir = path.join(publicDir, 'decisions');
  const dataDir = path.join(publicDir, 'data');
  const runtimeDir = path.join(output, '_runtime');
  for (const directory of [pagesDir, decisionsDir, dataDir, runtimeDir]) fs.mkdirSync(directory, { recursive: true });

  process.env.BRAINSTORM_DIR = sessionDir;
  const { exportHtml } = require('./server.cjs');
  const { renderMarkdown } = require('./vendor/markdown.cjs');
  const screenFiles = fs.readdirSync(contentDir)
    .filter((name) => !name.startsWith('.') && name.endsWith('.html'))
    .map((name) => {
      const file = path.join(contentDir, name);
      if (!isRegularFile(file)) return null;
      return { name, file, mtime: fs.statSync(file).mtime.getTime() };
    })
    .filter(Boolean)
    .sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name));
  if (!screenFiles.length) fail('会话中没有可导出的 HTML 页面');

  const pages = screenFiles.map((screen) => {
    const html = exportHtml(screen.file);
    const target = path.join(pagesDir, screen.name);
    fs.writeFileSync(target, html);
    return { name: screen.name, href: `pages/${encodeURIComponent(screen.name)}`, bytes: Buffer.byteLength(html), sourceMtime: new Date(screen.mtime).toISOString() };
  });

  const decisionNames = ['design-spec.md', 'design-decisions.md', 'decisions.md', 'spec.md'];
  const decisionDocuments = decisionNames.flatMap((name) => {
    const source = path.join(sessionDir, name);
    if (!isRegularFile(source)) return [];
    const markdown = fs.readFileSync(source, 'utf8');
    fs.writeFileSync(path.join(decisionsDir, name), markdown);
    return [{ name, bytes: Buffer.byteLength(markdown), href: `decisions/${encodeURIComponent(name)}`, markdown }];
  });
  const decisionsHtml = decisionDocuments.map((document) =>
    `<section data-decision-document="${document.name.replace(/[&<>"]/g, '')}">${renderMarkdown(document.markdown)}</section>`
  ).join('\n<hr>\n');

  const analytics = analyticsSummary(readJsonLines(path.join(stateDir, 'analytics.jsonl')));
  fs.writeFileSync(path.join(dataDir, 'analytics-summary.json'), JSON.stringify(analytics, null, 2) + '\n');
  const generatedAt = new Date().toISOString();
  const siteData = {
    schema: 'tech-tower.design-site.v1',
    title: options.title || '技术塔设计交付站',
    sessionLabel: path.basename(sessionDir),
    generatedAt,
    pages,
    decisionDocuments: decisionDocuments.map(({ markdown, ...document }) => document),
    decisionsHtml,
    analytics,
  };
  const template = fs.readFileSync(path.join(__dirname, 'design-site-template.html'), 'utf8');
  if (!template.includes('<!--TT_SITE_DATA-->')) fail('站点模板缺少数据占位符');
  fs.writeFileSync(path.join(publicDir, 'index.html'), template.replace('<!--TT_SITE_DATA-->', jsonForScript(siteData)));
  fs.writeFileSync(path.join(publicDir, 'site-manifest.json'), JSON.stringify({ ...siteData, decisionsHtml: undefined }, null, 2) + '\n');

  fs.copyFileSync(path.join(__dirname, 'serve-design-site.cjs'), path.join(output, 'serve.cjs'));
  fs.copyFileSync(path.join(__dirname, 'vendor', 'express.cjs'), path.join(runtimeDir, 'express.cjs'));
  fs.copyFileSync(path.join(__dirname, 'vendor', 'THIRD_PARTY_NOTICES.txt'), path.join(runtimeDir, 'THIRD_PARTY_NOTICES.txt'));
  fs.writeFileSync(path.join(output, 'README.md'), `# ${siteData.title}\n\n运行：\n\n\`\`\`bash\nnode serve.cjs --open\n\`\`\`\n\n默认仅监听 127.0.0.1，启动后使用终端输出的完整随机预览 URL。\n`);
  fs.writeFileSync(path.join(output, MARKER), JSON.stringify({ schema: siteData.schema, generatedAt }) + '\n', { mode: 0o600 });
  return { status: 'ok', path: output, publicDir, pages: pages.length, decisions: decisionDocuments.length, analyticsEvents: analytics.total };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = buildSite(options);
  if (!options.serve) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const { startServer } = require(path.join(result.path, 'serve.cjs'));
  startServer({ host: options.host, port: options.port, open: options.open }, (server) => {
    process.stdout.write(`${JSON.stringify({ ...result, server })}\n`);
  });
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'error', error: error.message })}\n`);
    process.exit(1);
  }
}

module.exports = { analyticsSummary, buildSite, parseArgs, prepareOutput };
