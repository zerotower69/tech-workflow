#!/usr/bin/env node
// 更新检查：每天首次触发时比较 GitHub 最新 tag 与本地版本。
// 用法：node check-update.cjs [--force] [--repo <owner/repo 或 url>]
// 输出单行 JSON：
//   {"status":"ok","checked":true,"local","latest","updateAvailable"}
//   {"status":"ok","checked":false,"reason":"already-checked-today",...}
//   {"status":"error","error"} —— 检查失败不阻塞工作流
// 状态文件：$TECH_TOWER_STATE_DIR/update-check.json（默认 ~/.tech-tower/）
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const args = process.argv.slice(2);
let force = false;
let repo = 'zerotower69/tech-tower-workflow';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--force') force = true;
  else if (args[i] === '--repo') repo = String(args[++i] || '').replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
}

function out(obj) { console.log(JSON.stringify(obj)); process.exit(0); }

const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const stateDir = process.env.TECH_TOWER_STATE_DIR || path.join(os.homedir(), '.tech-tower');
const stateFile = path.join(stateDir, 'update-check.json');

let local = '0.0.0';
try {
  const sk = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
  const m = sk.match(/version:\s*([\d.]+)/);
  if (m) local = m[1];
} catch (e) { /* 读不到就按 0.0.0 处理 */ }

let state = {};
try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (e) { /* 首次无状态 */ }

function cmp(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1; }
  return 0;
}

function fetchLatest() {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://api.github.com/repos/${repo}/tags?per_page=100`, {
      headers: { 'user-agent': 'tech-tower-update-check', accept: 'application/vnd.github+json' },
      timeout: 8000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const tags = JSON.parse(body).map((t) => t.name).filter((n) => /^v\d+\.\d+\.\d+$/.test(n));
          if (!tags.length) return reject(new Error('no semver tags'));
          tags.sort((a, b) => cmp(a.slice(1), b.slice(1)));
          resolve(tags[tags.length - 1].slice(1));
        } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

(async () => {
  if (!force && state.date === today) {
    out({ status: 'ok', checked: false, reason: 'already-checked-today', local, latest: state.latest || null, updateAvailable: cmp(state.latest, local) > 0 });
  }
  const latest = await fetchLatest();
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ date: today, local, latest }));
  } catch (e) { /* 状态写失败不影响结果 */ }
  out({ status: 'ok', checked: true, local, latest, updateAvailable: cmp(latest, local) > 0 });
})().catch((e) => out({ status: 'error', error: e.message }));
