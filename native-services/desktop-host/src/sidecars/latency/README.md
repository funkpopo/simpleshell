# Latency sidecar

This module owns the `latency-serve` long-running command exposed by the stable
`simpleshell-native-services` binary. It only executes TCP direct or proxy
tunnel probes; connection registration, the 1-second scheduler, quality
computation, history, `serviceGeneration`, Mosh passive status, and the SSH
exec fallback remain in the JavaScript `networkLatencyService`.

## Protocol (NDJSON, `schemaVersion: 1`)

Input messages:

- `probe` — `requestId`, `sessionId`, `generation`, `host`, `port`,
  `timeoutMs`, `proxyRevision`. Uses the per-session resolved network path.
- `proxyUpdate` — `requestId`, `sessionId`, `proxyRevision`, `proxy`,
  `proxyRequired`. Updates the proxy snapshot per session; a stale proxy
  revision cancels pending/active probes for that session. A global proxy must
  never override all connections.
- `cancel` — `requestId`, `targetRequestId`. Idempotent cancel; repeats and
  unknown targets return an acknowledgement without double-completing the
  target request.

Output messages:

- `ready` — `schemaVersion`, `capabilities: ["tcp", "proxy-tunnel"]`,
  `maxConcurrentProbes: 4`.
- `result` — original request ID. Probes return `latencyMs`, `method`
  (`tcp` or `proxy-tunnel`), `generation`, `proxyRevision`; control requests
  return an acknowledgement.
- `error` — original request ID with `errorCode`, `errorKind`, `retryable`.
  Cancelled probes end with `errorKind: "cancelled"`.

## Timing and concurrency

- Monotonic clock (`tokio::time::Instant`) starts at the actual network
  operation; DNS, connect, and proxy handshake are included in `latencyMs`.
  Proxy config parsing and JS queueing are not measured.
- Total probe timeout defaults to 5000 ms (`timeoutMs` per probe).
- At most 4 probes run concurrently; excess requests receive a `busy` error
  (`errorKind: "busy"`) so the JS scheduler stays the only queue.
- Cancellation tokens abort DNS/connect/handshake; sockets close on exit.
- stdin EOF cancels all probes and exits; diagnostics go to stderr.

stdout carries protocol output only. Proxy credentials never appear on the
command line, in events, or in logs.
