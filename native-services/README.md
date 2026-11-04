# native-services

Cargo workspace for `simpleshell-core`, the native process behind SimpleShell.

```text
native-services/
├── Cargo.toml              # workspace: shared versions, patched russh
├── core/                   # bin `simpleshell-core`: CLI routing + resident frame server
├── crates/
│   ├── core-protocol/      # frame codec, control messages, service I/O context,
│   │                       #   in-process stream harness for tests (feature `testing`)
│   ├── netutil/            # TCP / HTTP CONNECT / SOCKS proxy tunnels
│   ├── ssh-hub/            # shared SSH connections: auth, host keys, algorithms, leases
│   ├── ssh-session/        # ssh-connection / ssh-channel: terminal shells and exec
│   ├── term-pipe/          # terminal output pipeline; highlight-text / -validate
│   ├── sftp/               # sftp-request|session|watch, scan-folder, checksum-file
│   ├── forward/            # port-forward-serve (-L / -R / SOCKS5)
│   ├── zmodem/             # ZMODEM engine: in-stream Detector (zmodem-serve is test-only)
│   ├── localpty/           # pty: local programs on ConPTY / Unix PTYs (local tabs, Mosh)
│   ├── serial/             # serial-port, serial-list
│   ├── telnet/             # telnet: negotiation (NAWS, TTYPE), automatic login
│   ├── sysmetrics/         # system-metrics: CPU, memory, network, disks, processes
│   ├── auxsvc/             # ai-serve, latency-serve, ip-query-serve
│   ├── test-sshd/          # in-process SSH server for tests (never shipped)
│   └── fuzz-harness/       # fuzz harnesses for untrusted-input parsers (tests only)
├── fuzz/                   # cargo-fuzz targets (outside the workspace)
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
  the same pipeline for parity tests against the JS reference
  (`tests/helpers/referenceHighlighter.js`).
- ZMODEM is detected and transferred inside the stream: protocol bytes go
  straight back to the channel, and only `zmodem {kind, event}` events reach
  the main process, which answers with `zmodemAccept` / `zmodemSend` /
  `zmodemCancel` (dialogs and naming stay in JS).
- Credit counts the text sent, so renderer ACKs are passed on unchanged; it
  is a signed balance (an overspend is debt), and batched text not yet sent
  already counts. Pause reasons (`pause {reason}`) are kept per reason, so
  output stalls until each is resumed. In flight per terminal stays near the
  renderer's 512 KiB threshold.

## Local terminals and devices

The app has no Node native addons; what node-pty, serialport, telnet-client
and systeminformation did runs in the core:

- `pty` runs a local program on a pseudo terminal (ConPTY on Windows, via
  portable-pty). Blocking terminal I/O runs on threads joined to the stream
  by bounded queues, so a paused terminal stops the program. ConPTY asks for
  the cursor position first; xterm.js answers. After the program exits,
  remaining output is drained briefly before `exit`.
- `serial-port` / `serial-list` use the serialport crate (none / even / odd
  parity, RTS/CTS or XON/XOFF flow control); errors carry node-style codes
  (`ENOENT`, `EACCES`, `EINVAL`, `EIO`).
- `telnet` negotiates ECHO / SGA, terminal type and window size (NAWS on
  resize), doubles IAC in input, and answers the first login and password
  prompts when credentials are configured.
- `system-metrics` (aux core) keeps sysinfo counters in the resident
  process, so CPU, network and disk rates are measured between requests.

`src/main/native/` holds the matching JS clients (`nativePty`,
`nativeSerialPort`, `nativeTelnet`, `nativeSystemMetrics`). Electron
Forge's rebuild step has nothing to build (`rebuildConfig.onlyModules: []`).

## Running

```sh
cargo build --locked --manifest-path native-services/Cargo.toml
cargo test --locked --manifest-path native-services/Cargo.toml
```

- `simpleshell-core serve --role core|aux` — the resident process used by the
  Electron main process (`src/main/native/coreSupervisor.js`).
- `simpleshell-core <service> [args]` — one service over plain stdio, used by
  protocol tests and for debugging.

## Fuzzing

The parsers that read bytes from remote hosts (or the supervisor) have fuzz
harnesses in `crates/fuzz-harness`: `term_pipe` (UTF-8 decoding, OSC filter,
editor mode, highlighting with the default rules), `telnet` (IAC negotiation,
automatic login), `zmodem` (in-stream `Detector` and the zmodem2 machines it
drives, including accepted downloads and uploads), `frame_codec` and
`control` (frame decoding, control messages). Each input's first 8 bytes
seed how the rest is split into chunks, and besides "no panic" the harnesses
check invariants: chunking never changes the result, plain `TermPipe` output
equals `String::from_utf8_lossy` of the input, ZMODEM detection passes every
byte before an intro through, frames and control messages round-trip.
(SFTP replies are parsed by `openssh-sftp-client`, not here.)

On stable, `cargo test` runs them on seeded random inputs (400 per target);
a longer run:

```sh
FUZZ_HARNESS_ITERS=300000 FUZZ_HARNESS_SEED=7 \
  cargo test --release --manifest-path native-services/Cargo.toml -p fuzz-harness
```

Coverage-guided fuzzing uses [cargo-fuzz](https://github.com/rust-fuzz/cargo-fuzz)
(nightly, libFuzzer; use Linux, macOS or WSL — the instrumented build did not
link with MSVC):

```sh
cargo install cargo-fuzz
cd native-services/fuzz
cargo +nightly fuzz run zmodem -- -max_total_time=120 -dict=dict/zmodem.dict
cargo +nightly fuzz run telnet -- -max_total_time=120 -dict=dict/telnet.dict
cargo +nightly fuzz run term_pipe -- -max_total_time=120
cargo +nightly fuzz run frame_codec -- -max_total_time=120
cargo +nightly fuzz run control -- -max_total_time=120 -dict=dict/control.dict
```

`fuzz/Cargo.lock` is the workspace lock plus libFuzzer; refresh it by copying
`Cargo.lock` over it rather than re-resolving (zmodem2 0.7.3 does not build
with the `zmodem` crate). A crash is saved under `fuzz/artifacts/<target>/`;
replay it with `cargo +nightly fuzz run <target> <file>`, then fix the parser
and add a regression test to its crate.

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
- AI, latency, IP lookup and system metrics run in a second `aux` instance of
  the same binary.
- If a process dies, the supervisor ends its open streams (clients run their
  normal recovery: SFTP sessions reopen, transfers retry, port forwarding
  reconnects) and restarts it on the next request, backing off when it keeps
  crashing. A core that stops answering `ping` is killed and restarted.
