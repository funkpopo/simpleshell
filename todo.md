# SimpleShell 项目保守化设计 TODO

> 目标：在保留当前 Electron/React 主体与 Rust transfer-sidecar 优势的前提下，把项目进一步收敛为一个更保守、可审计、可恢复、默认安全的运维工具。

## 完成记录

- [x] 2026-06-21：已实现 1.1/1.2/1.3 的首轮落地：sidecar 继续作为独立进程边界，SFTP 请求/进度/结果/watch 输出补齐 `schemaVersion`、`requestId`、`processType`、`operation` 元数据，扫描结果补齐 `scanId`、`rootPath`、`generatedAt`、`truncated`、`maxEntriesHit`、`maxDepthHit`、`maxBytesHit`、`errors` 等 manifest 字段，并在 JS wrapper/service 层保留这些字段。
- [x] 2026-06-21：已调整文件管理侧边栏按钮触发机制：文件按钮不再只判断当前 tab 是否为 SSH，而是必须等待该 SSH tab 的主进程连接状态为 `isConnected=true` 且 `isConnecting=false` 后才可点击；连接失败、未就绪或断开时会禁用文件按钮，并阻止打开/继续展示文件管理侧边栏。
- [x] 2026-06-22：已实现 2.1：主 SSH hostVerifier 确认后的 `SHA256:` 主机指纹会写入主进程内部信任状态，native SFTP/传输请求必须携带同一可信指纹；Rust sidecar 删除 `AcceptAnyServerKey`，握手时计算服务端公钥 SHA256 指纹并严格比对，缺失或不匹配时返回 hostKey 分类错误。

## 0. 当前项目判断

SimpleShell 当前主体是 Electron 主进程 + React 渲染进程 + Node 工具层，终端连接、配置、IPC、安全边界和 UI 都集中在 JS 侧；Rust sidecar 位于 `transfernative/transfer-sidecar`，主要承担本地目录扫描、SFTP 文件操作、上传/下载传输、远程目录扫描与目录轮询监听。

当前已经具备的稳健基础：

- 主窗口安全边界较明确：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、生产 CSP、禁止任意导航、外链协议白名单。
- IPC 已有集中 channel 定义、AJV 校验、trace 记录与敏感字段脱敏，适合继续扩展成权限/审计模型。
- 主 SSH 连接池已有主机指纹确认、代理/VPN 支持、重连状态机、健康检查、失败分类和延迟探测。
- 配置服务已支持配置备份、损坏配置恢复、safeStorage/主密码加密、连接密码/私钥路径/API key 加密保存。
- 文件传输层已有 native sidecar 进度流、分段传输、队列/并发控制、取消、运行时统计、外部编辑器临时文件生命周期和崩溃标记。
- 更新服务已限制可信下载域名、校验安装包 hash、限定安装包后缀、使用受控临时目录。

## 1. Rust sidecar 值得继续沿用的设计思路

### 1.1 继续沿用“独立进程能力边界” [x] 已完成首轮落地

现有 `nativeSftpClient.js` 通过 `spawn(sidecarPath, ["sftp-request"])` 或 `["sftp-watch"]` 调用 Rust，这个边界值得保留。

原因：

- 大文件传输、目录扫描、SFTP IO 与 Electron 主进程隔离，降低主进程卡顿和内存膨胀风险。
- 取消传输可以通过杀掉对应 sidecar 子进程实现，语义直接，失败半径小。
- sidecar panic/异常退出可以被主进程捕获并记录 crash marker，便于诊断。

实现延续方向：

- 新增 native 能力时优先走 sidecar 子命令或 JSON-RPC 风格请求，不把高负载 IO 再塞回 renderer 或主进程。
- 对长耗时任务继续使用 stdout JSON Lines：`progress`、`result`、`watch`、`error` 分离。

### 1.2 继续沿用结构化输出与结构化错误 [x] 已完成首轮落地

Rust sidecar 当前返回：

- `type: "progress"`：传输增量进度。
- `type: "result"`：最终结果。
- `type: "watch"`：目录监听事件。
- 错误包含 `errorCode`、`errorKind`、`retryable`、`module`、`operation`、`sidecarVersion`、`platform`、`arch`、`timestamp`。

这套设计适合继续沿用，并扩展为所有 native 操作的统一错误契约。

实现延续方向：

- 在 Rust 侧新增 `schemaVersion`，避免以后错误结构变更时 JS 解析困难。
- 在 JS 的 `buildErrorResponse` / `nativeSftpClient` 中统一映射 native 错误到现有错误分类。
- 所有 native 新操作都必须返回机器可读错误码，UI 文案在 JS/i18n 层翻译，避免 Rust 输出直接成为用户文案。

