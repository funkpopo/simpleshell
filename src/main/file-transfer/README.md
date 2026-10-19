# 文件传输服务边界

`filemanagementService.js` 保留公开命令、传输注册表和生命周期状态，组合
`domains/` 中的任务注册/取消、进度事件、进程池与运行指标、远端目录扫描、
续传恢复、批任务、单文件/多文件/目录下载、上传执行和上传来源选择模块。
每个模块接收明确命名的状态和命令，传输身份、缓存、任务队列不重复存储。
底层网络操作仍通过原生 SFTP 服务执行，现有调用接口保持一致。

`tests/integration/sftpRecovery.test.js` 使用真实本地 SSH/SFTP 服务验证
中断、重试、续传、校验、目录操作和取消；`npm run test:integration` 统一运行。

## 文件传输完整性基线（Phase 0 冻结）

> 来源：`transferIntegrity.js` → `resumableTransfer.js` 调用链核对，日期 2026-09-22。

## 需要保持的行为

### `hashLocalFile(localPath, algorithm, { signal, segmentOffset, segmentLength })`

- 返回值：小写十六进制摘要字符串（`crypto` digest `"hex"`）。
- 算法：仅 `md5`、`sha256`；其他值抛 `errorKind: "validation"`、`retryable: false` 的错误。
- 区间语义：`segmentOffset` 默认 0；`segmentLength` 缺省时读到文件末尾；允许空文件与零长度区间。
- 校验失败：非普通文件、负数、非安全整数、`segmentOffset + length > size` 抛
  `"Invalid local checksum range"`（普通 Error，无 errorKind）。
- 提前 EOF：实际读取字节数 ≠ 请求长度时抛 `"Checksum source truncated while reading"`。
- 源文件变化：读取前后 size/mtime 变化时抛 `errorKind: "source-changed"`、`retryable: false`。
- 取消：`signal.throwIfAborted()` 在读取前检查；`createReadStream` 传入 `signal` 支持读取中取消。

### `verifyTransfer({...})`

- 双端并发求和：本地 `hashLocalFile` + 远端 `nativeSftpClient checksumFile`
  （`Promise.allSettled`，任一失败抛出该错误）。
- 返回结构：`{ algorithm, localHash, remoteHash, verified }`。
- 摘要不一致：抛 `errorKind: "integrity-mismatch"`、`retryable: false`，消息含双端摘要。
- 取消：`signal` 同时终止本地读取与远端子进程（`onSpawn` 后 `child.kill()`）。

### `resumableTransfer.js` 依赖点

- 续传区间校验调用 `hashLocalFile(localPath, algorithm, { segmentOffset, segmentLength })`。
- 完整性不一致后仅整文件重传一次；取消语义依赖 `signal` 透传。
- `transferResume.js` 的 `transferIdentity()`（对方向/路径/连接短 JSON 的 SHA-256）
  与 manifest 版本保持 JS 侧实现，不迁移。

## 错误分类汇总

| 错误                | errorKind          | retryable |
| ------------------- | ------------------ | --------- |
| 不支持的算法        | validation         | false     |
| 非法区间/非普通文件 | （无，普通 Error） | -         |
| 源文件被截断        | （无，普通 Error） | -         |
| 源文件变化          | source-changed     | false     |
| 双端摘要不一致      | integrity-mismatch | false     |
