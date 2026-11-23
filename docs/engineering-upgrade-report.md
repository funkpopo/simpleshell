# SimpleShell Engineering Upgrade Report (Goals 1–7)

- **Repository**: `SimpleShell` (`v0.6.0`)
- **Platform / Toolchain**: `win32-x64` | Electron `40.4.1` | React `19.2.8` | MUI `9.2.0` | Node `v24.20.0`
- **Baseline Benchmark**: `D:\Projects\simpleshell\.cache\benchmarks\before-opt.json`
- **Latest Verification Branch**: `swarm-gap-fixer-f4d8a4e4` (branched from `master` at `8069ae0`)

---

## 1. Executive Summary Across Goals 1–7

| Goal       | Commit           | Scope                            | Key Outcome                                                                                                                                                                                                                                                           |
| ---------- | ---------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Goal 1** | `3ad1513`        | Windows Installer Packaging      | Single-step `npm run make` directly builds Inno Setup installer (`installer/SimpleShell-v0.6.0-Setup-x64.exe`, 97.77 MB) via custom `maker-inno-setup.js` and `installer/simpleshell.iss`.                                                                            |
| **Goal 2** | `5d1084f`        | Development Benchmark Suite      | Added dev-only `benchmarks/` framework (4 suites, 82 metrics) with production leak guards (`benchmarkIsolation.test.js`).                                                                                                                                             |
| **Goal 3** | `8cb346d`        | Performance & 500k Scrollback    | Optimized Rust `sftp` / `term-pipe`, main cold-require startup, IPC validation, 500k scrollback search, connection list rendering, and renderer initial JS bundle without truncating output or scrollback.                                                            |
| **Goal 4** | `8e8e12e`        | Global Settings Exposure         | Modeled and wired hardcoded timeouts, intervals, limits, terminal options, and file-manager/storage/log defaults across `uiSettingsDefaults.js`, `configSchemas.js`, `runtimeSettingsSync.js`, and 7 tabs in `Settings.jsx`.                                          |
| **Goal 5** | `ed73326`        | Competitive Analysis & Roadmap   | Benchmarked SimpleShell against WindTerm, Tabby, Electerm, XPipe, WezTerm, Warp, and Ghostty; authored `docs/competitive-analysis-and-roadmap.md`.                                                                                                                    |
| **Goal 6** | `8069ae0`        | P0 & P1 Competitive Features     | Implemented all 4 P0 items (`P0-1`..`P0-4`) and all 7 P1 items (`P1-1`..`P1-7`), plus `// @ts-check` contracts and MUI v9 `slotProps` compliance.                                                                                                                     |
| **Goal 7** | Gap-Fixer Commit | Audit Fixup & Final Verification | Resolved all 6 `final-auditor` findings (`.gitignore`/diagnostics tracking, theme persistence & i18n, Command Palette template substitution, `render1kMs` & bundle size regressions, shortcut input guards, `terminalFontWeight` schema & 0 i18n hardcoded warnings). |

---

## 2. Goal-by-Goal Technical Summary

### Goal 1 — Single-Step Windows Installer (`3ad1513`)

- Replaced legacy vendor Squirrel packaging (`scripts/prepare-winstaller-vendor.js` removed) with `scripts/makers/maker-inno-setup.js`, `scripts/lib/inno-setup.js`, and `installer/simpleshell.iss`, wired directly into `forge.config.js` (`npm run make`).
- Updated `src/main/update/updateService.js`, `README.md`, `README_zh.md`, and unit tests (`tests/unit/innoSetupMaker.test.js`, `tests/unit/updateLifecycle.test.js`).
- Audited build output on `master` (`8069ae0`): `installer/SimpleShell-v0.6.0-Setup-x64.exe` (97,773,448 B) and `out/SimpleShell-win32-x64/resources/app.asar` (8,217,155 B, 95 files, zero `benchmarks/` or `.map` leaks, locales trimmed to `en-US.pak` + `zh-CN.pak`).

### Goal 2 — Development-Only Benchmark Suite (`5d1084f`)

