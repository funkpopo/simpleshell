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
