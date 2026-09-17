# Application composition

`src/app.jsx` owns the React root, application providers and global error boundary.
`AppShell.jsx` owns layout, session actions, sidebar composition and application
menus. Focused hooks own their state, subscriptions and cleanup:

- `useReconnect`: per-session connection/reconnect status, live-session filtering,
  pause/resume commands and the visible menu's countdown timer.
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
