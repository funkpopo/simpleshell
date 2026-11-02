# Migration performance record

Measured with `npm run test:perf` (see `tests/README.md`) on loopback SSH/SFTP
servers: 48 MiB of terminal output, 1000 × 1 KiB files, 4 tabs. `baseline.json`
is the reference captured before the Rust migration; each phase is compared
with it before merging.

| metric                           | baseline | P0   | P1   |
| -------------------------------- | -------- | ---- | ---- |
| terminal throughput (MB/s)       | 8.87     | 11.6 | 11.2 |
| main event-loop delay p99 (ms)   | 28.0     | 28.0 | 22.6 |
| health-check false positive rate | 0        | 0    | 0    |
| tab open → first prompt (ms)     | 4.9      | 4.8  | 4.9  |
| native processes per tab         | 1.25     | 0.25 | 0.25 |
| total RSS, 4 tabs (MB)           | 442      | 280  | 266  |
| upload 1000 files (ms)           | 12430    | 5609 | 2263 |
| upload 1000 files: handshakes    | 1000     | 1000 | 0    |
| download 1000 files (ms)         | 12397    | 5389 | 2331 |
| download 1000 files: handshakes  | 1000     | 1000 | 0    |

Platform: win32-x64, Node 24.20.

## Notes

- **P0** (resident `simpleshell-core`): per-task sidecar processes became
  streams, so small-file batches no longer pay a process spawn per file.
  Each transfer still opens its own SSH connection; that is P1's target.
  The supervisor dispatches core frames with a per-event-loop-iteration time
  budget; without it, coalesced core output let ZMODEM passthrough and
  highlighting run back to back and raised p99 to ~150 ms.
- **P1** (`ssh-hub`): SFTP sessions and transfers lease one SSH connection
  per host and credential set; each transfer concurrency slot keeps an SFTP
  channel for consecutive files. The transfer batches report 0 handshakes
  because they reuse the connection the tab measurement opened to the same
  server (the first batch on a cold hub performs exactly one).
