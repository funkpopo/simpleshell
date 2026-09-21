# Renderer feature ownership

Each feature owns its views, hooks and local state/helpers. Use an explicit
component or command entry when consuming a feature; do not introduce a single
barrel that eagerly re-exports every feature.

| Feature      | Entry / ownership                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------- |
| terminal     | WebTerminal.jsx; hooks own subscriptions; runtime owns xterm objects; model owns session/pane logic |
| connections  | ConnectionManager.jsx; protocol forms, authentication and OpenSSH import views                      |
| file-manager | index.jsx is the lazy entry; FileManagerContainer composes focused hooks, panels and dialogs        |
| transfers    | GlobalTransferBar, GlobalTransferFloat and TransferSidebar share state/globalTransferStore          |
| ai           | AIChatWorkspace and AIChatWindow; AI settings, command UI and prompt helpers                        |
| settings     | Settings.jsx; application settings composition                                                      |
| monitoring   | ResourceMonitor and IPAddressQuery; metric charts and map                                           |

Application providers, cross-feature menus and atomic session state live in
`../app`. Reusable UI primitives, notifications and browser helpers live in
`../shared`; that directory must not import app or feature implementations.

`../app/LazyComponents.jsx` retains the dynamic imports, Suspense boundaries and
intent preloading. File previews remain dynamically imported by the file-manager
dialogs. Transfer state outlives file-sidebar mounts; moving the code does not
change its lifetime. Shared IPC contracts remain outside renderer, under
`src/shared/contracts`.
