import { useEffect } from "react";
import {
  computeFileListSignature,
  makeListKey,
  storeCachedDirectory,
  toApiPath,
} from "../lib/directoryListing.js";

/**
 * Subscribes to listFiles chunk events. Foreground chunks are buffered and
 * appended to the visible list; background refresh chunks are collected and
 * applied once on completion only if the directory context is still idle.
 */
export default function useDirectoryChunkStream({
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
}) {
  const updateDirectoryCache = (path, data) =>
    storeCachedDirectory(directoryCacheRef.current, path, data);

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
}
