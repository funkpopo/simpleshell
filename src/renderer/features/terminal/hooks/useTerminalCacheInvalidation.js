import { useEffect, useRef } from "react";
import {
  clearGeometryFor,
  fitAddonCache,
  processCache,
  terminalCache,
} from "../runtime/terminalSessionStore.js";
import { getTerminalConfigSignature } from "../lib/terminalHelpers.js";

/**
 * Drops a cached terminal so the lifecycle effect recreates it: on an explicit
 * refreshKey, or when the config of a never-connected session is corrected.
 */
export function useTerminalCacheInvalidation({
  sessionKey,
  refreshKey,
  sshConfig,
}) {
  // 如果 refreshKey 变化，清除缓存强制重新创建终端
  useEffect(() => {
    if (refreshKey && terminalCache[sessionKey]) {
      if (processCache[sessionKey]) {
        try {
          if (window.terminalAPI && window.terminalAPI.killProcess) {
            window.terminalAPI.killProcess(processCache[sessionKey]);
          }
        } catch {
          // Failed to kill process
        }
        clearGeometryFor(processCache[sessionKey], sessionKey);
        delete processCache[sessionKey];
      }

      try {
        if (
          terminalCache[sessionKey].__simpleShellOsc133Disposable &&
          typeof terminalCache[sessionKey].__simpleShellOsc133Disposable
            .dispose === "function"
        ) {
          terminalCache[sessionKey].__simpleShellOsc133Disposable.dispose();
          delete terminalCache[sessionKey].__simpleShellOsc133Disposable;
        }
        terminalCache[sessionKey].__workingDirectoryTracker?.dispose();
        terminalCache[sessionKey].dispose();
      } catch {
        // Failed to dispose terminal
      }
      delete terminalCache[sessionKey];
      delete fitAddonCache[sessionKey];
    }
  }, [refreshKey, sessionKey]);

  // 已失败的初次连接没有进程可供主进程更新，配置修正后重新建立该终端。
  const previousSshConfigRef = useRef(sshConfig);
  useEffect(() => {
    const changed =
      getTerminalConfigSignature(previousSshConfigRef.current) !==
      getTerminalConfigSignature(sshConfig);
    previousSshConfigRef.current = sshConfig;
    const cached = terminalCache[sessionKey];
    if (changed && cached?.__connectionFailed && !processCache[sessionKey]) {
      cached.__workingDirectoryTracker?.dispose();
      cached.dispose();
      delete terminalCache[sessionKey];
      delete fitAddonCache[sessionKey];
    }
  }, [sshConfig, sessionKey]);
}
