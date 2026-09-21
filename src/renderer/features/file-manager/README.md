# File manager boundaries

`index.jsx` remains the lazy-loading entry. `FileManagerContainer.jsx`
composes the following hooks and passes explicit data and commands to panels and
dialogs. There is no shared mutable controller object or catch-all context.

| Owner                          | State and responsibilities                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hooks/useFileNav.js`          | Current path, history, directory cache, foreground request ordering, chunk buffers, background refresh, directory watches and terminal directory following. |
| `hooks/useFileSelection.js`    | Search, sort, selection and range anchor. Reconciles refreshed entries by identity and clears selection when navigation changes.                            |
| `hooks/useFileOps.js`          | Composes file commands, staged deletion with rollback and copy-path operations. Delegates dialog state to focused owners.                                   |
| `hooks/useFileNameDialog.js`   | Independent create-file, create-folder and rename drafts, captured targets, submission guards and mutation retries.                                         |
| `hooks/useFileDetails.js`      | Properties request ordering and permission editing against a captured file target.                                                                          |
| `hooks/useFilePreview.js`      | Preview file/path identity, external editor settings and event subscriptions.                                                                               |
| `hooks/useTransferTasks.js`    | Upload/download task creation, drop validation and overwrite confirmation, progress updates, completion and task-local cancellation.                        |
| `hooks/useTransferHosts.js`    | Host metadata requests keyed by the set of transfer sessions; progress ticks never trigger additional IPC reads.                                            |
| `hooks/useDragDrop.js`         | Native drag gestures and matching browser entries to verified local paths; submits entries to the transfer hook.                                            |
| `hooks/useFileMenus.js`        | Menu anchors, context targeting and menu actions. Selection changes use selection commands.                                                                 |
| `hooks/useFileKeyboard.js`     | Keyboard routing to navigation, selection and file commands.                                                                                                |
| `hooks/useConfirmDialog.js`    | One confirmation at a time. Superseded or unmounted asynchronous confirmations resolve as cancelled.                                                        |
| `hooks/useFileManagerClose.js` | Close lifecycle and confirmation when the session still has active transfers.                                                                               |

Directory changes flow from navigation to selection through `files` and
`selectionResetKey`. Navigation never writes selection state, and file/transfer
operations receive `refreshDirectory(path)`, not `loadDirectory`. This command
invalidates the affected cache entry and only reloads a currently visible idle
directory. It cannot navigate back to an operation's old path, interrupt a pending
navigation, or run against a replaced/unmounted session. Uploads also invalidate
the destination when it is a selected child folder. Deletion completion cannot
replace selection after the directory context has changed. Menu closure belongs
to the interaction layer, and file shortcuts are scoped to the sidebar's DOM root.

Dialog models capture their session, directory and file when opened. Navigation
or selection changes do not retarget a submit or an open preview. Switching
sessions closes dialogs and invalidates their pending UI updates; mutation and
transfer completion still belong to the original operation. Properties responses
are ordered by dialog request identity. Name/permission submissions reject
duplicate submits, and name mutation retries do not include the subsequent read.

`panels/FileList.jsx` owns row formatting and virtualized rendering. The row
component and lazy preview component keep stable module-level identities.
`panels/Breadcrumbs.jsx` renders the existing path editor, including IME handling.
`dialogs/FileManagerDialogs.jsx` connects the individual name, properties,
permission and preview models to their views. The container passes these models
without unpacking their draft fields, and the preview dependency remains lazy.
Confirmation remains a separate interaction shared by operations and transfers.

`../transfers/components/TransferProgress.jsx` renders the existing global progress bar. Its
placement remains in AppShell, so hiding or unmounting the file sidebar does not
remove transfers. `useTransferActions` provides task commands and an on-demand
snapshot without subscribing the container to progress ticks. Progress surfaces
use the existing subscribed store hooks.

Renderer regression tests exercise request ordering, chunk ownership, selection,
history, confirmations, native drops, task cancellation, dialog target snapshots,
upload/navigation races, session replacement, keyboard scope, host metadata
requests and real container mounting in `tests/unit/fileManagerHooks.test.js`.
