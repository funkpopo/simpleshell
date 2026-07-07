# 本地终端内置化实施规划

## 背景与目标

当前侧边栏「本地终端」入口由 `LocalTerminalSidebar.jsx` 检测系统终端后，通过 `window.terminalAPI.launchLocalTerminal()` 调用主进程 `localTerminalHandlers.js`，再由 `local-terminal-manager.js` 使用 `child_process.spawn()` 拉起外部 Windows Terminal、PowerShell、cmd、WSL 或系统终端。现有 `window-embedder` 路径尝试把外部窗口嵌入主窗口，但本质仍依赖外部窗口句柄，尺寸、焦点、输入法、生命周期和跨平台一致性都不可控。

目标是将「本地终端」从拉起外部 Terminal 改造成应用内部标签页终端：主进程用 `node-pty` 启动本地 shell，renderer 复用现有 `WebTerminal` + xterm.js 渲染和输入输出链路，生命周期、关闭、resize、背压、主题、搜索、快捷输入等行为必须与 SSH/Telnet 标签保持一致。

本规划禁止最小化实现，也禁止设计任何外部 Terminal 兜底机制。实施结果必须是完整的应用内终端能力：不能只支持单一 shell，不能只实现启动而遗漏关闭、resize、背压、退出事件、tab 生命周期、检查脚本和跨平台策略；如果某个平台或 shell 暂不可支持，应明确标记为未完成阻塞项，而不是转为外部打开。

## 推荐总体方案

- 保留 `TerminalDetector` 的检测能力，用于列出 PowerShell、cmd、WSL 发行版和可用 shell。
- 新增真正的内置本地 PTY 会话，不再把 Windows Terminal、Terminal.app、GNOME Terminal 等外部 GUI 作为运行目标。
- 侧边栏点击本地终端后创建一个应用内 tab，tab 类型新增为 `local` 或 `local-terminal`。
- `WebTerminal` 支持按 tab 类型启动本地终端：SSH 走 `startSSH`，Telnet 走 `startTelnet`，本地终端走新增 `startLocalTerminal`。
- 主进程本地终端输出进入现有 `TerminalIOMailboxManager`，renderer 继续通过 `RendererTerminalIOMailbox` 接收输出、发送输入、确认消费和 resize。
- 删除旧的外部窗口启动和外部窗口嵌入路径，`WindowEmbedder` 不再参与本地终端功能。
- 不设计外部 Terminal 兜底路径；`node-pty` 启动失败必须返回结构化错误并在应用内展示。
- 不接受最小化交付；本地终端必须同时完成启动、输入、输出、resize、退出、关闭、清理、测试和文案。

## 分阶段任务

### 阶段 1：梳理协议和数据模型

- [x] 明确本地 tab 数据结构：
  - `type: "local"`
  - `id: local-${timestamp}`
  - `label`: 终端名称，例如 `PowerShell`、`cmd`、`Ubuntu`
  - `localConfig`: `{ name, type, executable, executablePath, launchArgs, cwd, env, distribution }`
- [x] 统一终端启动配置字段，避免 `executable` 和 `executablePath` 双字段散落：
  - detector 输出保留原字段兼容；
  - 启动前归一化为 `command`、`args`、`cwd`、`env`。
- [x] 定义支持范围：
  - Windows：`powershell.exe`、`pwsh.exe`、`cmd.exe`、`wsl.exe -d <distribution>`。
- [x] 明确不再内置启动 GUI 终端：
  - `windows-terminal`、`Terminal.app`、`iTerm`、`gnome-terminal` 不作为本地终端目标；
  - 不提供「外部打开」替代路径；
  - 检测列表只展示可通过 PTY 启动的 shell 或 WSL 发行版。
- [x] 明确完整实现边界：
  - Windows 必须覆盖 PowerShell、cmd、WSL；
  - macOS/Linux 必须覆盖默认用户 shell；
  - 任一目标未完成时，任务保持未完成状态，不以缩小范围方式验收。

### 阶段 2：新增主进程 PTY 管理能力

- [x] 新增或改造 `src/core/local-terminal/local-terminal-manager.js`：
  - 引入 `node-pty`；
  - 新增 `startEmbeddedTerminal(localConfig, tabId, options)`；
  - 使用 `pty.spawn(command, args, { name, cols, rows, cwd, env })`；
  - 返回 `{ processId, tabId, pid, status, shell, cwd, startedAt }`。
