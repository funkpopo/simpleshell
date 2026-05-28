const { logToFile } = require("../../utils/logger");
const externalEditorManager = require("../../../modules/sftp/externalEditorManager");
const { IPC_REQUEST_CHANNELS } = require("../schema/channels");

/**
 * 外部编辑器相关的IPC处理器
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
    if (
      !externalEditorManager ||
      typeof externalEditorManager.openFileInExternalEditor !== "function"
    ) {
      return {
        success: false,
        error: "External editor feature not available.",
      };
    }

    if (!tabId || !remotePath) {
      return { success: false, error: "Missing parameters." };
    }

    try {
      return await externalEditorManager.openFileInExternalEditor(
        tabId,
        remotePath,
      );
    } catch (error) {
      logToFile(
        `External editor open failed for ${remotePath}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: error.message };
    }
  }
}

module.exports = ExternalEditorHandlers;
