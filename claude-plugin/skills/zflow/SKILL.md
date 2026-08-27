---
name: zflow
description: 技术塔六步工程执行流水线（intake→brainstorm→plan→build→review→pr）。当用户明确要走技术塔流程，或需要把需求落实为代码、测试、审查与交付的完整工程闭环时使用。内置 brainstorm 视觉决策、git 建仓引导、测试用例集成和运行时回归。只想完成 UI/UX 设计、页面原型或视觉比稿而不实现代码时，不使用本 skill，改用 zflow-vision。
metadata:
  short-description: 技术塔六步流水线：视觉伴侣+建仓引导+测试集成
  version: 1.16.0
---

# 技术塔工作流 v1.16.0

六步流水线：intake → brainstorm → plan → build → review → pr。
拓扑定义：`references/zflow.yaml`；端到端示例：`references/demo.md`。

## 与独立 UI 设计的边界

- 本 skill 面向工程执行与交付。用户只说「设计 UI」「出页面方案」「用视觉伴侣比稿」，且没有要求实现代码时，改用 `zflow-vision`，不要启动六步流水线。
- 用户同时要求设计与实现，或明确说「走技术塔工作流」，才在本流程的 brainstorm 阶段使用内置视觉伴侣，并继续 plan/build/review/pr。
- 已在独立视觉伴侣中批准的 `design-spec.md` 与原型可以作为本流程 intake/brainstorm 的输入，但仍需遵守本流程的阶段门槛。

## 核心纪律（全程生效）

- 一次只问一个问题，每问给默认值；用户可回字母/单词，也可「全部默认」。
- HARD-GATE：spec 未批准不写 plan；plan 未批准不动代码。
- 步骤完成 = 产物落盘 + 用户批准。
- intake 启动即把首次给到的信息写入 `.scratch/<slug>/ticket_context.md`；用户确认后作为只读基线，后续阶段先读取它，不用新结论覆盖初始上下文。
- 新 Ticket 优先用 `scripts/sandbox/cli.cjs create` 建立机器可读沙箱；恢复任务先执行 `status` + `validate` 并读取 `handoff.md`，不得重新生成覆盖。
- 阶段迁移、产物批准、回退、Commit/Review 证据、Skill Lock 与 pack/restore 必须通过确定性沙箱命令完成；不得只改 Markdown 宣称状态已变化。完整手册：`references/portable-sandbox.md`。
- context 与澄清收口后先走 knowledge 检查点，再形成 Spec。知识库只提供带来源的参考；无知识源可记录原因后显式跳过，冲突必须由用户决定并写入 `decisions.md`。
- 已批准产物发生变化必须创建新 revision；回退保留旧文档和 Commit，并把依赖旧 revision 的下游产物标记为 `stale`。
- build 在第一处施工改动前创建 `.scratch/<slug>/repo.json`，记录每个仓库的路径、分支和 base commit；施工期间随仓库/分支/每个 Ticket 提交持续补齐 head 与 checkpoints，收尾记录 final commit，review 修复提交后同步刷新。
- 验证分层：静态校验 ≠ 运行时证明；未真实执行的验证单独声明。
- 产物约定：工作流产物在 `.scratch/<slug>/`；代码仓库在 `.repository/` 容器目录（可容纳多个 git 仓库，自身不是仓库）。
- 全程中文交流（强制）：解释、汇报、提问一律中文，未经用户明确指定不切换其他语言。

## 更新检查（每天首次启动）

- skill 触发时先跑 `scripts/check-update.cjs`（当天已查自动跳过；失败静默放行，不阻塞原请求）。
- `updateAvailable=true` 时一句话告知本地版本/远端最新 tag，问是否更新：同意后直接执行 `npx @kaitow/zflow --global` 更新已安装 skills，再继续原请求；拒绝则直接继续原请求。项目级安装则在项目根执行 `npx @kaitow/zflow`。

## 各步骤要点与手册

| 步骤 | 要点 | 手册 |
|---|---|---|
| intake | 创建/恢复确定性沙箱，固化 ticket_context，再结合领域文档拷问工单 | `references/intake-ticket-context.md`、`references/portable-sandbox.md` |
| brainstorm | 澄清→知识参考→spec；视觉问题可启用视觉伴侣；spec revision 获批后迁移 | `references/brainstorm-visual-companion.md`、`references/portable-sandbox.md` |
| plan | 拆 Tickets **同时**产出 test-cases.md（unit/integration/manual） | `references/plan-test-cases.md` |
| build | git 底座确认后创建 repo.json；逐 Ticket 持续补齐仓库/分支/checkpoints，收尾锁定 final commit | `references/build-git-bootstrap.md`、`references/build-repo-manifest.md` |
| review | 独立审查 + 核对 manual 用例真实执行；运行时专属问题清单逐条回归 | `references/plan-test-cases.md` 附录 |
| pr | 严格校验；交付代码、验证、handoff 与可选 `.tws` 迁移包 | `references/portable-sandbox.md` |

## 视觉伴侣速览

```bash
visual-companion/scripts/start-server.sh --project-dir <项目根> --open
visual-companion/scripts/stop-server.sh <会话目录>
visual-companion/smoke-test.sh   # 一键冒烟，无需人工交互
```

