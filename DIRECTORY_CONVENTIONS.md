# 工具目录归属规则（src/shared vs src/core/utils vs src/utils）

> 生效日期：2025-09。**新代码必须按本文档投放**；存量文件迁移时同样遵循。
> 另有一个独立体系：`src/modules/`（功能编排）与 `src/core/`（低层原语）的边界由 README「Connection Architecture」描述，不在本文范围。

## 一、三层工具目录的定位

| 目录              | 运行环境                                  | 允许的依赖                                | 禁止的内容                                                            |
| ----------------- | ----------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| `src/shared/`     | 主进程 + 渲染进程 + workers 共用          | **零 npm 依赖**、纯 Node/JS 逻辑          | `require("electron")`、React、DOM（`window`/`document`）、native 模块 |
| `src/core/utils/` | 仅主进程（main / workers / sidecar 桥接） | npm 包、`electron`（main 部分）、Node API | React、DOM                                                            |
| `src/utils/`      | 仅渲染进程                                | React、DOM、npm UI 依赖                   | `require("electron")`（渲染进程如需 IPC 走 preload 暴露的 API）       |

判别口诀：**一个模块若不依赖任何运行环境，放 `shared`；只跑在主进程，放 `core/utils`；只跑在渲染进程，放 `utils`。**

## 二、投放决策树

```
新工具函数/类：
├─ 双端都要用？
│  ├─ 是 → 零依赖纯逻辑？ ── 是 → src/shared/
│  │                        └─ 否 → 拆出纯逻辑入 shared，环境相关部分留在各自侧
│  └─ 仅主进程用 → src/core/utils/
└─ 仅渲染进程用 → src/utils/
```

补充约束：

1. **`src/shared/` 保持零依赖**（参照 `shared/common.js` 头注释的既有约定）。它会被 webpack 同时打进 main 与 renderer bundle，引入 npm 依赖会双份膨胀；引入 Electron/DOM API 会直接崩。
2. **主进程禁止引用 `src/utils/`**，渲染进程原则上禁止引用 `src/core/utils/`（见下方「豁免清单」）。
3. 文件与函数一律带 JSDoc 注明所属运行环境；含副作用的模块（如注册全局监听）需在文件头声明。
4. 工具函数合并收口原则沿用既往重构（B 系列 todo）：同一函数出现两份克隆时，必须合并到正确层级，不允许各留一份。

## 三、跨层引用守则

- 渲染进程需要主进程能力 → 一律通过 `src/preload.js` 暴露的 contextBridge API，不得直接 import 主进程模块。
- 主进程需要文案/翻译 → 使用 `src/shared/mainI18n.js`（加载与渲染进程相同的 locale JSON），不得依赖渲染进程的 i18n 实例。
- workers（`src/workers/`、webpack main entry 的 worker bundle）视为主进程侧，遵循 `core/utils` 与 `shared` 规则。

## 四、豁免清单（历史遗留，迁移前有效）

以下 `src/core/utils/` 模块目前被渲染进程直接引用，属于**双向共用但未达标**的存量：

| 模块                        | 现状                                                                                 | 处理方向                                                   |
| --------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `core/utils/formatters.js`  | 渲染侧 4 处引用（FileManager / FilePreview / GlobalTransferFloat / ResourceMonitor） | 纯格式化逻辑，应迁往 `src/shared/`（可保留 i18n 回调注入） |
| `core/utils/performance.js` | 渲染侧 3 处引用（含 useTerminalLifecycle / useAutoCleanup）                          | 拆分：Node 侧计时入 core，通用性能工具入 shared            |

新代码**不得新增**跨层引用；触碰上述模块时顺手完成迁移，迁完后从此表移除。

## 五、落地检查

1. Code review 时按「投放决策树」核对新文件位置。
2. 可选加固（后续可加进 `scripts/check-*.js` 体系）：
   - `check-layer-boundaries.js`：主进程源码（`src/core|modules|services|workers`）不得出现 `require("…/utils/…")` 指向 `src/utils/`；渲染侧不得引用 `src/core/utils/` 豁免清单之外的模块；`src/shared/` 不得出现 `require("electron")`、`from "react"`、DOM 全局。
3. 相对路径深度注意：`src/core/ipc/handlers/` 下的 `../../utils/xxx` 指向 `src/core/utils/`（handlers → ipc → core），不是渲染层 `src/utils/`，review 时留意层级。