- Implemented `benchmarks/run.js`, `benchmarks/lib/{env,stats,reporter,loopbackSshServer,loopbackSftpServer,loopbackSshProcess}.js`, `benchmarks/fixtures/webterminal-bench-*`, and 4 suites:
  1. `startup-and-bundle` (26 metrics: webpack initial/async JS, main bundle, cold-require timing & RSS, crypto, config 500-connection save/load, command history compression & 10k suggest).
  2. `terminal-pipeline` (19 metrics: loopback SSH -> Rust `simpleshell-core` `term-pipe` -> mailbox across logs, ANSI, JSON, CJK/emoji, burst, backpressure, memory).
  3. `webterminal-renderer` (18 metrics: real Electron Chromium + `xterm.js` 50k/500k DOM & WebGL streaming, search scan/heartbeat/cached jump, echo, resize reflow, memory).
  4. `sftp-and-ui` (19 metrics: loopback SFTP batch/large transfer, FileCache, 10k file manager sort/search, 1k connection tree dedupe/sort/render/search, AJV IPC schema validation ops/s).
- Verified zero production imports via `tests/unit/benchmarkIsolation.test.js`.

### Goal 3 — Production Performance & 500k Scrollback Preservation (`8cb346d`)

- **Scrollback Invariant Preserved**: `DEFAULT_TERMINAL_SCROLLBACK_LINES = 50000`, `MIN_TERMINAL_SCROLLBACK_LINES = 1000`, `MAX_TERMINAL_SCROLLBACK_LINES = 500000` (`src/shared/domain/terminalScrollback.js`), with zero output truncation.
- **SFTP (`native-services/crates/sftp`)**: Configured `SftpOptions::new().flush_interval(Duration::ZERO)` in `connect.rs` and 64 KiB × 24 concurrent `FuturesOrdered` positional reads in `transfer.rs` with 256 KiB progress coalescing.
- **Terminal Pipeline (`native-services/crates/term-pipe`, `coreSupervisor.js`, `RendererTerminalIOMailbox.js`)**: Replaced `fancy_regex` lookahead with an O(N) ASCII byte scanner (`Cow::Borrowed`), skipped ANSI/OSC scans when ESC is absent, compiled keyword/alert rules to `AhoCorasick` (`LeftmostLongest`) + `u64` `RegexSet` bitmasks, switched `coreSupervisor` and `RendererTerminalIOMailbox` queues to head-index queues, and coalesced buffered writes up to 32 KiB.
- **WebTerminal 500k Search & Tracking**: Sliding `nextLine` row caching and unwrapped-row fast paths in `searchResults.js`; `MessageChannel` slice yielding (with `setTimeout` preserved under fake timers) and O(1) idle `invalidate()` in `TerminalSearchAddon.js`; fast bailouts in `workingDirectoryTracking.js`.
- **Startup & UI Lists**: Lazy-loaded `Ajv` + `ajv-formats` (`configSchemas.js`, `validator.js`), proxy agents (`ip-query.js`), main bootstrap modules (`ipcSetup.js`, `appInitializer.js`, `appCleanup.js`), and renderer dialogs/workspaces (`AppShell.jsx`, `SessionWorkspace.jsx`, `DialogsLayer.jsx`, `SidebarWorkspace.jsx`); optimized `VirtualizedConnectionList.jsx`, `OverflowTooltipText.jsx`, and `useFileSelection.js` (`compareFileNamesFast`).

### Goal 4 — Global Settings Exposure & Consumer Wiring (`8e8e12e`)

Added centralized schema validation, normalization, UI controls (across all 7 tabs of `Settings.jsx`, including the new `ConnectionSftpSettings.jsx`), i18n keys (`zh-CN.json` / `en-US.json`), and live runtime consumers:

