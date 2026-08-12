Bundled native sidecars are staged here before packaging.

Expected layout:

- `native-services/bin/win32-x64/simpleshell-native-services.exe`
- `native-services/bin/win32-arm64/simpleshell-native-services.exe`

`npm run prepare:native-services` builds the Rust project when `cargo` is
available and copies the executable into the correct platform directory. Electron
Forge then bundles this directory via `packagerConfig.extraResource`, so client
machines do not need a local Node.js or Rust toolchain to run the packaged app.
