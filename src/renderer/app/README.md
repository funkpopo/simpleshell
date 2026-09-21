# Application composition

`src/renderer/main.jsx` owns the React root, application providers and global error boundary.
`AppShell.jsx` owns layout, session actions, sidebar composition and application
menus. Focused hooks own their state, subscriptions and cleanup:

- `useReconnect`: IPC listeners, live-session filtering and pause/resume commands.
  It writes to the provider-scoped reconnect store without subscribing AppShell.
  `ReconnectMenuSection` owns the visible menu's countdown timer.
- `useCredentialSecurity`: credential store status, master password submission and
  locking. Status reads and lock/unlock commands share a revision boundary, so an
  older IPC response cannot overwrite a newer command or security event. Unlock
  submission state also has request identity and is invalidated on unmount.
- `useSSHAuthentication`: authentication request identity, challenge dialogs and
  IPC responses. The current challenge is consumed before sending its response,
  preserving a subsequent challenge received while IPC is pending.
- `useAppTheme`: one initial settings load, live appearance settings, theme
  creation, document attributes and startup reveal. Settings changes received
  during startup are applied after the loaded snapshot, and a completed load
  cannot update an unmounted shell.

The app reducer remains the owner of tabs, panes, connection configuration and
global UI state. Hooks expose focused commands; AppShell does not mutate their
internal connection maps. `appShellUtils.js` contains the existing normalization,
connection lookup, session configuration and layout helpers.

`tests/unit/appHooks.test.js` exercises settings races, credential status ordering,
reconnect filtering and cleanup. `tests/unit/appShell.test.js` mounts the actual
shell across startup, theme changes and lock events with feature bodies stubbed.

## Subscription boundaries

`AppProvider` provides stable stores. `useSyncExternalStore` compares selected
snapshots before scheduling renders; `useAppSelector` no longer reads a changing
Context value. Selectors default to `Object.is`; object/array projections must
provide an equality function such as `shallowEqual`. The selector cache is local
to each render so selector changes and concurrent rendering do not share a
mutable snapshot cache.

The reducer remains a single source of truth. `appStore` publishes three domains
atomically before notifying listeners:

- Shell: tabs, pane layouts, sidebar/dialog state, theme and saved connections.
- Drag: tab hover/insert position, pane drop zone and pane drag targets.
- Terminal: instance presence, configuration, process IDs and refresh tokens.

Reconnect has a separate store for status maps and pending commands. Each
provider owns its stores; there is no process-wide renderer singleton.

`SessionTab`, `PaneDropOverlay`, `SessionWorkspace` and the per-session terminal
wrapper subscribe at their rendering boundaries. The shell reads only the
focused session's configuration, process ID and connection status, because these
drive the sidebars. Updating these focused-session details still legitimately
renders the shell. Background sessions and reconnect progress do not. Callbacks
read current store snapshots so handlers do not need broad render subscriptions.
The complete `useAppState` hook remains for compatibility, with no current
production consumers; new consumers should use selectors or domain hooks.

`appContext.test.js` covers domain isolation, object selectors, selector/equality
changes, provider isolation and atomic cross-domain publication.
`sessionSubscriptions.test.js` measures renders of the actual connected views
with feature bodies stubbed, and checks countdown isolation and cleanup.
`appShell.test.js` checks that hot-domain updates do not render the welcome body
through the actual shell. These are render-count checks, not frame-time/FPS
measurements in Electron.

## Zustand and action-handler migration assessment

The short-term split does not require a new dependency. Keep the public selector
and dispatch hooks as the migration boundary. Zustand becomes useful when the
project needs shared middleware/devtools or more independently owned state
domains; swapping the backing store alone would not fix broad selectors or
subscriptions held in AppShell.

A gradual migration can proceed in this order:

1. Measure many-session dragging, reconnect bursts and open-menu countdowns in
   the Electron React Profiler. Retain the render-count tests as acceptance
   checks and compare commit duration before replacing the store implementation.
2. If adopting Zustand, start with its vanilla store behind the reconnect or
   drag domain hooks. Keep stores scoped to AppProvider and keep IPC/listener
   ownership in `useReconnect`; do not duplicate listeners in consumers.
3. Extract the reducer's drag, theme and simple sidebar cases into pure action
   handlers, preserving action names and payloads. They can be reused by a
   Zustand dispatch adapter without migrating all callers at once.
4. Migrate terminal/session handlers last. `ADOPT_TAB`, `UNSPLIT_TAB`,
   `REMOVE_PANE` and `FORGET_SESSIONS` span tabs, pane layouts, instances and sync
   groups. Preserve one atomic transition and the existing session identity and
   teardown behavior rather than splitting those commands into independent
   store writes. Keep reducer/session regression tests throughout migration.

Do not move imperative terminal objects, process caches or IPC effects into
serializable UI snapshots merely to accommodate a state library. Their existing
session lifecycle remains the owner.