### 1.3 继续沿用“本地扫描/远程扫描前置”的传输准备模型 [x] 已完成首轮落地

sidecar 的 `scan-folder` 和 `scanRemoteFolderTree` 先得到文件数量、总字节数、路径列表，再由 JS 侧创建 transfer entry、计算并发与进度，这个思路适合保留。

原因：

- UI 可以提前展示总量和准备状态。
- 传输前能做空间、覆盖、权限、根目录保护等预检。
- 批量任务可拆分为可取消、可统计的任务单元。

实现延续方向：

- 为扫描结果加入 `scanId`、`rootPath`、`truncated`、`maxFilesHit`、`errors` 等字段。
- 对远程扫描加入最大文件数/最大深度/最大总字节保护，确保无论远程目录有多大都可以成功展示。

### 1.4 继续沿用“分段传输 + JS 调度”的大文件策略

当前 sidecar 支持 `segmentOffset`、`segmentLength`、`remoteWriteFlags`、`localWriteFlags`，JS 侧决定是否拆块并发，这个边界清晰。

实现延续方向：

- 保持 Rust 只负责一个确定片段的读写，JS 负责并发数、重试、失败清理、UI 进度。
- 为每个分段增加 `taskId`/`segmentIndex`/`segmentCount` 回传，减少 JS 侧根据 task metadata 反查。
- 传输完成后可选做远端/本地 size 校验。

### 1.5 继续沿用“运行时文件生命周期管理”

`runtimeFileLifecycle` 对 file-cache、file-snapshots、external-editor-temp 等资源做启动恢复、周期清理、active 保护、大小上限清理，这个模型适合推广。

实现延续方向：

- 将 sidecar 临时 manifest、传输断点文件、诊断包草稿都注册为 runtime resource。
- 每类临时文件都定义：rootPath、maxAge、maxBytes、startupCleanup、protectActive。
- UI 设置禁止例如“退出时清理临时文件”“最大缓存大小”等设置。

## 2. 高优先级保守化调整

### 2.1 Rust sidecar 必须补齐 SSH 主机密钥校验 [x] 已完成

当前 Rust sidecar 的 `AcceptAnyServerKey` 会接受任意服务端主机密钥，而主 SSH 连接在 JS 侧已有已知主机指纹缓存和用户确认流程。这会导致终端连接和 SFTP/传输连接的安全语义不一致：用户确认的是主连接，但 sidecar 传输可能接受另一个主机密钥。

建议目标：

- sidecar 可信主机指纹与SSH连接保存的指纹使用一致

### 2.2 Rust sidecar 的代理/VPN 路径要与主 SSH 连接一致

主 SSH 连接池支持连接项代理、默认代理、系统代理/PAC 和 HTTP/SOCKS 隧道；Rust sidecar 当前自己直连 `host:port`，没有继承 JS 的代理路径。这在运维场景中可能导致：

- 终端能连，SFTP 失败。
- 终端走代理/VPN，传输绕过代理直连。
- 审计链路与真实访问路径不一致。

建议目标：

- sidecar 必须明确知道“本次连接是否需要代理”。
- 代理未支持时宁可禁用 native transfer，也不静默直连。

实现思路：

- JS `resolveSshConfig` 中解析 `rawConfig.proxy` 和 `proxyManager.resolveProxyConfigAsync(rawConfig)`，传入 sidecar：
  - `proxy: { type, host, port, username?, password? }`
  - `proxyRequired: boolean`
- 实现 Rust 代理支持：
  - HTTP/HTTPS：实现 CONNECT 后把 socket 交给 russh。
  - SOCKS5/SOCKS4：实现握手或引入成熟 crate。
  - 代理认证字段进入 Rust 结构化配置，但日志必须脱敏。
- 禁止fallback设计

验收标准：

- 配置了代理的连接，native sidecar 不再直连目标 host。
- 代理不可用时错误分类为 proxy/network，可重试但不刷屏。
- 诊断包能显示 sidecar transfer 使用的网络路径：direct/proxy type/source，不记录代理密码。

### 2.4 收紧 IPC schema 与高风险通道权限

IPC schema 已经集中，但仍有较多 `{}`、`ANY_SCHEMA`、宽松 object 参数，尤其是文件、进程控制、批量 invoke、设置和 runtime-files 通道。保守运维工具应尽量避免 renderer 能用任意 payload 触发主进程高权限行为。

建议目标：

