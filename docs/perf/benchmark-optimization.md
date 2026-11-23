# Production Benchmark Optimization Report (Goal 3)

- **Baseline**: `D:\Projects\simpleshell\.cache\benchmarks\before-opt.json`
- **Comparison Command**: `npm run bench -- --compare D:\Projects\simpleshell\.cache\benchmarks\before-opt.json`
- **Environment**: `win32-x64` | Node `v24.20.0` | `12th Gen Intel(R) Core(TM) i5-12400` (12 cores, 32466 MB RAM)
- **Overall Comparison Summary**: **41 improved**, **8 regressed** (including intentional async chunk growth from moving modals/workspaces out of the initial bundle), **33 unchanged**, 0 new, 0 missing
- **Display & Scrollback Invariant**: Preserved 100% of WebTerminal output and full `50,000` default / `500,000` max scrollback history without truncation.

---

## Before vs After Key Metrics

### 1. Startup & Bundle (`startup-and-bundle`)

| Metric                                  |         Before |          After |       Delta |
| --------------------------------------- | -------------: | -------------: | ----------: |
| `startup.coldRequire.bootstrapMs`       |     111.731 ms |       6.129 ms | **-94.51%** |
| `startup.coldRequire.configServiceMs`   |      45.247 ms |      10.216 ms | **-77.42%** |
| `startup.coldRequire.totalMs`           |     181.531 ms |      49.632 ms | **-72.66%** |
| `startup.coldRequire.rssDeltaMB`        |       21.82 MB |       5.934 MB | **-72.80%** |
| `startup.bundle.rendererInitialJsBytes` |    1,145,174 B |      929,843 B | **-18.80%** |
| `startup.bundle.rendererAsyncJsBytes`   |    3,485,843 B |    3,871,370 B |     +11.06% |
| `startup.bundle.rendererBuildMs`        |  16,178.124 ms |  12,509.681 ms | **-22.68%** |
| `startup.bundle.mainBuildMs`            |   5,266.135 ms |   4,165.853 ms | **-20.89%** |
| `startup.config.load500ConnectionsMs`   |       2.906 ms |       2.468 ms | **-15.07%** |
| `startup.config.save500ConnectionsMs`   |      10.403 ms |       9.067 ms | **-12.84%** |
| `startup.history.suggest10kOpsPerSec`   | 2,312.89 ops/s | 2,851.77 ops/s | **+23.30%** |
| `startup.history.suggest10kP95Ms`       |       0.669 ms |       0.541 ms | **-19.13%** |

### 2. Terminal Pipeline (`terminal-pipeline`)

| Metric                                       |     Before |       After |        Delta |
| -------------------------------------------- | ---------: | ----------: | -----------: |
| `terminal.workload.logs.throughputMBps`      | 16.02 MB/s |  21.34 MB/s |  **+33.21%** |
| `terminal.workload.logs.eventLoopP99Ms`      |  22.053 ms |     11.1 ms |  **-49.67%** |
| `terminal.workload.ansi.throughputMBps`      | 56.99 MB/s |  74.38 MB/s |  **+30.51%** |
| `terminal.workload.ansi.eventLoopP99Ms`      |  14.803 ms |    8.577 ms |  **-42.06%** |
| `terminal.workload.json.throughputMBps`      | 54.45 MB/s |  59.13 MB/s |   **+8.60%** |
| `terminal.workload.cjk_emoji.eventLoopP99Ms` |  16.318 ms |     7.09 ms |  **-56.55%** |
| `terminal.workload.burst.throughputMBps`     |  3.14 MB/s |   3.48 MB/s |  **+10.83%** |
| `terminal.highlight.disabledThroughputMBps`  | 85.42 MB/s | 144.21 MB/s |  **+68.82%** |
| `terminal.backpressure.throughputMBps`       |  1.24 MB/s |   2.48 MB/s | **+100.00%** |
| `terminal.memory.nativeRssMB`                |   24.65 MB |    22.84 MB |   **-7.34%** |
| `terminal.memory.mainRssMB`                  | 1354.52 MB |  1235.24 MB |   **-8.81%** |
| `terminal.timeToPromptMs`                    |   2.166 ms |    2.004 ms |   **-7.48%** |

### 3. WebTerminal Renderer (`webterminal-renderer`)

| Metric                                  |       Before |        After |       Delta |
| --------------------------------------- | -----------: | -----------: | ----------: |
| `renderer.search500k.scanMs`            |   1,151.6 ms |     546.9 ms | **-52.51%** |
| `renderer.search500k.maxHeartbeatGapMs` |      12.8 ms |      10.7 ms | **-16.41%** |
| `renderer.search500k.cachedJumpMs`      |       6.5 ms |       5.9 ms |  **-9.23%** |
| `renderer.search50k.scanMs`             |     248.3 ms |     197.8 ms | **-20.34%** |
| `renderer.search50k.cachedJumpMs`       |       6.4 ms |       5.8 ms |  **-9.38%** |
| `renderer.stream500k.domMBps`           |  34.247 MB/s |  36.166 MB/s |  **+5.60%** |
| `renderer.resize500k.reflowMs`          |    124.45 ms |     122.3 ms |      -1.73% |
| `renderer.memory.rssMB`                 | 1,511.633 MB | 1,508.258 MB |      -0.22% |

