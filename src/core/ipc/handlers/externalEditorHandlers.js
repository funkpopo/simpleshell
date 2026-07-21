const externalEditorManager = require("../../../modules/sftp/externalEditorManager");
const { IPC_REQUEST_CHANNELS } = require("../schema/channels");

/**
 * 外部编辑器相关的IPC处理器
 * 错误统一由 safeHandle/wrapIpcHandler 捕获并生成标准错误响应,处理器内直接 throw
 */
class ExternalEditorHandlers {
  getHandlers() {
    return [
      {
        channel: IPC_REQUEST_CHANNELS.EXTERNAL_EDITOR_OPEN,
        category: "external-editor",
        handler: this.openInExternalEditor.bind(this),
      },
    ];
  }

  async openInExternalEditor(event, tabId, remotePath) {
    void event;
    if (
      !externalEditorManager ||
      typeof externalEditorManager.openFileInExternalEditor !== "function"
    ) {
      throw new Error("External editor feature not available.");
    }

    if (!tabId || !remotePath) {
      throw new Error("Missing parameters.");
    }

    return externalEditorManager.openFileInExternalEditor(tabId, remotePath);
  }
}

module.exports = ExternalEditorHandlers;
