---
name: tech-tower-installer
description: 从 GitHub 自动化安装 tech-tower-workflow（技术塔工作流）技能包，支持 Codex 与 Claude Code 两大 Agent，项目/全局两种范围。当用户说「安装技术塔工作流」「装一下 tech-tower」「install tech-tower-workflow」时触发。
metadata:
  short-description: 从 GitHub 一键自动安装技术塔工作流（Codex / Claude Code）
  version: 1.5.0
---

# 技术塔工作流 · AI 自动安装

skill-name：`tech-tower-workflow`

下载地址（GitHub 压缩包，无需 git）：
- 默认 main：`https://github.com/zerotower69/tech-tower-workflow/archive/refs/heads/main.tar.gz`（或 `.zip`）
- 指定版本：`https://github.com/zerotower69/tech-tower-workflow/archive/refs/tags/<tag>.tar.gz`

## 1. 环境检测（自行检测，无需询问用户）

- 操作系统（Windows/macOS/Linux）
- 可用下载工具（curl/wget/Invoke-WebRequest）
- 可用解压工具（tar/unzip/Expand-Archive）；macOS/Linux 优先 tar.gz+tar，Windows 优先 zip+Expand-Archive
- 检测项目中已使用的 Agent：检查当前项目目录下是否存在 `.codex/`、`.claude/`，存在则默认选中

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
3. 以 skill-name 为子目录名放入目标位置：`<目标目录>/tech-tower-workflow/`；同名旧版本先覆盖。
4. 目标目录不存在先创建；安装包自包含，整体复制即完成安装（含全部材料与脚本）。
   - Codex 目标额外排除 `claude-plugin/`、`.claude-plugin/`（避免 Codex 把嵌套 SKILL.md 扫成重复 skill）；Claude 目标整目录保留。
5. 全部完成后清理临时文件。

可选增强：若选中 Claude Code 且用户需要「禁止自动 git push」hook，再执行 `claude plugin install <解压目录>/claude-plugin`（仅问一句是否安装）。

## 4. 验证与汇报

- 检查每个安装目录存在 `SKILL.md`，读取 frontmatter `version` 汇报。
- 告知触发方式：「用技术塔工作流处理：<需求>」或「小塔/阿塔，分析一下xxx，给我出个技术方案」。

## 纪律

- 全程不执行 `git push`。
- 只写安装目录与临时目录，不改用户既有文件。
