/** Directory listing (streaming chunks) and live directory watch lifecycle handlers. */
function createDirectoryListingAndWatchMethods({
  generateId,
  nativeSftpClient,
  IPC_EVENT_CHANNELS,
}) {
  return {
    _removeActiveDirectoryRead(token) {
      if (!token) return;
      this.activeDirectoryReads.delete(String(token));
    },

    _cancelActiveDirectoryRead(token) {
      const entry = this.activeDirectoryReads.get(String(token));
      if (!entry) {
        return false;
      }

      this._removeActiveDirectoryRead(token);

      try {
        if (entry.child && !entry.child.killed) {
          entry.child.kill();
        }
      } catch {
        // ignore process kill failures
      }

      return true;
    },

    _generateDirectoryWatchId() {
      return generateId();
    },

    _getDirectoryWatchOwnerKey(sender, tabId) {
      const senderId = sender?.id ? String(sender.id) : "unknown";
      return `${senderId}::${String(tabId ?? "")}`;
    },

    _removeActiveDirectoryWatch(entry) {
      if (!entry || !entry.watchId) {
        return;
      }

      this.activeDirectoryWatches.delete(entry.watchId);
      if (
        this.activeDirectoryWatchOwners.get(entry.ownerKey) === entry.watchId
      ) {
        this.activeDirectoryWatchOwners.delete(entry.ownerKey);
      }

      if (typeof entry.removeDestroyedListener === "function") {
        entry.removeDestroyedListener();
        entry.removeDestroyedListener = null;
      }
    },

    _sendDirectoryWatchEvent(entry, eventName, payload = {}) {
      try {
        if (!entry?.sender || entry.sender.isDestroyed()) {
          return;
        }

        entry.sender.send(IPC_EVENT_CHANNELS.DIRECTORY_WATCH_EVENT, {
          ...payload,
          watchId: entry.watchId,
          tabId: entry.tabId,
          path: entry.path,
          event: eventName,
        });
      } catch {
        // ignore renderer send failures during teardown
      }
    },

    _stopActiveDirectoryWatch(entry, reason = "stopped") {
      if (!entry) {
        return false;
      }

      entry.stopped = true;
      entry.stopReason = reason;
      this._removeActiveDirectoryWatch(entry);

      try {
        entry.controller?.close?.();
      } catch {
        // ignore sidecar shutdown failures
      }

      return true;
    },

    _findDirectoryWatchById(watchId) {
      if (!watchId) {
        return null;
      }
      return this.activeDirectoryWatches.get(String(watchId)) || null;
    },

    async listFiles(event, tabId, remotePath, options = {}) {
      // 支持非阻塞/分片目录加载：
      // 立即返回 { chunked, token }，并通过 listFiles:chunk 增量推送 items
      if (options && options.nonBlocking) {
        const requestedPath = remotePath;
        const chunkSize =
          typeof options.chunkSize === "number" && options.chunkSize > 0
            ? Math.floor(options.chunkSize)
            : 300;
        const token = generateId();

        // Fire-and-forget chunk producer
        Promise.resolve()
          .then(async () => {
            const send = (payload) => {
              try {
                if (event && event.sender && !event.sender.isDestroyed()) {
                  event.sender.send(
                    IPC_EVENT_CHANNELS.FILE_LIST_CHUNK,
                    payload,
                  );
                }
              } catch {
                // ignore send errors (window may be gone)
              }
            };

            let streamedChunkCount = 0;
            let streamedListDone = false;
            const result = await nativeSftpClient.listFiles(
              tabId,
              requestedPath,
              {
                streamList: true,
                onSpawn: (child) => {
                  this.activeDirectoryReads.set(token, {
                    tabId: String(tabId),
                    token,
                    child,
                  });
                },
                onListChunk: (chunk) => {
                  const items = Array.isArray(chunk?.items) ? chunk.items : [];
                  streamedListDone = chunk?.done === true;
                  if (items.length === 0) {
                    if (streamedListDone) {
                      send({
                        tabId,
                        path: requestedPath,
                        token,
                        items: [],
                        done: true,
                      });
                    }
                    return;
                  }
                  streamedChunkCount += items.length;
                  send({
                    tabId,
                    path: requestedPath,
                    token,
                    items,
                    done: streamedListDone,
                  });
                },
              },
            );

            if (!result || result.success === false) {
              send({
                tabId,
                path: requestedPath,
                token,
                items: [],
                done: true,
                error: result?.error || "listFiles failed",
                errorCode: result?.errorCode || result?.code || null,
                errorKind: result?.errorKind || null,
                retryable: result?.retryable === true,
                module: result?.module || null,
                operation: result?.operation || null,
              });
              return;
            }

            if (streamedChunkCount > 0 && !streamedListDone) {
              send({
                tabId,
                path: requestedPath,
                token,
                items: [],
                done: true,
              });
              return;
            }

            const data = Array.isArray(result.data) ? result.data : [];
            for (let i = 0; i < data.length; i += chunkSize) {
              const items = data.slice(i, i + chunkSize);
              const done = i + chunkSize >= data.length;
              send({ tabId, path: requestedPath, token, items, done });
            }

            // Ensure done signal even for empty directories
            if (data.length === 0) {
              send({
                tabId,
                path: requestedPath,
                token,
                items: [],
                done: true,
              });
            }
          })
          .catch((err) => {
            try {
              if (event && event.sender && !event.sender.isDestroyed()) {
                event.sender.send(IPC_EVENT_CHANNELS.FILE_LIST_CHUNK, {
                  tabId,
                  path: requestedPath,
                  token,
                  items: [],
                  done: true,
                  error: err?.message || String(err),
                  errorCode: err?.errorCode || err?.code || null,
                  errorKind: err?.errorKind || null,
                  retryable: err?.retryable === true,
                  module: err?.module || null,
                  operation: err?.operation || null,
                });
              }
            } catch {
              /* intentionally ignored */
            }
          })
          .finally(() => {
            this._removeActiveDirectoryRead(token);
          });

        return { success: true, data: [], chunked: true, token };
      }

      return nativeSftpClient.listFiles(tabId, remotePath);
    },

    async cancelListFiles(event, tabId, token = null) {
      const normalizedTabId = String(tabId ?? "");
      if (!normalizedTabId) {
        throw new Error("tabId is required");
      }

      if (token) {
        const entry = this.activeDirectoryReads.get(String(token));
        if (!entry || entry.tabId !== normalizedTabId) {
          return { success: true, cancelledCount: 0 };
        }

        return {
          success: true,
          cancelledCount: this._cancelActiveDirectoryRead(token) ? 1 : 0,
        };
      }

      let cancelledCount = 0;
      for (const [activeToken, entry] of this.activeDirectoryReads.entries()) {
        if (entry.tabId !== normalizedTabId) continue;
        if (this._cancelActiveDirectoryRead(activeToken)) {
          cancelledCount += 1;
        }
      }

      return { success: true, cancelledCount };
    },

    async startDirectoryWatch(event, tabId, remotePath, options = {}) {
      const normalizedTabId = String(tabId ?? "");
      if (!normalizedTabId) {
        throw new Error("tabId is required");
      }

      const sender = event?.sender;
      if (!sender || sender.isDestroyed()) {
        throw new Error("renderer is unavailable");
      }

      const ownerKey = this._getDirectoryWatchOwnerKey(sender, normalizedTabId);
      const previousWatchId = this.activeDirectoryWatchOwners.get(ownerKey);
      if (previousWatchId) {
        const previousEntry = this._findDirectoryWatchById(previousWatchId);
        this._stopActiveDirectoryWatch(previousEntry, "replaced");
      }

      const watchId = this._generateDirectoryWatchId();
      const requestedPath =
        typeof remotePath === "string" ? remotePath : String(remotePath ?? "");

      const entry = {
        watchId,
        tabId: normalizedTabId,
        path: requestedPath,
        ownerKey,
        sender,
        controller: null,
        stopped: false,
        stopReason: null,
        removeDestroyedListener: null,
      };

      const handleSenderDestroyed = () => {
        this._stopActiveDirectoryWatch(entry, "renderer-destroyed");
      };
      sender.on("destroyed", handleSenderDestroyed);
      entry.removeDestroyedListener = () => {
        try {
          sender.removeListener("destroyed", handleSenderDestroyed);
        } catch {
          // ignore listener cleanup failures
        }
      };

      let controller;
      try {
        controller = await nativeSftpClient.watchDirectory(
          normalizedTabId,
          requestedPath,
          {
            intervalMs: options?.intervalMs,
            onChanged: (payload) => {
              if (!this.activeDirectoryWatches.has(watchId)) {
                return;
              }
              this._sendDirectoryWatchEvent(entry, "changed", payload);
            },
            onError: (error) => {
              if (!this.activeDirectoryWatches.has(watchId)) {
                return;
              }
              this._sendDirectoryWatchEvent(entry, "error", {
                error: error?.message || String(error),
              });
            },
            onExit: () => {
              const isStillActive =
                this.activeDirectoryWatches.get(watchId) === entry;
              if (isStillActive) {
                this._removeActiveDirectoryWatch(entry);
              }
            },
          },
        );
      } catch (error) {
        entry.removeDestroyedListener?.();
        entry.removeDestroyedListener = null;
        throw error;
      }

      entry.controller = controller;
      this.activeDirectoryWatches.set(watchId, entry);
      this.activeDirectoryWatchOwners.set(ownerKey, watchId);

      return {
        success: true,
        watchId,
        path: requestedPath,
      };
    },

    async stopDirectoryWatch(event, tabId, watchId = null) {
      const normalizedTabId = String(tabId ?? "");
      if (!normalizedTabId) {
        throw new Error("tabId is required");
      }

      if (watchId) {
        const entry = this._findDirectoryWatchById(watchId);
        if (!entry || entry.tabId !== normalizedTabId) {
          return { success: true, stopped: false };
        }

        return {
          success: true,
          stopped: this._stopActiveDirectoryWatch(entry, "client-stop"),
        };
      }

      const ownerKey = this._getDirectoryWatchOwnerKey(
        event?.sender,
        normalizedTabId,
      );
      const activeWatchId = this.activeDirectoryWatchOwners.get(ownerKey);
      if (!activeWatchId) {
        return { success: true, stopped: false };
      }

      const entry = this._findDirectoryWatchById(activeWatchId);
      return {
        success: true,
        stopped: this._stopActiveDirectoryWatch(entry, "client-stop"),
      };
    },
  };
}

module.exports = createDirectoryListingAndWatchMethods;