- [x] 替换旧 `launchTerminal()` 的外部 GUI 启动语义：
  - 删除或停止使用 `child_process.spawn()` 拉起 GUI 终端的路径；
  - 将本地终端唯一启动入口改为 `startEmbeddedTerminal()`；
  - 不新增 `launchExternalTerminal()` 之类的外部启动 API。
- [x] 将本地 PTY 注册到全局 `processManager`：
  - `processManager.setProcess(processId, { type: "local-pty", process: ptyProcess, tabId, config, isRemote: false })`；
  - 同时用 `tabId` 建 alias，便于 renderer 现有 resize/input 逻辑继续按 tabId 或 processId 定位。
- [x] 将 PTY 输出接入 `TerminalIOMailboxManager`：
  - `ptyProcess.onData(data => mailbox.emitOutput(data))`；
  - `ptyProcess.onExit(({ exitCode, signal }) => emit LOCAL_TERMINAL_STATUS/TERMINAL_EXIT)`；
  - 使用 mailbox 的 `applyResize` 调用 `ptyProcess.resize(cols, rows)`。
- [x] 输入写入统一走现有 `TerminalHandlers.writeToProcess()` 或等价路径：
  - 对 `type: "local-pty"` 调用 `process.write(input)`；
  - 避免使用 `stdin.write()`，因为 `node-pty` 进程对象不是普通 child_process。
- [x] 关闭逻辑：
  - 用户关闭 tab 时调用现有 `killProcess(processId)`；
  - 对 PTY 调用 `kill()`；
  - 清理 process map、mailbox、tab alias 和本地 active map。

### 阶段 3：新增 IPC 通道和 preload API

- [x] 在 `src/core/ipc/schema/channels.js` 增加请求：
  - `LOCAL_TERMINAL_START_EMBEDDED` 或 `TERMINAL_START_LOCAL`；
  - 入参为 `localConfig`；
  - 返回标准响应 `{ success, data: processId }` 或保持与 `startSSH` 兼容直接返回 `processId`，建议使用标准响应再在前端 normalize。
- [x] 在 `src/core/ipc/handlers/localTerminalHandlers.js` 注册新 handler：
  - `startEmbeddedLocalTerminal(event, localConfig)`；
  - 从 `localConfig.tabId` 读取 tab；
  - 调用 `LocalTerminalManager.startEmbeddedTerminal()`；
  - 返回 `processId` 和可序列化 metadata。
- [x] 在 `src/preload.js` 暴露：
  - `startLocalTerminal(localConfig)`；
  - 删除或废弃现有 `launchLocalTerminal()` 外部打开 API；
  - `closeLocalTerminal()` 逐步转为基于 processId/tabId 的关闭接口。
- [x] 给 `LOCAL_TERMINAL_STATUS` 增加新事件类型：
  - `starting`
  - `ready`
  - `exit`
  - `error`
- [x] 不增加外部兜底状态事件；所有失败都走 `error` 并携带结构化错误码、message、shell、command、args。

### 阶段 4：改造侧边栏点击行为为创建应用内 tab

- [ ] 修改 `src/app.jsx` 的 `handleLaunchLocalTerminal`：
  - 不再只调用 `window.terminalAPI.launchLocalTerminal()`；
  - 创建本地 tab；
  - 写入 `terminalInstances[tabId] = true`；
  - 写入 `terminalInstances[`${tabId}-config`] = normalizedLocalConfig` 或新增本地配置存储键；
  - 切换当前 tab 到新建本地终端；
  - 关闭或保留侧边栏按产品体验决定，建议点击后关闭侧边栏。
- [ ] tab label 使用本地终端名称：
  - WSL 发行版用 `Ubuntu`、`Debian` 等；
  - PowerShell/cmd 使用检测项名称；
  - 如果同类终端多开，追加序号或短时间戳避免混淆。
- [ ] tab 类型判断从只支持 `ssh`/`telnet` 扩展为支持 `local`：
  - 渲染 `WebTerminal`；
  - 关闭 tab 时调用现有 cleanup/kill 流程；
  - 不触发 SSH reconnect、latency、SFTP 等远程专属逻辑。
