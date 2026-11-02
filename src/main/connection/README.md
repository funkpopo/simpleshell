# 连接层

`connectionManager.js` 统一管理 SSH / Telnet / 串口 / Mosh 连接池；本目录其余
模块负责 SSH 连接的建立、健康检查与重连策略。

## SSH 后端

`sshClientFactory.js` 决定终端使用的 SSH 客户端：

- `native`（默认）：`native/nativeSshClient.js` 提供与 ssh2 `Client` 兼容的
  接口（`connect` / `shell` / `exec` / `end`，`ready` / `error` / `close` /
  `keyboard-interactive` 事件，`hostVerifier` 选项），SSH 运行在
  `simpleshell-core` 中，按账号（主机、端口、用户、代理）与 SFTP、传输、
  端口转发共享同一条连接。
- `ssh2`：进程内的 ssh2 实现，作为过渡期回退。通过环境变量
  `SIMPLESHELL_SSH_BACKEND=ssh2` 或设置 `uiSettings.performance.sshBackend:
"ssh2"` 启用；缺少原生程序时自动使用。观察一至两个版本后移除，届时
  `ssh-pool.js` / `ssh-retry-helper.js` 中的代理 socket 分支、
  `ssh-transport-health.js` 的 ssh2 内部探测与 `ssh2` 依赖一并删除。

两种后端共用连接池、重连策略（`reconnection-manager.js`）、主机指纹信任
（`sshAuthenticationService.js` 的 `hostVerifier`）和 keyboard-interactive
应答（`ssh-interactive-auth.js`）。原生客户端的差异：

- 代理由调用方解析后通过 `options.proxy` 传入（`acceptsProxyConfig`），
  隧道在 core 中建立；
- 健康检查走 `checkTransport()`：keepalive 有应答，或超时窗口内收到过通道
  数据即视为存活；
- 终端流控按通道进行：渲染背压暂停时 core 停止读取该通道，SSH 窗口随之
  关闭，同一连接上的其他通道不受影响；主进程最多缓存 256 KiB 未消费输出；
- 终端 shell 以管道模式打开（`supportsTerminalPipe`，`shell(window,
  { pipe: { rules } })`）：UTF-8 解码、OSC 过滤、高亮、编辑器模式检测与
  ZMODEM 都在 core 的流内完成，`terminalOutput.js` 只把文本交给邮箱；
  渲染端 ACK 与暂停原因经邮箱的 `remoteFlow` 原样转给 core 作为通道
  credit（`grantCredit` / `pauseFor` / `resumeFor`），ZMODEM 由
  `zmodemTransferService.attachChannel` 处理通道的 `zmodem` 事件。
  ssh2 回退后端仍走主进程的 `output-processor.js` / `oscSafeOutput.js` /
  `zmodem-serve` 路径，随 ssh2 一并移除。
