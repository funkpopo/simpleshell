// @ts-check
/**
 * Preload 运行于隔离上下文；类型检查由 scripts/check-preload-typings.js 执行。
 * 主进程尚未细化的响应使用 unknown，调用方应先缩窄类型。
 * @import { IpcResult, ProcessId, Unsubscribe, PayloadCallback, IpcCallback, ReconnectCallback, ExternalEditorCallback, TerminalMailboxMessage, WindowState, ExternalOpenOptions, ExternalOpenResult, ListFilesOptions, DownloadProgressCallback, UploadProgressCallback, UploadFolderProgressCallback, UploadDroppedProgressCallback } from "../../shared/contracts/preload"
 */

/** @param {ReturnType<typeof import("../bridgeContext").createBridgeContext>} bridge */
function createClipboardAPI(bridge) {
  const { ipcRenderer, IPC_REQUEST_CHANNELS, clipboardWriteSuccessListeners } =
    bridge;
  return {
    /**
     * 通过 IPC 读取剪贴板文本，失败时拒绝 Promise。
     * @returns {Promise<string>}
     */
    readText: async () => {
      const result = await ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.CLIPBOARD_READ_TEXT,
      );
      if (result?.success === false) {
        throw new Error(result.error || "Failed to read clipboard text");
      }
      return typeof result?.text === "string" ? result.text : "";
    },

    /**
     * 通过 IPC 写入剪贴板并通知成功监听器，失败时拒绝 Promise。
     * @param {unknown} text
     * @returns {Promise<boolean>}
     */
    writeText: async (text) => {
      const result = await ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.CLIPBOARD_WRITE_TEXT,
        String(text ?? ""),
      );
      if (result?.success === false) {
        throw new Error(result.error || "Failed to write clipboard text");
      }
      for (const listener of clipboardWriteSuccessListeners) {
        try {
          listener({ timestamp: Date.now() });
        } catch {
          // Ignore renderer notification listener failures.
        }
      }
      try {
        window.dispatchEvent(
          new CustomEvent("simpleshell:clipboard-write-success", {
            detail: { timestamp: Date.now() },
          }),
        );
      } catch {
        // Notification is best-effort; the clipboard write already succeeded.
      }
      return true;
    },

    /**
     * 监听本地剪贴板写入成功通知，返回取消订阅函数。
     * @param {PayloadCallback<{timestamp: number}>} callback
     * @returns {Unsubscribe}
     */
    onWriteSuccess: (callback) => {
      if (typeof callback !== "function") {
        return () => {};
      }
      clipboardWriteSuccessListeners.add(callback);
      return () => {
        clipboardWriteSuccessListeners.delete(callback);
      };
    },
  };
}
module.exports = { createClipboardAPI };
