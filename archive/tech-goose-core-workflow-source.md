# 技术鹅核心工作流

> 整理时间：2026-08-08 · 依据：ses-harness 知识图谱 + 仓库文档/代码交叉验证
> 关键来源：`ses-harness/docs/changelog/entries/ticket-sandbox-engineering-skill-workflow.md`（2026-07-22）、`ses-harness/.scratch/grill-workflow-routing/findings.md`（含 2026-07-24 全量 Workflow inventory）、`ses-harness/.scratch/adaptive-workflow-topology/issues/02-define-topology-yaml-contract.md`

## 一、定位

「技术鹅」是 SES harness 中三个当前在产（未归档、绑定当前发布版本）的 Agent Workflow 之一，负责把一个工单从问题分析一路推进到代码交付：

| Agent Workflow | 当前 package / workflow | 步骤形态 |
|---|---|---|
| Chat | 1.0.8 / 1.0.8 | 单步持续对话 |
| 工单鹅 | 1.0.42 / 1.0.34 | 工单分析 → 可选转技术开发单 |
| **技术鹅** | **1.0.34 / 1.0.37** | **工单分析 → 头脑风暴 → 技术方案 → 执行 → 代码审查 → 代码交付** |

历史版本共关联 68 个未删除 Session（Chat 54、工单鹅 78 作对照）。其余 14 个 draft 未绑定当前 package，属旧配置/测试，不代表用户可见行为。

## 二、核心流水线（当前发布的线性六步）

```text
intake → brainstorm → plan → build → review → pr
工单分析   头脑风暴     技术方案   执行    代码审查   代码交付
```

每一步**强制绑定且只允许执行一个工程 Skill**，禁止越阶段执行：

| 步骤 | 展示标签 | 绑定 Skill | 权威产物 / 前置约束 |
|---|---|---|---|
| intake | 工单分析 | `grill-with-docs` | 结合领域文档拷问工单，弄清问题、影响范围与关键上下文 |
| brainstorm | 头脑风暴 | `to-spec` | 必须产出 `.scratch/<slug>/spec.md` |
| plan | 技术方案 | `to-tickets` | 必须先有 spec，拆解为实现 Tickets |
| build | 执行 | `implement` | 必须 spec + Tickets 齐备；逐个 ticket 实施，ticket 之间清理上下文 |
| review | 代码审查 | `code-review` | 独立阶段，固定从 `.scratch` 读取 spec/Tickets |
| pr | 代码交付 | — | 代码、验证结果与交付信息完整提供 |

> 注意：`brainstorm` / `plan` 的展示标签与实际 Skill/产物并不一致（实际是 Spec / Tickets），findings 已建议改名对齐。

## 三、沙箱与产物约定

- Ticket sandbox 创建/恢复时**自动注入** 5 个工程 Skill（`grill-with-docs`、`to-spec`、`to-tickets`、`implement`、`code-review`），无需用户初始化或选择 tracker；已存在的 workspace 恢复时也会补齐同一套约定。
- Workspace 自动获得 **Local Ticket Graph** 与 **single-context domain docs** 约定。
- spec 与实施 Tickets 统一保存在 `.scratch/<feature-slug>/`，避免重复维护多套计划产物。
- 整个流程在**同一个 Ticket Session** 内推进：workflow snapshot/progress 持久化在 Session 的 `workflowPinning`，各步骤复用同一 provider conversation 与 transcript；引入路由不需要创建或切换 Session。

## 四、已知语义缺陷（findings 结论）

核心缺陷：**provider turn success 被 runtime 当成 Workflow Step completed**。技术鹅的一次阻塞说明、一次正常回复都可能被误判为阶段完成。代码层面证据（`ses-harness` 仓库）：

1. `src/shared/agent-workflows.ts:28-34` — step snapshot 只有 `id/label/agentId/instructions/runtimeContext`，没有 route、allowed transitions、skipped、execution outcome。
2. `src/server/mastra-workflow-runtime.ts:198-253` — executor resolve 后无条件完成当前 step，再取数组下一个 step。
3. `src/server/mastra-workflow-runtime.ts:314-322` — 只允许点击 authoritative `currentStepId`，用户无法合法跳到 build。
4. `src/server/ws-router.ts:1984-2017` — workflow executor 只 await `agent.send()`，不返回业务 outcome。
5. `src/server/agent.ts:3152-3158` — waiter 只区分 provider failed/cancelled，success 不携带 step result。
6. `src/server/agent.ts:3647-3659` — provider success 立即触发 workflow completion。
7. `src/server/ticket-entry-agent-runtime.ts:49-64` — 通用 wrapper 仍把所有步骤描述为"工单分析"。

