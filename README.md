# tech-tower-workflow

「技术塔」：工单分析到代码交付的六步工程流水线，头脑风暴（brainstorm）步骤内置**技术塔视觉伴侣**——设计讨论中可以用浏览器向用户展示原型、图表与并排对比。

视觉伴侣自包含于 `visual-companion/`，**不依赖 superpowers 插件/技能**：代码改自 superpowers 6.2.0 的 brainstorming visual companion（MIT），已改名、移除原品牌/远程 logo/遥测相关逻辑，持久化路径改为 `.tech-tower/brainstorm/`。

## 流水线

```text
intake → brainstorm → plan → build → review → pr
工单分析   头脑风暴      技术方案      执行            代码审查   代码交付
          （视觉伴侣）  （+测试用例） （git 建仓引导+测试骨架）
```

- 每步强制绑定且只执行一个工程 Skill：`grill-with-docs` / `to-spec` / `to-tickets` / `implement` / `code-review`，pr 无绑定。
- spec 与 Tickets 统一保存在 `.scratch/<feature-slug>/`；全流程在同一个 Ticket Session 内推进。
- 本次扩展只增强 brainstorm 步骤，拓扑、绑定与产物约定不变。

## 流水线（mermaid）

```mermaid
flowchart LR
  A["intake 工单分析"] -->|"问题/影响/上下文清楚"| B["brainstorm 头脑风暴<br/>内置视觉伴侣·浏览器比稿/点选"]
  B -->|"spec 获批·视觉伴侣清理"| C["plan 技术方案<br/>同步 test-cases.md·test_generator MCP"]
  C -->|"spec+Tickets+用例齐备"| D["build 执行<br/>git 建仓引导·.repository 容器"]
  D -->|"tickets 完成·验证通过"| E["review 代码审查<br/>运行时回归清单"]
  E -->|"必须修复项清零"| F["pr 代码交付"]
```

> 单线串行流水线：节点内小字 = 该步骤内置的工具/产物，箭头上 = 该步骤的出口门槛。

## 目录结构

| 文件 | 说明 |
|---|---|
| `workflow/tech-tower-workflow.yaml` | Workflow 定义（adaptive-workflow-topology YAML 契约：`transitions` + nodes + rules） |
| `docs/brainstorm-visual-companion.md` | brainstorm 步骤增强指令：触发判断、征求同意、启动/事件读取/清理运行手册、HARD-GATE、集成要求 |
| `docs/build-git-bootstrap.md` | build 前置步骤：git 环境检查与引导建仓（命名 / local config / 默认分支 / .gitignore / 远程） |
| `docs/plan-test-cases.md` | plan 同步产物：测试用例规格（test-cases.md）格式、类型划分与 test_generator MCP 集成（工具清单 / 已知局限 / 修正纪律） |
| `demo.md` | 端到端示例：一句话需求 → 可运行小程序的全过程复盘（含视觉伴侣交互实录与 review 修复记录） |
| `visual-companion/GUIDE.md` | 视觉伴侣使用指南：何时用浏览器/终端、内容片段规范、CSS 类、事件格式 |
| `visual-companion/scripts/` | 视觉伴侣本地服务器（server.cjs）、启停脚本、页面框架模板与客户端辅助脚本 |

## 视觉伴侣速览

1. 主题涉及视觉问题时，用一条**独立消息**征求同意（声明额外 token 成本），拒绝则纯文本继续。
2. 同意后启动（Claude Code / Codex 通用，脚本自动处理后台化）：
   ```bash
   visual-companion/scripts/start-server.sh --project-dir <项目根> --open
   ```
3. 用户在返回的本地 URL 中查看原型并点选，点击事件落在会话目录的 `.events`；连接信息在 `state/server-info`。
4. 逐问题决策浏览器还是终端，标准：**用户看到它是否比读到它更容易理解**。
5. 退出 brainstorm 前执行 `visual-companion/scripts/stop-server.sh "$SCREEN_DIR"`，原型保留在 `.tech-tower/brainstorm/`。

