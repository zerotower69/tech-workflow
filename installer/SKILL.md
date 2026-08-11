---
name: tech-tower-installer
description: 从 GitHub 自动化安装 tech-tower-workflow（技术塔工作流）到 Codex skill，并可选安装 Claude Code 插件。当用户说「安装技术塔工作流」「装一下 tech-tower」「install tech-tower-workflow」时触发。
metadata:
  short-description: 从 GitHub 一键自动安装技术塔工作流
  version: 1.4.0
---

# 技术塔工作流 · AI 自动安装

全程自动完成安装；用户最多回答一个决策问题（是否同时装 Claude 插件）。

仓库：`https://github.com/zerotower69/tech-tower-workflow.git`

## 1. 环境探测

- 必备：`git`；`node`（视觉伴侣运行时需要）。缺失则报告用户并停止。
- 判定平台：Windows（PowerShell）或 macOS/Linux（bash）。

## 2. 获取源码（临时目录）

```bash
git clone --depth 1 https://github.com/zerotower69/tech-tower-workflow.git "<tmp>/tech-tower-workflow"
```

- 网络失败重试一次；若仓库需认证且存在 `gh`，改用 `gh repo clone`；仍失败则如实报告并停止。
- 默认装 main；用户指定版本时 fetch 对应 tag 并 checkout。

## 3. 安装 Codex skill

- macOS / Linux / Git Bash：在克隆目录执行 `./install.sh`
- Windows PowerShell：`powershell -ExecutionPolicy Bypass -File install.ps1`
- 两者都尊重 `CODEX_HOME`（默认 `~/.codex`），安装到 `$CODEX_HOME/skills/tech-tower-workflow`。

## 4. 可选：Claude Code 插件

- 检测到 `claude` CLI 时，只问用户一句：是否同时安装 Claude 插件。
- 同意则执行 `claude plugin install ./claude-plugin`（或加入 marketplace 后安装）。
- 插件内置 PreToolUse hook：禁止自动 `git push`，仅用户显式要求时放行。

## 5. 验证与汇报

- 确认 `$CODEX_HOME/skills/tech-tower-workflow/SKILL.md` 存在，读取 frontmatter `version` 并汇报。
- 告知触发方式：「用技术塔工作流处理：<需求>」或「小塔/阿塔，分析一下xxx，给我出个技术方案」。

## 6. 清理

- 删除临时克隆目录。

## 纪律

- 安装过程不执行 `git push`。
- 只写 `$CODEX_HOME/skills` 安装目录与临时目录，不改用户既有文件。
