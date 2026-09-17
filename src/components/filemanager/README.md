# File manager boundaries

`../FileManager.jsx` remains the lazy-loading entry. `FileManagerContainer.jsx`
composes the following hooks and passes explicit data and commands to panels and
dialogs. There is no shared mutable controller object or catch-all context.

| Owner                          | State and responsibilities                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hooks/useFileNav.js`          | Current path, history, directory cache, foreground request ordering, chunk buffers, background refresh, directory watches and terminal directory following. |
| `hooks/useFileSelection.js`    | Search, sort, selection and range anchor. Reconciles refreshed entries by identity and clears selection when navigation changes.                            |
| `hooks/useFileOps.js`          | Create, rename, staged deletion with rollback, permissions, properties, preview and external editor events. Owns operation and dialog state.                |
| `hooks/useTransferTasks.js`    | Upload/download task creation, drop validation and overwrite confirmation, progress updates, completion and task-local cancellation.                        |
| `hooks/useDragDrop.js`         | Native drag gestures and matching browser entries to verified local paths; submits entries to the transfer hook.                                            |
| `hooks/useFileMenus.js`        | Menu anchors, context targeting and menu actions. Selection changes use selection commands.                                                                 |
| `hooks/useFileKeyboard.js`     | Keyboard routing to navigation, selection and file commands.                                                                                                |
| `hooks/useConfirmDialog.js`    | One confirmation at a time. Superseded or unmounted asynchronous confirmations resolve as cancelled.                                                        |
| `hooks/useFileManagerClose.js` | Close lifecycle and confirmation when the session still has active transfers.                                                                               |

Directory changes flow from navigation to selection through `files` and
`selectionResetKey`. Navigation never writes selection state, and file/transfer
operations never write navigation state: they request a directory load or a
refresh. Menu closure belongs to the interaction layer.

`panels/FileList.jsx` owns row formatting and virtualized rendering. The row
component and lazy preview component keep stable module-level identities.
`panels/Breadcrumbs.jsx` renders the existing path editor, including IME handling.
`dialogs/` contains the name, properties, permission, confirmation and preview
surfaces; the preview dependency remains lazy.

`panels/TransferProgress.jsx` renders the existing global progress bar. Its
placement remains in AppShell, so hiding or unmounting the file sidebar does not
remove transfers. `useTransferActions` provides task commands and an on-demand
snapshot without subscribing the container to progress ticks. Progress surfaces
use the existing subscribed store hooks.

Renderer regression tests exercise request ordering, chunk ownership, selection,
history, confirmations, native drops, task cancellation and real container
mounting in `tests/unit/fileManagerHooks.test.js`.
