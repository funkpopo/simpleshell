# Directory conventions

SimpleShell is one Electron application and one Rust native-services crate. Keep
them in the same repository; a new package is justified only by an independently
consumable API or release lifecycle.

## Runtime ownership

The migration target is `src/main`, `src/preload`, `src/renderer`, and
`src/shared`. During migration, classify files by their actual imports and
runtime responsibilities rather than renaming `core` or `modules` wholesale.

| Runtime  | Responsibility                                                                   | Allowed dependencies                                 |
| -------- | -------------------------------------------------------------------------------- | ---------------------------------------------------- |
| main     | Electron lifecycle, windows, sessions, storage, IPC handlers and native clients  | Node/Electron, main and shared                       |
| preload  | Explicit contextBridge API and managed subscriptions                             | Electron preload API, preload and shared contracts   |
| renderer | React UI, terminal views, browser state and interactions                         | Renderer, browser-compatible dependencies and shared |
| shared   | IPC definitions, data types, protocols, pure cross-runtime logic and locale data | Shared and runtime-independent dependencies          |

Never import a main-process implementation into renderer/preload. Main must not
import React components. Shared modules must not import application layers.
Browser-specific helpers belong to renderer even if their names are generic.
Code using Node/Electron is not shared merely because a worker also uses it.

## Feature ownership

Renderer features own their components, hooks, state and local helpers. Put
reusable UI primitives and browser helpers under renderer/shared; a helper used
by only one feature stays in that feature. Application composition owns provider
creation, cross-feature layout and atomic session actions. Do not split a single
cross-domain state transition into separate observable writes.

Main IPC handlers adapt requests to services. Session lifetime, authentication,
configuration persistence and transfer scheduling belong to focused services.
Inject callbacks/data where a low-level client would otherwise import the
application service that owns it. Preserve terminal backpressure, listener
cleanup, request identity and cancellation when extracting modules.

Keep lazy feature imports lazy. Preload implementation modules may be split
without changing the public window API. Protocols shared with Rust retain their
existing command names, schema versions and response shapes.

## Repository rules

- Components use PascalCase; hooks use `useSomething`. Keep existing names during
  moves; do naming cleanup separately from behavior changes.
- Import MUI icons by subpath, such as `@mui/icons-material/Close`. The barrel
  export loads thousands of icons in Vitest, unlike Webpack's Babel import transform.
- Declare every directly imported third-party package in package.json. Keep
  package-lock.json and Cargo.lock tracked.
- Track shared editor, formatting and architectural documentation. Local config,
  credentials, diagnostics, native binaries and build output remain ignored.
- Keep build/release entry points in scripts, test fixtures with their checks,
  and behavior tests in tests. Update path-based checks with every source move.
- Use separate commits for runtime moves, feature moves and responsibility
  extraction. Run the checks documented in MANUAL_TESTING.md.
