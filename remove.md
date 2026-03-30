# 冗余代码扫描记录

## 扫描范围与判定口径

- 扫描范围：`src/**`
- 主要判定方式：
  1. 从 `src/main.js`、`src/app.jsx`、`src/preload.js` 出发做静态依赖图扫描
  2. 结合 `rg` 全仓搜索，确认目标文件/导出是否存在 `import` / `require` 消费
  3. 若存在替代实现或调用链已迁移，则标记为高置信度冗余
- 本文中的“高置信度整文件冗余”适合后续直接进入删除批次
- 本文中的“符号级标记”表示文件本身仍在使用，但内部有未消费导出，建议后续单独清理
- 统计口径说明：
  - “文件数 / 行数”只统计整文件候选，不重复计算符号级标记
  - 行数为粗略代码行数，用于评估删除规模

## 统计汇总

- 高置信度整文件冗余：`17` 个文件，约 `6122` 行
- 其中：
  - 旧 IPC / 旧传输 / 旧内存子系统：`11` 个文件，约 `4427` 行
  - 未接入的工具模块：`6` 个文件，约 `1695` 行
- 符号级冗余：`11` 个未消费导出，涉及 `2` 个文件

## 高置信度整文件冗余

| 分类 | 文件 | 行数 | 证据 | 备注 |
| --- | --- | ---: | --- | --- |
| 旧 IPC | `src/core/ipc/ipcManager.js` | 279 | 全仓未发现任何 `import/require`；当前 IPC 注册实际走 `src/core/app/ipcSetup.js` 与 `src/core/ipc/setupIPC.js` | 可作为首批删除候选 |
| 旧 IPC 依赖 | `src/core/ipc/ipc-batcher.js` | 176 | 仅被 `src/modules/sftp/TransferProgressCoordinator.js` 引用；而后者本身无入口引用 | 需与 `TransferProgressCoordinator.js` 一起删除 |
| 旧内存子系统 | `src/core/memory/memory-pool.js` | 728 | 静态依赖图不可达；全仓未发现入口消费 | 属于废弃子系统根节点 |
| 旧内存子系统 | `src/core/memory/memory-leak-detector.js` | 670 | 仅被未接入的 `memory-pool.js` 引用 | 跟随 `memory-pool.js` 删除 |
| 旧传输子系统 | `src/core/transfer/backpressure-controller.js` | 764 | 静态依赖图不可达；全仓未发现入口消费 | 当前传输链路未使用该控制器 |
| 旧传输子系统 | `src/core/transfer/optimization-middleware.js` | 417 | 静态依赖图不可达；全仓未发现入口消费 | 当前传输链路未使用该中间件 |
| 旧传输子系统 | `src/core/transfer/sftp-engine.js` | 197 | 静态依赖图不可达；全仓未发现入口消费 | 文件内部仍保留 “compatibility shim” 风格实现 |
| 旧传输子系统 | `src/core/transfer/transfer-resume-manager.js` | 572 | 静态依赖图不可达；全仓未发现入口消费 | 当前代码未接入断点续传管理器 |
| 旧传输子系统 | `src/core/transfer/zero-copy-engine.js` | 162 | 静态依赖图不可达；全仓未发现入口消费 | 当前传输链路未使用零拷贝实现 |
| 旧传输子系统 | `src/modules/sftp/TransferProgressCoordinator.js` | 363 | 静态依赖图不可达；全仓未发现入口消费 | 已无任何传输入口引用该协调器 |
| 旧传输子系统 | `src/modules/sftp/sftpTransfer.js` | 99 | 静态依赖图不可达；全仓未发现入口消费 | 兼容层残留，当前无调用方 |
| 工具模块 | `src/core/utils/directoryCache.js` | 41 | 全仓未发现入口消费；`src/components/FileManager.jsx:277` 已直接使用 `useRef(new Map())` 维护目录缓存，`src/components/FileManager.jsx:918` 有本地 `updateDirectoryCache` | 功能已被组件内实现替代 |
| 工具模块 | `src/utils/VirtualScrollBuffer.js` | 340 | 静态依赖图不可达；全仓未发现入口消费 | 未接入任何终端渲染链路 |
| 工具模块 | `src/utils/batchIpc.js` | 221 | 静态依赖图不可达；全仓未发现入口消费 | 运行时直接暴露了 `window.terminalAPI.batchInvoke`，但该封装层未被使用 |
| 工具模块 | `src/utils/imageSupport.js` | 363 | 静态依赖图不可达；全仓未发现入口消费 | 设置中仍有 `imageSupported` 开关，但运行时未接入该管理器 |
| 工具模块 | `src/utils/realtimeInputHighlighter.js` | 354 | 静态依赖图不可达；全仓未发现入口消费；当前终端高亮规则由 `src/modules/terminal/output-processor.js:3`、`src/modules/terminal/output-processor.js:165`、`src/modules/terminal/output-processor.js:632` 管理 | 明显属于旧实现残留 |
| 工具模块 | `src/utils/thinkContentProcessor.js` | 376 | 静态依赖图不可达；全仓未发现入口消费；`src/components/AIChatWindow.jsx:602` 已在组件内定义 `processThinkContent`，并在 `src/components/AIChatWindow.jsx:1483` 使用 | 功能已被组件内实现覆盖 |

## 当前真实调用链证据

以下内容用于说明为什么上面的旧模块可以被视为冗余：

- 当前文件传输主链路已经走 `src/modules/filemanagement/filemanagementService.js`
  - `src/modules/filemanagement/filemanagementService.js:14` 使用 `nativeSftpClient`
  - `src/modules/filemanagement/filemanagementService.js:17` 使用 `TransferProcessPool`
  - `src/modules/filemanagement/filemanagementService.js:27` 明确写了 `TRANSFER_ENGINE_MODE = "process-worker-pool-v1"`
