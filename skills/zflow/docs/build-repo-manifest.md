# build 产物：repo.json（schema v2）

`repo.json` 是施工期间持续补齐的仓库交接清单，存放在：

```text
.scratch/<sandbox-id>/repo.json
```

它记录本 Ticket 实际修改了哪些仓库、在哪个分支施工，以及审查和交付应比较的 commit 边界。多仓任务必须为每个仓库保留独立记录。

v1.14.0 的权威结构为 `schemaVersion: 2`，使用 `workspaceRoot`、`baseCommit`、`headCommit`、`finalCommit`、`pushStatus` 和 `lastVerifiedAt`。旧 `schema_version: 1` 仅作为迁移输入，通过以下命令单向升级；不得并存第二个 `repositories.json`：

```bash
zflow-sandbox migrate-repo .scratch/<sandbox-id>
zflow-sandbox verify-repositories .scratch/<sandbox-id>
```

schema v2 仓库项示例：

```json
{
  "schemaVersion": 2,
  "sandboxId": "feature-slug",
  "workspaceRoot": "/absolute/path/to/workspace",
  "repositories": [
    {
      "id": "web-app",
      "path": ".repository/web-app",
      "url": "https://github.com/example/web-app.git",
      "remote": "origin",
      "baseBranch": "main",
      "baseCommit": "0123456789abcdef0123456789abcdef01234567",
      "targetBranch": "feature/checkout",
      "headCommit": "89abcdef0123456789abcdef0123456789abcdef",
      "finalCommit": "89abcdef0123456789abcdef0123456789abcdef",
      "pushStatus": "unpushed",
      "lastVerifiedAt": "2026-08-23T12:30:00+08:00",
      "statusAtBase": [],
      "statusAtFinal": [],
      "excludedDirtyPaths": [],
      "checkpoints": []
    }
  ],
  "changes": []
}
```

所有 Commit 字段必须使用完整 40 位 SHA。分支名是可移动引用，不能作为复现依据。

## 生命周期

1. 进入 build，完成 git 环境检查；新仓库先完成首次提交。
2. 在第一处施工改动前创建 `repo.json`，此时写入仓库信息、分支、`base_commit` 和当前 `head_commit`，`final_commit` 设为 `null`。
3. 每增加或移除一个施工仓库，立即更新 `repositories`；不得等到交付时凭记忆补写。
4. 每个 Ticket 或有意义的施工单元完成提交后，立即刷新 `head_commit`，并向 `checkpoints` 追加记录；分支、remote 或脏状态变化时也立即同步。
5. build 完成必要验证后，提交剩余的本 Ticket 改动，将当前 `HEAD` 同时写入 `head_commit` 与 `final_commit`。
6. review 若产生修复提交，复核后刷新对应仓库的 `head_commit`、`final_commit` 并追加 checkpoint。
7. pr 前校验每个仓库当前 `HEAD` 等于 `final_commit`，并以 `base_commit..final_commit` 作为交付 diff 边界。

不要把它留到阶段末尾一次性补写。任何会改变交付边界的 Git 事件发生后，都应在同一工作轮次更新 `repo.json`；即使上下文被清理，文件也能反映施工当前进度。

已有 `repo.json` 时先读取并验证实际仓库状态，不得重新生成覆盖。需要更换仓库、分支或 base 时，先向用户说明原因；保留原记录到 `changes` 数组后再更新。

## 旧版 JSON 结构（schema v1，仅供迁移器输入）

```json
{
  "schema_version": 1,
  "ticket": "feature-slug",
  "workspace_root": "/absolute/path/to/workspace",
  "created_at": "2026-08-23T10:00:00+08:00",
  "updated_at": "2026-08-23T12:30:00+08:00",
  "repositories": [
    {
      "name": "web-app",
      "path": ".repository/web-app",
      "branch": "feature/checkout",
      "detached_head": false,
      "remotes": [
        {
          "name": "origin",
          "url": "https://github.com/example/web-app.git"
        }
      ],
      "base_commit": "0123456789abcdef0123456789abcdef01234567",
      "head_commit": "89abcdef0123456789abcdef0123456789abcdef",
      "final_commit": "89abcdef0123456789abcdef0123456789abcdef",
      "status_at_base": [],
      "status_at_final": [],
      "excluded_dirty_paths": [],
      "checkpoints": [
        {
          "ticket": "T-03",
          "commit": "89abcdef0123456789abcdef0123456789abcdef",
          "recorded_at": "2026-08-23T12:20:00+08:00",
          "summary": "完成结算页状态处理"
        }
      ]
    }
  ],
  "changes": []
}
```

以下 snake_case 字段仅说明旧版含义；新文件统一使用上方 schema v2 的 camelCase 字段：

- `path`：相对 `workspace_root` 的路径；只有仓库在 workspace 外时才使用绝对路径并说明原因。
- `branch`：`git branch --show-current` 的结果；detached HEAD 时为 `null`，并设 `detached_head: true`。未经用户确认不要在 detached HEAD 上施工。
- `remotes`：记录 `git remote -v` 中实际存在的远程；没有则为空数组。URL 中的用户名、密码、token 和临时签名参数必须移除或写为 `<redacted>`。
- `base_commit`：施工前选定的 `HEAD` 完整 40 位 SHA。已有仓库在处理好无关改动后记录；新仓库使用首次提交 SHA。
- `head_commit`：最近一次同步 manifest 时的当前 `HEAD`；每次施工提交后立即刷新。它是进行中状态，不等同于最终交付边界。
- `final_commit`：本 Ticket 当前最终提交的完整 SHA。施工开始时为 `null`，build 完成提交后填写，review 修复后刷新。
- `status_at_base` / `status_at_final`：`git status --short` 的逐行 JSON 字符串数组。理想值为空；无法清理的用户既有改动还要列入 `excluded_dirty_paths`，不得混入工作流提交。
- `changes`：只记录 manifest 自身的边界变更，例如换分支、调整 base、增加仓库；每项含时间、仓库、原值、新值和原因。
- `checkpoints`：按发生顺序追加每个 Ticket/施工单元及 review 修复对应的 commit。不得通过覆盖数组抹掉历史；同一 commit 覆盖多个 Tickets 时可以逐项记录并保持相同 SHA。

## 采集与校验

对每个仓库至少执行等价的只读检查：

```bash
git rev-parse --show-toplevel
git branch --show-current
git remote -v
git rev-parse HEAD
git status --short
```

写入 `final_commit` 前确认：

```bash
git merge-base --is-ancestor <base_commit> <final_commit>
git rev-parse HEAD
git status --short
```

- `final_commit` 必须可解析，且应为 `base_commit` 的后代。合法的无代码变更 Ticket 可以二者相同，但交付说明必须明确这是 no-op。
- 不得为了得到干净状态而提交、覆盖或删除用户既有的无关改动。
- 不得把 `repo.json` 放进业务仓库；它属于 `.scratch/<sandbox-id>/` 工作流产物。
- 本文件只证明 Git 边界，不代表测试已通过，也不代表远程已推送。

## 阶段门槛

- **施工中**：每个已提交 Ticket 都能在 `checkpoints` 找到记录，`head_commit` 等于最近观测到的仓库 `HEAD`。
- **build → review**：`repo.json` 存在；所有施工仓库都有非空 `base_commit`、`head_commit` 和 `final_commit`；本 Ticket 的改动已提交；必要验证已完成。
- **review → pr**：review 修复均已提交；`final_commit` 已刷新并等于当前 `HEAD`；`base_commit..final_commit` 与审查范围一致。
