---
name: tech-tower-workflow
description: 技术塔六步工程流水线（intake→brainstorm→plan→build→review→pr）。当用户说「用技术塔工作流处理」「走技术塔流程」，或需要把一句话需求做成从分析到交付的完整工程闭环时使用。内置浏览器视觉伴侣（brainstorm 视觉决策）、git 建仓引导（build 前置）、测试用例与 test_generator MCP 集成（plan/build）、运行时回归纪律（review）。人格经 SOUL.md 注入（小塔/阿塔）；用户呼唤「小塔、阿塔，分析一下xxx，给我出个技术方案」同样触发。
metadata:
  short-description: 技术塔六步流水线：视觉伴侣+建仓引导+测试集成
  version: 1.8.0
---

# 技术塔工作流 v1.8.0

六步流水线：intake → brainstorm → plan → build → review → pr。
拓扑定义：`workflow/tech-tower-workflow.yaml`；端到端示例：`demo.md`。

## 核心纪律（全程生效）

- 一次只问一个问题，每问给默认值；用户可回字母/单词，也可「全部默认」。
- HARD-GATE：spec 未批准不写 plan；plan 未批准不动代码。
- 步骤完成 = 产物落盘 + 用户批准。
- 验证分层：静态校验 ≠ 运行时证明；未真实执行的验证单独声明。
- 产物约定：工作流产物在 `.scratch/<slug>/`；代码仓库在 `.repository/` 容器目录（可容纳多个 git 仓库，自身不是仓库）。
- 全程中文交流（强制）：解释、汇报、提问一律中文，未经用户明确指定不切换其他语言。

## 更新检查（每天首次启动）

- skill 触发时先跑 `scripts/check-update.cjs`（当天已查自动跳过；失败静默放行，不阻塞原请求）。
- `updateAvailable=true` 时一句话告知本地版本/远端最新 tag，问是否更新：同意则按 `installer/SKILL.md` 完成更新后继续原请求；拒绝则直接继续原请求。

## 各步骤要点与手册

| 步骤 | 要点 | 手册 |
|---|---|---|
| intake | 结合领域文档拷问工单，弄清问题/影响范围/上下文 | — |
| brainstorm | 视觉问题征求同意后启用视觉伴侣；收敛为 spec 并获批；原型快照需同意（告知消耗与路径） | `docs/brainstorm-visual-companion.md` |
| plan | 拆 Tickets **同时**产出 test-cases.md（unit/integration/manual） | `docs/plan-test-cases.md` |
| build | 先 git 环境检查与引导建仓，首次提交后才动代码；逐 ticket 实施 | `docs/build-git-bootstrap.md` |
| review | 独立审查 + 核对 manual 用例真实执行；运行时专属问题清单逐条回归 | `docs/plan-test-cases.md` 附录 |
| pr | 交付代码、验证结果与交付信息 | — |

## 视觉伴侣速览

```bash
visual-companion/scripts/start-server.sh --project-dir <项目根> --open
visual-companion/scripts/stop-server.sh <会话目录>
visual-companion/smoke-test.sh   # 一键冒烟，无需人工交互
```

浏览器 vs 终端逐问题判断：用户「看到」比「读到」更容易理解就走浏览器。

## 测试集成速览

- plan→build 门槛：spec + Tickets + test-cases.md 齐备。
- 纯逻辑模块用 test_generator MCP 出骨架（先 `generate_tests` 预览再 `write_test_file`）；骨架是脚手架级（断言空洞/导入路径错/模块体系不匹配），必须修正后真实运行。

## 版本历史

- **v1.8.0**（2026-08-11）：npm 工程化 —— 新增 `npx tech-tower-workflow` 一键安装器（`bin/tech-tower-workflow.js`：项目/全局范围、--tool/--uninstall、镜像覆盖、`~` 下安装护栏）；新增 `.version-bump.json` + `scripts/sync-version.js` 版本位点自动同步（npm version 钩子）；install.sh/install.ps1 收紧排除清单（排除 `plugin-src/`、`archive/`、`bin/`、`package.json` 等工程产物）；README 安装文档重构为三方式并列。
- **v1.7.0**（2026-08-11）：新增 `scripts/check-update.cjs` 每日首次启动更新检查（GitHub tag 对比，提示用户选择是否更新，不阻塞）。
- **v1.6.0**（2026-08-11）：新增原型快照：`snapshot-prototype.cjs` 只截 `data-tt-screen` 区域，brainstorm 收尾前征得同意（披露 token 估算与存放路径）后执行。
- **v1.5.2**（2026-08-11）：installer 纪律增强：不打印完整命令、禁 rm -rf 旧目录，Codex 全局直接执行随包安装脚本；全程中文交流（强制）。
- **v1.5.1**（2026-08-11）：installer Agent 检测改为项目目录/全局目录/CLI 三层，任一命中默认选中；未检测到时不视为错误。
- **v1.5.0**（2026-08-11）：installer 重写为分发模式（环境自检测→Codex/Claude Code 多选/项目全局确认→GitHub 压缩包解压安装→清理），不上报统计；安装包自包含可整目录拷贝，Codex 安装目录排除 claude-plugin 以避免重复 skill 扫描。
- **v1.4.0**（2026-08-11）：新增 `installer/SKILL.md` AI 自动安装 skill（GitHub 克隆→按平台安装→验证→清理），README 提供一句话触发入口。
- **v1.3.0**（2026-08-11）：新增 Windows 安装入口 `install.ps1`（robocopy /MIR 等价 rsync --delete）；运行时脚本保持 Git Bash/MSYS 自动适配。
- **v1.2.0**（2026-08-11）：产品改名技术塔，清除全部旧命名表述；SOUL.md 人格注入，小塔/阿塔触发。
- **v1.1.0**（2026-08-11）：封装 Claude Code 插件（`claude-plugin/`），新增 PreToolUse hook 禁止自动 git push（仅用户显式要求时放行）。
- **v1.0.0**（2026-08-11）：首次 skill 封装。含视觉伴侣集成、git 建仓引导、`.repository` 容器约定、测试用例+MCP 集成、运行时回归纪律。
