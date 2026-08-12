# Native sidecars

Every long-running or protocol-facing native capability belongs in one direct
child directory of `sidecars/`. The host executable is named
`simpleshell-native-services`; it is intentionally not named after any one
service.

```text
src/
├── main.rs                 # stable CLI routing only
└── sidecars/
    ├── ai/                 # `ai-serve` NDJSON service
    └── file_management/   # scan-folder, sftp-request, sftp-watch
```

Each sidecar directory owns a `mod.rs` implementation and a README describing
its command boundary, input/output protocol, security constraints, and runtime
limits. Cross-sidecar imports are prohibited: shared implementation belongs in
a future explicit `shared/` module, never in another sidecar directory.