- [ ] 侧边栏文案调整：
  - 当前成功提示从「启动成功」改为「已打开本地终端标签页」；
  - 失败提示必须说明应用内终端启动失败原因，不出现「已在外部终端打开」之类文案。

### 阶段 5：改造 WebTerminal 支持本地终端启动

- [x] 扩展 `WebTerminal` props：
  - 增加 `terminalType` 或直接从 config 判断；
  - 增加 `localConfig`；
  - 仍保留 `sshConfig` 兼容当前远程路径。
- [x] 启动连接逻辑改为三分支：
  - `protocol === "telnet"`：`startTelnet(config)`；
  - `type === "local"`：`startLocalTerminal(localConfig)`；
  - 默认：`startSSH(config)`。
- [x] `terminalProcessIdUpdated` 事件增加 `protocol: "local"` 或 `terminalType: "local"`：
  - 避免命令历史、快捷命令、监控、SFTP 等只适用于 SSH 的逻辑误判。
- [x] 本地终端启动成功后复用现有：
  - `ensureTerminalMailbox(term)`；
  - `setupDataListener(processId, term)`；
  - `setupCommandDetection(...)`；
  - resize、paste、search、copy、context menu。
- [x] 本地终端不应显示 SSH 连接成功、重连恢复、认证等文案。
- [x] 本地终端退出时在终端内打印简短提示：
  - `Process exited with code <code>`；
  - 保持 tab 可见，用户可关闭或重新打开。

### 阶段 6：平台 shell 解析策略

- [x] Windows PowerShell：
  - command 优先 `pwsh.exe` 或检测到的 `powershell.exe`；
  - args 默认可为空；
  - env 合并 `process.env`。
- [x] Windows cmd：
  - command `cmd.exe`；
  - args 可为空。
- [x] Windows WSL：
  - command `wsl.exe`；
  - args 使用 `["-d", distribution]`；
  - 如果没有 distribution，使用默认 WSL；
  - 不再通过 `wt.exe new-tab wsl`。
- [x] macOS/Linux：
  - command 优先用户 shell：`process.env.SHELL`；
  - 若 `process.env.SHELL` 不存在，则按 `/bin/zsh`、`/bin/bash`、`/bin/sh` 的确定性候选顺序选择第一个存在的 shell；
  - cwd 默认用户 home。
- [x] cwd 策略：
  - 默认 `os.homedir()`；
  - 后续可从设置项提供「启动目录」。

### 阶段 7：删除外部窗口启动和嵌入路径

- [ ] 删除本地终端外部启动路径：
  - 删除或停用 `launchLocalTerminal()` 的外部 Terminal 行为；
  - 删除 `LocalTerminalManager.launchWindowsTerminal()`、`launchMacOSTerminal()`、`launchLinuxTerminal()` 对 GUI 终端的启动语义；
  - 删除 `wt.exe new-tab`、`open -a Terminal`、`gnome-terminal` 等 GUI 终端启动逻辑。
- [ ] 删除外部窗口嵌入路径：
  - 删除 `WindowEmbedder` 依赖；
  - 删除 `resizeEmbeddedTerminal()`；
  - 删除按主窗口估算 bounds 的 resize 逻辑；
  - 删除外部窗口句柄 `hwnd` 作为主要状态的 UI 逻辑。
- [ ] 删除外部兜底产品入口：
  - 侧边栏不提供「外部打开」；
  - IPC 不提供外部打开；
  - 设置项不提供「启动失败时外部打开」；
  - 代码中不得新增 external local terminal fallback 分支。

## 重点风险与处理

- [ ] `node-pty` 原生依赖风险：
  - 当前 `package.json` 已有 `node-pty`，但 Electron 40/Node 24 的 rebuild 和打包必须验证；
  - 确认 `@electron-forge/plugin-auto-unpack-natives` 能正确处理；
  - 在 Windows 开发环境执行 `npm start` 和 `npm run package` 验证；
  - 如果 `node-pty` 不可用，功能必须以结构化错误失败并阻塞验收，不允许转为外部 Terminal。
