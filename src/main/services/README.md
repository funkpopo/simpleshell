# 网络延迟服务基线（Phase 0 冻结）

> 来源：`networkLatencyService.js`、`networkQuality.js` 行为核对，日期 2026-09-22。

## Phase 2：原生探测执行

探测执行入口已替换为原生 `latency-serve` sidecar（`src/main/native/nativeLatencyClient.js`）：

- `measureLatency()` 优先调用原生探测；回退链为 原生 → JS TCP（直连/代理）→ SSH exec。
- 取消、连接注销、服务停止、过时代次不触发回退；`busy` 交回 JS 重新调度，不计为质量失败。
- 代理解析复用 `resolveNativeSidecarNetworkPath()`（`strictProxy: true`，要求代理但解析失败返回错误，不绕过代理）。
- 连接注销、连接替换、代理变更和 `stop()` 均取消关联请求；`latencyHandlers.cleanup()` 关闭服务。
- Rust 侧契约见 `native-services/desktop-host/src/sidecars/latency/README.md`；行为检查见 `scripts/check-latency-sidecar.js`。

## JS 保留的能力（不迁移）

- 连接注册/注销：`registerSSHConnection`、`registerMoshConnection`、`unregisterConnection`。
- 1 秒调度器（`schedulerIntervalMs: 1000`），按质量调整检测周期（`getCheckIntervalForQuality`）。
- 历史数据（最近 10 次）、`serviceGeneration` 代次检查、`latencyData` Map。
- 全部质量算法（`networkQuality.js`）。
- Mosh：仅被动分发状态（`running/roaming/exited`），不执行 SSH/TCP 探测。
- SSH exec 回退 `_measureLatencyViaSshExec()`（`echo latency_test`）。

## 对外事件（需保持字段）

- `latency:updated`：`{ tabId, latency, host, port, lastCheck, timestamp, status, quality, qualityLevel }`。
- `latency:error`：`{ tabId, error, host, port, lastCheck, timestamp, quality, qualityLevel }`。
- `latency:disconnected`：`{ tabId }`。
- `service:started` / `service:stopped`。

## 测量来源（三种，需区分）

| 来源          | 计时起点       | 说明                                 |
| ------------- | -------------- | ------------------------------------ |
| `tcp`         | `net.connect`  | 直连 TCP 三次握手完成即 RTT，5s 超时 |
| `proxy-tunnel`| 代理隧道建连   | 含代理握手往返，5s 超时              |
| `ssh-exec`    | SSH exec 回退  | 兼容旧逻辑；TCP/代理探测失败才回退   |

- 计时使用 `performance.now()`（单调时钟），不是墙上时钟。
- 代理解析：`proxyManager.resolveProxyConfigAsync`；Mosh 分支不进入测量。
- 迁移目标：隔离主进程忙碌对探测回调的影响；1 秒调度器、质量计算、SSH exec 回退继续由 JS 持有。

## 取消与生命周期

- `stop()`：清除调度器、重置代次、清空 `latencyData`。
- 连接重复注册：先注销旧连接。
- 代次检查：迟到结果不更新新会话（`serviceGeneration !== checkGeneration` 丢弃）。
