Bundled native sidecars are staged here before packaging.

Expected layout:

- `transfernative/bin/win32-x64/transfer-sidecar.exe`
- `transfernative/bin/win32-arm64/transfer-sidecar.exe`

`npm run prepare:native-sidecar` builds the Rust project when `cargo` is
available and copies the executable into the correct platform directory. Electron
Forge then bundles this directory via `packagerConfig.extraResource`, so client
machines do not need a local Node.js or Rust toolchain to run the packaged app.