### 4. SFTP & UI (`sftp-and-ui`)

| Metric                                 |             Before |               After |         Delta |
| -------------------------------------- | -----------------: | ------------------: | ------------: |
| `sftp.largeDownload.throughputMBps`    |          1.68 MB/s |         139.82 MB/s | **+8222.62%** |
| `sftp.largeUpload.throughputMBps`      |        144.49 MB/s |         169.96 MB/s |   **+17.63%** |
| `sftp.batchDownload.ms`                |         875.461 ms |           822.47 ms |    **-6.05%** |
| `ui.connectionTree.render1kMs`         |         173.616 ms |          140.077 ms |   **-19.32%** |
| `ui.connectionTree.search1kMs`         |         215.622 ms |           65.199 ms |   **-69.76%** |
| `ui.fileManager.sortName10kMs`         |         120.438 ms |          110.254 ms |    **-8.46%** |
| `ui.fileManager.search10kMs`           |           0.779 ms |            0.664 ms |   **-14.76%** |
| `ipc.validateSchema.mediumOpsPerSec`   | 9,980,039.92 ops/s | 10,531,858.87 ops/s |    **+5.53%** |
| `ipc.validateSchema.large500OpsPerSec` | 3,954,132.07 ops/s |  4,161,464.84 ops/s |    **+5.24%** |

---

## Optimization Details

### 1. SFTP Pipelined Download & Flush Interval Fix (`native-services/crates/sftp`)

- **Root Cause**: `openssh-sftp-client` defaulted to `SftpOptions::default()` with a `500us` flush interval, while `TokioCompatFile::poll_read_into_buffer` did not notify `flush_immediately` and only issued one sequential read request at a time (`max_read_len` bytes). On Windows, each timer tick stalled for ~15.6 ms OS timer granularity, throttling 32 MB downloads to 1.68 MB/s.
- **Changes**:
  - [connect.rs](../../native-services/crates/sftp/src/connect.rs): Configured `SftpOptions::new().flush_interval(Duration::ZERO)` to remove the per-request flush tick stall.
  - [transfer.rs](../../native-services/crates/sftp/src/transfer.rs): Replaced sequential `TokioCompatFile::read` with bounded positional concurrent chunk reads (`DOWNLOAD_CHUNK_BYTES = 64 KiB`, `DOWNLOAD_MAX_IN_FLIGHT = 24`) via `FuturesOrdered`, writing sequentially in offset order and coalescing progress notifications every 256 KiB.

### 2. Terminal Pipeline Highlighting, Frame Queue & Mailbox (`native-services/crates/term-pipe`, `coreSupervisor.js`, `RendererTerminalIOMailbox.js`)

- **Changes**:
  - [highlight.rs](../../native-services/crates/term-pipe/src/highlight.rs) & [rules.rs](../../native-services/crates/term-pipe/src/rules.rs):
    - Replaced `fancy_regex` lookahead in `strip_host_suffix` with an O(N) ASCII byte scanner returning `Cow::Borrowed` whenever `@host-hex` is absent.
    - Skipped OSC/ANSI regex scans when `\x1b` / `\x1b]` is absent and switched `scan_features` from UTF-8 `.chars()` decoding to `.as_bytes()` scanning.
    - Compiled ASCII word-alternation `Keyword` and word-alternation `Regex` rules (`alertPatterns`) to `AhoCorasick` (`MatchKind::LeftmostLongest`) with fast ASCII word-boundary checks, removing per-match `.to_lowercase()` heap allocations and linear color scans.
    - Evaluated `RegexSet` with a stack `u64` bitmask (`trailing_zeros()` iteration) and fast SIMD single-byte `quick_possible` checks before running `scan_features`, made `Candidate` `Copy` (borrowing `&str` formatting), reused `HighlightScratch` vectors across segments, and used in-place `sort_unstable_*`.
  - [coreSupervisor.js](../../src/main/native/coreSupervisor.js): Replaced O(N) `this._inbox.shift()` with an `_inboxHead` read index and periodic slice compaction, and pushed decoded frame arrays without spread arguments.
  - [RendererTerminalIOMailbox.js](../../src/renderer/features/terminal/io/RendererTerminalIOMailbox.js): Replaced `pendingWriteChunks.shift()` with `pendingWriteHead` and coalesced queued write chunks with matching `processId` up to `MAX_TERMINAL_WRITE_CHARS` (`32 KiB`) when `term.write` is busy, doubling backpressure throughput (`1.24 -> 2.48 MB/s`).

