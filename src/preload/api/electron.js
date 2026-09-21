// @ts-check
/**
 * Preload 运行于隔离上下文；类型检查由 scripts/check-preload-typings.js 执行。
 * 主进程尚未细化的响应使用 unknown，调用方应先缩窄类型。
 * @import { IpcResult, ProcessId, Unsubscribe, PayloadCallback, IpcCallback, ReconnectCallback, ExternalEditorCallback, TerminalMailboxMessage, WindowState, ExternalOpenOptions, ExternalOpenResult, ListFilesOptions, DownloadProgressCallback, UploadProgressCallback, UploadFolderProgressCallback, UploadDroppedProgressCallback } from "../../shared/contracts/preload"
 */

/** @param {ReturnType<typeof import("../bridgeContext").createBridgeContext>} bridge */
function createElectronAPI(bridge) {
  const { ipcRenderer, IPC_REQUEST_CHANNELS } = bridge;
  return {
    // SSH密钥对生成
    /**
     * 通过 IPC_REQUEST_CHANNELS.SSH_KEY_GENERATE 请求主进程。
     * @param {Record<string, unknown>} options
     * @returns {Promise<unknown>}
     */
    generateSSHKeyPair: (options) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SSH_KEY_GENERATE, options),

    // 保存SSH密钥到文件
    /**
     * 通过 IPC_REQUEST_CHANNELS.SSH_KEY_SAVE 请求主进程。
     * @param {Record<string, unknown>} options
     * @returns {Promise<unknown>}
     */
    saveSSHKey: (options) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SSH_KEY_SAVE, options),
  };
}
module.exports = { createElectronAPI };