| Domain                          | Exposed Settings Keys                                                                                                                                                                                                                                                                                                                                                                           | Primary Consumers                                                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SSH & Network**               | `ssh.{keepaliveIntervalSeconds, keepaliveCountMax, readyTimeoutSeconds, connectionTimeoutSeconds, idleTimeoutMinutes}`                                                                                                                                                                                                                                                                          | `ssh-network-profile.js`, `BaseConnectionPool`                                                                                                                                 |
| **Reconnect & Latency**         | `reconnect.{maxRetries, initialDelayMs, totalTimeCapSeconds, fastReconnectEnabled}`, `networkLatency.checkIntervalSeconds`                                                                                                                                                                                                                                                                      | `ReconnectionManager`, `NetworkLatencyService`                                                                                                                                 |
| **SFTP & File Manager**         | `sftp.{parallelUploads, parallelDownloads, maxRetries, sessionIdleTimeoutMinutes}`, `fileManager.{defaultSortMode, showHiddenFiles, directoryWatchIntervalMs, directoryCacheTtlSeconds, maxPreviewSizeMB}`                                                                                                                                                                                      | `sftpConfig.js`, `sftpSessionPool.js`, `useDirectoryWatch`, `useDirectoryLoader`, `useFileSelection`, `useFilePreview`, `useBinaryPreview`, `TextPreview`                      |
| **Storage & Editor**            | `storage.{fileCacheMaxMB, fileCacheMaxAgeMinutes, snapshotMaxPerFile, snapshotRetentionDays}`, `editorFont`, `externalEditor.{enabled, command, autoUploadDebounceMs}`                                                                                                                                                                                                                          | `fileCache.js`, `fileSnapshotStore.js`, `externalEditorManager.js`, CodeMirror previews                                                                                        |
| **Terminal Appearance & Input** | `terminalCursorStyle`, `terminalCursorBlink`, `terminalLetterSpacing`, `terminalFontWeightBold`, `terminalCopyOnSelect`, `terminalRightClickSelectsWord`, `terminalMiddleClickPaste`, `terminalMacOptionIsMeta`, `terminalScrollbackLines`                                                                                                                                                      | `terminalBootstrap.js`, `useTerminalSettingsSync.js`                                                                                                                           |
| **History, Shells & ZMODEM**    | `commandHistoryMaxSize`, `commandHistoryMinLength`, `commandSuggestionsEnabled`, `commandSuggestionLimit`, `defaultLocalShell`, `zmodem.saveDirectory`                                                                                                                                                                                                                                          | `command-history.js`, `local-terminal-config.js`, `zmodemTransferService.js`, `useTerminalSuggestions.js`                                                                      |
| **App, Monitor, Logs & Perf**   | `updates.{autoCheckOnStartup, reminderIntervalHours}`, `notificationDurationSeconds`, `recentConnectionsLimit`, `resourceMonitor.{displayMode, systemRefreshSeconds, processRefreshSeconds, maxVisibleProcesses}`, `backupRetentionDays`, `logSettings.{maxFiles, compressOldLogs, cleanupIntervalDays}`, `performance.{hardwareAcceleration, webglEnabled, cacheEnabled, terminalPerfMonitor}` | `runtimeSettingsSync.js`, `NotificationContext.jsx`, `ResourceMonitor.jsx`, `remote-system.js`, `logger.js`, `configBackups` (dead `imageSupported`/`prefetchEnabled` removed) |

### Goal 5 — Competitive Analysis (`ed73326`)

- Produced `docs/competitive-analysis-and-roadmap.md` comparing SimpleShell against WindTerm, Tabby, Electerm, XPipe, WezTerm, Warp, and Ghostty across 11 capability dimensions, establishing the 4 P0 and 7 P1 implementation specs.

### Goal 6 — Competitive UX, Security, AI, SFTP & Workflow Parity (`8069ae0`)

