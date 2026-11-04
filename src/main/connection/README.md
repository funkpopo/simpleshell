# 连接层

`connectionManager.js` 统一管理 SSH / Telnet / 串口 / Mosh 连接池；本目录其余
模块负责 SSH 连接的建立、健康检查与重连策略。

## SSH 客户端

SSH 只有一个实现：`sshClientFactory.js` 创建 `native/nativeSshClient.js`，
SSH 运行在 `simpleshell-core` 中，按账号（主机、端口、用户、代理）与 SFTP、
传输、端口转发共享同一条连接。缺少原生程序（`simpleshell-core`）时
`createSshClient()` 抛出 `ENATIVECORE` 错误，没有进程内回退实现。

`NativeSshClient` 的接口沿用应用最初基于的 ssh2 `Client`（`connect` /
`shell` / `exec` / `end`，`ready` / `error` / `close` / `keyboard-interactive`
事件，`hostVerifier` 选项）。连接池（`ssh-pool.js`）、重连策略
（`reconnection-manager.js`）、主机指纹信任（`sshAuthenticationService.js`
的 `hostVerifier`）和 keyboard-interactive 应答（`ssh-interactive-auth.js`）
都建立在它之上：

- 代理由调用方解析后通过 `options.proxy` 传入，隧道在 core 中建立；
- 健康检查（`ssh-transport-health.js`）走 `checkTransport()`：keepalive 有
  应答，或超时窗口内收到过通道数据即视为存活；
- 终端 shell 以管道模式打开（`shell(window, { pipe: { rules } })`，规则来自
  `shared/domain/highlight-configs.js`）：UTF-8 解码、OSC 过滤、高亮、编辑器
  模式检测与 ZMODEM 都在 core 的流内完成，`terminalOutput.js` 只把文本交给
  邮箱；渲染端 ACK 与暂停原因经邮箱的 `remoteFlow` 原样转给 core 作为通道
  credit（`grantCredit` / `pauseFor` / `resumeFor`），ZMODEM 由
  `zmodemTransferService.attachChannel` 处理通道的 `zmodem` 事件。
