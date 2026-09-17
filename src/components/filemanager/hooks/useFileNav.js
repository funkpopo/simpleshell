import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import useAutoCleanup from "../../../hooks/useAutoCleanup.js";
import { debounce } from "../../../core/utils/performance.js";
import { useTranslation } from "react-i18next";
import { useFollowTerminalDirectory } from "../../../hooks/useFollowTerminalDirectory.js";
import {
  FILE_MANAGER_PATH_HISTORY_LIMIT,
  normalizeNavigationState,
} from "../fileManagerUtils.js";
/** Owns directory requests, cache, history and watches. Selection consumes its committed results. */
export default function useFileNav({
  open,
  initialPath,
  navigationState,
  tabId,
  onNavigationStateChange,
  onPathChange,
  sshConnection,
  showNotification,
  followTerminalDirectory,
}) {
  const { t } = useTranslation();
  const { addTimeout } = useAutoCleanup();
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  const [selectionResetKey, setSelectionResetKey] = useState(0);
  const resetSelection = useCallback(
    () => setSelectionResetKey((key) => key + 1),
    [],
  );
  const normalizedInitialPath =
    typeof initialPath === "string" && initialPath.trim() ? initialPath : "/";

  const initialNavigationState = useMemo(
    () => normalizeNavigationState(navigationState, normalizedInitialPath),
    [navigationState, normalizedInitialPath],
  );

  const [currentPath, setCurrentPath] = useState(normalizedInitialPath);

  const [files, setFiles] = useState([]);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState(null);

  const [connectionLoading, setConnectionLoading] = useState(false);

  const [connectionLoadingMessage, setConnectionLoadingMessage] = useState("");

  const [lastRefreshTime, setLastRefreshTime] = useState(null);

  const [, forceUpdate] = useState(0);

  const directoryCacheRef = useRef(new Map());

  const currentPathRef = useRef(currentPath);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  const loadingRef = useRef(loading);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    if (!open) {
      setConnectionLoading(false);
      setConnectionLoadingMessage("");
    }
  }, [open]);

  const lastRefreshTimeRef = useRef(lastRefreshTime);

  useEffect(() => {
    lastRefreshTimeRef.current = lastRefreshTime;
  }, [lastRefreshTime]);

  const markLastRefreshTime = useCallback((timestamp = Date.now()) => {
    lastRefreshTimeRef.current = timestamp;
    setLastRefreshTime(timestamp);
  }, []);

  const [pathInput, setPathInput] = useState(normalizedInitialPath);

  const [pathHistory, setPathHistory] = useState(
    initialNavigationState.pathHistory,
  );

  const [historyIndex, setHistoryIndex] = useState(
    initialNavigationState.historyIndex,
  );

  const pathHistoryRef = useRef(pathHistory);

  useEffect(() => {
    pathHistoryRef.current = pathHistory;
  }, [pathHistory]);

  const historyIndexRef = useRef(historyIndex);

  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  useEffect(() => {
    if (!tabId || typeof onNavigationStateChange !== "function") {
      return;
    }

    onNavigationStateChange(tabId, {
      pathHistory,
      historyIndex,
    });
  }, [tabId, pathHistory, historyIndex, onNavigationStateChange]);

  const skipInitialPathSyncRef = useRef(false);

  const previousInitialPathRef = useRef(normalizedInitialPath);

  const throttledLoadStateRef = useRef({
    lastExecution: 0,
    timeoutId: null,
  });

  const [isChunking, setIsChunking] = useState(false);

  const isChunkingRef = useRef(isChunking);

  useEffect(() => {
    isChunkingRef.current = isChunking;
  }, [isChunking]);

  const chunkBufferRef = useRef([]);

  const flushTimerRef = useRef(null);

  const filesRef = useRef(files);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const CACHE_EXPIRY_TIME = 10000;

  const MAX_DIRECTORY_CACHE_ENTRIES = 500;

  const USER_ACTIVITY_REFRESH_DELAY = 300;

  const DIRECTORY_WATCH_INTERVAL_MS = 1500;

  const BACKGROUND_REFRESH_MIN_INTERVAL_MS = 2000;

  const BACKGROUND_REFRESH_MAX_IN_FLIGHT_MS = 60000;

  const updateCurrentPath = (newPath, isHistoryNavigation = false) => {
    currentPathRef.current = newPath;
    setCurrentPath(newPath);
    if (onPathChange && tabId) {
      skipInitialPathSyncRef.current = true;
      onPathChange(tabId, newPath);
    }

    // 只有在非历史导航时才添加到历史记录
    if (!isHistoryNavigation) {
      addToHistory(newPath);
    }
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    if (!tabId) {
      setError(t("fileManager.errors.missingConnectionInfo"));
      return;
    }

    if (!sshConnection) {
      setError(t("fileManager.errors.missingConnectionInfo"));
      return;
    }

    // 先检查API是否可用
    if (!window.terminalAPI || !window.terminalAPI.listFiles) {
      setError(t("fileManager.errors.fileApiNotAvailable"));
      return;
    }

    // 使用记忆的路径或默认路径
    const pathToLoad = normalizedInitialPath;
    const isSamePath = pathToLoad === currentPathRef.current;
    const initialPathChanged =
      previousInitialPathRef.current !== normalizedInitialPath;
    previousInitialPathRef.current = normalizedInitialPath;

    if (skipInitialPathSyncRef.current && initialPathChanged && isSamePath) {
      skipInitialPathSyncRef.current = false;
      setPathInput(pathToLoad);
      return;
    }

    skipInitialPathSyncRef.current = false;

    // 清空缓存
    directoryCacheRef.current.clear();

    currentPathRef.current = pathToLoad;
    setCurrentPath(pathToLoad);
    setPathInput(pathToLoad);
    loadDirectory(pathToLoad, 0, false, true);
  }, [open, sshConnection, tabId, normalizedInitialPath]);

  const [listToken, setListToken] = useState(null);

  const listTokenRef = useRef(listToken);

  useEffect(() => {
    listTokenRef.current = listToken;
  }, [listToken]);

  const backgroundListRequestRef = useRef({
    inFlight: false,
    token: null,
    apiPath: null,
    startedAt: 0,
    reason: null, // "directoryWatch" | "userActivity" | "manual" | ...
    resolve: null,
    reject: null,
    watchdog: null,
  });

  const backgroundListBufferRef = useRef([]);

  const backgroundListLastAttemptAtRef = useRef(0);

  const foregroundLoadCountRef = useRef(0);

  const activeForegroundLoadRequestIdRef = useRef(0);

  const stableListSignatureRef = useRef(null);

  const stableListSignatureKeyRef = useRef(null);

  const directoryWatchIdRef = useRef(null);

  const directoryWatchPathRef = useRef(null);

  const directoryWatchGenerationRef = useRef(0);

  const pendingDirectoryWatchRefreshRef = useRef(false);

  const directoryWatchRefreshRetryTimerRef = useRef(null);

  const toApiPath = useCallback((path) => {
    if (path === "~") return "";
    return path || "";
  }, []);

  const makeListKey = useCallback((id, apiPath) => {
    return `${id || ""}::${apiPath || ""}`;
  }, []);

  const computeFileListSignature = useCallback((list) => {
    if (!Array.isArray(list) || list.length === 0) return "0:0:0";

    let xor = 0;
    let sum = 0;

    for (let i = 0; i < list.length; i++) {
      const f = list[i] || {};
      const name = typeof f.name === "string" ? f.name : "";
      const modifyTime = Number.isFinite(f.modifyTime) ? f.modifyTime : 0;
      const size = Number.isFinite(f.size) ? f.size : 0;
      const isDir = f.isDirectory ? 1 : 0;

      // FNV-1a 32-bit (via Math.imul for speed)
      let h = 2166136261;
      const s = `${name}\u0000${modifyTime}\u0000${size}\u0000${isDir}`;
      for (let j = 0; j < s.length; j++) {
        h ^= s.charCodeAt(j);
        h = Math.imul(h, 16777619);
      }
      h >>>= 0;

      xor ^= h;
      sum = (sum + h) >>> 0;
    }

    return `${list.length}:${(xor >>> 0).toString(16)}:${sum.toString(16)}`;
  }, []);

  const getDirectoryFromCache = (path) => {
    const cacheEntry = directoryCacheRef.current.get(path);
    if (!cacheEntry) {
      return null;
    }
    const now = Date.now();

    // 检查缓存是否过期
    if (now - cacheEntry.timestamp > CACHE_EXPIRY_TIME) {
      return null;
    }
    return cacheEntry.data;
  };

  const updateDirectoryCache = (path, data) => {
    const cache = directoryCacheRef.current;
    cache.set(path, {
      data,
      timestamp: Date.now(),
    });

    // LRU: 超过上限则删除最旧条目
    if (cache.size > MAX_DIRECTORY_CACHE_ENTRIES) {
      const oldestPath = cache.keys().next().value;
      cache.delete(oldestPath);
    }
  };

  useEffect(() => {
    if (!window.terminalAPI || !window.terminalAPI.onListFilesChunk) return;

    const unsubscribe = window.terminalAPI.onListFilesChunk((payload) => {
      try {
        // 侧边栏关闭或组件未挂载时忽略异步分片更新，防止竞态/异常
        if (!openRef.current) return;
        if (!payload || payload.tabId !== tabId || !payload.token) return;

        const apiPath = toApiPath(currentPathRef.current);
        const bg = backgroundListRequestRef.current;
        const fgToken = listTokenRef.current;

        const isForeground =
          payload.path === apiPath && payload.token === fgToken;
        const isBackground =
          Boolean(bg?.inFlight) &&
          payload.path === bg.apiPath &&
          payload.token === bg.token;

        if (!isForeground && !isBackground) return;

        // 后台刷新：先缓冲，done 时再一次性判断变化并更新 UI（避免轮询导致列表闪烁/重置选择）
        if (isBackground) {
          if (Array.isArray(payload.items) && payload.items.length > 0) {
            // 直接 push，避免 concat 产生额外数组
            backgroundListBufferRef.current.push(...payload.items);
          }

          if (payload.done) {
            const nextList = Array.isArray(backgroundListBufferRef.current)
              ? backgroundListBufferRef.current
              : [];
            backgroundListBufferRef.current = [];

            // 清理 watchdog/状态
            try {
              if (bg.watchdog) clearTimeout(bg.watchdog);
            } catch {
              /* intentionally ignored */
            }
            bg.watchdog = null;

            const resolve = bg.resolve;
            bg.inFlight = false;
            bg.token = null;
            bg.apiPath = null;
            bg.startedAt = 0;
            bg.reason = null;
            bg.resolve = null;
            bg.reject = null;

            // 路径切换/前台加载时丢弃后台结果（避免覆盖用户的显式操作）
            const stillSamePath =
              toApiPath(currentPathRef.current) === payload.path;
            const canApply =
              stillSamePath &&
              foregroundLoadCountRef.current === 0 &&
              !loadingRef.current &&
              !listTokenRef.current &&
              !isChunkingRef.current;

            if (canApply) {
              const key = makeListKey(tabId, payload.path);
              const prevSig =
                stableListSignatureKeyRef.current === key
                  ? stableListSignatureRef.current
                  : computeFileListSignature(filesRef.current || []);
              const nextSig = computeFileListSignature(nextList);
              const changed = prevSig !== nextSig;

              // 即使未变化，也更新缓存与刷新时间（保证侧边栏“最近刷新”正确）
              updateDirectoryCache(currentPathRef.current, nextList);
              markLastRefreshTime();

              if (changed) {
                setFiles(nextList);
              }

              stableListSignatureKeyRef.current = key;
              stableListSignatureRef.current = nextSig;

              if (typeof resolve === "function") {
                resolve({ ok: true, changed });
              }
            } else {
              if (typeof resolve === "function") {
                resolve({ ok: true, changed: false, discarded: true });
              }
            }
          }
          return;
        }

        // 前台目录加载：分片增量更新 UI
        if (Array.isArray(payload.items) && payload.items.length > 0) {
          isChunkingRef.current = true;
          setIsChunking(true);

          // buffer chunks and batch update to reduce re-renders
          try {
            chunkBufferRef.current.push(payload.items);
            if (!flushTimerRef.current) {
              flushTimerRef.current = setTimeout(() => {
                try {
                  const buffered = chunkBufferRef.current.flat();
                  chunkBufferRef.current = [];
                  if (buffered.length > 0) {
                    const nextFiles = (filesRef.current || []).concat(buffered);
                    filesRef.current = nextFiles;
                    setFiles(nextFiles);
                  }
                } finally {
                  flushTimerRef.current = null;
                }
              }, 80);
            }
          } catch {
            setFiles((prev) => prev.concat(payload.items));
          }
        }

        // finalize chunked loading with buffer flush
        if (payload.done) {
          if (flushTimerRef.current) {
            clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
          }
          const remaining = chunkBufferRef.current.flat();
          chunkBufferRef.current = [];
          if (remaining.length > 0) {
            const nextFiles = (filesRef.current || []).concat(remaining);
            filesRef.current = nextFiles;
            setFiles(nextFiles);
          }

          updateDirectoryCache(currentPathRef.current, filesRef.current || []);

          // 更新稳定签名，供轮询快速比较
          try {
            const key = makeListKey(tabId, apiPath);
            stableListSignatureKeyRef.current = key;
            stableListSignatureRef.current = computeFileListSignature(
              filesRef.current || [],
            );
          } catch {
            /* intentionally ignored */
          }

          listTokenRef.current = null;
          setListToken(null);
          isChunkingRef.current = false;
          setIsChunking(false);
          markLastRefreshTime();
        }
      } catch {
        // ignore
      }
    });

    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [
    tabId,
    toApiPath,
    makeListKey,
    computeFileListSignature,
    markLastRefreshTime,
  ]);

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
            error: response?.error || "listFiles failed",
          });
        }
        return { ok: false, error: response?.error || "listFiles failed" };
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
      const protocolError = "listFiles nonBlocking response missing token";
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

  const updatePathHistoryState = useCallback((nextHistory, nextIndex) => {
    pathHistoryRef.current = nextHistory;
    historyIndexRef.current = nextIndex;
    setPathHistory(nextHistory);
    setHistoryIndex(nextIndex);
  }, []);

  const addToHistory = useCallback(
    (path) => {
      const currentHistory = Array.isArray(pathHistoryRef.current)
        ? pathHistoryRef.current
        : [];
      const currentIndex = Number.isInteger(historyIndexRef.current)
        ? historyIndexRef.current
        : -1;
      const baseHistory =
        currentIndex >= 0 ? currentHistory.slice(0, currentIndex + 1) : [];

      let nextHistory = baseHistory;
      let nextIndex = currentIndex;

      if (
        baseHistory.length === 0 ||
        baseHistory[baseHistory.length - 1] !== path
      ) {
        nextHistory = [...baseHistory, path];
        if (nextHistory.length > FILE_MANAGER_PATH_HISTORY_LIMIT) {
          nextHistory = nextHistory.slice(-FILE_MANAGER_PATH_HISTORY_LIMIT);
        }
        nextIndex = nextHistory.length - 1;
      } else {
        nextIndex = baseHistory.length - 1;
      }

      updatePathHistoryState(nextHistory, nextIndex);
    },
    [updatePathHistoryState],
  );

  const loadDirectory = async (
    path,
    retryCount = 0,
    forceRefresh = false,
    isHistoryNavigation = false,
    requestId = undefined,
    followRequest = null,
  ) => {
    const loadRequestId =
      typeof requestId === "number"
        ? requestId
        : (activeForegroundLoadRequestIdRef.current += 1);
    if (followRequest) followRequest.id = loadRequestId;
    const isCurrentLoadRequest = () =>
      activeForegroundLoadRequestIdRef.current === loadRequestId &&
      !followRequest?.signal.aborted;

    if (!isCurrentLoadRequest()) {
      return;
    }

    if (!sshConnection || !tabId) {
      if (isCurrentLoadRequest()) {
        setError(t("fileManager.errors.missingConnectionInfo"));
      }
      return;
    }

    // 切换路径时重置前台分片状态，避免旧分片残留导致持续加载
    try {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
      }
    } catch {
      /* intentionally ignored */
    }
    flushTimerRef.current = null;
    chunkBufferRef.current = [];
    if (listTokenRef.current) {
      listTokenRef.current = null;
      setListToken(null);
    }
    if (isChunkingRef.current) {
      isChunkingRef.current = false;
      setIsChunking(false);
    }

    const isPathChanged = path !== currentPathRef.current;

    // 如果不是强制刷新，尝试从缓存获取数据
    if (!forceRefresh) {
      const cachedData = getDirectoryFromCache(path);
      if (cachedData) {
        if (!isCurrentLoadRequest()) {
          return;
        }
        filesRef.current = cachedData;
        setFiles(cachedData);
        updateCurrentPath(path, isHistoryNavigation);
        setPathInput(path);
        if (isPathChanged) {
          resetSelection();
        }
        return;
      }
    }

    foregroundLoadCountRef.current += 1;
    let foregroundLoadReleased = false;
    const releaseForegroundLoad = () => {
      if (foregroundLoadReleased) return;
      foregroundLoadReleased = true;
      foregroundLoadCountRef.current = Math.max(
        0,
        foregroundLoadCountRef.current - 1,
      );
    };
    const cancelFollowRequest = () => {
      releaseForegroundLoad();
      if (activeForegroundLoadRequestIdRef.current !== loadRequestId) return;
      activeForegroundLoadRequestIdRef.current += 1;
      setLoading(false);
      setConnectionLoading(false);
      setConnectionLoadingMessage("");
    };
    followRequest?.signal.addEventListener("abort", cancelFollowRequest, {
      once: true,
    });
    setLoading(!followRequest);
    setError(null);
    let isRetrying = false; // 标记是否正在重试

    try {
      if (!isCurrentLoadRequest()) {
        return;
      }

      if (isPathChanged && !followRequest) {
        // 进入新目录前同步清空 ref/state，避免旧列表在分片到达前残留
        filesRef.current = [];
        setFiles([]);
        resetSelection();
      }

      if (window.terminalAPI && window.terminalAPI.listFiles) {
        // 将~转换为空字符串，用于API调用
        const apiPath = path === "~" ? "" : path;

        // 使用可合并的目录读取操作
        const options = {
          type: "readdir",
          path: apiPath,
          canMerge: true,
          priority: forceRefresh ? "high" : "normal",
          // Automatic navigation commits only after a successful read.
          // Keep the current directory intact on errors and cancellation.
          nonBlocking: !followRequest,
          chunkSize: 300,
        };

        const response = await window.terminalAPI.listFiles(
          tabId,
          apiPath,
          options,
        );

        if (!isCurrentLoadRequest()) {
          return;
        }

        if (response?.success) {
          setConnectionLoading(false);
          setConnectionLoadingMessage("");
          const fileData = Array.isArray(response.data) ? response.data : [];
          if (response.chunked && response.token) {
            listTokenRef.current = response.token;
            setListToken(response.token);
            isChunkingRef.current = true;
            setIsChunking(true);
          } else {
            listTokenRef.current = null;
            setListToken(null);
            isChunkingRef.current = false;
            setIsChunking(false);
          }

          // 更新缓存
          updateDirectoryCache(path, fileData);

          filesRef.current = fileData;
          setFiles(fileData);
          updateCurrentPath(path, isHistoryNavigation); // 保持UI中显示~
          setPathInput(path);
          if (isPathChanged) {
            resetSelection();
          }

          // 分片加载在 done 时记录刷新时间；非分片在此处记录
          if (!(response.chunked && response.token)) {
            markLastRefreshTime();
          }
        } else {
          // 处理错误，检查是否需要重试
          if (followRequest)
            throw new Error(
              response?.error || t("fileManager.errors.loadDirectoryFailed"),
            );
          if (
            response?.error?.includes("SFTP错误") ||
            /sftp\s*error/i.test(response?.error || "") ||
            response?.error?.includes("Channel open failure") ||
            response?.error?.includes("SSH连接尚未就绪") ||
            /ssh connection (is )?not ready/i.test(response?.error || "") ||
            response?.error?.includes("No SSH connection info found") ||
            response?.error?.includes("ECONNRESET")
          ) {
            // 如果是SFTP通道错误或SSH连接未就绪，且重试次数未达到上限，则进行重试
            if (retryCount < 5) {
              // 增加重试等待时间，指数退避算法
              const waitTime = Math.min(500 * Math.pow(1.5, retryCount), 5000); // 最长等待5秒
              setConnectionLoading(true);
              setConnectionLoadingMessage(
                t("fileManager.messages.retrying", {
                  current: retryCount + 1,
                  max: 5,
                }),
              );

              // 先关闭loading状态，避免持续显示
              if (isCurrentLoadRequest()) {
                setLoading(false);
              }
              isRetrying = true; // 标记正在重试

              // 添加延迟，避免立即重试
              addTimeout(() => {
                loadDirectory(
                  path,
                  retryCount + 1,
                  forceRefresh,
                  isHistoryNavigation,
                  loadRequestId,
                );
              }, waitTime);
              return;
            }
          }

          // 重试失败或其他错误
          if (isCurrentLoadRequest()) {
            setConnectionLoading(false);
            setConnectionLoadingMessage("");
            setError(
              response?.error || t("fileManager.errors.loadDirectoryFailed"),
            );
          }
        }
      } else {
        if (isCurrentLoadRequest()) {
          setConnectionLoading(false);
          setConnectionLoadingMessage("");
          setError(t("fileManager.errors.fileApiNotAvailable"));
        }
      }
    } catch (error) {
      if (!isCurrentLoadRequest()) {
        return;
      }
      if (followRequest) throw error;

      // 加载目录失败

      // 如果是异常错误且重试次数未达到上限，则进行重试
      if (retryCount < 5) {
        // 增加重试等待时间，指数退避算法
        const waitTime = Math.min(500 * Math.pow(1.5, retryCount), 5000); // 最长等待5秒
        setConnectionLoading(true);
        setConnectionLoadingMessage(
          t("fileManager.messages.retrying", {
            current: retryCount + 1,
            max: 5,
          }),
        );

        // 先关闭loading状态，避免持续显示
        if (isCurrentLoadRequest()) {
          setLoading(false);
        }
        isRetrying = true; // 标记正在重试

        // 添加延迟，避免立即重试
        addTimeout(() => {
          loadDirectory(
            path,
            retryCount + 1,
            forceRefresh,
            isHistoryNavigation,
            loadRequestId,
          );
        }, waitTime);
        return;
      }

      if (isCurrentLoadRequest()) {
        setConnectionLoading(false);
        setConnectionLoadingMessage("");
        setError(
          t("fileManager.errors.loadDirectoryFailed") +
            ": " +
            (error.message || t("fileManager.errors.unknownError")),
        );
      }
    } finally {
      followRequest?.signal.removeEventListener("abort", cancelFollowRequest);
      releaseForegroundLoad();
      // 只有在不重试的情况下才关闭loading
      if (!isRetrying && isCurrentLoadRequest()) {
        setLoading(false);
      }
    }
  };

  const loadDirectoryRef = useRef(loadDirectory);

  loadDirectoryRef.current = loadDirectory;

  useFollowTerminalDirectory({
    enabled: followTerminalDirectory,
    sessionKey: tabId,
    open,
    connected: Boolean(sshConnection),
    currentPathRef,
    loadDirectoryRef,
    navigationRequestIdRef: activeForegroundLoadRequestIdRef,
    onError: (error, path) =>
      showNotification(
        t("fileManager.followDirectoryFailed", {
          path,
          error: error.message || t("fileManager.errors.loadDirectoryFailed"),
        }),
        "warning",
        6000,
      ),
  });

  const throttleLoadDirectory = useCallback(
    (path, forceRefresh = false, isHistoryNavigation = false) => {
      const throttleState = throttledLoadStateRef.current;
      const invokeLoad = () => {
        throttleState.lastExecution = Date.now();
        throttleState.timeoutId = null;
        if (typeof loadDirectoryRef.current === "function") {
          loadDirectoryRef.current(path, 0, forceRefresh, isHistoryNavigation);
        }
      };

      const now = Date.now();
      const timeSinceLastCall = now - throttleState.lastExecution;

      if (timeSinceLastCall < 300) {
        if (throttleState.timeoutId) {
          clearTimeout(throttleState.timeoutId);
        }

        throttleState.timeoutId = setTimeout(() => {
          invokeLoad();
        }, 300 - timeSinceLastCall);
        return;
      }

      if (throttleState.timeoutId) {
        clearTimeout(throttleState.timeoutId);
        throttleState.timeoutId = null;
      }

      invokeLoad();
    },
    [],
  );

  useEffect(() => {
    return () => {
      const timeoutId = throttledLoadStateRef.current.timeoutId;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  const handleHistoryBack = () => {
    const currentIndex = historyIndexRef.current;
    const history = pathHistoryRef.current;

    if (currentIndex <= 0 || currentIndex >= history.length) {
      return;
    }

    const nextIndex = currentIndex - 1;
    updatePathHistoryState(history, nextIndex);
    loadDirectory(history[nextIndex], 0, false, true);
  };

  const handleGoToNextPath = () => {
    const currentIndex = historyIndexRef.current;
    const history = pathHistoryRef.current;

    if (currentIndex < 0 || currentIndex >= history.length - 1) {
      return;
    }

    const nextIndex = currentIndex + 1;
    updatePathHistoryState(history, nextIndex);
    loadDirectory(history[nextIndex], 0, false, true);
  };

  const handleEnterDirectory = (path) => {
    throttleLoadDirectory(path);
  };

  const handleGoUp = () => {
    if (currentPath === "~") {
      throttleLoadDirectory("/");
      return;
    }

    if (!currentPath || currentPath === "/") return;

    const lastSlashIndex = currentPath.lastIndexOf("/");
    const parentPath =
      lastSlashIndex > 0 ? currentPath.substring(0, lastSlashIndex) : "/";

    throttleLoadDirectory(parentPath);
  };

  const handleRefresh = () => {
    throttleLoadDirectory(currentPath, true); // 强制刷新
  };

  const handleGoHome = () => {
    throttleLoadDirectory("~");
  };

  useEffect(
    () => () => {
      activeForegroundLoadRequestIdRef.current += 1;
    },
    [tabId, sshConnection, open],
  );
  const refreshAfterUserActivity = useMemo(
    () =>
      debounce(() => {
        if (currentPath && foregroundLoadCountRef.current === 0) {
          silentRefreshCurrentDirectory();
        }
      }, USER_ACTIVITY_REFRESH_DELAY),
    [currentPath, silentRefreshCurrentDirectory],
  );

  useEffect(
    () => () => refreshAfterUserActivity.cancel(),
    [refreshAfterUserActivity],
  );

  const handlePathInputChange = (e) => {
    setPathInput(e.target.value);
  };

  const pathInputSubmitOnCompositionEndRef = useRef(false);

  const submitPathInput = (value) => {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed) {
      return;
    }
    setPathInput(trimmed);
    loadDirectory(trimmed);
  };

  const handlePathInputSubmit = (e) => {
    if (e.key !== "Enter") {
      return;
    }

    // 忽略输入法组合中的回车（中文输入法确认候选词），
    // 避免 preventDefault 打断组合提交，也避免用未提交的旧值触发跳转
    if (e.nativeEvent?.isComposing || e.nativeEvent?.keyCode === 229) {
      pathInputSubmitOnCompositionEndRef.current = true;
      return;
    }

    pathInputSubmitOnCompositionEndRef.current = false;
    e.preventDefault();
    submitPathInput(e.target?.value ?? pathInput);
  };

  const handlePathInputCompositionEnd = (e) => {
    if (!pathInputSubmitOnCompositionEndRef.current) {
      return;
    }
    pathInputSubmitOnCompositionEndRef.current = false;
    e.preventDefault?.();
    submitPathInput(e.target?.value ?? pathInput);
  };

  useEffect(() => {
    if (error) {
      showNotification(error, "error");
    }
  }, [error]);

  useEffect(() => {
    if (!open) return;

    // 设置定时器,每60秒触发一次更新
    const intervalId = setInterval(() => {
      forceUpdate((prev) => prev + 1);
    }, 60000);

    return () => {
      clearInterval(intervalId);
    };
  }, [open]);
  return {
    selectionResetKey,
    currentPath,
    files,
    loading,
    error,
    connectionLoading,
    connectionLoadingMessage,
    lastRefreshTime,
    pathInput,
    pathHistory,
    historyIndex,
    isChunking,
    listToken,
    loadDirectory,
    handleHistoryBack,
    handleGoToNextPath,
    handleEnterDirectory,
    handleGoUp,
    handleRefresh,
    handleGoHome,
    refreshAfterUserActivity,
    handlePathInputChange,
    pathInputSubmitOnCompositionEndRef,
    handlePathInputSubmit,
    handlePathInputCompositionEnd,
  };
}
