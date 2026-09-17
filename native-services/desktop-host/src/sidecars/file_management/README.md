# File-management sidecar

This module owns the native file-management commands exposed by the stable
`simpleshell-native-services` binary:

- `scan-folder` — bounded local directory scanning;
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
