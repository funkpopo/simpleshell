import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  getWorkingDirectoryState,
  subscribeWorkingDirectory,
} from "../modules/terminal/workingDirectoryStore.js";
import { isAbsoluteRemotePath } from "../modules/terminal/workingDirectoryTracking.js";

export function useFollowTerminalDirectory({
  enabled,
  sessionKey,
  open,
  connected,
  currentPathRef,
  loadDirectoryRef,
  navigationRequestIdRef,
  onError,
}) {
  const subscribe = useCallback(
    (listener) => subscribeWorkingDirectory(sessionKey, listener),
    [sessionKey],
  );
  const getSnapshot = useCallback(
    () => getWorkingDirectoryState(sessionKey),
    [sessionKey],
  );
  const { path } = useSyncExternalStore(subscribe, getSnapshot);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!open || !connected || !sessionKey || !enabled || !path) return;
    const controller = new AbortController();
    const { signal } = controller;
    let expectedNavigation = navigationRequestIdRef.current;
    // Coalesce rapidly arriving prompts and cancel home resolution when the
    // active session, visibility, preference or reported directory changes.
    let timer;
    const follow = async (attempt = 0) => {
      if (
        signal.aborted ||
        navigationRequestIdRef.current !== expectedNavigation
      )
        return;
      const request = { signal };
      try {
        let target = path;
        if (path === "~" || path.startsWith("~/")) {
          const relativePath = path === "~" ? "." : `./${path.slice(2)}`;
          const result = await window.terminalAPI?.getAbsolutePath(
            sessionKey,
            relativePath,
          );
          if (
            signal.aborted ||
            navigationRequestIdRef.current !== expectedNavigation
          )
            return;
          if (!result?.success || !isAbsoluteRemotePath(result.path)) {
            throw new Error(result?.error || "");
          }
          target = result.path;
        }
        if (
          !signal.aborted &&
          isAbsoluteRemotePath(target) &&
          target !== currentPathRef.current
        ) {
          await loadDirectoryRef.current(
            target,
            0,
            true,
            false,
            undefined,
            request,
          );
        }
      } catch (error) {
        if (signal.aborted) return;
        if (
          navigationRequestIdRef.current !== (request.id ?? expectedNavigation)
        )
          return;
        expectedNavigation = navigationRequestIdRef.current;
        const transient =
          /not ready|ECONNRESET|ETIMEDOUT|connection.*(?:lost|closed)|Channel open failure|SSH连接尚未就绪/i.test(
            error?.message || "",
          );
        if (transient && attempt < 3) {
          timer = setTimeout(() => follow(attempt + 1), 300 * 2 ** attempt);
        } else {
          onErrorRef.current?.(error, path);
        }
      }
    };
    timer = setTimeout(() => follow(), 120);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [
    sessionKey,
    open,
    connected,
    path,
    enabled,
    currentPathRef,
    loadDirectoryRef,
    navigationRequestIdRef,
  ]);
}
