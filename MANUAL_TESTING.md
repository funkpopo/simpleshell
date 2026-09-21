# Verification guide

## Automated baseline

Use Node.js 22.22.2+ (22 LTS) or 24.15.0+, npm, Rust and the platform's native build tools as described in
README.md. Install with `npm ci`. Build the debug sidecar before the integration
checks and stage the release sidecar before packaging:

```sh
cargo build --locked --manifest-path native-services/desktop-host/Cargo.toml
npm run prepare:native-services
npm run lint
npm run test:unit
npm run check
npm run release:check
```

`npm run check` discovers all scripts/check-*.js files. Some checks start hidden
Electron windows, local HTTP/SSH servers or the Rust binary. They require a
desktop-capable environment and free local ports; they do not require a public
SSH server. Unit tests default to Node and opt into jsdom per file.

The MUI icon barrel must not be imported: use icon subpaths so both Vitest and
Webpack resolve a bounded set of modules. An EMFILE failure while importing
icons is a test-loading failure, not a successful test run.

## Desktop smoke test

1. Run `npm start`. Check first paint, saved light/dark theme, window controls,
   settings and restart persistence. Repeat with a packaged application.
2. Open local terminals and SSH sessions. Type, paste, resize, select text,
   search output and run a command producing substantial output. Input and
   cancellation must remain responsive.
3. Split a tab, move panes, change focus and close background sessions. Check
   independent working directories, command suggestions and terminal cleanup.
4. Interrupt and restore an SSH connection. Check reconnect progress, restored
   streams, intentional disconnect and credential/host-key prompts. Use a
   controlled test host; do not accept an unexpected host-key change.
5. In SFTP, navigate during a pending read, follow terminal directories, preview
   files, rename and edit permissions. Upload/download test files and folders,
   check overwrite prompts, cancel a transfer, then exercise resume/recovery.
   Compare source/destination checksums. Closing the sidebar must not stop tasks.
6. For Mosh, install a local client (or WSL on Windows) and use a test server with
   mosh-server. Interrupt network connectivity, then restore it. The UI should
   show roaming and return to running without restarting the session.
7. Exercise an AI stream, stop it, switch sessions and close the chat while a
   response is pending. Verify that chunks and cleanup belong to the right session.
8. Export configuration and import it into a disposable profile. Check credential
   lock/unlock, settings, backup recovery and diagnostics export.

Record platform, application version, commands run and any skipped checks.
Passing Node/jsdom tests does not establish desktop rendering performance or
real-network compatibility.
