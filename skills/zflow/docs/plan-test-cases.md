# 测试用例创建与 test_generator MCP 集成（plan 同步产物）

> 适用节点：`plan`（产出用例规格）+ `build`(骨架生成与修正)
> 纪律：**用例规格写语义意图，MCP 只出骨架**；骨架修正并真实运行之前，不得宣称测试通过。

## 1. plan 步骤：写测试用例规格

拆 Tickets 的同时，产出 `.scratch/<sandbox-id>/test-cases.md`，与 `plan.md` 一起过用户审查门。

每条用例字段：

| 字段 | 说明 |
|---|---|
| ID | `TC-001` 起编 |
| 映射 | 对应 ticket 编号 + spec 验收条目 |
| 类型 | `unit` / `integration` / `manual`（UI 交互走 DevTools 人工清单） |
| 对象 | 模块函数 / 页面 / 交互链路 |
| 前置 | 需要的状态、mock 开关、数据 |
| 步骤 | 操作序列 |
| 预期 | 可判定的结果 |
| 自动化 | `MCP 骨架` / `手写` / `人工` |

**类型划分原则**：
- 无副作用的纯逻辑（utils、纯函数、数据变换）→ `unit`，标记「MCP 骨架」。
- 跨模块/带全局状态的逻辑 → `integration`，通常手写。
- 页面渲染与交互（尤其小程序 `Page()`/`wx` 依赖）→ `manual`，写成 DevTools 操作清单，不强行单测。

## 2. build 步骤：MCP 骨架生成与修正

### 可用工具（test_generator MCP）

| 工具 | 行为 |
|---|---|
| `generate_tests` | 只返回测试代码，**不落盘**（先探后写用它） |
| `write_test_file` | 生成并写入测试文件 |
| `batch_generate` | 多文件批量 |

参数：`sourceFile`（源文件）、`testFile`（可选，落盘路径）、`config.framework`（`jest`/`mocha`/`vitest`/`ava`）、`config.coverage`、`config.includeEdgeCases`、`config.includeErrorCases`。

### 标准流程

1. 对 test-cases.md 标记「MCP 骨架」的模块，先 `generate_tests` 预览。
2. 确认方向后 `write_test_file` 落盘（测试文件与源码同目录，`<name>.test.js`）。
3. **修正骨架**（见下方已知局限），按 test-cases.md 的预期补真实断言。
4. 运行测试，把真实输出作为 ticket 验证证据。

## 3. test_generator 已知局限（实测，2026-08-08）

对该 MCP 用 CommonJS 数据模块实测，产物为**脚手架级**，直接运行会失败：

1. **断言空洞**：happy-path 普遍只有 `expect(fn()).toBeDefined()`；边界用例对函数塞超长占位字符串，无真实语义。
2. **导入路径错误**：生成 `import * as target from './<绝对路径>'`——绝对路径前强加 `./`，必挂。
3. **模块体系不匹配**：源文件是 CommonJS（`module.exports`）时仍生成 ESM `import`，且测试体裸调函数名（未从 `target` 解构），运行即 `ReferenceError`。

**因此约定**：MCP 产物一律视为待修正骨架；真实断言以 test-cases.md 为准；修完必须真实运行。对零依赖项目（如原生小程序）引入 jest/vitest 属新增 dev 依赖，需先征求用户同意（可放在仓库外或独立 dev 配置）。

## 4. 运行参考

```bash
# jest（CommonJS 项目最省事）
npx jest <name>.test.js
# vitest
npx vitest run <name>.test.js
```

## 5. 运行时专属问题清单（实测沉淀）

以下类别**静态审查与单测都发现不了**，plan 写用例时必须落成 manual 回归项，review 时核对是否真实执行：

1. **组件样式隔离**：`app.wxss` 里 `page {}` 定义的 CSS 变量在 Component（如 custom-tab-bar）内不生效——曾导致 tab bar 背景透明、页面内容穿透。组件内一律字面色值。
2. **原生胶囊/安全区几何**：`navigationStyle: custom` 页面顶栏必须用 `wx.getMenuButtonBoundingClientRect()` 布局，否则被原生胶囊遮挡。
3. **条件渲染的真实状态组合**：有/无订单、售罄、异常、自提/外卖等状态要逐个切换编译验证，mock 开关就是为此存在。

实例：示例测试用例 `test-cases.md` 的 TC-108/TC-109 即第 1、2 类的回归用例。

## 6. 完成条件

- test-cases.md 覆盖全部 ticket 与 spec 验收条目；
- 「MCP 骨架」用例均已修正并**真实运行通过**（附输出）；
- `manual` 用例形成可执行 DevTools 清单，运行验证单独声明、不以编译/单测冒充。
