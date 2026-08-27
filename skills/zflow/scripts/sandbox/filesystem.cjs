'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fail } = require('./errors.cjs');

const TRANSACTION = '.sandbox-transaction.json';
const LOCK = '.sandbox.lock';

function now() { return new Date().toISOString(); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }

function validateSlug(slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(slug) || slug === '.' || slug === '..') {
    fail('E_SLUG', `无效的沙箱标识: ${String(slug)}`);
  }
  return slug;
}

function dateStamp(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) fail('E_DATE', '无效的沙箱日期');
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, '0'))
    .join('');
}

function nextSandboxId(baseRoot, suffix, options = {}) {
  validateSlug(suffix);
  const day = dateStamp(options.date);
  let highest = 0;
  if (fs.existsSync(baseRoot)) {
    const pattern = new RegExp(`^${day}(\\d{3})-`);
    for (const entry of fs.readdirSync(baseRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const match = pattern.exec(entry.name);
      if (match) highest = Math.max(highest, Number(match[1]));
    }
  }
  const sequence = highest + 1;
  if (sequence > 999) fail('E_SEQUENCE_EXHAUSTED', `${day} 的沙箱轮次已达到 999`);
  return validateSlug(`${day}${String(sequence).padStart(3, '0')}-${suffix}`);
}

function safeRelative(input) {
  if (typeof input !== 'string' || !input || input.includes('\0')) fail('E_PATH', '路径不能为空或包含 NUL');
  const unix = input.replace(/\\/g, '/');
  if (path.isAbsolute(input) || /^[a-z]:\//i.test(unix) || unix.startsWith('//')) fail('E_PATH', `禁止绝对路径: ${input}`);
  const normalized = path.posix.normalize(unix);
  if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) fail('E_PATH', `路径越界: ${input}`);
  return normalized;
}

function inside(root, relative) {
  const safe = safeRelative(relative);
  const target = path.resolve(root, ...safe.split('/'));
  const base = `${path.resolve(root)}${path.sep}`;
  if (target !== path.resolve(root) && !target.startsWith(base)) fail('E_PATH', `路径越界: ${relative}`);
  return target;
}

function mkdirp(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readText(file, fallback) {
  try { return fs.readFileSync(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  }
}
function readJson(file, fallback) {
  const text = readText(file, fallback === undefined ? undefined : null);
  if (text === null) return fallback;
  try { return JSON.parse(text); }
  catch (error) { fail('E_JSON', `JSON 解析失败: ${file}`, { cause: error.message }); }
}

function atomicWrite(file, content) {
  mkdirp(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function recoverTransaction(root) {
  const journal = path.join(root, TRANSACTION);
  if (!fs.existsSync(journal)) return false;
  const tx = readJson(journal);
  for (const item of tx.writes || []) {
    atomicWrite(inside(root, item.path), Buffer.from(item.base64, 'base64'));
  }
  fs.unlinkSync(journal);
  return true;
}

function commitTransaction(root, writes) {
  const entries = Object.entries(writes).map(([relative, content]) => ({
    path: safeRelative(relative),
    base64: Buffer.from(content).toString('base64'),
  }));
  atomicWrite(path.join(root, TRANSACTION), json({ version: 1, createdAt: now(), writes: entries }));
  recoverTransaction(root);
}

function acquireLock(root, options = {}) {
  mkdirp(root);
  const lockPath = path.join(root, LOCK);
  const staleMs = options.staleMs || 5 * 60 * 1000;
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, json({ pid: process.pid, createdAt: now() }));
    fs.closeSync(fd);
    return { lockPath, tookOver: false };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const lock = readJson(lockPath, {});
    const age = Date.now() - Date.parse(lock.createdAt || 0);
    if (!options.takeover || !Number.isFinite(age) || age <= staleMs) {
      fail('E_LOCKED', '沙箱正被另一个写入者占用', lock);
    }
    fs.unlinkSync(lockPath);
    const acquired = acquireLock(root, { ...options, takeover: false });
    acquired.tookOver = true;
    acquired.previous = lock;
    return acquired;
  }
}

function withLock(root, fn, options = {}) {
  const lock = acquireLock(root, options);
  try {
    recoverTransaction(root);
    return fn(lock);
  } finally {
    try { fs.unlinkSync(lock.lockPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function walkFiles(root, options = {}) {
  const result = [];
  const excluded = new Set(options.exclude || []);
  function visit(dir, prefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (excluded.has(relative) || excluded.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) fail('E_SYMLINK', `沙箱不允许符号链接: ${relative}`);
      if (entry.isDirectory()) visit(full, relative);
      else if (entry.isFile()) result.push(relative);
    }
  }
  visit(root, '');
  return result;
}

module.exports = {
  TRANSACTION, LOCK, now, sha256, json, validateSlug, dateStamp, nextSandboxId, safeRelative, inside, mkdirp,
  readText, readJson, atomicWrite, recoverTransaction, commitTransaction, acquireLock,
  withLock, walkFiles,
};
