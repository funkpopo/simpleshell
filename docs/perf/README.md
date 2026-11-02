# Migration performance record

Measured with `npm run test:perf` (see `tests/README.md`) on loopback SSH/SFTP
servers: 48 MiB of terminal output, 1000 × 1 KiB files, 4 tabs. `baseline.json`
is the reference captured before the Rust migration; each phase is compared
with it before merging.

| metric                           | baseline | P0   |
| -------------------------------- | -------- | ---- |
| terminal throughput (MB/s)       | 8.87     | 11.6 |
| main event-loop delay p99 (ms)   | 28.0     | 28.0 |
| health-check false positive rate | 0        | 0    |
| tab open → first prompt (ms)     | 4.9      | 4.8  |
| native processes per tab         | 1.25     | 0.25 |
| total RSS, 4 tabs (MB)           | 442      | 280  |
| upload 1000 files (ms)           | 12430    | 5609 |
| upload 1000 files: handshakes    | 1000     | 1000 |
| download 1000 files (ms)         | 12397    | 5389 |
| download 1000 files: handshakes  | 1000     | 1000 |

Platform: win32-x64, Node 24.20.

## Notes

- **P0** (resident `simpleshell-core`): per-task sidecar processes became
  streams, so small-file batches no longer pay a process spawn per file.
  Each transfer still opens its own SSH connection; that is P1's target.
  The supervisor dispatches core frames with a per-event-loop-iteration time
  budget; without it, coalesced core output let ZMODEM passthrough and
  highlighting run back to back and raised p99 to ~150 ms.