浏览器 vs 终端逐问题判断：用户「看到」比「读到」更容易理解就走浏览器。

## 测试集成速览

- plan→build 门槛：ticket_context.md + spec + Tickets + test-cases.md 齐备。
- 纯逻辑模块用 test_generator MCP 出骨架（先 `generate_tests` 预览再 `write_test_file`）；骨架是脚手架级（断言空洞/导入路径错/模块体系不匹配），必须修正后真实运行。

## 版本历史

- **v1.15.0**（2026-08-26）：中文名称保持不变，英文 skill 标识迁移为 `zflow` / `zflow-vision`；首次安装统一使用 `npx @kaitow/zflow`，移除安装提示词 skill，并增加旧名称目录迁移清理与隔离首装校验。
- **v1.14.0**（2026-08-23）：新增零依赖可迁移工作流沙箱内核与 `zflow-sandbox` CLI——机器可读阶段/门禁、产物 revision 与 hash、知识参考检查点、追加式事件、结构化回退和 stale 传播、Git/Commit/Review 证据、Skill Lock、handoff，以及带 bundle/patch/untracked 保护的 `.tws` pack/restore；保留六步用户流程和既有安装器兼容。
- **v1.13.0**（2026-08-23）：build 新增持续补齐的 `.scratch/<slug>/repo.json` 仓库交接清单；施工前按仓库记录路径、分支、脱离 HEAD、脱敏 remotes 与 `base_commit`，每次 Ticket 提交刷新 `head_commit` 并追加 checkpoint，build 收尾填写 `final_commit`，review 修复提交后刷新，pr 以 `base_commit..final_commit` 锁定最终交付范围。
- **v1.12.0**（2026-08-23）：intake 新增权威启动快照 `.scratch/<slug>/ticket_context.md`，在首次追问前记录用户原始请求、给定材料、环境与初始项目状态；用户确认后保持只读，作为 brainstorm/plan/build/review 的共同上下文基线，防止长流程或上下文压缩造成初始信息丢失。
- **v1.11.0**（2026-08-22）：新增独立 `tech-visual-companion` skill——用户只想做 UI/UX 设计时，可直接进入浏览器比稿、点选、逐屏迭代与 `design-spec.md` 交付，不再被迫进入 plan/build/review/pr；工程 skill 增加明确路由边界，安装器与 Claude 插件同步打包两个 skills。
- **v1.10.0**（2026-08-11）：视觉伴侣会话自包含 —— 每次启动把 `frame-template.html` 与 `helper.js` 复制进会话目录（项目会话即 `<工程>/.tech-tower/brainstorm/<session-id>/` 持有一份），server 优先读会话内副本、缺失回退 skill 捆绑版；收尾纪律新增：`spec.md` 必须记录会话目录并链接原型页面副本；GUIDE/brainstorm 手册的模板引用改为可点击链接。
- **v1.9.0**（2026-08-11）：结构升级为多 skill 包，skill 移入 `skills/<skill-name>/`，安装脚本改为遍历 `skills/` 逐个镜像安装。
- **v1.8.0**（2026-08-11）：npm 工程化 —— 新增一键安装 CLI（项目/全局范围、--tool/--uninstall、镜像覆盖、`~` 下安装护栏）；新增 `.version-bump.json` + `scripts/sync-version.js` 版本位点自动同步。
- **v1.7.0**（2026-08-11）：新增 `scripts/check-update.cjs` 每日首次启动更新检查（GitHub tag 对比，提示用户选择是否更新，不阻塞）。
- **v1.6.0**（2026-08-11）：新增原型快照：`snapshot-prototype.cjs` 只截 `data-tt-screen` 区域，brainstorm 收尾前征得同意（披露 token 估算与存放路径）后执行。
- **v1.5.2**（2026-08-11）：installer 纪律增强：不打印完整命令、禁 rm -rf 旧目录，Codex 全局直接执行随包安装脚本；全程中文交流（强制）。
- **v1.5.1**（2026-08-11）：installer Agent 检测改为项目目录/全局目录/CLI 三层，任一命中默认选中；未检测到时不视为错误。
- **v1.5.0**（2026-08-11）：installer 重写为分发模式（环境自检测→Codex/Claude Code 多选/项目全局确认→GitHub 压缩包解压安装→清理），不上报统计；安装包自包含可整目录拷贝，Codex 安装目录排除 claude-plugin 以避免重复 skill 扫描。
- **v1.4.0**（2026-08-11）：曾引入旧式智能安装入口；该入口已在 v1.15.0 删除并由 npm 脚本取代。
- **v1.3.0**（2026-08-11）：新增 Windows 安装入口 `install.ps1`（robocopy /MIR 等价 rsync --delete）；运行时脚本保持 Git Bash/MSYS 自动适配。
- **v1.2.0**（2026-08-11）：产品改名技术塔，清除全部旧命名表述；SOUL.md 人格注入，小塔/阿塔触发。
- **v1.1.0**（2026-08-11）：封装 Claude Code 插件（`claude-plugin/`），新增 PreToolUse hook 禁止自动 git push（仅用户显式要求时放行）。
- **v1.0.0**（2026-08-11）：首次 skill 封装。含视觉伴侣集成、git 建仓引导、`.repository` 容器约定、测试用例+MCP 集成、运行时回归纪律。
