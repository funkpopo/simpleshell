# File-management sidecar

This module owns the native file-management commands exposed by the stable
`simpleshell-native-services` binary:

- `scan-folder` — bounded local directory scanning;
- `sftp-request` — one native SFTP operation per JSON stdin envelope;
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
