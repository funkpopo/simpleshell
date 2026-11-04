import { useCallback, useEffect, useMemo, useRef } from "react";
import { debounce } from "../../../shared/lib/performance.js";
import { useFollowTerminalDirectory } from "./useFollowTerminalDirectory.js";
import { USER_ACTIVITY_REFRESH_DELAY } from "../lib/directoryListing.js";

/**
 * User-facing navigation commands: operation refreshes, terminal directory
 * following, throttled navigation, history, user-activity refresh and the
 * path editor (including IME composition handling).
 */
export default function useFileNavCommands({
  open,
  tabId,
  sshConnection,
  followTerminalDirectory,
  showNotification,
  t,
  currentPath,
  pathInput,
  setPathInput,
  openRef,
  currentPathRef,
  directoryCacheRef,
  foregroundLoadCountRef,
  activeForegroundLoadRequestIdRef,
  pathHistoryRef,
  historyIndexRef,
  updatePathHistoryState,
  loadDirectory,
  loadDirectoryRef,
  silentRefreshCurrentDirectory,
}) {
  const throttledLoadStateRef = useRef({
    lastExecution: 0,
    timeoutId: null,
  });

  // Operations can invalidate their target, but cannot navigate or supersede a
  // directory request started by the user. Old session commands become inert.
  const refreshSession = useMemo(
    () => ({ active: false }),
    [tabId, sshConnection],
  );
  useEffect(() => {
    refreshSession.active = true;
    return () => {
      refreshSession.active = false;
    };
  }, [refreshSession]);
  const refreshDirectory = useCallback(
    async (path, { background = false } = {}) => {
      if (!refreshSession.active) return;
      directoryCacheRef.current.delete(path);
      if (
        !openRef.current ||
        path !== currentPathRef.current ||
        foregroundLoadCountRef.current > 0
      )
        return;
      if (background) {
        silentRefreshCurrentDirectory();
        return;
      }
      await loadDirectoryRef.current(path, 0, true, true);
    },
    [refreshSession, silentRefreshCurrentDirectory],
  );

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

  return {
    refreshDirectory,
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