- [ ] 输入输出背压风险：
  - 必须复用 `TerminalIOMailboxManager`，不要新增一套直接 `webContents.send` 高频输出通道；
  - 大量输出如 `dir /s`、`find /`、`yes` 场景要验证 UI 不冻结。
- [ ] resize 风险：
  - 本地 PTY 必须处理 xterm fit 后的 cols/rows；
  - 首次渲染、侧边栏开关、窗口 resize、tab 切换都要触发 resize。
- [ ] 生命周期风险：
  - 关闭 tab 必须 kill PTY；
  - 应用退出必须清理所有 PTY；
  - PTY 自行退出后不能留下僵尸 process map 或 mailbox。
- [ ] 远程专属功能误触发：
  - 本地 tab 不应注册 SSH reconnect；
  - 不应出现 SFTP、延迟、连接池、主机认证等远程状态；
  - 快捷命令可以支持本地，但需明确命令发送目标。
- [ ] WSL 特殊风险：
  - `wsl.exe` 作为 PTY 子进程时退出、路径、编码和发行版参数需单独测；
  - WSL 内的彩色输出、中文、Ctrl+C、Ctrl+D 要验证。
- [ ] 最小化实现风险：
  - 不允许只实现 PowerShell 或 cmd 后即验收；
  - 不允许只实现启动，不实现 resize、关闭、退出事件、清理和测试；
  - 不允许用外部打开覆盖未实现平台或失败路径。

## 验收标准

- [ ] 点击侧边栏「本地终端」中的 PowerShell/cmd/WSL 后，在应用内部新建终端 tab，而不是打开外部 Terminal 窗口。
- [ ] 项目中不存在本地终端启动失败后转外部 Terminal 的兜底逻辑。
- [ ] 本地 tab 能正常输入命令、显示输出、复制粘贴、搜索、清屏、右键菜单可用。
- [ ] 窗口 resize、侧边栏展开/收起、tab 切换后，本地终端尺寸正确，无裁剪和错位。
- [ ] 关闭本地 tab 后，对应 PTY 进程退出，`processManager` 和 mailbox 不残留。
- [ ] PowerShell、cmd、至少一个 WSL 发行版通过手工验证。
- [ ] macOS/Linux 默认 shell 路径有明确实现和检查；如果当前开发环境无法手工验证，需要补充代码级检查和待验证记录，不能从范围中移除。
- [ ] SSH/Telnet 现有连接、重连、命令建议、搜索和快捷命令不回归。
- [ ] `npm run check` 通过；如新增检查脚本，覆盖本地终端 IPC schema、tab 类型和 PTY 生命周期。
- [ ] 检查脚本覆盖禁止项：不得出现新增的外部本地终端启动分支、`WindowEmbedder` 本地终端调用、`fallback-external` 状态或「外部打开」文案。

## 建议提交顺序

- [x] 提交 1：新增本地 PTY manager 和 IPC，并同步停用外部 Terminal 启动入口。
- [x] 提交 2：`WebTerminal` 支持 `local` 启动分支，并补齐 lifecycle/resize。
- [ ] 提交 3：侧边栏点击改为创建本地 tab，删除外部打开文案和行为。
- [ ] 提交 4：补充检查脚本和手工验证记录。
- [ ] 提交 5：删除 `WindowEmbedder` 外部嵌入逻辑和相关 IPC/API。

## 需要优先查看的代码位置

- `src/components/LocalTerminalSidebar.jsx`：侧边栏检测和点击入口。
- `src/app.jsx`：`handleLaunchLocalTerminal`、tab 创建、tab 渲染、tab 关闭。
- `src/components/WebTerminal.jsx`：终端启动分支、mailbox 绑定、输入输出、resize。
- `src/core/ipc/handlers/localTerminalHandlers.js`：本地终端 IPC handler。
- `src/core/local-terminal/local-terminal-manager.js`：当前外部终端启动逻辑，后续改为唯一内置 PTY 路径。
- `src/core/ipc/schema/channels.js`：新增本地 PTY IPC schema。
- `src/preload.js`：暴露 `startLocalTerminal`。
- `src/core/terminal/terminalIOMailboxManager.js`：输出、输入、resize、背压统一通道。
- `src/core/process/processManager.js`：PTY 进程注册、关闭和清理。