详见 `docs/brainstorm-visual-companion.md` 与 `visual-companion/GUIDE.md`。

## 作为 Codex Skill 使用

本仓库根目录即 skill 包（`SKILL.md` + `agents/openai.yaml`），当前版本 **v1.5.0**：

### AI 自动安装（推荐）

把这句话原样发给你的 AI（Codex / Claude Code 等）：

> 请读取 https://raw.githubusercontent.com/zerotower69/tech-tower-workflow/main/installer/SKILL.md 并按它自动完成技术塔工作流的安装。

AI 会自动检测环境与项目中已用的 Agent（Codex / Claude Code 两大 Agent），确认范围后从 GitHub 下载压缩包安装到对应 skills 目录，验证并清理；完整规程见 `installer/SKILL.md`。

### 手动安装

```bash
./install.sh   # macOS / Linux / Git Bash：安装到 $CODEX_HOME/skills/tech-tower-workflow
```

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1   # Windows：等价安装
```

Windows 说明：安装用 `install.ps1`；视觉伴侣等运行时脚本在 Git Bash/MSYS 下已自动适配，纯 PowerShell 环境可直接 `node visual-companion/scripts/server.cjs` 前台启动。

Claude 安装目录自包含全部材料与脚本，可整目录拷贝移植；Codex 安装目录仅排除 `claude-plugin/`、`.claude-plugin/`（避免嵌套 SKILL.md 被扫成重复 skill），其余齐全。

安装后对 Agent 说「用技术塔工作流处理：<需求>」即可触发；版本与变更见 `SKILL.md` 版本历史，git tag 同步打 `v1.0.0`。

### Claude Code 插件（v1.1.0+）

`claude-plugin/` 为 Claude Code 插件包（由 `scripts/pack-claude-plugin.sh` 从源文件组装，勿手改）：

```bash
claude plugin install ./claude-plugin   # 或加入 marketplace 后安装
```

内置 **PreToolUse hook 禁止自动 git push**：Agent 只有在用户当轮消息显式包含 push/推送 时才能执行 `git push`，否则被阻断并提示确认。

## 本地测试

一键冒烟测试（启动 → 鉴权 → 品牌渲染 → 内容页 → 模拟点击事件落盘 → 停止，无需人工交互；依赖 Node 22+ / curl / python3）：

```bash
visual-companion/smoke-test.sh
```

手工测试（真实浏览器）：

1. 启动服务器并自动打开浏览器：
   ```bash
   visual-companion/scripts/start-server.sh --project-dir <项目根> --open
   ```
2. 往会话目录的 `content/` 写任意 HTML 片段（无需 `<html>` 包裹，如 `layout.html`），页面会自动展示最新文件；选项用 `<div class="option" data-choice="a" onclick="toggleSelect(this)">` 结构。
3. 在页面上点击选项，然后查看 `<会话目录>/state/events` 里的点击事件（JSONL，每行一个）。
4. 停止：`visual-companion/scripts/stop-server.sh <会话目录>`。

注意：`/tmp`（含系统临时目录）下的会话为一次性会话，停止时清理；使用真实项目目录则原型持久化在 `.tech-tower/brainstorm/`。

## 许可与来源

MIT（见 `LICENSE`）。`visual-companion/` 改自 [superpowers](https://github.com/obra/superpowers)（Copyright (c) 2025 Jesse Vincent，MIT）的 brainstorming visual companion；保留原版权声明，改动：重命名为「技术塔视觉伴侣」、存储路径 `.superpowers/brainstorm/` → `.tech-tower/brainstorm/`、移除远程品牌图与遥测相关代码。

## 注意

- `archive/` 存放历史来源文档（含原内部引用），非产品面、不打包进 skill/插件；仓库保持私有。
- workflow YAML 遵循已定稿的 topology 契约：每个非 terminal 节点恰好一条前向 Rule，`when` 为自然语言、由 AI 判断。