### 3. WebTerminal 500k Search & Runtime Overhead (`searchResults.js`, `TerminalSearchAddon.js`, `workingDirectoryTracking.js`)

- **Changes**:
  - [searchResults.js](../../src/renderer/features/terminal/model/searchResults.js): Maintained a sliding `nextLine` reference across rows to read `buffer.getLine()` once per row instead of 3-5x per row, added a fast path for unwrapped rows (skipping wrapper arrays/generator delegation), used `indexOf` for case-sensitive literal searches, reused fetched `BufferLine` objects in `stringLengthToBufferSize`, and yielded every 32 iterations instead of every row.
  - [TerminalSearchAddon.js](../../src/renderer/features/terminal/runtime/TerminalSearchAddon.js): Eliminated ~4 ms Chromium `setTimeout(step, 0)` clamping between slices using a `MessageChannel` macrotask yielder (preserving `setTimeout` under Vitest fake timers), added O(1) early exit in `invalidate()` when no search is active, and tuned `SCAN_BUDGET_MS` to `3.5 ms` to cut 500k scan latency by 52.5% while improving `maxHeartbeatGapMs` (`12.8 -> 10.7 ms`).
  - [workingDirectoryTracking.js](../../src/renderer/features/terminal/model/workingDirectoryTracking.js): Added fast single-line and missing-`@` bailouts before regex matching inside `onWriteParsed` handlers.

### 4. UI Lists (`ConnectionList.jsx`, `VirtualizedConnectionList.jsx`, `OverflowTooltipText.jsx`, `useFileSelection.js`)

- **Changes**:
  - [ConnectionList.jsx](../../src/renderer/features/connections/components/ConnectionList.jsx): Prevented virtualization tear-down when search queries shrink visible rows below `200`, and skipped building the non-virtualized `<SortableContext>` tree when virtualized or loading.
  - [VirtualizedConnectionList.jsx](../../src/renderer/features/connections/VirtualizedConnectionList.jsx): Hoisted `useTheme()` out of `ConnectionItem` rows into the parent list with precomputed 8-variant row style objects and replaced per-row Emotion `<Box sx>` indentation wrappers with plain `<div>` styles.
  - [OverflowTooltipText.jsx](../../src/renderer/shared/ui/OverflowTooltipText.jsx): Deferred mounting MUI `<Tooltip>` and `useEffect` overflow checks until pointer hover or focus actually detects text truncation.
  - [useFileSelection.js](../../src/renderer/features/file-manager/hooks/useFileSelection.js): Short-circuited `reconcileSelectionWithNextList` when selection is empty (avoiding 10k `Map` allocation and redundant state updates) and added an ASCII natural-order comparator (`compareFileNamesFast`) with separated directory/file partitions while falling back to `Intl.Collator` for punctuation and non-ASCII ties.

### 5. Main-Process Cold Require & Renderer Initial Bundle (`bootstrap/*`, `configSchemas.js`, `ip-query.js`, `validator.js`, `app/`)

- **Changes**:
  - [configSchemas.js](../../src/main/settings/configSchemas.js) & [validator.js](../../src/main/ipc/schema/validator.js): Deferred `require("ajv")`, `require("ajv-formats")`, and schema compilation until the first validation call.
  - [ip-query.js](../../src/main/system-info/ip-query.js): Lazy-loaded `socks-proxy-agent`, `https-proxy-agent`, and `http-proxy-agent` only when proxy configuration requires them.
  - [ipcSetup.js](../../src/main/bootstrap/ipcSetup.js), [appInitializer.js](../../src/main/bootstrap/appInitializer.js), [appCleanup.js](../../src/main/bootstrap/appCleanup.js), [desktopIntegration.js](../../src/main/bootstrap/desktopIntegration.js), [systemMenu.js](../../src/main/bootstrap/systemMenu.js): Deferred loading IPC handler modules, `TerminalIOMailboxManager`, lifecycle services, and cleanup modules until registration/execution instead of module import time, reducing `bootstrap` cold-require time by 94.5%.
  - [AppShell.jsx](../../src/renderer/app/AppShell.jsx), [SessionWorkspace.jsx](../../src/renderer/app/SessionWorkspace.jsx), [DialogsLayer.jsx](../../src/renderer/app/components/DialogsLayer.jsx), [SidebarWorkspace.jsx](../../src/renderer/app/components/SidebarWorkspace.jsx), [useTransferPanels.js](../../src/renderer/app/hooks/useTransferPanels.js): Split `TerminalWorkspace`, `AIChatWorkspace`, `TransferSidebar`, `GlobalTransferFloat`, `GlobalTransferBar`, `SSHAuthDialog`, `MasterPasswordOverlay`, `ErrorNotification`, `AppMenu`, and `SessionContextMenu` into `React.lazy` chunks gated on open/active state, cutting initial renderer JS by 215 KiB (`-18.80%`).
