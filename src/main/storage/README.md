# Runtime file storage

This directory owns disk-backed runtime file stores and lifecycle eviction in
the main process:

- `runtimeFileLifecycle.js`: shared registration, retention policies
  (`file-cache`, `file-snapshots`, `external-editor-temp`), startup cleanup,
  and periodic size/age pruning.
- `fileCache.js`: temporary local cache (`FileCache`) for previewed/edited
  files, registered with `runtimeFileLifecycle` under `file-cache`.
- `fileSnapshotStore.js`: persistent local snapshot store
  (`FileSnapshotStore`) registered under `file-snapshots`.
