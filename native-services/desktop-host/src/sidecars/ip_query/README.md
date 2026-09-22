# ip-query-serve sidecar（Phase 4）

IP 归属查询长驻 sidecar：供应商竞速、内存缓存、代理支持从 JS
`src/main/system-info/ip-query.js` 迁移而来。JS 保留外部接口
`queryIpAddress(ip, logger, proxyConfig)`、私有/保留 IP 前置校验与本地化消息；
sidecar 失败时回退到保留的 JS 实现（`SIMPLESHELL_IPQUERY_BACKEND=js` 可强制）。

## 协议（NDJSON，camelCase）

请求（stdin）：

| 消息          | 字段                                              | 说明                                       |
| ------------- | ------------------------------------------------- | ------------------------------------------ |
| `query`       | `requestId`、`ip`（空串=本机出口）、`proxy?`      | 供应商竞速 + 缓存；查询并发执行            |
| `updateProxy` | `proxy?`、`revision?`                             | 代理快照原子更新，版本号参与缓存键         |
| `updateKeys`  | `keys`（供应商名→密钥）、`revision?`              | 密钥经 stdin 更新；不落盘、不记录含密钥 URL |
| `cancel`      | `queryId?`（缺省=取消全部在途）                   | 幂等；取消候选请求与竞速                   |
| `close`       | `requestId?`                                      | 确认                                       |

响应（stdout）：

- `ready`：`schemaVersion: 1`、`capabilities`、`cacheTtlMs`、`cacheMax`。
- `event` + `kind: "result"`：`requestId`、`result`（`{ret:"ok",data}` 或
  `{ret:"failed",msg}`）、`cached`、`stale`、`provider?`。
- `result` 确认：`requestId`、`acknowledged`（更新/取消类）。
- `event` + `kind: "error"`：`errorCode: IP_QUERY_INVALID_REQUEST`（请求解析失败）。

## 缓存（P4.4）

- 键：`{查询IP}|p{代理版本}|k{供应商配置版本}`——代理切换后版本变化，
  避免继续返回旧出口的「本机 IP」。
- 容量默认 200（`IPQUERY_CACHE_MAX`）、TTL 默认 5 分钟（`IPQUERY_CACHE_TTL_MS`）。
- LRU 淘汰；SWR：过期后先返回旧值（`stale: true`）并触发后台刷新，
  同键仅允许一次在途刷新；刷新完成时按当前版本写回，
  失败不替换仍可用的成功条目。

## 竞速（P4.3）

- 候选来自固定供应商表（≤ 11 个，并发有界），每个候选 5s 超时，
  整体 8s 总截止时间；首个成功胜出并取消其余候选。
- own 路径：先竞速 own 供应商，全部失败则先取出口 IP（api.ip.sb /ip）
  再查归属（与 JS getPublicIp 回退一致）。
- 密钥供应商（ip2location.io）仅在 `updateKeys` 下发密钥后启用。

## 代理（P4.5）

- `http`/`https` 标签：普通 HTTP CONNECT（无 TLS 到代理，与 JS 一致）；
  `socks5`：本地 DNS（`socks5://`，与 JS SocksProxyAgent 默认一致）；
  `socks4`：不受支持——明确报错，不静默直连。
- 无代理时显式直连（`no_proxy`，不读取环境代理）。

## 测试钩子

- `IPQUERY_TEST_ORIGIN`：将供应商 URL 重写到本地 HTTP fixture
  （保留路径，附加 `__provider={name}` 查询参数），供
  `scripts/check-ip-query-sidecar.js` 在无公共 API 依赖下验证 transform、
  竞速、缓存与取消。
