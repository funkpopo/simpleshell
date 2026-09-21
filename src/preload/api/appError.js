// @ts-check
/**
 * Preload 运行于隔离上下文；类型检查由 scripts/check-preload-typings.js 执行。
 * 主进程尚未细化的响应使用 unknown，调用方应先缩窄类型。
 * @import { IpcResult, ProcessId, Unsubscribe, PayloadCallback, IpcCallback, ReconnectCallback, ExternalEditorCallback, TerminalMailboxMessage, WindowState, ExternalOpenOptions, ExternalOpenResult, ListFilesOptions, DownloadProgressCallback, UploadProgressCallback, UploadFolderProgressCallback, UploadDroppedProgressCallback } from "../../shared/contracts/preload"
 */

/** @param {ReturnType<typeof import("../bridgeContext").createBridgeContext>} bridge */
function createAppErrorAPI(bridge) {
  const { ipcRenderer, IPC_EVENT_CHANNELS } = bridge;
  return {
    // 监听应用错误
    /**
     * 注册应用错误 IPC 监听；返回 Electron 的 IpcRenderer，不是取消订阅函数。
     * @param {IpcCallback} callback
     * @returns {import("electron").IpcRenderer}
     */
    onError: (callback) =>
      ipcRenderer.on(IPC_EVENT_CHANNELS.APP_ERROR, callback),

    // 移除错误监听
    /**
     * 管理主进程事件监听，无返回值。
     * @returns {void}
     */
    removeErrorListener: () => {
      ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.APP_ERROR);
    },
  };
}
module.exports = { createAppErrorAPI };
