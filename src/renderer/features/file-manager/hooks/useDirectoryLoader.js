import { useCallback, useRef } from "react";
import { FILE_MANAGER_PATH_HISTORY_LIMIT } from "../fileManagerUtils.js";
import {
  getCachedDirectory,
  storeCachedDirectory,
} from "../lib/directoryListing.js";

/**
 * Foreground directory loading (cache, chunked reads, retries, follow-request
 * cancellation) and the path history it commits to. `loadDirectory` is a fresh
 * per-render closure, exactly as before the split.
 */
export default function useDirectoryLoader({
  sshConnection,
  tabId,
  t,
  addTimeout,
  onPathChange,
  skipInitialPathSyncRef,
  currentPathRef,
  setCurrentPath,
  setPathInput,
  pathHistoryRef,
  historyIndexRef,
  setPathHistory,
  setHistoryIndex,
  activeForegroundLoadRequestIdRef,
  foregroundLoadCountRef,
  directoryCacheRef,
  filesRef,
  setFiles,
  flushTimerRef,
  chunkBufferRef,
  listTokenRef,
  setListToken,
  isChunkingRef,
  setIsChunking,
  setLoading,
  setError,
  setConnectionLoading,
  setConnectionLoadingMessage,
  resetSelection,
  markLastRefreshTime,
}) {
  // 重试定时器触发时调用最新渲染的 loadDirectory，避免使用过期的连接/语言闭包。
  const latestLoadDirectoryRef = useRef(null);

  const getDirectoryFromCache = (path) =>
    getCachedDirectory(directoryCacheRef.current, path);

  const updateDirectoryCache = (path, data) =>
    storeCachedDirectory(directoryCacheRef.current, path, data);

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
                releaseForegroundLoad();
                latestLoadDirectoryRef.current(
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
          releaseForegroundLoad();
          latestLoadDirectoryRef.current(
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
      // 等待重试期间保留前台加载占位，防止后台刷新插入；由重试定时器释放。
      if (!isRetrying) {
        releaseForegroundLoad();
      }
      // 只有在不重试的情况下才关闭loading
      if (!isRetrying && isCurrentLoadRequest()) {
        setLoading(false);
      }
    }
  };

  latestLoadDirectoryRef.current = loadDirectory;

  return { loadDirectory, updatePathHistoryState };
}