| ID     | Feature                                                                                                                                                                                              | Key Modules Implemented                                                                                                                                                                                |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `P0-1` | Global Command Palette (`Ctrl+Shift+P` & header trigger)                                                                                                                                             | `commandPalette.js`, `CommandPaletteDialog.jsx`, `AppShell.jsx`, `SidebarWorkspace.jsx`, `terminalShortcuts.js`                                                                                        |
| `P0-2` | Keyboard-first Tab/Split ergonomics & context actions (`Ctrl+Shift+E/H/W/T`, `Ctrl+Shift+C/V`, `Ctrl+=/−/0`, `Ctrl+Tab`, `Ctrl+1..9`, `Alt+Arrow`, Duplicate/Rename/Close Others/Close Right/Reopen) | `paneLayout.js`, `appReducer.js`, `useSessionTabs.js`, `SessionContextMenu.jsx`, `WebTerminalContextMenu.jsx`, `RenameTabDialog.jsx`, `CustomTab.jsx`, `SidebarRail.jsx`                               |
| `P0-3` | Quick Connect (`user@host[:port]`, `ssh://`, `telnet://`, `[IPv6]:port`), Pin/Favorite, Tags, Color Badges & Duplicate Connection                                                                    | `quickConnect.js`, `quickConnectSession.js`, `ConnectionManager.jsx`, `ConnectionListItems.jsx`, `VirtualizedConnectionList.jsx`, `ConnectionEditorDialog.jsx`, `connectionTree.js`, `WelcomePage.jsx` |
| `P0-4` | Context-aware AI Assistant (active CWD, last command, bounded ANSI-stripped & secret-redacted output + quick chips)                                                                                  | `terminalContextCollector.js`, `workingDirectoryStore.js`, `aiSystemPrompt.js`, `AIChatWindow.jsx`, `ChatComposer.jsx`, `ChatHeader.jsx`, `useChatRequest.js`                                          |
| `P1-1` | Parameterized Shortcut Commands (`{{var}}`, `{{var=default}}`, `{{host}}/{{user}}/{{port}}/{{cwd}}`, Run/Insert mode, tag pills)                                                                     | `commandTemplates.js`, `ShortcutCommands.jsx`                                                                                                                                                          |
| `P1-2` | 10 Curated Terminal Color Schemes + Tab Color Badges                                                                                                                                                 | `terminalThemePresets.js`, `terminalTheme.js`, `TerminalSettings.jsx`, `useTerminalSettingsSync.js`, `SessionTab.jsx`, `CustomTab.jsx`                                                                 |
| `P1-3` | Interactive Multi-Session Broadcast Command Bar                                                                                                                                                      | `BroadcastCommandBar.jsx`, `syncGroupCommandDispatcher.js`, `SessionWorkspace.jsx`                                                                                                                     |
| `P1-4` | SSH `known_hosts` Manager UI & Typed IPC                                                                                                                                                             | `KnownHostsSection.jsx`, `SecuritySettings.jsx`, `sshKeyHandlers.js`, `sshAuthenticationService.js`, `connection.js`, `preload.d.ts`                                                                   |
| `P1-5` | Copy All Output & Scrollback Export (`.log`/`.txt`)                                                                                                                                                  | `terminalBufferExport.js`, `WebTerminalContextMenu.jsx`, `SessionContextMenu.jsx`, `terminalHandlers.js`, `terminal.js`                                                                                |
| `P1-6` | SFTP `cd Terminal Here` & Toolbar Dotfiles Toggle                                                                                                                                                    | `directoryListing.js` (`buildCdCommand`), `useFileSelection.js`, `FileToolbar.jsx`, `FileContextMenus.jsx`, `FileManagerContainer.jsx`                                                                 |
| `P1-7` | Startup Workspace & Split-Layout Restore (post-unlock, secrets stripped)                                                                                                                             | `workspaceSnapshot.js`, `useWorkspaceRestore.js`, `GeneralSettings.jsx`, `loadSettingsSnapshot.js`                                                                                                     |

### Goal 7 — Audit Gap Fixes & Final Verification

