# SimpleShell Development Benchmark Suite

**Strictly development-only.** Nothing under `benchmarks/` is imported by `src/`, compiled by Webpack, or packaged by Electron Forge. Reports are written to `.cache/benchmarks/` (gitignored).

## Quick Start

```sh
npm run bench:quick      # Fast smoke run across all suites (smaller payloads/iterations)
npm run bench            # Full benchmark run across all suites
npm run bench:baseline   # Run full suite and save baseline to .cache/benchmarks/baseline.json
npm run bench:compare    # Run full suite and compare against .cache/benchmarks/baseline.json
```

## CLI Options

`node benchmarks/run.js [options]`

- `--suite <name|all>`: Run one or more comma-separated suites (`startup-and-bundle`, `terminal-pipeline`, `webterminal-renderer`, `sftp-and-ui`, or `all`). Short aliases such as `startup`, `terminal`, `renderer`, and `sftp` are also accepted.
- `--save-baseline [path]`: Write a baseline JSON snapshot (default: `.cache/benchmarks/baseline.json`).
- `--compare <baselinePath>`: Compare current metrics against a baseline JSON file and compute delta % and improvement/regression status.
- `--quick`: Use smaller payloads and fewer iterations for fast local iteration.
- `--json`: Output machine-readable JSON to `stdout` (progress/tables are suppressed).
- `--out <dir>`: Override the report output directory (default: `.cache/benchmarks`).

Examples:

```sh
node benchmarks/run.js --suite startup --quick
node benchmarks/run.js --suite terminal-pipeline,sftp-and-ui --save-baseline .cache/benchmarks/my-baseline.json
node benchmarks/run.js --compare .cache/benchmarks/my-baseline.json --json
```

## Suites

1. `startup-and-bundle`:
   - Production Webpack renderer & main bundle size audit (initial JS bytes, async chunks, total JS/asset bytes, build time).
   - Main-process cold-require latency (`p50`/`p95`/`p99` ms and RSS delta) in isolated Node subprocesses.
   - `ConfigService` load/save and AES-256-GCM `crypto.js` encrypt/decrypt latency across 500 connections.
   - `commandHistoryCodec` gzip compression/decompression and `CommandHistoryService` suggestion ranking across 10,000 entries.

2. `terminal-pipeline`:
   - Loopback SSH + `simpleshell-core` pipe mode throughput (`MB/s`) and main event-loop delay (`p50`/`p99`/`max` ms) across 5 workloads:
     - `logs` (timestamps, IPs, URLs, paths, statuses)
     - `ansi` (256-color / truecolor SGR sequences)
     - `json` (long structured JSON lines)
     - `cjk_emoji` (multi-byte CJK + emoji UTF-8)
     - `burst` (small fragmented chunks)
   - Highlight overhead comparison (production highlight rules vs unhighlighted pipe mode).
   - `TerminalIOMailboxManager` + `RendererTerminalIOMailbox` ACK & backpressure pacing under throttled consumers.
   - Time to first prompt and native `simpleshell-core` / main RSS memory.

3. `webterminal-renderer`:
   - Real Electron + `<WebTerminal />` + `@xterm/xterm` renderer benchmark compiled with the production Webpack renderer rules.
   - Sustained streaming throughput (`MB/s`) at 50,000 default scrollback and 500,000 max scrollback (**full content retained, zero truncation**).
   - Full-buffer search scan latency, cached jump navigation latency, and search heartbeat max gap (`ms`).
   - Prompt tracking (`promptDetection.js`) and link provider (`terminalLinkProvider.js`) overhead on normal and 2,000-row wrapped lines.
   - Input echo latency (`p50`/`p95`/`p99` ms), resize/fit reflow latency (`ms`), and Electron renderer/working-set RSS (`MB`).

4. `sftp-and-ui`:
   - Loopback SFTP small-file batch upload/download throughput & handshake reuse (`TransferScheduler` + `nativeSftpClient`), plus large-file streaming throughput (`MB/s`) and `FileCache` write throughput.
   - Large directory (10,000 entries) sort/filter/search via `useFileSelection` and `directoryListing.js`.
   - Connection tree (1,000 entries) dedupe/sort/stabilize and `ConnectionList` filter/search rendering.
   - IPC `validateSchema` throughput (`ops/s`) across small, medium, and 500-connection payloads.

## Native Host Resolution

Suites that exercise `simpleshell-core` (`terminal-pipeline`, `sftp-and-ui`) automatically check `SIMPLESHELL_NATIVE_SERVICES_PATH`, local `native-services/bin/<platform>-<arch>`, `native-services/target/release`, `native-services/target/debug`, and (inside git worktrees) the main checkout's staged binary. Set `SIMPLESHELL_NATIVE_SERVICES_PATH` explicitly to benchmark a specific binary build.

## Note on `npm run test:perf`

The legacy Vitest migration benchmark (`npm run test:perf`, `tests/perf/baseline.perf.test.js`) remains untouched for compatibility with `docs/perf/baseline.json`.
