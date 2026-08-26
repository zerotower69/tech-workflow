# 可迁移工作流沙箱运行手册

技术塔 v1.14.0 起提供零依赖 Node 18+ 的确定性沙箱内核。Skill 负责推理和沟通；沙箱内核负责状态、revision、事件、门禁、Git 证据和迁移恢复。

## 入口

安装 npm 包后：

```bash
zflow-sandbox --help
```

Skill 自包含安装时：

```bash
node <skill-dir>/scripts/sandbox/cli.cjs --help
```

所有自动化调用建议加 `--json`，失败时读取 stderr 中的稳定 `code`、`message` 和 `details`，不要解析自然语言字符串。

## 启动与恢复

新任务在 intake 第一次追问前创建：

```bash
zflow-sandbox create <slug> --root .scratch --title "<目标>"
```

已有 `.scratch/<slug>/sandbox.json` 时禁止重新 create；先执行：

```bash
zflow-sandbox status .scratch/<slug> --json
zflow-sandbox validate .scratch/<slug> --json
```

存在 `handoff.md` 时先读 handoff，再按 status 返回的 `allowedNext` 接续。

## 产物 revision 与批准

编辑顶层 Markdown 后，先创建 revision，再申请批准：

```bash
zflow-sandbox revise context .scratch/<slug>
zflow-sandbox approve context .scratch/<slug>

zflow-sandbox revise spec .scratch/<slug> --path spec.md
zflow-sandbox approve spec .scratch/<slug>

zflow-sandbox revise plan .scratch/<slug> --path plan.md --spec-revision <n>
zflow-sandbox approve plan .scratch/<slug>
```

`approve` 只能在用户明确批准后调用。批准文件被手工修改会产生 hash 漂移；必须 `revise`，不得改 registry 中的摘要蒙混通过。

## 知识参考检查点

流程固定为：

```text
context → clarify → knowledge → spec
```

有知识源时填写：

- `knowledge/query.yaml`
- `knowledge/references.json`
- `knowledge/knowledge_brief.md`

无知识源时可以显式跳过：

```bash
zflow-sandbox approve knowledge .scratch/<slug> --skip-reason "<原因>"
```

存在信息冲突时写入 `decisions.md`，由用户决定后才允许批准 Spec。知识库只提供参考，不直接批准或改写 Spec。

```bash
zflow-sandbox conflict-add KB-CONFLICT-01 "旧规范与当前代码事实冲突" .scratch/<slug> --sources KB-AUTH-012,CODE-auth-service
zflow-sandbox conflict-resolve KB-CONFLICT-01 "以用户本次确认的当前代码行为为准" .scratch/<slug>
```

只有用户明确裁决后才能执行 `conflict-resolve`；命令会同步写入 `decisions.md` 和事件日志。

## 阶段迁移

```bash
zflow-sandbox transition brainstorm:clarify .scratch/<slug>
zflow-sandbox transition brainstorm:knowledge .scratch/<slug>
zflow-sandbox transition brainstorm:spec .scratch/<slug>
zflow-sandbox transition plan .scratch/<slug>
zflow-sandbox transition build .scratch/<slug>
zflow-sandbox transition review .scratch/<slug>
zflow-sandbox transition pr .scratch/<slug>
```

迁移失败时必须处理 `details.missing`，不能直接改 `sandbox.json` 绕过门禁。

## Git、Commit 和 Review

旧版 `repo.json` 先迁移：

```bash
zflow-sandbox migrate-repo .scratch/<slug>
zflow-sandbox verify-repositories .scratch/<slug>
```

施工提交和审查记录使用 JSON：

```bash
zflow-sandbox record-commit '{"ticketId":"T-01","repositoryId":"app","commit":"<40位SHA>","tests":["npm test"],"pushed":false}' .scratch/<slug>
zflow-sandbox record-review '{"id":"REVIEW-01","type":"integration","status":"approved","findings":[]}' .scratch/<slug>
```

Skill 锁：

```bash
zflow-sandbox lock-skill zflow <skill-dir> .scratch/<slug> --version 1.15.0 --source <source>
```

## 回退

```bash
zflow-sandbox rollback brainstorm:spec .scratch/<slug> --reason "<用户确认的原因>"
```

回退会追加事件、创建目标 draft revision、传播 `stale` 并重建 handoff；不会删除旧产物、Commit 或执行 `git reset`。

## 打包与恢复

```bash
zflow-sandbox pack .scratch/<slug> --output <slug>.tws
zflow-sandbox restore <slug>.tws --output <新沙箱目录> --workspace-root <新工作区>
```

`.tws` 是 gzip 压缩的版本化 JSON 容器：

- 已推送且干净的仓库只记录完整 Commit。
- 未推送 Commit 自动加入 Git bundle。
- 已跟踪未提交改动自动加入 binary patch。
- 重要未跟踪普通文件逐字节保护。
- 摘要损坏、路径穿越、非空目标、patch 冲突或无法保护的文件都会失败。

MVP 不自动恢复位于 workspace 根路径 `.` 的仓库，以防覆盖工作区；其 payload 会保留供人工处理。推荐项目仓库放在 `.repository/<name>/`。

## 校验纪律

每个阶段出口和交付前运行：

```bash
zflow-sandbox validate .scratch/<slug> --strict --json
```

普通模式把不可用 Skill 路径等可迁移差异列为 warning；strict 模式将 warning 升级为失败。静态校验不代表测试、浏览器或目标平台运行已经完成。