另一个已知问题：历史 `completedStepIds` 不区分"provider 自动完成"与"用户明确接受"，无法可靠反推或批量重算。

## 五、演进方向

### 5.1 三路由方案（grill-workflow-routing）

设计原则：**Route 决定需要哪些阶段；Completion Contract 只验证实际执行的阶段**。

```text
fast:    intake → build → review → pr
spec:    intake → spec → build → review → pr
planned: intake → spec → tickets → build → review → pr
```

要点：

- intake 输出路由建议，**用户点击决定**：范围清晰可作有界实现单元 → 推荐 build；需要持久化范围但不需要依赖图 → 推荐 spec；多个 vertical slices / blocking edges / 多仓协调 / 长执行链 → 推荐 spec + tickets；huge/foggy → 继续 grilling 或 wayfinder，不进 build。
- build 前置条件改为二选一：有 spec/Tickets 则以其为权威范围；fast path 以已确认的 intake conversation + ticket context 为权威范围；两者都无法形成清晰 scope/seam 则返回 blocked，不实施。
- 结构化 step outcome 前置为 P0：executor 必须返回受控的 `completed | waiting_for_input | blocked | failed`，provider success 但无 outcome 时停留当前 step，绝不推进；声称产出 spec/Tickets 的需校验文件真实存在。
- review 允许无 spec 路径（fast path 用 ticket/conversation 作 Spec 轴来源）。
- `wayfinder` 继续作为独立 on-ramp，不塞进固定六步。

### 5.2 拓扑版 Workflow（adaptive-workflow-topology，契约已定稿）

用顶层 `transitions` 键作为整版行为开关（缺失 = 现有 linear，存在 = topology）：

```yaml
name: 技术鹅 workflow
description: 自动识别当前工作阶段

transitions:
  start: analysis
  terminal: delivery

  nodes:
    - id: analysis
      label: 工单分析
      objective: |
        理解问题、影响范围和关键上下文。
    - id: execution
      label: 执行
      objective: |
        完成实现及必要验证。
    - id: review
      label: 代码审查
      objective: |
        检查实现是否满足需求并识别必须修复的问题。
    - id: delivery
      label: 代码交付
      objective: |
        代码、验证结果和交付信息已经完整提供。

  rules:
    - from: analysis
      to: execution
      when: 问题和方案已经明确，可以开始实现
    - from: execution
      to: review
      when: 实现及必要验证已经完成
    - from: review
      to: delivery
      when: 代码审查通过，可以交付
```

关键契约：

- 每个非 terminal 节点恰好一条前向 Rule；rules 从 start 出发构成唯一覆盖全部节点的前向路径；禁止自环、重复边、前向跳步、孤儿节点。
- `when` 是自然语言，由 AI 判断，不作为服务端表达式执行；AI 每轮可提议 `stay` / `advance` / 隐式 `return`（可回到任意更早节点，产生新 Visit），服务端对照 pinned snapshot 校验。
- 已发布版本不可变；draft/preview/publish 生命周期沿用，校验错误阻断发布、警告允许但必须可见。

## 六、关键文件索引

| 文件 | 内容 |
|---|---|
| `ses-harness/docs/changelog/entries/ticket-sandbox-engineering-skill-workflow.md` | Skill 与步骤绑定、sandbox 自动注入的官方说明（2026-07-22） |
| `ses-harness/.scratch/grill-workflow-routing/findings.md` | 现状偏差、三路由改造方案、关键测试清单、Workflow inventory（2026-07-24） |
| `ses-harness/.scratch/adaptive-workflow-topology/issues/02-define-topology-yaml-contract.md` | topology YAML 契约与发布校验规则（已 resolved） |
| `ses-harness/src/shared/agent-workflows.ts` | workflow 步骤快照 / linear / topology 类型定义 |
| `ses-harness/src/shared/shared-sandbox-assets.ts` | sandbox 注入的 Skill 清单 |
| `ses-harness/src/server/mastra-workflow-runtime.ts` | workflow executor 与步骤推进逻辑 |

## 七、待产品决策（findings 遗留）

1. fast path 的权威 scope 只保存在 conversation，还是生成轻量 session snapshot？
2. 同一 Session 中是否正式保留 `spec-only` 路径，还是只提供 fast 与 full planned？
3. 历史已错误 completed 的步骤只诊断，还是提供显式重算/回退动作？
