# zmodem-serve sidecar（Phase 3）

ZMODEM（rz/sz）长驻 sidecar：ZMODEM 检测、协议状态机与终端透传从 JS
`zmodemTransferService.js`（旧 `zmodem2` 状态机路径，已移除）迁移而来。
基于 Rust `zmodem2` crate；JS 侧 `src/main/terminal/zmodemTransferService.js`
仅保留编排（文件选择/保存策略/i18n/IPC 事件/背压）。

P3.9 起为唯一后端：真实 SSH 下 `rz`/`sz` 手工互操作验证通过后默认启用，
旧的 JS 状态机路径与 `SIMPLESHELL_ZMODEM_BACKEND` 切换入口已移除。

## 协议（NDJSON 控制消息 + Base64 字节载荷）

请求（stdin，camelCase）：

| 消息         | 字段                                           | 说明                                    |
| ------------ | ---------------------------------------------- | --------------------------------------- |
| `open`       | `sessionId`、`generation?`                     | 注册会话（检测模式）                    |
| `input`      | `sessionId`、`seq?`、`dataBase64`              | 原始 SSH 输出字节（有序投递）           |
| `wireAck`    | `sessionId`、`n?`                              | `writeRemote` 字节已写入 SSH 流         |
| `sendFiles`  | `sessionId`、`files`（path/name/size/mtimeMs） | 上传文件已由 JS 授予路径                |
| `acceptFile` | `sessionId`、`path`                            | 下载目标已由 JS 批准（Rust 仅写该路径） |
| `cancel`     | `sessionId`                                    | 先向远端发 5×CAN + 5×BS，再结束本端会话 |
| `close`      | `sessionId`                                    | 关闭会话                                |

响应（stdout）：

- `passthrough`：`sessionId`、`dataBase64` —— 非 ZMODEM 字节原样透传，
  JS 经 `onRawOutput` 回调进入原解码/输出缓冲管线。
- `writeRemote`：`sessionId`、`dataBase64` —— 协议输出字节写入 SSH 流
  （JS 遵守 writable 背压，`stream.write` 返回 false 时排队，drain 后续发）。
- `event`：`sessionId`、`kind`（`intro`/`offer`/`progress`/`fileDone`/
  `done`/`cancelled`/`acceptFailed`/`error`）+ 附加字段（`direction`、
  `nameBase64`/`fileName`/`fileSize`/`awaitingAccept`、`deltaBytes`、
  `filesDone`、`message`）。

## 行为要点

- 检测：起始序列 `**\x18B0` + 类型字符（`0`=ZRQINIT 下载、`1`=ZRINIT 上传、
  `2`=ZSINIT 会话内）；非 ZMODEM 字节透传。
- 会话内全部字节进入协议状态机，不透传到终端；结束后恢复透传。
- 取消序列：5×CAN + 5×BS（lrzsz 约定）；进度节流 150ms、空闲超时 45s。
- 文件读写有界（子包上限 1024，与 lrzsz 一致）；下载仅写 `acceptFile`
  授权路径（排他创建，重名由 JS `uniqueSavePath` 唯一化）。
- 事件经代次（`generation`）隔离：重启只服务新会话，旧进程事件被丢弃。
- `wireAck` 为即时确认模型：sidecar 发出 `writeRemote` 即视为已写线，
  ack 仅用于协议演进兼容，背压由 JS 输出队列持有。

## 互操作

- `scripts/check-zmodem-sidecar.js`：两个 `zmodem-serve` 实例字节回环互驱
  （对端发送由手工构造的 ZRINIT 帧触发，模拟 rz 启动序列），覆盖下载/上传
  摘要、取消、跨块透传与 native 编排层端到端。
- 独立实现互操作：真实 `lrzsz` 双向传输、多文件、中文/空格文件名、CRC 重传
  与取消已在真实 SSH 下手工验证（P3.9）。
