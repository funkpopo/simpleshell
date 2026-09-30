# port-forward-serve sidecar

原生 SSH 端口转发：本地（`-L`）、远端（`-R`）与动态（SOCKS5）转发由按标签
代次独立持有的原生 SSH 连接承载（vendored `russh`），转发数据不经过跨进程
桥接。JS 侧 `port-forwarding-service.js` 保留规则编排、凭据与信任来源、
代理策略及 tabId 生命周期；`src/main/native/nativePortForwardingClient.js`
负责本模块的进程管理与协议桥接。

`port-forward-prototype` 是同一实现的验证变体（`serve(true)`）：监听地址限定
回环（`127.0.0.1` / `::1`）、会话上限 4，供
`scripts/check-port-forwarding-sidecar.js` 与
`scripts/verify-port-forwarding-openssh.js` 使用。

## 协议（NDJSON，`schemaVersion: 1`，单行 ≤ 256 KiB）

所有请求携带 `requestId`、`sessionId`、`generation`（> 0）。每个 sessionId 的
代次单调递增；`closeSession` 记录代次墓碑，迟到的旧代次 `start` 不能复活
已关闭会话（`STALE_GENERATION`）。

请求（stdin，camelCase）：

| 消息           | 关键字段                                                | 说明                                           |
| -------------- | ------------------------------------------------------- | ---------------------------------------------- |
| `start`        | `ssh`、`rules[]`                                        | 建立会话并绑定全部规则；同会话重启必须递增代次 |
| `addRules`     | `rules[]`                                               | 向同代次活动会话增量绑定规则                   |
| `removeRule`   | `ruleId`                                                | 解绑单条规则并回收其监听与连接                 |
| `authResponse` | `challengeId`、`answers[]`（≤ 32 项，每项 ≤ 8192 字符） | keyboard-interactive 挑战应答                  |
| `closeSession` | —                                                       | 取消并等待会话清理（远端解绑、SSH 断开均有界） |

`ssh`：`host`、`port`、`username`、`expectedHostFingerprint`（`SHA256:` 前缀 +
64 位十六进制），凭据四选一（`password` / `privateKey`+`passphrase` /
`agentPath` / `keyboardInteractive: true`），另含可选 `proxy` 与
`proxyRequired`。

规则：`id`、`type`（`local` / `remote` / `dynamic`）、`listenHost`、
`listenPort`；非 dynamic 另需 `targetHost`、`targetPort`。单次提交 ≤ 100 条。

响应（stdout）：

- `ready`：`prototype`、能力列表（`local`、`remote`、`socks5`、`closeSession`、
  `generation`、`addRules`、`removeRule`、`keyboardInteractive`、`agent`、
  `connections`）、`maxSessions`、`maxStreamsPerSession`（32）、`maxInputBytes`。
- `result`：请求确认；`start` / `addRules` 附带 `bindings`（实际绑定的
  host/port；远端转发回传服务端分配的端口）。
- `event`：`state: "connections"` 报告某规则活跃连接数变化；会话终结发
  `state: "closed" | "disconnected"`。
- `auth`：keyboard-interactive 挑战（`challengeId`、`name`、`instructions`、
  `prompts[{prompt, echo}]`），随后等待 `authResponse`，最多 8 轮。
- `error`：`errorCode`（`INVALID_REQUEST`、`INVALID_CONFIG`、`BUSY`、
  `STALE_GENERATION`、`IDENTITY_LIMIT`、`UNSUPPORTED_REQUEST`、`CONNECT_FAILED`、
  `CONNECT_TIMEOUT`、`HOST_KEY_MISMATCH`、`ALGORITHM_UNSUPPORTED`、`AUTH_FAILED`、
  `AGENT_UNAVAILABLE`、`INVALID_KEY`、`PROXY_REQUIRED`、`CANCELLED`、
  `DISCONNECTED`）；`CONNECT_FAILED` / `DISCONNECTED` 标记 `retryable: true`。

## 行为要点

- 认证顺序：`none` → `password` → `privateKey`（+passphrase）→ `agent`
  （Windows：Pageant 或命名管道；Unix：UDS）→ `keyboard-interactive`。
  凭据只经 stdin 进入，不进命令行、事件或日志；诊断写 stderr。
- 主机指纹：仅接受与 `expectedHostFingerprint` 一致的服务器密钥，
  不匹配即 `HOST_KEY_MISMATCH`，指纹由 JS 侧既有信任来源下发。
- 算法：现代默认之上追加终端既有兼容集（5 种旧 MAC、2 种 AES-GCM 名称、
  CBC/3DES、DSA、GEX 等），仅影响转发协商，不改变其他 sidecar 策略。
  互操作矩阵见 `scripts/check-port-forwarding-algorithms.js` 及真实 OpenSSH
  验证（`scripts/verify-port-forwarding-openssh.js`）。
- 资源上限：会话数（原型 4 / 正式 32）、每会话并发流 32（超限丢弃新
  连接）、身份墓碑 4096、会话命令队列 16；父进程停止读取时 stdout 写入
  2s 超时后退出，不遗留转发资源。
- 代理：经 `shared::network` 的 HTTP CONNECT / SOCKS 隧道；`proxyRequired`
  时无可用代理即 `PROXY_REQUIRED`，不静默直连。
- SSH 参数：窗口 256 KiB、最大包 32 KiB、channel 缓冲 16、keepalive 5s
  （`keepalive_max` 3）、`nodelay`；双流复制使用 32 KiB 有界缓冲。
- stdin EOF 或进程退出前取消全部会话并等待清理完成。

## 契约检查

`scripts/check-port-forwarding-sidecar.js`（原型进程 + 回环 SSH/TCP）、
`check-port-forwarding-client.js`、`check-port-forwarding-service.js`、
`check-port-forwarding-algorithms.js`、`check-port-forwarding-delete.js`、
`check-port-forwarding-ipc.js`、`check-port-forwarding-renderer.js` 与
`benchmark-port-forwarding.js`（同机吞吐对照，结果为本地工件，不随仓库归档）。
