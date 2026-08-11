---
name: tech-tower-installer
description: 从 GitHub 自动化安装 tech-tower-workflow（技术塔工作流）技能包，支持 Codex 与 Claude Code 两大 Agent，项目/全局两种范围。当用户说「安装技术塔工作流」「装一下 tech-tower」「install tech-tower-workflow」时触发。
metadata:
  short-description: 从 GitHub 一键自动安装技术塔工作流（Codex / Claude Code）
  version: 1.8.0
---

# 技术塔工作流 · AI 自动安装

skill-name：`tech-tower-workflow`

下载地址（GitHub 压缩包，无需 git）：
- 默认 main：`https://github.com/zerotower69/tech-tower-workflow/archive/refs/heads/main.tar.gz`（或 `.zip`）
- 指定版本：`https://github.com/zerotower69/tech-tower-workflow/archive/refs/tags/<tag>.tar.gz`

## 0. 快速通道（环境有 Node ≥ 18 时优先）

检测到 `node -v` ≥ 18 时，优先直接执行官方安装器（免下载、自带检测/镜像安装/版本验证）：

- 项目级：`npx tech-tower-workflow`（自动检测 Codex / Claude Code）
- 全局：`npx tech-tower-workflow --global`
- 显式指定：`npx tech-tower-workflow --tool codex|claude`
- 未发布到 npm registry 时改用：`npx github:zerotower69/tech-tower-workflow`（参数相同）

成功即跳到第 4 节验证汇报；Node 不可用或安装器失败时，继续下面的下载流程。

## 1. 环境检测（自行检测，无需询问用户）

- 操作系统（Windows/macOS/Linux）
- 可用下载工具（curl/wget/Invoke-WebRequest）
- 可用解压工具（tar/unzip/Expand-Archive）；macOS/Linux 优先 tar.gz+tar，Windows 优先 zip+Expand-Archive
- 检测已使用的 Agent（三层任一命中即视为在用，默认选中）：
  - 项目层：当前项目目录下 `.codex/`、`.claude/`
  - 全局层：`$CODEX_HOME`/`~/.codex`、`~/.claude` 目录
  - CLI 层：`command -v codex`、`command -v claude`
- 均未检测到时不视为错误：Q1 列出两个选项由用户手动选择

## 2. 确认安装位置（需询问用户）

**Q1: 你要安装到哪些 Agent？（可多选，已检测到的 Agent 默认选中）**
- Codex → 项目: `<project>/.codex/skills/tech-tower-workflow/` | 全局: `$CODEX_HOME/skills/tech-tower-workflow/`（默认 `~/.codex`）
- Claude Code → 项目: `<project>/.claude/skills/tech-tower-workflow/` | 全局: `~/.claude/skills/tech-tower-workflow/`

**Q2: 安装到项目目录还是全局目录？**
- 项目目录：仅当前项目可用
- 全局目录：所有项目可用

## 3. 执行安装

为每个选中的 Agent 执行：
1. 下载压缩包到临时目录（网络失败重试一次）。
2. 解压；GitHub 包顶层目录为 `tech-tower-workflow-main` 或 `tech-tower-workflow-<tag>`。
3. Codex 全局：直接在解压目录执行随包 `./install.sh`（Windows 用 `install.ps1`）——脚本自带覆盖与排除逻辑，不要自拼删除命令。
4. 其他目标（Claude 全局/项目目录）：用覆盖同步（`rsync -a --delete` / `robocopy /MIR` / `cp -R`）放入 `<目标目录>/tech-tower-workflow/`；不要 `rm -rf` 旧目录；目标目录不存在先创建。
5. Codex 目标排除 `claude-plugin/`、`.claude-plugin/`（install.sh/install.ps1 已内置，手动复制同样加排除）；Claude 目标整目录保留（自包含全部材料与脚本）。
6. 全部完成后清理临时文件。

可选增强：若选中 Claude Code 且用户需要「禁止自动 git push」hook，再执行 `claude plugin install <解压目录>/claude-plugin`（仅问一句是否安装）。

## 4. 验证与汇报

- 检查每个安装目录存在 `SKILL.md`，读取 frontmatter `version` 汇报。
- 告知触发方式：「用技术塔工作流处理：<需求>」或「小塔/阿塔，分析一下xxx，给我出个技术方案」。

## 纪律

- 全程不执行 `git push`。
- 只写安装目录与临时目录，不改用户既有文件。
- 不用 `rm -rf` 删除旧安装目录，统一覆盖同步语义。
- 不向用户打印完整执行命令；只汇报「动作+结果」一句话（目标目录、版本）。仅当用户明确要求或失败需排查时才展示命令。
- 全程中文交流（强制），未经用户明确指定不切换其他语言。
