# File-management sidecar

This module owns the native file-management commands exposed by the stable
`simpleshell-native-services` binary:

- `scan-folder` — bounded local directory scanning;
- `checksum-file` — one-shot local file/segment hashing (`--path <absolute-path>`
  `--algorithm <md5|sha256>` optional `--offset` / `--length`, mirroring the JS
  `segmentOffset` / `segmentLength`);
- `sftp-request` — one native SFTP operation per JSON stdin envelope;
- `sftp-session` — a persistent SFTP connection with requests correlated by
  `requestId`; the first NDJSON line contains `{config, request}`, and later
  lines contain requests only;
- `sftp-watch` — a long-running remote-directory watch stream.

`mod.rs` contains the SFTP protocol, SSH connection setup, host-key validation,
file operations, and structured results/errors. Its stdout is protocol output;
diagnostics go to stderr through the module's structured error helper. It must
not import from `sidecars/ai`.

Transfer operations also expose `statFile` (size, modification time, mode), and
`checksumFile` (`path`, required `algorithm`: `md5` or `sha256`, optional
`segmentOffset` / `segmentLength`). Checksums use a bounded 256 KiB SFTP read
buffer and reject files that change size or modification time while hashing.
No shell command or alternate checksum backend is used.

Transfer writes with `r+` require an existing target, preserve other segments,
and seek to the requested offset. Downloads sync the file before acknowledging
segment completion. The main process owns manifests, retries, destination
commit, and task recovery; protocol errors never silently reset a transfer.

## Directory and transfer boundary

The main-process `fileHandlers` and `sftpHandlers` route remote operations through
`nativeSftpClient`. Directory listing, metadata, permissions, creation, rename,
copy, removal, text/binary reads, text writes, directory watches, and recursive
scans execute here. Streaming listings emit `listChunk` events in groups of up
to 100 entries and return no duplicate full listing.

`sftp-transfer-worker.js` forwards upload/download requests and progress through
the same native bridge. File bytes, segment offsets, remote checksums, and SFTP
handles belong to Rust. `filemanagementService`, `transferProcessPool`,
`transferResume`, and `resumableTransfer` retain task scheduling, manifests,
retry policy, resume validation, and the decision to commit the destination.
Local manifest writes, source metadata checks, local checksums, and local
destination rename remain part of that orchestration; they are not a second
JavaScript SFTP implementation.

The SSH reconnection manager's remaining `client.sftp()` call only opens and
closes a subsystem as a connection probe; it does not browse or transfer files.
Native SFTP validates the host fingerprint previously trusted by the main SSH
connection and uses the resolved proxy path. Its current authentication input
is a password or private key, independent of terminal agent forwarding.

## Batched permission reads

`getFilePermissionsBatch` accepts `paths: string[]` without a path-count limit.
It uses the current SFTP session and runs at most eight metadata
reads concurrently. Results preserve input order, duplicate paths, and exact
path whitespace. Each result includes `path` and `success`; successful results
have the same permissions, mode, uid, gid, and stats as `getFilePermissions`,
while failures carry `error`, `errorCode`, `errorKind`, and `retryable`.

An outer `success: true` means the batch was processed, not that every path
exists or was readable. Missing or inaccessible files do not discard successful
entries. Envelope/connection failures fail the request. The JavaScript bridge
submits the complete path list in one native request, while Rust schedules reads
with bounded concurrency. Uploads have no file-count cap. Dragged upload
conflict detection uses this operation and treats only missing paths as clear
destinations; other errors stop the conflict check before upload.

Rebuild/stage the native host with `npm run prepare:native-services` before
using a renderer/main-process version that sends this operation. `npm start`
already performs that preparation. An explicitly configured
`SIMPLESHELL_NATIVE_SERVICES_PATH` must point to an updated binary.

## Local checksum-file command (Phase 1)

`checksum-file` is a one-shot command: stdout emits exactly one JSON line.

- Success (exit code 0): `{schemaVersion: 1, success: true, algorithm, digest, bytesHashed}`
  with a lowercase-hex digest.
- Failure (exit code 1, structured output): `{schemaVersion, success: false, error,
  errorCode, errorKind, retryable}`. Error codes: `CHECKSUM_UNSUPPORTED_ALGORITHM`,
  `CHECKSUM_INVALID_REQUEST` (directory target, invalid/overflowing range),
  `CHECKSUM_SOURCE_UNAVAILABLE` / `CHECKSUM_READ_FAILED` (io),
  `CHECKSUM_SOURCE_TRUNCATED`, `CHECKSUM_SOURCE_CHANGED` (`errorKind:
  "source-changed"`).

Validation: only `md5`/`sha256`; the target must be a regular file;
`offset <= size` and `length <= size - offset` (no silent truncation). Reads use
a bounded 256 KiB buffer, seek to the offset, only read the requested length,
and verify size/mtime before and after reading. Empty files and zero-length
segments are allowed.

The JavaScript bridge (`src/main/native/nativeChecksumClient.js`) locates the
host binary, spawns it with an argument array (never a shell string), caps
stdout/stderr buffers, validates schema version, algorithm, digest length and
hex format, `bytesHashed`, supports `AbortSignal` cancellation, and queues work
behind a concurrency limit (default 2, `SIMPLESHELL_CHECKSUM_MAX_CONCURRENCY`)
with a bounded queue. Long files use a configurable total timeout
(`SIMPLESHELL_CHECKSUM_TIMEOUT_MS`, default 10 minutes) instead of short network
timeouts.

`transferIntegrity.hashLocalFile()` delegates to this command and keeps its
string-digest contract; failed local verification is never treated as success
and does not silently fall back to Node hashing. Manifests, resume identity,
and transfer orchestration remain JavaScript-side.

Performance note (Windows x64, see `docs/migration-baseline.md`): the one-shot
process adds ~20 ms startup overhead; small files (< 4 MiB) are dominated by
process start. A resident/batch checksum interface is a candidate follow-up if
the overhead matters in practice.
