# Renderer feature ownership

Each feature owns its views, hooks and local state/helpers. Use an explicit
component or command entry when consuming a feature; do not introduce a single
barrel that eagerly re-exports every feature.

| Feature      | Entry / ownership                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| terminal     | WebTerminal.jsx; hooks own subscriptions; runtime owns xterm objects; model owns session/pane logic                                                                       |
| connections  | ConnectionManager.jsx composes connection storage/menus, ConnectionList and ConnectionEditorDialog; useConnectionEditor owns drafts, credentials, validation and autosave |
| file-manager | index.jsx is the lazy entry; FileManagerContainer composes focused hooks, panels and dialogs                                                                              |
| transfers    | GlobalTransferBar, GlobalTransferFloat and TransferSidebar share state/globalTransferStore                                                                                |
| ai           | AIChatWorkspace and AIChatWindow; AI settings, command UI and prompt helpers                                                                                              |
| settings     | Settings.jsx owns loading, navigation and committing settings; sections own tab drafts, useConfigSync owns import/export/WebDAV commands                                  |
| monitoring   | ResourceMonitor and IPAddressQuery; metric charts and map                                                                                                                 |

Application providers, cross-feature menus and atomic session state live in
`../app`. Reusable UI primitives, notifications and browser helpers live in
`../shared`; that directory must not import app or feature implementations.

`../app/LazyComponents.jsx` retains the dynamic imports, Suspense boundaries and
intent preloading. File previews remain dynamically imported by the file-manager
dialogs. Transfer state outlives file-sidebar mounts; moving the code does not
change its lifetime. Shared IPC contracts remain outside renderer, under
`src/shared/contracts`.

Settings sections stay mounted while the dialog is open, preserving unsaved
drafts when switching tabs. Their small imperative handles provide snapshots
and section-specific save commands; the parent captures these at save time.
Closing/reopening resets drafts and invalidates old load/close notifications.
`tests/unit/componentEditors.test.js` covers cross-tab saves, security validation,
load/save ordering and connection/group creation through the actual views.

Connections keep pure tree and form helpers in `connections/lib`. List rows own
truncation/sortable behavior, `ConnectionList` owns filtering/virtualization and
dragging, and `useConnectionEditor` retains credential checks, testing and
debounced edit saves. These modules use the existing persistence callbacks and
do not introduce a second connection store.
