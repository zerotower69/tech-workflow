#!/usr/bin/env node

// 技术塔工作流安装器（npx tech-workflow）
// 设计参考 superpowers-zh 的 bin 模式：零依赖 Node 脚本、TARGETS 表驱动、
// 手写递归复制保证跨平台（含 Windows npx 缓存 junction）行为一致。
//
// 多 skill 结构：skills/<skill-name>/SKILL.md，安装 = 把 skills/ 下每个 skill
// 分别复制到目标的 skills 目录（如 .codex/skills/<skill-name>/）。
// 安装语义为「镜像覆盖」：先移除旧目录再整体复制，保证无旧版本残留。

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, lstatSync, copyFileSync, rmSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PKG = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const SKILLS_SRC = resolve(ROOT, 'skills');
const PROJECT_DIR = process.cwd();
const HOME = homedir();
const CODEX_HOME = process.env.CODEX_HOME || join(HOME, '.codex');

// 手动递归复制：跨 Node 版本和操作系统行为一致
// 不使用 cpSync —— 在 Windows + npx 缓存（含 junction）+ 部分 Node 版本下不稳定
function copyDirSync(src, dest) {
  let realSrc = src;
  try { realSrc = realpathSync(src); } catch { /* keep src */ }

  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(realSrc, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const srcPath = join(realSrc, entry.name);
    const destPath = join(dest, entry.name);
    let stat;
    try { stat = lstatSync(srcPath); } catch { continue; }
    if (stat.isSymbolicLink()) {
      try {
        const real = realpathSync(srcPath);
        const realStat = lstatSync(real);
        if (realStat.isDirectory()) copyDirSync(real, destPath);
        else copyFileSync(real, destPath);
      } catch { /* skip broken link */ }
    } else if (stat.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else if (stat.isFile()) {
      copyFileSync(srcPath, destPath);
    }
  }
}

// 不依赖 child_process 的 PATH 探测
function cliInPath(name) {
  const pathEnv = process.env.PATH || '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map(e => e.toLowerCase())
    : [''];
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      try { if (existsSync(join(dir, name + ext))) return true; } catch { /* ignore */ }
    }
  }
  return false;
}

// 扫描 skills/ 下的全部 skill（含 SKILL.md 的目录）
function scanSkills() {
  if (!existsSync(SKILLS_SRC)) {
    console.error('❌ 未找到 skills/ 目录，安装包不完整');
    process.exit(1);
  }
  const skills = [];
  for (const entry of readdirSync(SKILLS_SRC, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMd = join(SKILLS_SRC, entry.name, 'SKILL.md');
    if (!existsSync(skillMd)) continue;
    skills.push({ name: entry.name, src: join(SKILLS_SRC, entry.name), skillMd });
  }
  if (skills.length === 0) {
    console.error('❌ skills/ 下没有任何包含 SKILL.md 的 skill');
    process.exit(1);
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

function skillVersion(skillMd) {
  try {
    const content = readFileSync(skillMd, 'utf8');
    const fm = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fm) return 'unknown';
    const m = fm[1].match(/^\s*version:\s*(.+)$/m);
    return m ? m[1].trim() : 'unknown';
  } catch { return 'unknown'; }
}

// 每个目标：项目级 skills 基目录（相对 cwd）+ 全局 skills 基目录（用户级加载路径）
const TARGETS = [
  {
    key: 'codex',
    name: 'Codex',
    aliases: ['codex'],
    projectBase: join('.codex', 'skills'),
    globalBase: join(CODEX_HOME, 'skills'),
    detectProject: () => existsSync(join(PROJECT_DIR, '.codex')),
    detectGlobal: () => existsSync(CODEX_HOME) || cliInPath('codex'),
  },
  {
    key: 'claude',
    name: 'Claude Code',
    aliases: ['claude', 'claude-code', 'claudecode'],
    projectBase: join('.claude', 'skills'),
    globalBase: join(HOME, '.claude', 'skills'),
    detectProject: () => existsSync(join(PROJECT_DIR, '.claude')),
    detectGlobal: () => existsSync(join(HOME, '.claude')) || cliInPath('claude'),
  },
];

function usage() {
  console.log(`
  tech-workflow v${PKG.version} — 技术塔 skills 安装器

  用法：
    npx tech-workflow                    项目级：自动检测 Codex / Claude Code 并装到当前项目
    npx tech-workflow --global           全局：装到用户级目录，所有项目共享
    npx tech-workflow --tool claude      指定目标安装（检测不到时使用）
    npx tech-workflow --global -t codex  全局 + 指定目标
    npx tech-workflow --uninstall        卸载项目级（加 --global 卸载全局）
    npx tech-workflow --force            允许在用户主目录(~)做项目级安装（默认拒绝）
    npx tech-workflow --help             显示帮助
    npx tech-workflow --version          显示版本

  包含的 skills（安装时全部复制到目标 skills 目录）：
${scanSkills().map(s => `    - ${s.name}`).join('\n')}

  目标 skills 基目录：
    codex   → 项目 .codex/skills/  | 全局 ${join(CODEX_HOME, 'skills')}/
    claude  → 项目 .claude/skills/ | 全局 ${join(HOME, '.claude', 'skills')}/

  说明：
    安装为镜像覆盖：先移除目标旧目录再整体复制，无旧版本残留。
    项目级优先、全局兜底，二者可共存。
    可迁移沙箱 CLI：tech-workflow-sandbox --help（或直接运行 skill 内 scripts/sandbox/cli.cjs）。
    工程交付：对 Agent 说「用技术塔工作流处理：<需求>」。
    只做 UI：对 Agent 说「用技术塔视觉伴侣完成 UI 设计：<需求>」。

  项目：https://github.com/zerotower69/tech-workflow
`);
}

function installOne(target, isGlobal, skills) {
  const base = isGlobal ? target.globalBase : resolve(PROJECT_DIR, target.projectBase);
  for (const skill of skills) {
    const dest = join(base, skill.name);
    rmSync(dest, { recursive: true, force: true });
    copyDirSync(skill.src, dest);
    console.log(`  ✅ ${target.name} · ${skill.name} → ${dest} (v${skillVersion(skill.skillMd)})`);
  }
}

function uninstallOne(target, isGlobal, skills) {
  const base = isGlobal ? target.globalBase : resolve(PROJECT_DIR, target.projectBase);
  for (const skill of skills) {
    const dest = join(base, skill.name);
    if (!existsSync(dest)) {
      console.log(`  ⏭️  ${target.name} · ${skill.name}：未安装，跳过`);
      continue;
    }
    rmSync(dest, { recursive: true, force: true });
    console.log(`  🗑️  ${target.name} · ${skill.name}：已卸载（${dest}）`);
  }
}

// ---------- 参数解析 ----------

const args = process.argv.slice(2);
const flags = { help: false, version: false, global: false, uninstall: false, force: false, tool: null };
const KNOWN_FLAGS = new Set(['--help', '-h', '--version', '-v', '--global', '-g', '--uninstall', '-u', '--force', '-f', '--tool', '-t']);

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!KNOWN_FLAGS.has(a)) {
    console.error(`❌ 未知参数: ${a}`);
    usage();
    process.exit(1);
  }
  if (a === '--help' || a === '-h') flags.help = true;
  else if (a === '--version' || a === '-v') flags.version = true;
  else if (a === '--global' || a === '-g') flags.global = true;
  else if (a === '--uninstall' || a === '-u') flags.uninstall = true;
  else if (a === '--force' || a === '-f') flags.force = true;
  else if (a === '--tool' || a === '-t') {
    flags.tool = args[++i];
    if (!flags.tool) {
      console.error('❌ --tool 需要指定目标名（codex / claude）');
      process.exit(1);
    }
  }
}