All 6 findings raised by `final-auditor` (#77) were resolved and covered by regression tests:

1. **[P0] Git Hygiene (`.gitignore` + `src/main/diagnostics/`)**: Anchored `.gitignore:27` to `/diagnostics/` so `src/main/diagnostics/{crashReporter.js,diagnostics.js,mainProcessResourceManager.js}` are tracked in Git for all clones and worktrees.
2. **[P1] Command Palette Terminal Theme Persistence & Localization**:
   - `AppShell.jsx` (`case "setTerminalTheme"`) now normalizes `themeId` and persists `window.terminalAPI?.saveUISettings?.({ terminalTheme: themeId })` alongside dispatching `simpleshell:setTerminalTheme` and `settingsChanged`.
   - Removed duplicated hardcoded theme array from `commandPalette.js`; exported shared `getTerminalThemePresetLabel(t, presetId)` in `src/shared/settings/terminalThemePresets.js` using `settings.terminalThemePresets.*` keys, consumed by both `commandPalette.js` and `TerminalSettings.jsx`.
3. **[P1] Command Palette Snippet Template Substitution**:
   - Extracted `src/renderer/features/terminal/components/CommandTemplateParamDialog.jsx` shared between `ShortcutCommands.jsx` and `AppShell.jsx` (lazy-loaded in `AppShell.jsx`).
   - `AppShell.jsx` (`case "runSnippet"`) now builds session context via `buildSessionTemplateContext` + `getWorkingDirectoryState(activeSessionKey)` and evaluates `prepareCommandExecution`: built-in/static commands execute immediately with substituted values, while commands requiring user parameters open `CommandTemplateParamDialog`.
4. **[P1] Performance & Bundle Regressions Restored**:
   - **`ui.connectionTree.render1kMs`** (`336.789 ms -> 89.745 ms`, `-48.31%` vs `before-opt.json`): Eliminated per-row `useTranslation()`, `<Tooltip>/<IconButton>`, and `<Box>` Emotion allocations in `ConnectionListItems.jsx`, hoisted pin labels to `ConnectionList.jsx` / `VirtualizedConnectionList.jsx`, and fixed `ConnectionList.jsx` `useVirtualizedConnectionList` to evaluate `hasActiveFilter` (preventing urgent-pass teardown/remount of 168 dnd-kit rows during `useDeferredValue` search clearing).
   - **`startup.bundle.rendererInitialJsBytes`** (`1,098,049 B -> 1,018,128 B`, `-11.09%` vs `before-opt.json`): Extracted `src/renderer/features/welcome/QuickConnectSaveDialog.jsx` behind `React.lazy`, replaced MUI `TextField` / `Chip` in `WelcomePage.jsx` with lightweight styled primitives, and imported `normalizeTerminalThemeId` in `AppShell.jsx` from `uiSettingsDefaults.js` rather than `terminalThemePresets.js` (keeping the initial `mui` chunk at `234.8 KB` vs Goal 3's `232.6 KB`).
   - **Schema & Connection Serialization**: Cached compiled Ajv validator per wrapper in `configSchemas.js`, removed redundant `WeakMap.has()` lookup in `validator.js`, and added empty/single-item fast paths in `connectionSettings.js` (`normalizeConnectionTags`).
5. **[P2] Shortcut Input Guards**: Added `isEditableNonXtermTarget` (`src/renderer/shared/lib/keyboardTarget.js`) to guard `terminalShortcuts.js` (`Ctrl+L`, `Ctrl+/`, `Escape`, `F3`, `Ctrl+G`, `Ctrl+.`, `Ctrl+,`) and `SidebarWorkspace.jsx` (`Alt+Arrow`, `Ctrl+1..9`) when focus is inside `INPUT`, `TEXTAREA`, `SELECT`, or `contentEditable` elements other than `.xterm-helper-textarea`.
6. **[P2] Zero i18n Hardcoded Warnings & `terminalFontWeight` Schema**: Eliminated all 4 `i18n.test.js` hardcoded UI warnings (`commandPalette.js` + `workspaceSnapshot.js` using `i18n.t("terminal.welcome")`) and modeled `terminalFontWeight` (`integer`, `300..1000`, default `400`) in `uiSettingsDefaults.js`, `configSchemas.js`, and `loadSettingsSnapshot.js`.

---

## 3. Final Benchmark Comparison (`before-opt.json` vs Current Goal 7 Run)

Measured via `npm run bench -- --compare D:\Projects\simpleshell\.cache\benchmarks\before-opt.json` (`win32-x64`, Node `v24.20.0`, Intel i5-12400, 12 cores, 61.99 s, full mode). Overall summary: **39 improved**, **22 regressed**, **21 unchanged**, **0 new**, **0 missing**.

| Suite                  | Metric                                      | Before (`before-opt.json`) |        Goal 7 Final |   Delta % | Status     |
| ---------------------- | ------------------------------------------- | -------------------------: | ------------------: | --------: | ---------- |
| `startup-and-bundle`   | `startup.bundle.rendererBuildMs`            |              16,178.124 ms |       12,327.255 ms |   -23.80% | improved   |
| `startup-and-bundle`   | `startup.bundle.rendererInitialJsBytes`     |                1,145,174 B |         1,018,128 B |   -11.09% | improved   |
| `startup-and-bundle`   | `startup.bundle.rendererAsyncJsBytes`       |                3,485,843 B |         4,053,293 B |   +16.28% | regressed* |
| `startup-and-bundle`   | `startup.bundle.mainBuildMs`                |               5,266.135 ms |        4,128.599 ms |   -21.60% | improved   |
| `startup-and-bundle`   | `startup.bundle.mainBundleBytes`            |                1,143,093 B |         1,200,483 B |    +5.02% | regressed* |
| `startup-and-bundle`   | `startup.coldRequire.bootstrapMs`           |                 111.731 ms |            5.786 ms |   -94.82% | improved   |
| `startup-and-bundle`   | `startup.coldRequire.configServiceMs`       |                  45.247 ms |           11.418 ms |   -74.77% | improved   |
| `startup-and-bundle`   | `startup.coldRequire.totalMs`               |                 181.531 ms |           50.303 ms |   -72.29% | improved   |
| `startup-and-bundle`   | `startup.coldRequire.rssDeltaMB`            |                   21.82 MB |            6.191 MB |   -71.63% | improved   |
| `startup-and-bundle`   | `startup.crypto.encryptOpsPerSec`           |            23,912.85 ops/s |     35,977.34 ops/s |   +50.45% | improved   |
| `startup-and-bundle`   | `startup.history.suggest10kOpsPerSec`       |             2,312.89 ops/s |     29,850.75 ops/s | +1190.63% | improved   |
| `startup-and-bundle`   | `startup.history.suggest10kP95Ms`           |                   0.669 ms |            0.053 ms |   -92.08% | improved   |
| `terminal-pipeline`    | `terminal.timeToPromptMs`                   |                   2.166 ms |            1.807 ms |   -16.57% | improved   |
| `terminal-pipeline`    | `terminal.workload.logs.throughputMBps`     |                 16.02 MB/s |          21.22 MB/s |   +32.46% | improved   |
| `terminal-pipeline`    | `terminal.workload.logs.eventLoopP99Ms`     |                  22.053 ms |            15.72 ms |   -28.72% | improved   |
| `terminal-pipeline`    | `terminal.highlight.disabledThroughputMBps` |                 85.42 MB/s |         119.82 MB/s |   +40.27% | improved   |
| `terminal-pipeline`    | `terminal.backpressure.throughputMBps`      |                  1.24 MB/s |           1.75 MB/s |   +41.13% | improved   |
| `terminal-pipeline`    | `terminal.memory.nativeRssMB`               |                   24.65 MB |            23.24 MB |    -5.72% | improved   |
| `terminal-pipeline`    | `terminal.memory.mainRssMB`                 |                1,354.52 MB |         1,111.92 MB |   -17.91% | improved   |
| `webterminal-renderer` | `renderer.stream500k.domMBps`               |                34.247 MB/s |         36.875 MB/s |    +7.67% | improved   |
| `webterminal-renderer` | `renderer.stream500k.webglMBps`             |                18.609 MB/s |         19.856 MB/s |    +6.70% | improved   |
| `webterminal-renderer` | `renderer.search50k.scanMs`                 |                   248.3 ms |            194.7 ms |   -21.59% | improved   |
| `webterminal-renderer` | `renderer.search500k.scanMs`                |                 1,151.6 ms |            560.7 ms |   -51.31% | improved   |
| `webterminal-renderer` | `renderer.search500k.cachedJumpMs`          |                     6.5 ms |             5.95 ms |    -8.46% | improved   |
| `webterminal-renderer` | `renderer.resize500k.reflowMs`              |                  124.45 ms |           113.15 ms |    -9.08% | improved   |
| `webterminal-renderer` | `renderer.memory.rssMB`                     |               1,511.633 MB |        1,510.891 MB |    -0.05% | unchanged  |
| `sftp-and-ui`          | `sftp.batchDownload.ms`                     |                 875.461 ms |          746.662 ms |   -14.71% | improved   |
| `sftp-and-ui`          | `sftp.largeUpload.throughputMBps`           |                144.49 MB/s |         151.99 MB/s |    +5.19% | improved   |
| `sftp-and-ui`          | `sftp.largeDownload.throughputMBps`         |                  1.68 MB/s |         137.38 MB/s | +8077.38% | improved   |
| `sftp-and-ui`          | `ui.fileManager.sortName10kMs`              |                 120.438 ms |           105.37 ms |   -12.51% | improved   |
| `sftp-and-ui`          | `ui.fileManager.sortTime10kMs`              |                   0.369 ms |            0.532 ms |   +44.17% | regressed  |
| `sftp-and-ui`          | `ui.fileManager.search10kMs`                |                   0.779 ms |            0.718 ms |    -7.83% | improved   |
| `sftp-and-ui`          | `ui.connectionTree.render1kMs`              |                 173.616 ms |           89.745 ms |   -48.31% | improved   |
| `sftp-and-ui`          | `ui.connectionTree.search1kMs`              |                 215.622 ms |           99.668 ms |   -53.78% | improved   |
| `sftp-and-ui`          | `ipc.validateSchema.smallOpsPerSec`         |        15,569,048.73 ops/s | 16,750,418.76 ops/s |    +7.59% | improved   |
| `sftp-and-ui`          | `ipc.validateSchema.large500OpsPerSec`      |         3,954,132.07 ops/s |  3,321,155.76 ops/s |   -16.01% | regressed  |

_\*Note: `rendererAsyncJsBytes` (+567 KB) and `mainBundleBytes` (+57 KB) reflect Goal 3 lazy-chunk splitting plus Goal 4–7 new features (`KnownHostsSection`, `CommandPaletteDialog`, `BroadcastCommandBar`, `QuickConnectSaveDialog`, `CommandTemplateParamDialog`, `uiSettingsDefaults`, and `sshAuthenticationService`). Initial `mui.js` chunk remains 234.8 KB (Goal 3: 232.6 KB)._

---

## 4. Verification Evidence

### Executed After Final Goal 7 Fixes

- **Prettier Check**: `npx prettier --end-of-line auto --check .` — **PASS** (all matched files conform).
- **Full Lint, Typecheck & Unit Suite (`npm run check`)**:
  - `eslint .` — **PASS**
  - `tsc -p tsconfig.preload.json` — **PASS**
  - `vitest run` — **PASS** (**75 files / 663 tests**), including:
    - `i18n.test.js`: 2,028 keys, 2,808 translation calls, 2 locales, **0 hardcoded UI warnings** (down from 4).
    - `preloadContracts.test.js`: 5 APIs, 233 typed methods, 174 static invokes, 0 dynamic skipped.
    - `muiV9Props.test.js` & `accessibility.test.js` & `benchmarkIsolation.test.js`: **PASS**.
    - Added Goal 7 regression tests in `tests/unit/{appShell,commandPalette,terminalShortcuts,globalSettingsWiring,quickConnect}.test.js`.
- **Electron Renderer Integration Suite (`tests/integration/renderer.test.js`)**:
  - Executed with `SIMPLESHELL_NATIVE_SERVICES_PATH` pointing to staged `simpleshell-core.exe`: **PASS** (**7 / 7 tests**, 77.36s, including `500,000` history lines DOM + WebGL, native history keys, AI narrow theme, port forwarding, SFTP, split selection/resize/ZMODEM, and production CSP).
- **Full Benchmark Comparison**: `npm run bench -- --compare D:\Projects\simpleshell\.cache\benchmarks\before-opt.json` — **PASS** (all 4 suites, 82 metrics, 61.99s).

### Audited Baseline Evidence on `master` (`8069ae0`, pre-Goal-7)

Recorded by `final-auditor` (#77) prior to Goal 7 fixups:

- `cargo test --manifest-path native-services/Cargo.toml`: **88 passed, 0 failed**.
- `npm run make`: Produced `installer/SimpleShell-v0.6.0-Setup-x64.exe` (97,773,448 B) and `out/SimpleShell-win32-x64/resources/app.asar` (8,217,155 B, 95 files).
- `npm run test:integration`: **15 files / 49 tests** passed (284.03s).
