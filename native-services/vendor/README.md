# Vendored crates

## russh

`russh/` is russh 0.58.0 from crates.io plus the patches in `patches/`,
applied in file-name order. The workspace uses it through
`[patch.crates-io]` in `native-services/Cargo.toml`.

| patch                              | purpose                                                                                                                                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001-legacy-algorithms.patch`     | `aes128-gcm` / `aes256-gcm` names and the `legacy-macs` feature (hmac-md5, hmac-\*-96) so servers that only offer them still negotiate; trims the manifest to what the workspace builds.                                    |
| `0002-channel-flow-control.patch`  | Per-channel flow control for clients: received data no longer re-opens the window immediately; the window grows as the application takes data, and channel queues never block the session loop, so one paused terminal cannot stall SFTP or other channels on a shared connection. |

### Upgrading

1. `node scripts/vendor-russh.js <version>` — downloads the release, applies
   the patches and replaces `russh/`. If a patch no longer applies the script
   stops and leaves the current copy in place; rebase that patch against the
   new release (apply it by hand in a scratch copy, then regenerate it with
   `diff -ruN a b`), keeping one concern per patch.
2. Update the `russh = "=<version>"` pin in `native-services/Cargo.toml`.
3. Run the vendored suite (its backpressure test covers patch 0002):
   `cargo test --manifest-path native-services/vendor/russh/Cargo.toml --no-default-features --features "flate2 ring rsa dsa des legacy-macs"`
4. Run `cargo test --manifest-path native-services/Cargo.toml`,
   `npm run test:integration` and `npm run test:perf`.

To change a patch, edit `russh/`, then regenerate the affected patch from a
pristine upstream copy with the earlier patches applied, so the patch files
always reproduce `russh/` exactly.
