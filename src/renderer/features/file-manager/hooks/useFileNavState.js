import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { normalizeNavigationState } from "../fileManagerUtils.js";

/**
 * Navigation state owned by useFileNav: committed path/list/loading state,
 * history, chunking flags and the request bookkeeping refs shared by the
 * listing, background refresh and directory watch sub-hooks. The ref mirror
 * effects keep their original declaration order.
 */
export default function useFileNavState({
  open,
  initialPath,
  navigationState,
  tabId,
  onNavigationStateChange,
}) {
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

  const [listToken, setListToken] = useState(null);

  const listTokenRef = useRef(listToken);

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

  const pendingDirectoryWatchRefreshRef = useRef(false);

  const directoryWatchRefreshRetryTimerRef = useRef(null);

  return {
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
  };
}
