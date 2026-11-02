# native-services

Cargo workspace for `simpleshell-core`, the native process behind SimpleShell.

```text
native-services/
├── Cargo.toml              # workspace: shared versions, patched russh
├── core/                   # bin `simpleshell-core`: CLI routing + resident frame server
├── crates/
│   ├── core-protocol/      # frame codec, control messages, service I/O context
│   ├── netutil/            # TCP / HTTP CONNECT / SOCKS proxy tunnels
│   ├── sftp/               # sftp-request|session|watch, scan-folder, checksum-file
│   ├── forward/            # port-forward-serve (-L / -R / SOCKS5)
│   ├── zmodem/             # zmodem-serve
│   └── auxsvc/             # ai-serve, latency-serve, ip-query-serve
└── vendor/russh/           # patched russh (own lockfile, outside the workspace)
```

Service crates depend on `core-protocol` and `netutil` only; they never import
each other. `core` is the only crate that knows every service.

## Running

```sh
cargo build --locked --manifest-path native-services/Cargo.toml
cargo test --locked --manifest-path native-services/Cargo.toml
```

- `simpleshell-core serve --role core|aux` — the resident process used by the
  Electron main process (`src/main/native/coreSupervisor.js`).
- `simpleshell-core <service> [args]` — one service over plain stdio, used by
  protocol tests and for debugging.

## Frame protocol

One stdio pipe per process carries length-prefixed frames
(`crates/core-protocol/src/frame.rs`, mirrored in
`src/main/native/coreProtocol.js`):

```text
[len u32 LE = 5 + payload][kind u8][stream u32 LE][payload]
```

- **Control** (`kind 1`, stream 0): one JSON object with `schemaVersion` and
  `op` — `ready`, `open`, `eof`, `kill`, `exit`, `ping`/`pong`, `error`,
  `shutdown`.
- **Data** (`kind 2`, stream ≥ 1): opaque bytes; the supervisor forwards them
  without parsing. Each stream carries the NDJSON protocol of its service.

## Fault isolation

- Every `open` runs the service as its own tokio task. Errors, panics and kills
  end that stream only and are reported as `exit` (`code` 1 / 101, or
  `signal: SIGTERM`).
- Background tasks started through `core_protocol::service::spawn` belong to
  the stream and are aborted with it.
- AI, latency and IP lookup run in a second `aux` instance of the same binary.
- If a process dies, the supervisor ends its open streams (clients run their
  normal recovery: SFTP sessions reopen, transfers retry, port forwarding
  reconnects) and restarts it on the next request, backing off when it keeps
  crashing. A core that stops answering `ping` is killed and restarted.
