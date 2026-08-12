# AI sidecar module

This directory owns the Rust implementation behind the stable
`simpleshell-native-services ai-serve` command. It is deliberately separate from the
one-shot SFTP commands in the crate root because it is a long-running,
line-oriented service.

## Boundary

- `mod.rs` owns the NDJSON command loop, active-request limits, cancellation,
  provider request adaptation, stream parsing, and structured output events.
- The public entry point is only `serve()`; `main.rs` must not depend on
  internal protocol or provider implementation details.
- Electron owns process lifetime and forwards existing renderer IPC events.
  This module owns request execution only. There is no Node AI-worker path.

## Protocol

Input and output are UTF-8 newline-delimited JSON (`schemaVersion: 1`).
Commands: `health`, `proxyUpdate`, `request`, and `cancel`.
Events: `ready`, `result`, `streamChunk`, `streamEnd`, and `error`.

`stdout` is protocol-only. Secrets must never be emitted to stdout, stderr,
or command-line arguments. The automated contract lives in
`scripts/check-ai-sidecar.js`.

## Operational limits

- maximum active requests: 16;
- maximum active streams: 10;
- at most one stream for a given `sessionId`.

Any rejected command receives a structured `error` event; the service stays
alive for later commands.
