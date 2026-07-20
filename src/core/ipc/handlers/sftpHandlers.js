const fileSnapshotStore = require("../../utils/fileSnapshotStore");
const nativeSftpClient = require("../../utils/nativeSftpClient");
const connectionManager = require("../../../modules/connection");
const { logToFile } = require("../../utils/logger");
const { buildErrorResponse } = require("../../utils/errorResponse");
const { IPC_REQUEST_CHANNELS } = require("../schema/channels");

/**
 * SFTP会话和队列相关的IPC处理器
 */
class SftpHandlers {
  getHandlers() {
    return [
      {
        channel: IPC_REQUEST_CHANNELS.SFTP_GET_SESSION,
        category: "sftp",
        handler: this.getSftpSession.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SFTP_ENQUEUE_OPERATION,
        category: "sftp",
        handler: this.enqueueSftpOperation.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SFTP_PROCESS_QUEUE,
        category: "sftp",
        handler: this.processSftpQueue.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SFTP_READ_FILE_CONTENT,
        category: "sftp",
        handler: this.readFileContent.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SFTP_READ_FILE_BASE64,
        category: "sftp",
        handler: this.readFileAsBase64.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SFTP_SAVE_FILE_CONTENT,
        category: "sftp",
        handler: this.saveFileContent.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SFTP_LIST_FILE_SNAPSHOTS,
        category: "sftp",
        handler: this.listFileSnapshots.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SFTP_CREATE_FILE_SNAPSHOT,
        category: "sftp",
        handler: this.createFileSnapshot.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SFTP_GET_FILE_SNAPSHOT,
        category: "sftp",
        handler: this.getFileSnapshot.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SFTP_RESTORE_FILE_SNAPSHOT,
        category: "sftp",
        handler: this.restoreFileSnapshot.bind(this),
      },
    ];
  }

  async getSftpSession(event, tabId) {
    try {
      // 复用 connectionManager 中的兼容存根（native 后端固定返回值）
      const base = await connectionManager.getSftpSession(tabId);
      return {
        success: base.success,
        session: {
          tabId,
          backend: "rust-sidecar",
          native: base.native,
        },
      };
    } catch (error) {
      logToFile(`Error getting SFTP session: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async enqueueSftpOperation(event, tabId, operation) {
    try {
      void event;
      // 复用 connectionManager 中的兼容存根（IPC 传入的 operation 不会是函数）
      return await connectionManager.enqueueSftpOperation(tabId, operation);
    } catch (error) {
      logToFile(`Error enqueueing SFTP operation: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async processSftpQueue(event, tabId) {
    try {
      void event;
      void tabId;
      return { success: true, processed: true, native: true };
    } catch (error) {
      logToFile(`Error processing SFTP queue: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async readFileContent(event, tabId, filePath) {
    try {
      const result = await nativeSftpClient.readFileContent(tabId, filePath);
      return result;
    } catch (error) {
      logToFile(`Error reading file content: ${error.message}`, "ERROR");
      return buildErrorResponse(error, "Failed to read file content");
    }
  }

  async readFileAsBase64(event, tabId, filePath) {
    try {
      const result = await nativeSftpClient.readFileAsBase64(tabId, filePath);
      return result;
    } catch (error) {
      logToFile(`Error reading file as base64: ${error.message}`, "ERROR");
      return buildErrorResponse(error, "Failed to read file as base64");
    }
  }

  async saveFileContent(event, tabId, filePath, content) {
    try {
      const result = await nativeSftpClient.saveFileContent(
        tabId,
        filePath,
        content,
      );
      return result;
    } catch (error) {
      logToFile(`Error saving file content: ${error.message}`, "ERROR");
      return buildErrorResponse(error, "Failed to save file content");
    }
  }

  async listFileSnapshots(event, tabId, filePath) {
    try {
      const snapshots = await fileSnapshotStore.listSnapshots(tabId, filePath);
      return { success: true, snapshots };
    } catch (error) {
      logToFile(`Error listing file snapshots: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async createFileSnapshot(event, tabId, filePath, content, options = {}) {
    try {
      return await fileSnapshotStore.createSnapshot(
        tabId,
        filePath,
        content,
        options,
      );
    } catch (error) {
      logToFile(`Error creating file snapshot: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async getFileSnapshot(event, tabId, filePath, snapshotId) {
    try {
      const snapshot = await fileSnapshotStore.readSnapshot(
        tabId,
        filePath,
        snapshotId,
      );
      return { success: true, snapshot };
    } catch (error) {
      logToFile(`Error reading file snapshot: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async restoreFileSnapshot(
    event,
    tabId,
    filePath,
    snapshotId,
    currentContent = null,
  ) {
    try {
      const restoreResult = await fileSnapshotStore.restoreSnapshot(
        tabId,
        filePath,
        snapshotId,
        currentContent,
      );

      const saveResult = await nativeSftpClient.saveFileContent(
        tabId,
        filePath,
        restoreResult.content,
      );

      if (!saveResult?.success) {
        return {
          success: false,
          error: saveResult?.error || "Failed to save restored snapshot",
        };
      }

      const snapshots = await fileSnapshotStore.listSnapshots(tabId, filePath);

      return {
        success: true,
        content: restoreResult.content,
        restoredSnapshot: restoreResult.snapshot,
        snapshots,
      };
    } catch (error) {
      logToFile(`Error restoring file snapshot: ${error.message}`, "ERROR");
      return buildErrorResponse(error, "Failed to restore file snapshot");
    }
  }
}

module.exports = SftpHandlers;