if (flags.version) { console.log(`tech-workflow v${PKG.version}`); process.exit(0); }

const skills = scanSkills();
if (flags.help) { usage(); process.exit(0); }

// ---------- 目标解析 ----------

function resolveTargets() {
  if (flags.tool) {
    const wanted = flags.tool.toLowerCase();
    const t = TARGETS.find(t => t.key === wanted || t.aliases.includes(wanted));
    if (!t) {
      console.error(`❌ 未知目标: ${flags.tool}（可用: codex, claude）`);
      process.exit(1);
    }
    return [t];
  }
  return TARGETS.filter(t => (flags.global ? t.detectGlobal() : t.detectProject()));
}

const targets = resolveTargets();
if (targets.length === 0) {
  console.error(`❌ 未检测到${flags.global ? '全局' : '项目级'} Codex / Claude Code 使用痕迹。`);
  console.error(`   请用 --tool 显式指定，例如: npx tech-workflow ${flags.global ? '--global ' : ''}--tool codex`);
  process.exit(1);
}

// ---------- 卸载 ----------

if (flags.uninstall) {
  console.log(`\n  技术塔 skills — 卸载（${flags.global ? '全局' : '项目级'}，${skills.length} 个 skill）\n`);
  for (const t of targets) uninstallOne(t, flags.global, skills);
  console.log('');
  process.exit(0);
}

// ---------- 安装 ----------

// 护栏：项目级安装拒绝在用户主目录下执行（会把 skills 写进 ~ 污染全局），除非 --force
let realCwd = PROJECT_DIR;
try { realCwd = realpathSync(PROJECT_DIR); } catch { /* keep */ }
let realHome = HOME;
try { realHome = realpathSync(HOME); } catch { /* keep */ }
if (!flags.global && realCwd === realHome && !flags.force) {
  console.error('❌ 项目级安装不允许在用户主目录（~）下执行。');
  console.error('   想让所有项目可用，请用全局安装: npx tech-workflow --global');
  console.error('   如确实要装在当前目录，请加 --force。');
  process.exit(1);
}

console.log(`\n  技术塔 skills v${PKG.version} — 安装（${flags.global ? '全局' : '项目级'}，${targets.map(t => t.name).join(' + ')}，${skills.length} 个 skill）\n`);
for (const t of targets) installOne(t, flags.global, skills);

console.log(`
  安装完成。触发方式：
    - 「用技术塔工作流处理：<需求>」
    - 「用技术塔视觉伴侣完成 UI 设计：<需求>」
    - 「小塔/阿塔，分析一下xxx，给我出个技术方案」
${flags.global ? '' : '  提示：项目级仅当前项目可用；多项目共享请用 --global。\n'}`);
