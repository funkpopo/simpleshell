import { useEffect, useRef } from "react";
import useAutoCleanup from "../../../shared/hooks/useAutoCleanup.js";
import { useTranslation } from "react-i18next";
import useFileNavState from "./useFileNavState.js";
import useDirectoryChunkStream from "./useDirectoryChunkStream.js";
import useBackgroundDirectoryRefresh from "./useBackgroundDirectoryRefresh.js";
import useDirectoryWatch from "./useDirectoryWatch.js";
import useDirectoryLoader from "./useDirectoryLoader.js";
import useFileNavCommands from "./useFileNavCommands.js";
/**
 * Owns directory requests, cache, history and watches. Selection consumes its committed results.
 *
 * Composition note: sub-hooks are called in the order their effects were
 * originally declared (state mirrors -> initial load -> chunk stream ->
 * background refresh -> directory watch -> commands -> error notification),
 * so effect setup/cleanup ordering is unchanged.
 */
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
  const {
    openRef,
    selectionResetKey,
    resetSelection,
    normalizedInitialPath,
    currentPath,
    setCurrentPath,
    files,
    setFiles,
    loading,
    setLoading,
    error,
    setError,
    connectionLoading,
    setConnectionLoading,
    connectionLoadingMessage,
    setConnectionLoadingMessage,
    lastRefreshTime,
    directoryCacheRef,
    currentPathRef,
    loadingRef,
    lastRefreshTimeRef,
    markLastRefreshTime,
    pathInput,
    setPathInput,
    pathHistory,
    setPathHistory,
    historyIndex,
    setHistoryIndex,
    pathHistoryRef,
    historyIndexRef,
    skipInitialPathSyncRef,
    previousInitialPathRef,
    isChunking,
    setIsChunking,
    isChunkingRef,
    chunkBufferRef,
    flushTimerRef,
    filesRef,
    listToken,
    setListToken,
    listTokenRef,
    backgroundListRequestRef,
    backgroundListBufferRef,
    backgroundListLastAttemptAtRef,
    foregroundLoadCountRef,
    activeForegroundLoadRequestIdRef,
    stableListSignatureRef,
    stableListSignatureKeyRef,
    pendingDirectoryWatchRefreshRef,
    directoryWatchRefreshRetryTimerRef,
  } = useFileNavState({
    open,
    initialPath,
    navigationState,
    tabId,
    onNavigationStateChange,
  });

  // `loadDirectory` is provided by useDirectoryLoader below; this effect only
  // reads it after render, matching the original forward reference.
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

  useEffect(() => {
    listTokenRef.current = listToken;
  }, [listToken]);

  useDirectoryChunkStream({
    tabId,
    openRef,
    currentPathRef,
    loadingRef,
    isChunkingRef,
    setIsChunking,
    listTokenRef,
    setListToken,
    filesRef,
    setFiles,
    chunkBufferRef,
    flushTimerRef,
    directoryCacheRef,
    backgroundListRequestRef,
    backgroundListBufferRef,
    foregroundLoadCountRef,
    stableListSignatureRef,
    stableListSignatureKeyRef,
    markLastRefreshTime,
  });

  const { silentRefreshCurrentDirectory, flushPendingDirectoryWatchRefresh } =
    useBackgroundDirectoryRefresh({
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
    });

  useDirectoryWatch({
    open,
    sshConnection,
    tabId,
    currentPath,
    showNotification,
    t,
    pendingDirectoryWatchRefreshRef,
    directoryWatchRefreshRetryTimerRef,
    flushPendingDirectoryWatchRefresh,
  });

  const { loadDirectory, updatePathHistoryState } = useDirectoryLoader({
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
  });

  const loadDirectoryRef = useRef(loadDirectory);

  loadDirectoryRef.current = loadDirectory;

  const {
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
  } = useFileNavCommands({
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
  });

  useEffect(() => {
    if (error) {
      showNotification(error, "error");
    }
  }, [error]);

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
