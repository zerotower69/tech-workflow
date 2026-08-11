# Git 环境检查与建仓引导（build 前置步骤）

> 适用节点：`build`（动第一行代码之前）
> 纪律：**一次只问一个问题**，每问都给出默认值；用户可回答「全部默认」一次性跳过。

## 1. 何时触发

进入 build 步骤、实施第一个 ticket 之前，必须执行本检查。没有干净的 git 底座就开始写代码，等于把交付物放在无版本管理的地面上。

## 2. 检查步骤

```bash
git --version                                  # 0. git 可用
cd <构建目标目录>
git rev-parse --is-inside-work-tree            # 1. 是否已在仓库内
```

- **已在仓库内**：`git branch --show-current` + `git status --short` 确认分支与工作区状态，向用户报告后直接开工；工作区有无关改动时先询问处理方式。
- **不在仓库内**：进入下方引导流程。

## 3. 引导创建新仓库（逐条提问）

### Q1 仓库命名与仓库根位置
- 问：仓库叫什么名字？放在哪里？
- **目录约定**：工作区内的代码仓库统一放在项目根下的 `.repository/` 目录。`.repository` 是**仓库容器**（拼写即英文 repository，可存放多个相互独立的 git 仓库，自身不是仓库）；工作流产物（`.scratch/`、`.tech-tower/` 等）留在代码仓库之外，天然隔离：

```text
<项目根>/
├── .repository/          ← 仓库容器（可有多个 git 仓库）
│   └── <仓库名>/          ← 在这里 git init
├── .scratch/             ← 工作流产物（spec/plan/mockups，不进仓库）
└── .tech-tower/          ← 视觉伴侣会话（不进仓库）
```

- 默认：仓库名 = 项目 slug 或产品名（小程序项目可用 `project.config.json` 的 `projectname`）。

### Q2 是否设置 git local config
- 先读现状：`git config --global user.name` / `git config --global user.email`。
- 问：是否为本仓库单独设置 `user.name` / `user.email`（`--local`，仅对本仓库生效）？
- 默认：沿用现有全局配置，不设置 local。全局配置缺失时**必须**设置 local，否则提交会失败。

### Q3 默认分支
- 问：默认分支用 `master` 还是 `main`？
- 默认：`master`。
- 实施：`git init -b <branch>`（git ≥ 2.28）；旧版本先 `git init` 再 `git symbolic-ref HEAD refs/heads/<branch>`。

### Q4 .gitignore
- 问：是否按项目类型生成 `.gitignore`？
- 默认：生成。小程序参考模板：

```gitignore
node_modules/
miniprogram_npm/
dist/
.DS_Store
*.log
```

### Q5 远程仓库
- 问：是否现在关联远程（GitHub / Gitee）并推送？
- 默认：暂不关联，交付（pr 步骤）前再处理。

## 4. 首次提交

```bash
git add -A
git commit -m "chore: init <仓库名> skeleton"
```

## 5. 完成条件

`git log` 有首次提交且 `git status` 干净——满足后才允许开始第一个 ticket。
