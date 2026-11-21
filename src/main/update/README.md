# Application update service

`updateService.js` is the main-process facade orchestrating Electron APIs
(`app`, `dialog`, `shell`, `net`, `session`) and delegating release checking,
downloads, persistence and OS-specific installer launch to `domains/`:

- `domains/releaseCheck.js`: GitHub Releases lookup and update severity metadata.
- `domains/installerDownload.js`: trusted-host installer download and progress events.
- `domains/installerPersistence.js`: installer metadata and update error persistence.
- `domains/platformInstallers.js`: Windows/macOS/Linux installer execution helpers.
- `semver.js`: semantic version parsing and comparison helpers.
