# Native sidecars

Every long-running or protocol-facing native capability belongs in one direct
child directory of `sidecars/`. The host executable is named
`simpleshell-native-services`; it is intentionally not named after any one
service.

```text
src/
├── main.rs                 # stable CLI routing only
├── shared/                 # minimal cross-sidecar implementation (proxy networking)
└── sidecars/
    ├── ai/                 # `ai-serve` NDJSON service
    ├── file_management/    # checksum-file, scan-folder, sftp-request, sftp-session, sftp-watch
    ├── ip_query/           # `ip-query-serve` NDJSON service
    ├── latency/            # `latency-serve` NDJSON service
    ├── port_forwarding/    # `port-forward-serve` / `port-forward-prototype`
    └── zmodem/             # `zmodem-serve` NDJSON service
```

Each sidecar directory owns a `mod.rs` implementation and a README describing
its command boundary, input/output protocol, security constraints, and runtime
limits. Cross-sidecar imports are prohibited: shared implementation belongs in
the explicit `shared/` module, never in another sidecar directory.
