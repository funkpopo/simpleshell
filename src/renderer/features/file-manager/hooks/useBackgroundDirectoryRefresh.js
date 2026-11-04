import { useCallback, useEffect, useRef } from "react";
import {
  BACKGROUND_REFRESH_MAX_IN_FLIGHT_MS,
  BACKGROUND_REFRESH_MIN_INTERVAL_MS,
  toApiPath,
} from "../lib/directoryListing.js";

/**
 * Low-priority, non-blocking refreshes of the visible directory (user activity
 * and directory-watch driven). Results are applied by the chunk stream; this
 * hook owns the in-flight lock, watchdog and pending watch-refresh retries.
 */
export default function useBackgroundDirectoryRefresh({
  open,
  sshConnection,
  tabId,
  t,
  currentPath,
  isChunking,
  listToken,
  loading,
  openRef,
  currentPathRef,
  loadingRef,
  isChunkingRef,
  listTokenRef,
  lastRefreshTimeRef,
  backgroundListRequestRef,
  backgroundListBufferRef,
  backgroundListLastAttemptAtRef,
  foregroundLoadCountRef,
  pendingDirectoryWatchRefreshRef,
  directoryWatchRefreshRetryTimerRef,
}) {
  const startBackgroundDirectoryRefresh = useCallback(
    async ({ reason = "userActivity", awaitDone = true } = {}) => {
      const curPath = currentPathRef.current;
      const curLoading = loadingRef.current;
      const curChunking = isChunkingRef.current;
      const curListToken = listTokenRef.current;
      const curLastRefresh = lastRefreshTimeRef.current;

      // 仅在侧边栏打开且连接信息齐全时运行
      if (!open || !sshConnection || !tabId || !curPath) {
        return { ok: false, skipped: true, reason: "missingContext" };
      }
      if (!window.terminalAPI || !window.terminalAPI.listFiles) {
        return { ok: false, skipped: true, reason: "apiUnavailable" };
      }

      // 避免与前台目录加载/分片渲染并发，减少队列积压
      if (
        foregroundLoadCountRef.current > 0 ||
        curLoading ||
        curChunking ||
        curListToken
      ) {
        return { ok: false, skipped: true, reason: "busy" };
      }

      // 避免在一次刷新刚完成后立即再次刷新，减少竞态/抖动
      try {
        if (curLastRefresh && Date.now() - curLastRefresh < 700) {
          return { ok: false, skipped: true, reason: "recentlyRefreshed" };
        }
      } catch {
        /* intentionally ignored */
      }

      const now = Date.now();
      const lastAttempt = backgroundListLastAttemptAtRef.current || 0;
      if (now - lastAttempt < BACKGROUND_REFRESH_MIN_INTERVAL_MS) {
        return { ok: false, skipped: true, reason: "throttled" };
      }
      backgroundListLastAttemptAtRef.current = now;

      const bg = backgroundListRequestRef.current;
      if (bg.inFlight) {
        // 超过最大等待时间认为卡死，释放锁（防止一直无法刷新）
        if (
          bg.startedAt &&
          now - bg.startedAt > BACKGROUND_REFRESH_MAX_IN_FLIGHT_MS
        ) {
          try {
            if (bg.watchdog) clearTimeout(bg.watchdog);
          } catch {
            /* intentionally ignored */
          }
          bg.watchdog = null;
          bg.inFlight = false;
          bg.token = null;
          bg.apiPath = null;
          bg.startedAt = 0;
          bg.reason = null;
          bg.resolve = null;
          bg.reject = null;
          backgroundListBufferRef.current = [];
        } else {
          return { ok: false, skipped: true, reason: "inFlight" };
        }
      }

      const apiPath = toApiPath(curPath);

      // 初始化后台刷新上下文（结果由 listFiles:chunk done 回调统一处理）
      bg.inFlight = true;
      bg.token = null;
      bg.apiPath = apiPath;
      bg.startedAt = now;
      bg.reason = reason;
      backgroundListBufferRef.current = [];

      const donePromise = new Promise((resolve) => {
        bg.resolve = resolve;
      });

      const options = {
        type: "readdir",
        path: apiPath,
        canMerge: true,
        priority: "low",
        nonBlocking: true,
        chunkSize: 300,
      };

      let response = null;
      try {
        response = await window.terminalAPI.listFiles(tabId, apiPath, options);
      } catch (error) {
        const resolve = bg.resolve;
        bg.inFlight = false;
        bg.token = null;
        bg.apiPath = null;
        bg.startedAt = 0;
        bg.reason = null;
        bg.resolve = null;
        bg.reject = null;
        backgroundListBufferRef.current = [];
        if (typeof resolve === "function") {
          resolve({ ok: false, error: error?.message || String(error) });
        }
        return { ok: false, error: error?.message || String(error) };
      }

      if (!response?.success) {
        const resolve = bg.resolve;
        bg.inFlight = false;
        bg.token = null;
        bg.apiPath = null;
        bg.startedAt = 0;
        bg.reason = null;
        bg.resolve = null;
        bg.reject = null;
        backgroundListBufferRef.current = [];
        if (typeof resolve === "function") {
          resolve({
            ok: false,
            error: response?.error || t("fileManager.errors.listFilesFailed"),
          });
        }
        return {
          ok: false,
          error: response?.error || t("fileManager.errors.listFilesFailed"),
        };
      }

      // nonBlocking 模式下依赖 token + chunk 事件完成
      if (response.chunked && response.token) {
        bg.token = response.token;

        // watchdog：避免主进程/IPC异常导致 inFlight 永久卡住
        try {
          if (bg.watchdog) clearTimeout(bg.watchdog);
        } catch {
          /* intentionally ignored */
        }
        bg.watchdog = setTimeout(() => {
          try {
            const cur = backgroundListRequestRef.current;
            if (cur && cur.inFlight && cur.token === response.token) {
              const resolve = cur.resolve;
              cur.inFlight = false;
              cur.token = null;
              cur.apiPath = null;
              cur.startedAt = 0;
              cur.reason = null;
              cur.resolve = null;
              cur.reject = null;
              try {
                if (cur.watchdog) clearTimeout(cur.watchdog);
              } catch {
                /* intentionally ignored */
              }
              cur.watchdog = null;
              backgroundListBufferRef.current = [];
              if (typeof resolve === "function") {
                resolve({ ok: false, timeout: true });
              }
            }
          } catch {
            /* intentionally ignored */
          }
        }, BACKGROUND_REFRESH_MAX_IN_FLIGHT_MS);

        if (awaitDone) {
          return await donePromise;
        }

        // fire-and-forget 场景：避免未捕获 promise
        donePromise.catch(() => {});
        return { ok: true, started: true };
      }

      // 非阻塞刷新必须返回 token；没有 token 视为协议错误。
      const resolve = bg.resolve;
      bg.inFlight = false;
      bg.token = null;
      bg.apiPath = null;
      bg.startedAt = 0;
      bg.reason = null;
      bg.resolve = null;
      bg.reject = null;
      backgroundListBufferRef.current = [];
      const protocolError = t("fileManager.errors.listFilesTokenMissing");
      if (typeof resolve === "function") {
        resolve({ ok: false, error: protocolError });
      }
      return { ok: false, error: protocolError };
    },
    [open, sshConnection, tabId, toApiPath],
  );

  const silentRefreshCurrentDirectory = useCallback(() => {
    startBackgroundDirectoryRefresh({
      reason: "userActivity",
      awaitDone: false,
    }).catch(() => {});
  }, [startBackgroundDirectoryRefresh]);

  const flushPendingDirectoryWatchRefreshRef = useRef(null);

  const scheduleDirectoryWatchRefreshRetry = useCallback(
    (delayMs = BACKGROUND_REFRESH_MIN_INTERVAL_MS) => {
      try {
        if (directoryWatchRefreshRetryTimerRef.current) {
          clearTimeout(directoryWatchRefreshRetryTimerRef.current);
        }
      } catch {
        /* intentionally ignored */
      }

      directoryWatchRefreshRetryTimerRef.current = setTimeout(
        () => {
          if (
            typeof flushPendingDirectoryWatchRefreshRef.current === "function"
          ) {
            flushPendingDirectoryWatchRefreshRef.current();
          }
        },
        Math.max(250, delayMs),
      );
    },
    [],
  );

  const flushPendingDirectoryWatchRefresh = useCallback(() => {
    if (!pendingDirectoryWatchRefreshRef.current) {
      return;
    }

    if (
      !openRef.current ||
      !sshConnection ||
      !tabId ||
      !currentPathRef.current
    ) {
      return;
    }

    if (
      foregroundLoadCountRef.current > 0 ||
      loadingRef.current ||
      isChunkingRef.current ||
      listTokenRef.current
    ) {
      scheduleDirectoryWatchRefreshRetry(500);
      return;
    }

    pendingDirectoryWatchRefreshRef.current = false;

    startBackgroundDirectoryRefresh({
      reason: "directoryWatch",
      awaitDone: false,
    })
      .then((result) => {
        if (result?.ok) {
          return;
        }

        pendingDirectoryWatchRefreshRef.current = true;
        if (openRef.current) {
          scheduleDirectoryWatchRefreshRetry(
            result?.skipped ? 500 : BACKGROUND_REFRESH_MIN_INTERVAL_MS,
          );
        }
      })
      .catch(() => {
        pendingDirectoryWatchRefreshRef.current = true;
        if (openRef.current) {
          scheduleDirectoryWatchRefreshRetry(
            BACKGROUND_REFRESH_MIN_INTERVAL_MS,
          );
        }
      });
  }, [
    sshConnection,
    tabId,
    startBackgroundDirectoryRefresh,
    scheduleDirectoryWatchRefreshRetry,
  ]);

  flushPendingDirectoryWatchRefreshRef.current =
    flushPendingDirectoryWatchRefresh;

  useEffect(() => {
    flushPendingDirectoryWatchRefresh();
  }, [
    currentPath,
    isChunking,
    listToken,
    loading,
    flushPendingDirectoryWatchRefresh,
  ]);

  useEffect(() => {
    return () => {
      try {
        if (directoryWatchRefreshRetryTimerRef.current) {
          clearTimeout(directoryWatchRefreshRetryTimerRef.current);
        }
      } catch {
        /* intentionally ignored */
      }
      directoryWatchRefreshRetryTimerRef.current = null;

      const bg = backgroundListRequestRef.current;
      if (bg && bg.inFlight) {
        try {
          if (bg.watchdog) clearTimeout(bg.watchdog);
        } catch {
          /* intentionally ignored */
        }
        const resolve = bg.resolve;
        bg.inFlight = false;
        bg.token = null;
        bg.apiPath = null;
        bg.startedAt = 0;
        bg.reason = null;
        bg.resolve = null;
        bg.reject = null;
        bg.watchdog = null;
        backgroundListBufferRef.current = [];
        if (typeof resolve === "function") {
          resolve({ ok: false, cancelled: true });
        }
      }
    };
  }, [open, sshConnection, tabId, currentPath]);

  return {
    silentRefreshCurrentDirectory,
    flushPendingDirectoryWatchRefresh,
  };
}
