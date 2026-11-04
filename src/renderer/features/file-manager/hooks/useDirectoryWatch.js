import { useEffect, useRef } from "react";
import {
  DIRECTORY_WATCH_INTERVAL_MS,
  toApiPath,
} from "../lib/directoryListing.js";

/**
 * Keeps one remote directory watch bound to the visible directory and turns
 * its change events into pending background refreshes.
 */
export default function useDirectoryWatch({
  open,
  sshConnection,
  tabId,
  currentPath,
  showNotification,
  t,
  pendingDirectoryWatchRefreshRef,
  directoryWatchRefreshRetryTimerRef,
  flushPendingDirectoryWatchRefresh,
}) {
  const directoryWatchIdRef = useRef(null);

  const directoryWatchPathRef = useRef(null);

  const directoryWatchGenerationRef = useRef(0);

  useEffect(() => {
    if (!window.terminalAPI?.onDirectoryWatchEvent || !tabId) {
      return undefined;
    }

    const unsubscribe = window.terminalAPI.onDirectoryWatchEvent((event) => {
      if (!event || event.tabId !== String(tabId)) {
        return;
      }

      if (
        !directoryWatchIdRef.current ||
        event.watchId !== directoryWatchIdRef.current ||
        event.path !== directoryWatchPathRef.current
      ) {
        return;
      }

      if (event.event === "changed") {
        pendingDirectoryWatchRefreshRef.current = true;
        flushPendingDirectoryWatchRefresh();
        return;
      }

      if (event.event === "error") {
        directoryWatchIdRef.current = null;
        directoryWatchPathRef.current = null;
        showNotification(
          t("fileManager.errors.directoryWatchFailed", {
            error: event.error || t("fileManager.errors.unknownError"),
          }),
          "error",
          6000,
        );
      }
    });

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [tabId, flushPendingDirectoryWatchRefresh, showNotification, t]);

  useEffect(() => {
    const generation = ++directoryWatchGenerationRef.current;
    let cancelled = false;

    const stopWatch = async (watchId) => {
      if (!watchId || !window.terminalAPI?.stopDirectoryWatch || !tabId) {
        return;
      }

      try {
        await window.terminalAPI.stopDirectoryWatch(tabId, watchId);
      } catch {
        /* intentionally ignored */
      }
    };

    const syncDirectoryWatch = async () => {
      const previousWatchId = directoryWatchIdRef.current;
      directoryWatchIdRef.current = null;
      directoryWatchPathRef.current = null;
      pendingDirectoryWatchRefreshRef.current = false;

      try {
        if (directoryWatchRefreshRetryTimerRef.current) {
          clearTimeout(directoryWatchRefreshRetryTimerRef.current);
        }
      } catch {
        /* intentionally ignored */
      }
      directoryWatchRefreshRetryTimerRef.current = null;

      if (previousWatchId) {
        await stopWatch(previousWatchId);
      }

      if (
        cancelled ||
        generation !== directoryWatchGenerationRef.current ||
        !open ||
        !sshConnection ||
        !tabId ||
        !window.terminalAPI?.startDirectoryWatch
      ) {
        return;
      }

      const watchPath = toApiPath(currentPath);

      try {
        const response = await window.terminalAPI.startDirectoryWatch(
          tabId,
          watchPath,
          {
            intervalMs: DIRECTORY_WATCH_INTERVAL_MS,
          },
        );

        if (cancelled || generation !== directoryWatchGenerationRef.current) {
          if (response?.success && response.watchId) {
            await stopWatch(response.watchId);
          }
          return;
        }

        if (!response?.success || !response?.watchId) {
          showNotification(
            t("fileManager.errors.directoryWatchFailed", {
              error: response?.error || t("fileManager.errors.unknownError"),
            }),
            "error",
            6000,
          );
          return;
        }

        directoryWatchIdRef.current = response.watchId;
        directoryWatchPathRef.current = watchPath;
      } catch (error) {
        if (cancelled || generation !== directoryWatchGenerationRef.current) {
          return;
        }

        showNotification(
          t("fileManager.errors.directoryWatchFailed", {
            error: error?.message || t("fileManager.errors.unknownError"),
          }),
          "error",
          6000,
        );
      }
    };

    syncDirectoryWatch().catch(() => {});

    return () => {
      cancelled = true;
      directoryWatchGenerationRef.current += 1;
      const activeWatchId = directoryWatchIdRef.current;
      directoryWatchIdRef.current = null;
      directoryWatchPathRef.current = null;
      pendingDirectoryWatchRefreshRef.current = false;

      try {
        if (directoryWatchRefreshRetryTimerRef.current) {
          clearTimeout(directoryWatchRefreshRetryTimerRef.current);
        }
      } catch {
        /* intentionally ignored */
      }
      directoryWatchRefreshRetryTimerRef.current = null;

      void stopWatch(activeWatchId);
    };
  }, [
    open,
    sshConnection,
    tabId,
    currentPath,
    toApiPath,
    showNotification,
    t,
    DIRECTORY_WATCH_INTERVAL_MS,
  ]);
}