- 高风险 IPC 参数必须严格 schema。
- 批量 IPC 禁止调用高风险通道，或需要显式 allowlist。
- 所有文件路径参数做长度、类型、归一化与路径越界约束。

实现思路：

- 将 `IPC_CHANNEL_DEFINITIONS` 中 high-risk/process-control/filesystem/credentials 通道逐步改为严格 schema：
  - `tabId` 统一 `string | number`，但进入 handler 后立即 normalize 为 string。
  - path 字段加 `minLength`、`maxLength`。
  - enum 限制 operation/type/status。
  - 禁止 `additionalProperties: true` 用在高危对象。
- `batchInvokeHandlers` 增加 denylist：
  - 禁止批量调用 `TERMINAL_START_SSH`、`TERMINAL_SEND_TO_PROCESS`、`FILE_DELETE`、`FILE_SET_PERMISSIONS`、`FILE_SET_OWNERSHIP`、`SETTINGS_UNLOCK_CREDENTIAL_STORE`、`APP_INSTALL_UPDATE`。
- `safeHandle` / `wrapIpcHandler` 增加 permission 元数据记录，trace 输出 permission/category。
- 增加检查脚本：高风险通道不得使用 `ANY_ARGS_SCHEMA` 或空 `{}` item。

验收标准：

- `npm run check` 能发现新增的宽松高危 IPC。
- renderer 传入额外字段不会被 handler 隐式使用。
- batch invoke 无法绕过高危操作确认。

### 2.5 sidecar 请求协议增加超时、心跳与资源上限

当前 JS 可杀 sidecar，但 Rust 侧对单次请求本身缺少显式 deadline、最大返回条目、最大扫描深度等参数。对运维工具来说，面对异常远端目录、符号链接、超大目录、慢速链路时应默认保守。

建议目标：

- 每个 native request 都有可见的 deadline 和最大资源消耗边界。
- 长任务必须有心跳，主进程可区分“慢”和“卡死”。

实现思路：

- 扩展 `SftpRequest`：
  - `requestId`
  - `deadlineMs`
  - `maxEntries`
  - `maxDepth`
  - `maxBytes`
  - `emitHeartbeatIntervalMs`
- Rust 用 `tokio::time::timeout` 包裹高风险操作。
- `scan_folder` / `scanRemoteFolderTree` 达到上限时返回：
  - `truncated: true`
  - `truncatedReason`
  - 已扫描统计
- 传输 loop 中定期输出 `type: "heartbeat"`，包含 `requestId`、`operation`、`transferredBytes`。
- JS 侧若 heartbeat 超时，标记 `NATIVE_SFTP_NO_PROGRESS_TIMEOUT` 并终止子进程。

验收标准：

- 扫描百万文件目录不会无限占用内存。
- 远程卡死时 UI 显示“无进度超时”，取消后子进程退出。
- 诊断能看到 requestId、deadline、最后 heartbeat。

## 3. 中优先级功能/设计调整

### 3.1 传输结果增加校验与可恢复策略

当前传输完成主要依赖读写过程成功和字节数统计。保守运维场景中，关键文件传输需要更明确的完整性语义。

实现思路：

- 默认做轻量校验：上传/下载完成后 stat size，size 不一致判失败。
- 可选强校验：
  - 本地 sha256 由 Node/Rust 计算。
  - 远端如果可执行命令，则通过 SSH shell 执行 `sha256sum`/`shasum`/`certutil`，否则提示“不支持远端 hash 校验”。
- 对分段并发上传，失败后清理临时/目标文件，并输出 cleanup 结果。
- 引入 `.simpleshell-transfer.json` manifest，用于断点续传和失败复盘。

### 3.2 文件编辑/外部编辑器默认改为更保守

外部编辑器当前会下载远程文件到本地临时目录、watch 本地改动并自动上传。这个能力很方便，但在运维场景属于高风险自动写回。

建议调整：

- 默认关闭自动上传，改为“检测到变更后提示上传”。
- 提供 per-file 状态：本地已修改、待上传、上传成功、上传失败、远端可能已变化。
- 上传前 stat 远端 mtime/size，如果远端已变化，要求用户选择覆盖/另存/放弃。
- 临时文件目录和文件名继续使用 runtime lifecycle，但打开时显示本地临时路径和清理策略。

### 3.3 AI 能力默认降权，避免直接执行风险命令

项目已有 AI 命令风险等级、执行确认和自定义风险规则，这是值得保留的方向。但保守运维工具中 AI 应默认是解释/建议工具，不应默认进入执行链路。

建议调整：

