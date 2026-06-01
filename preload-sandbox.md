# Preload Sandbox Recovery

## Decision

The main renderer window runs with:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`

The preload bundle must stay a thin bridge over declared IPC channels. It may use Electron modules that are available to sandboxed preload scripts, such as `contextBridge`, `ipcRenderer`, `webUtils`, and `crashReporter`. It must not use Node-backed renderer-only APIs directly.

## Current Fix

The previous blocker was `@vercel/webpack-asset-relocator-loader` injecting runtime code that referenced CommonJS globals such as `__dirname`. Those globals are not reliable in sandboxed preload execution, so `webpack.renderer.config.js` excludes the asset relocator from renderer/preload builds while keeping it available for the main-process build.

Clipboard access was also moved out of preload. `window.clipboardAPI.readText()` and `window.clipboardAPI.writeText()` keep the same renderer-facing API, but now call `clipboard:readText` and `clipboard:writeText` in the main process.

## Risk Record

- If asset-relocator runtime is reintroduced into the renderer/preload build, the preload can fail before `contextBridge` exposes APIs, causing a blank or unusable window.
- If preload directly imports non-sandbox-compatible Electron modules or Node modules, startup can fail only in packaged or Electron-version-specific environments.
- Clipboard, filesystem, process-control, credential, network, and dialog capabilities must remain behind explicit IPC schema definitions so validation and tracing still apply.
- Disabling `sandbox` would expand renderer compromise impact: a preload bug or exposed object bug would run with a larger Node-capable surface.

## Alternatives

- Keep `sandbox: false`: simplest compatibility fallback, but it weakens the renderer boundary and should only be used as an emergency rollback.
- Split preload into a hand-written minimal file plus generated API modules: stronger long-term control, but higher refactor cost because the current bridge is broad.
- Move all native renderer utilities behind IPC: safest for sandbox compatibility, but drag-and-drop still needs `webUtils.getPathForFile`, which is sandbox-compatible and intentionally kept in preload.
- Replace Electron Forge Webpack with a build that emits a preload bundle without asset-relocator side effects: viable later if packaging issues reappear, but not required for the current recovery.

## Guardrails

- `scripts/regression/preload-sandbox-regression.js` checks that `sandbox: true` remains enabled, asset-relocator stays excluded from renderer/preload builds, and clipboard access remains IPC-backed.
- Add new preload APIs only through declared IPC channels unless Electron documents the API as sandboxed-preload safe.
