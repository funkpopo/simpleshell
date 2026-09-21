// @ts-check
/**
 * Preload 运行于隔离上下文；类型检查由 scripts/check-preload-typings.js 执行。
 * 主进程尚未细化的响应使用 unknown，调用方应先缩窄类型。
 * @import { IpcResult, ProcessId, Unsubscribe, PayloadCallback, IpcCallback, ReconnectCallback, ExternalEditorCallback, TerminalMailboxMessage, WindowState, ExternalOpenOptions, ExternalOpenResult, ListFilesOptions, DownloadProgressCallback, UploadProgressCallback, UploadFolderProgressCallback, UploadDroppedProgressCallback } from "../../shared/contracts/preload"
 */

/** @param {ReturnType<typeof import("../bridgeContext").createBridgeContext>} bridge */
function createDialogAPI(bridge) {
  const { ipcRenderer, IPC_REQUEST_CHANNELS } = bridge;
  return {
    // 显示打开文件/目录对话框
    /**
     * 通过 IPC_REQUEST_CHANNELS.DIALOG_SHOW_OPEN 请求主进程。
     * @param {import("electron").OpenDialogOptions} options
     * @returns {Promise<IpcResult<import("electron").OpenDialogReturnValue>>}
     */
    showOpenDialog: (options) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.DIALOG_SHOW_OPEN, options),

    // 显示保存文件对话框
    /**
     * 通过 IPC_REQUEST_CHANNELS.DIALOG_SHOW_SAVE 请求主进程。
     * @param {import("electron").SaveDialogOptions} options
     * @returns {Promise<IpcResult<import("electron").SaveDialogReturnValue>>}
     */
    showSaveDialog: (options) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.DIALOG_SHOW_SAVE, options),

    // 显示消息框
    /**
     * 通过 IPC_REQUEST_CHANNELS.DIALOG_SHOW_MESSAGE 请求主进程。
     * @param {import("electron").MessageBoxOptions} options
     * @returns {Promise<IpcResult<import("electron").MessageBoxReturnValue>>}
     */
    showMessageBox: (options) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.DIALOG_SHOW_MESSAGE, options),
  };
}
module.exports = { createDialogAPI };
