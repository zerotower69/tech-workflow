#!/usr/bin/env node
// 原型快照：只截 app 页面区域，供 plan/build/review 后续参考。
// 区域约定：mockup 用 <div data-tt-screen> 包裹 app 页面；缺失时回退 #frame-content，再回退 body。
// 用法：node snapshot-prototype.cjs --url <原型URL> --out <png路径> [--selector <css>] [--viewport 480x960] [--wait 500]
// 输出单行 JSON：
//   成功 {"status":"ok","path","width","height","estReadTokens"}
//   失败 {"status":"error","error","hint"}
// token 说明：截图本身是无头浏览器行为，≈0 tokens；estReadTokens = ceil(w*h/750)，
// 即后续把该图读回视觉模型上下文的近似成本。
const fs = require('fs');
const path = require('path');

function fail(error, hint) {
  console.log(JSON.stringify({ status: 'error', error, hint: hint || '' }));
  process.exit(1);
}

const argv = process.argv.slice(2);
const opts = { selector: '', viewport: '480x960', wait: '500' };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--url') opts.url = argv[++i];
  else if (a === '--out') opts.out = argv[++i];
  else if (a === '--selector') opts.selector = argv[++i];
  else if (a === '--viewport') opts.viewport = argv[++i];
  else if (a === '--wait') opts.wait = argv[++i];
  else fail(`未知参数 ${a}`);
}
if (!opts.url || !opts.out) {
  fail('缺少 --url 或 --out', '例：node snapshot-prototype.cjs --url http://localhost:52341/?key=xx --out .scratch/<sandbox-id>/mockups/snapshot-1.png');
}

let pw;
try {
  pw = require('playwright');
} catch (e) {
  fail('playwright 未安装', '在可达的 node_modules 中 npm i playwright && npx playwright install chromium；或改用浏览器 MCP（如 playwriter）做等价 element 截图');
}

const [vw, vh] = opts.viewport.split('x').map((n) => parseInt(n, 10));
if (!vw || !vh) fail('--viewport 格式应为 宽x高，如 480x960');

(async () => {
  let browser;
  try {
    browser = await pw.chromium.launch({ headless: true });
  } catch (e) {
    browser = await pw.chromium.launch({ headless: true, channel: 'chrome' });
  }
  try {
    const page = await browser.newPage({ viewport: { width: vw, height: vh } });
    await page.goto(opts.url, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(parseInt(opts.wait, 10) || 0);
    let selector = opts.selector;
    if (!selector) {
      if (await page.$('[data-tt-screen]')) selector = '[data-tt-screen]';
      else if (await page.$('#frame-content')) selector = '#frame-content';
      else selector = 'body';
    }
    const el = await page.waitForSelector(selector, { timeout: 5000 });
    fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    await el.screenshot({ path: opts.out });
    const box = await el.boundingBox();
    const estReadTokens = Math.ceil((box.width * box.height) / 750);
    console.log(JSON.stringify({
      status: 'ok',
      path: opts.out,
      width: Math.round(box.width),
      height: Math.round(box.height),
      estReadTokens,
    }));
  } finally {
    await browser.close();
  }
})().catch((e) => fail(e.message));
