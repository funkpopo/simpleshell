# 终端 ZMODEM 字节路径基线（Phase 0 冻结）

> 来源：`sshHandlers.js` → `feedOutput()` → 解码/mailbox 链路核对，日期 2026-09-22。

## 需要保持的字节路径

1. SSH 流 `data` → `zmodemTransferService.feedOutput(processId, chunk, context)`（同步返回
   可透传的 `Buffer`）。
2. 透传字节进入主进程输出缓冲（环形缓冲，`MAX_BUFFER_SIZE` 溢出保留最近数据并累计丢弃字节）。
3. 达到 `flushThresholdBytes` 立即 flush，否则 `flushIntervalMs` 微批处理。
4. flush 时经 `StringDecoder("utf8")` 解码 → `transformOutput` → `emitOutput`（mailbox 或直接 IPC）。

## ZMODEM 检测行为（需保持）

- 起始序列：`**\x18B0` + 类型字符（`0`=ZRQINIT 下载、`1`=ZRINIT 上传、`2`=ZSINIT 会话内）。
- 检测模式：仅扣留「构成起始序列前缀」的尾部字节（跨块处理），其余立即放行；
  空闲 `SCAN_TAIL_FLUSH_DELAY_MS: 500ms` 后冲刷扣留字节。
- 会话模式：全部字节交给协议状态机，不进入终端渲染。
- 取消序列：5×CAN + 5×BS。
- 进度节流 150ms、会话空闲超时 45s、watchdog 5s。
- 终端字节始终保持为 `Buffer`；`emitZmodemTerminalText` 注入状态提示（不参与背压统计）。

## 取消行为

- 用户取消/对话框取消/远端取消/空闲超时/标签关闭/SSH 断开/应用退出均终止会话。
- 会话结束后自动恢复透传。

## 性能基线（Phase 0 测量）

见 `docs/migration-baseline.md`。

# native 后端（Phase 3，P3.9 起为唯一后端）

## 后端说明

- P3.9 起协议状态机完全由 Rust sidecar `zmodem-serve` 承担（真实 SSH 下
  `rz`/`sz` 手工互操作验证已通过），旧的 JS `zmodem2` 状态机路径与
  `SIMPLESHELL_ZMODEM_BACKEND` 切换入口已移除。
- `zmodem2` 从 dependencies 移到 devDependencies：运行时（src/main）不再引用，
  仅 `scripts/check-zmodem-sidecar.js` 用其 Receiver/Sender 作为协议一致性
  检查的互操作对端。
- 上文「ZMODEM 检测行为（需保持）」的字节路径语义由 sidecar 实现
  （检测、透传、取消序列、进度节流与超时常量在 sidecar/编排器中保持一致）。

## native 会话契约（sidecar 侧详见 native-services/desktop-host/src/sidecars/zmodem/README.md）

- `feedOutput()` 在 native 后端下**始终同步返回空 Buffer**；透传字节经
  `context.onRawOutput(Buffer)` 回调进入同一解码/输出缓冲管线，保持字节归属与顺序。
- `context.onBackpressure(paused)`：sidecar 未决字节（输入队列 + writeRemote 队列）
  超过会话预算 2 MiB 时暂停 SSH 流读取（独立 `zmodem` 暂停原因，经由
  `terminalIOMailboxManager.pause/resume`，单次恢复不清除 renderer 等其他原因），
  回落到恢复水位 1 MiB 以下时恢复。
- `writeRemote` 遵守 SSH writable 背压：`stream.write()` 返回 false 时排队，`drain` 后续发。
- 未决字节统计可经 `zmodemTransferService.getHeldBytes(processId)` 查询，
  由 `sshHandlers` 计入 mailbox 背压缓冲统计。
- 事件映射：sidecar `intro/offer/progress/fileDone/done/cancelled/error`
  → 现有 IPC `start/offer/progress/file-done/end`（事件名与旧实现完全兼容）。
- 下载：sidecar `offer(awaitingAccept)` → JS 校验名称（路径分隔符/`..`/空名拒绝）、
  `uniqueSavePath` 唯一化目标 → `acceptFile` 回复；Rust 仅写入 JS 授权路径。
- 上传：JS 文件选择对话框 → `sendFiles`（授权路径+名称+大小）。
- 取消：JS 发 `cancel` → sidecar 先向远端发送 5×CAN + 5×BS 序列，
  再结束本端会话并回报 `cancelled` 事件。
- sidecar 进程崩溃：终结所有 native 会话（`end` 事件 status=error），
  释放 `zmodem` 暂停原因；重启只服务新会话，旧进程事件按 sessionId 丢弃。
