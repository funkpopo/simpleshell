# native-services

Cargo workspace for `simpleshell-core`, the native process behind SimpleShell.

```text
native-services/
├── Cargo.toml              # workspace: shared versions, patched russh
├── core/                   # bin `simpleshell-core`: CLI routing + resident frame server
├── crates/
│   ├── core-protocol/      # frame codec, control messages, service I/O context
│   ├── netutil/            # TCP / HTTP CONNECT / SOCKS proxy tunnels
│   ├── ssh-hub/            # shared SSH connections: auth, host keys, algorithms, leases
│   ├── ssh-session/        # ssh-connection / ssh-channel: terminal shells and exec
│   ├── term-pipe/          # terminal output pipeline; highlight-text / -validate
│   ├── sftp/               # sftp-request|session|watch, scan-folder, checksum-file
│   ├── forward/            # port-forward-serve (-L / -R / SOCKS5)
│   ├── zmodem/             # ZMODEM engine: zmodem-serve and in-stream Detector
│   ├── auxsvc/             # ai-serve, latency-serve, ip-query-serve
│   └── test-sshd/          # in-process SSH server for tests (never shipped)
└── vendor/russh/           # patched russh (own lockfile, outside the workspace)
```

Service crates build on `core-protocol`, `netutil` and `ssh-hub`; the only
cross-service use is `ssh-session` embedding `term-pipe` and the `zmodem`
engine for terminal pipe channels. `core` is the only crate that knows every
service.

## Shared SSH connections

`ssh-hub` keeps one russh connection per account: target, user and network
path. Terminals, SFTP sessions, transfers and port forwards lease it and open
channels, so a tab, its file manager, its transfers and its forwards perform
one handshake. As with OpenSSH connection multiplexing, an authenticated
connection is shared by every consumer of that account whatever credentials
each brings; each consumer's host-key policy is still checked against the key
the connection verified (a pinned fingerprint must match, a verifier is asked).

- Authentication follows ssh2's order: none, password, public key (encrypted
  OpenSSH/PEM keys), agent identities (Unix socket, Windows named pipe or
  Pageant), keyboard-interactive (prompts answered by the main process).
  Agent forwarding bridges forwarded channels to the local agent.
- Algorithm names from `sshAlgorithms.js` map onto russh preferences
  (`ssh-hub/src/algorithms.rs`), including legacy CBC/3DES ciphers, SHA-1 and
  group1 kex and hmac-md5/-96 MACs.
- Concurrent acquires share a handshake; a connection whose last lease ends is
  closed after an idle timeout (30 s, `SIMPLESHELL_HUB_IDLE_MS`); a dead
  connection is replaced on the next acquire, and sessions on it end so
  clients reopen them. Health checks use keepalive replies or recent channel
  traffic.

## Terminal channels

`ssh-connection` streams authenticate and hold a lease; `ssh-channel` streams
run a shell or exec on it with raw data / stderr frames and JSON events
(`resize`, `signal`, `exit`, `close`). Output flows under two windows: the
main process grants per-channel byte credit and the patched russh
(`vendor/README.md`) re-opens an SSH channel's window only as the core
consumes it. A paused terminal therefore stalls only its own channel.

Terminals open their shell in **pipe mode** (`open.pipe: {rules}`), and the
main process only relays:

```text
SSH data ─▶ zmodem::Detector ─▶ term_pipe::TermPipe ─▶ text frames ─▶ mailbox ─▶ renderer
              │ transfer            UTF-8 · OSC filter          ▲                │
              ▼                     editor mode · highlight     └── ACK = credit ┘
          files, `zmodem` events
```

- Output is batched like the old main-process path (8 ms / 16 KiB) before
  highlighting, and stderr is merged in order (red). `highlight-text` runs
  the same pipeline for parity tests against the JS reference.
- ZMODEM is detected and transferred inside the stream: protocol bytes go
  straight back to the channel, and only `zmodem {kind, event}` events reach
  the main process, which answers with `zmodemAccept` / `zmodemSend` /
  `zmodemCancel` (dialogs and naming stay in JS).
- Credit counts the text sent, so renderer ACKs are passed on unchanged; it
  is a signed balance (an overspend is debt), and batched text not yet sent
  already counts. Pause reasons (`pause {reason}`) are kept per reason, so
  output stalls until each is resumed. In flight per terminal stays near the
  renderer's 512 KiB threshold.

The ssh2 fallback backend keeps the JS output path (`terminalOutput.js`,
`output-processor.js`, the `zmodem-serve` service).

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