- 默认隐藏或关闭“直接执行”按钮，只保留复制。
- 高风险/critical 命令必须手动复制，禁止一键执行。
- AI 发送终端上下文前做脱敏预览：
  - IP、主机名、用户名、路径可选脱敏。
  - 识别 password/token/private key 片段并强制遮罩。
- API 配置继续保持 apiKey 不回传 renderer 的设计。
- 增加“离线/禁用 AI 模式”，适合生产堡垒机场景。

### 3.4 组同步命令增加安全阈值

组同步命令适合批量运维，但风险也高。当前 sync group 主要是成员广播，需要加入“影响范围确认”。

实现思路：

- 当 group 成员数 > 1 且命令命中高风险规则时，弹出确认：
  - 显示目标主机列表。
  - 要求输入成员数量或组名确认。
- 支持 per-tab dry-run 标记：只把命令粘贴到终端，不自动回车。
- 审计日志记录 groupId、member tabIds、命令风险等级和确认结果。

### 3.5 连接与凭据策略默认更保守

已有 safeStorage/主密码模式，但默认体验可再向保守运维工具靠拢。

建议调整：

- 首次启动安全向导中明确推荐启用主密码；未启用时显示“使用系统安全存储”的说明。
- 支持空闲自动锁定凭据存储：
  - 例如 15 分钟无操作后 `lockCredentialStore()`。
  - 已建立连接不强制断开，但新建连接/读取 API key 需要解锁。
- “最近连接/热门连接”默认不保存敏感字段，目前已有清空密码逻辑，继续保持。
- 导出诊断包/反馈 issue 前显示敏感信息检查摘要。

### 3.6 Telnet 默认降级为显式不安全协议

Telnet 在运维工具中应被视为 legacy/insecure。

实现思路：

- 新建 Telnet 连接时显示“不加密协议”提示。
- 设置项中提供“允许 Telnet”，默认关闭或首次使用确认。
- 连接列表中对 Telnet 使用明显标记。
- 诊断/日志中标记 protocol=telnet，但不记录密码。

### 3.7 更新机制补齐签名/发布证明

当前更新已经有可信域名、hash、后缀和受控目录，建议进一步增强：

- 优先使用 release asset digest；若 GitHub release 无 digest，要求项目发布 SHA256SUMS 文件。
- 支持签名校验，例如 minisign/cosign/GPG，至少在 release-check 中要求校验材料存在。
- 安装前 UI 显示：
  - 版本号
  - 发布日期
  - asset name
  - sha256 前后 12 位
  - 是否 security update
- Windows/macOS 代码签名状态加入诊断。

## 4. 低优先级但值得排期

### 4.1 sidecar 协议从字符串 operation 迁移到枚举

Rust 当前用 `operation: String` 做 match。可以继续兼容字符串，但内部尽量转为 enum，减少拼写错误和 unsupported 分支遗漏。

实现思路：

- `enum SftpOperation` + `#[serde(rename = "...")]`。
- 解析失败返回 `NATIVE_SFTP_UNSUPPORTED_OPERATION`。
- JS wrapper 继续使用现有字符串，等协议稳定后再集中定义 operation 常量。

## 5. 建议实施顺序

1. 先做 `2.1 sidecar 主机密钥校验` 和 `2.2 sidecar 代理路径一致性`。这是当前 native SFTP 与主 SSH 安全语义不一致的核心问题。
2. 再做 `2.3 高危文件操作 guard` 和 `2.4 IPC schema 收紧`。这两项会把“renderer 只是 UI，主进程负责最终安全决策”的边界固定下来。
3. 然后做 `2.5 sidecar 超时/心跳/资源上限`，提升异常目录和慢链路下的可恢复性。
4. 最后按产品取舍处理 AI 降权、外部编辑器写回策略、Telnet 默认禁用、更新签名等功能策略。

## 6. 不建议改动的方向

- 不建议把 Rust sidecar 合回 Electron 主进程。当前独立进程隔离对稳定性和取消语义有价值。
- 不建议在 renderer 里做最终安全判断。renderer 只能负责展示确认，主进程/sidecar 必须重新校验。
- 不建议为追求传输速度默认打开无限并发。当前按文件数/大小/CPU/会话上限选择并发的方向应保留，最多增加用户可见的“保守/均衡/激进”档位。
- 不建议默认启用 Telnet 或 AI 直接执行命令。它们应作为显式开启的高级功能。
- 不建议让 sidecar 在缺少 host key/proxy 支持时静默 fallback 到不安全直连。保守工具应明确失败并给出可操作提示。
