# Local release procedure

Release preparation uses the versioned npm scripts and Electron Forge config.
This repository does not require a GitHub release workflow to run local checks.

1. Align package.json, package-lock.json, Cargo.toml/Cargo.lock and the version
   badges in both READMEs. Review the change log and platform prerequisites.
2. Install dependencies with `npm ci` and build the test sidecar with
   `cargo build --locked --manifest-path native-services/desktop-host/Cargo.toml`.
3. Run `npm run lint` and `npm test`; complete MANUAL_TESTING.md for the target
   platform. Record unavailable environments explicitly.
4. Run `npm run prepare:native-services`, then `npm run release:check`. The check
   validates product identity, source assets, version agreement and the staged
   native binary for the current platform.
5. Run `npm run make` on each supported build platform. Use the platform's
   signing/notarization setup where configured; keep credentials out of Git.
6. Run `npm run release:checksums` and inspect the artifacts under out/. Smoke
   test an installed package, including its bundled native services and preload.
7. Upload/publish the reviewed artifacts through the project's chosen release
   process. Building locally does not publish a release automatically.

Keep source paths in release-check.js and Forge/Webpack configuration aligned
with DIRECTORY_CONVENTIONS.md when changing the source layout.