- 当前终端输出高亮已经走 `src/modules/terminal/output-processor.js`
  - `src/modules/terminal/output-processor.js:3` 引入 `highlightRuleConfigs`
  - `src/modules/terminal/output-processor.js:165` 初始化高亮规则
  - `src/modules/terminal/output-processor.js:632` 执行 `applySyntaxHighlighting`
- 当前目录缓存已经内聚到 `src/components/FileManager.jsx`
  - `src/components/FileManager.jsx:277` 定义 `directoryCacheRef`
  - `src/components/FileManager.jsx:918` 定义 `updateDirectoryCache`
- 当前 AI `<think>` 内容拆分已经直接内联在 `src/components/AIChatWindow.jsx`
  - `src/components/AIChatWindow.jsx:602` 定义 `processThinkContent`
  - `src/components/AIChatWindow.jsx:1483` 使用 `processThinkContent(message.content)`

## 符号级标记

以下项先标记，不建议在第一批中删除整个文件。

### 1. `src/components/LazyComponents.jsx`

未消费导出共 `7` 个：

- `AIAssistantWithSuspense`，定义于 `src/components/LazyComponents.jsx:92`
  - 全仓未发现任何导入
- `ResourceMonitor`，导出于 `src/components/LazyComponents.jsx:191`
- `IPAddressQuery`，导出于 `src/components/LazyComponents.jsx:192`
- `Settings`，导出于 `src/components/LazyComponents.jsx:193`
- `CommandHistory`，导出于 `src/components/LazyComponents.jsx:194`
- `ShortcutCommands`，导出于 `src/components/LazyComponents.jsx:195`
- `LocalTerminalSidebar`，导出于 `src/components/LazyComponents.jsx:196`
  - 以上 6 个导出旁边有“为了向后兼容”的注释，但仓库内未发现实际导入
  - 当前 `src/app.jsx` 实际只使用 `...WithSuspense` 版本以及 `preloadComponents` / `smartPreload`

### 2. `src/core/app/appInitializer.js` / `src/core/app/index.js`

未消费导出共 `4` 个：

- `getConnectionManager`
  - 定义：`src/core/app/appInitializer.js:211`
  - 重新导出：`src/core/app/index.js:15`
- `getSftpCore`
  - 定义：`src/core/app/appInitializer.js:218`
  - 重新导出：`src/core/app/index.js:16`
  - 额外风险：函数体返回 `sftpCore`，但当前文件内没有对应定义
- `getSftpTransfer`
  - 定义：`src/core/app/appInitializer.js:225`
  - 重新导出：`src/core/app/index.js:17`
  - 额外风险：函数体返回 `sftpTransfer`，但当前文件内没有对应定义
- `getExternalEditorManager`
  - 定义：`src/core/app/appInitializer.js:232`
  - 重新导出：`src/core/app/index.js:18`

说明：

- 这 4 个导出在仓库内未发现任何消费方
- 其中 `getSftpCore` / `getSftpTransfer` 不仅未使用，而且是潜在风险代码，因为一旦被调用会访问未定义标识符

## 已排除的误报

以下文件虽然在简单“入度统计”里可能像未引用，但实际上不能算冗余：

- `src/workers/ai-worker.js`
- `src/workers/sftp-transfer-worker.js`
  - 原因：两者在 `webpack.main.config.js:7-8` 被声明为 webpack 入口
- `src/shims/cpu-features.js`
  - 原因：在 `webpack.main.config.js:15` 被作为 `cpu-features$` 的 alias
- `src/components/ResourceMonitor.jsx`、`src/components/Settings.jsx`、`src/components/CommandHistory.jsx`、`src/components/ShortcutCommands.jsx`、`src/components/IPAddressQuery.jsx`、`src/components/LocalTerminalSidebar.jsx`
  - 原因：这些组件通过 `src/components/LazyComponents.jsx` 的动态 `import()` 被懒加载使用
- `src/styles/theme-variables.css`、`src/styles/global.css`、`src/styles/theme-transitions.css`、`src/styles/typography.css`、`src/styles/terminal.css`、`src/styles/scrollbar.css`、`src/styles/glass-effect.css`、`src/assets/fonts/fonts.css`
  - 原因：由 `src/styles/index.css` 和 `src/styles/global.css` 的 `@import` 链接入

## 后续删除建议顺序

建议按下面顺序处理，回归风险最低：

1. 先删工具模块：
   - `directoryCache.js`
   - `VirtualScrollBuffer.js`
   - `batchIpc.js`
   - `imageSupport.js`
   - `realtimeInputHighlighter.js`
   - `thinkContentProcessor.js`
2. 再删旧 IPC / 旧传输 / 旧内存子系统：
   - `ipcManager.js`
   - `ipc-batcher.js`
   - `memory-pool.js`
   - `memory-leak-detector.js`
   - `core/transfer/*`
   - `TransferProgressCoordinator.js`
   - `sftpTransfer.js`
3. 最后清理符号级冗余：
   - `LazyComponents.jsx` 的兼容导出
   - `appInitializer.js` / `core/app/index.js` 的 4 个未消费导出

## 结论

本次扫描已经确认项目内存在一批高置信度冗余代码，规模约为：

- `17` 个整文件候选
- 约 `6122` 行代码
- 另有 `11` 个未消费导出符号可在后续顺手清理

后续如需，我可以直接按照本文件内容开始分批删除，并在每一批删除后补一轮引用校验与回归检查。
