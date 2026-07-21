const fileSnapshotStore = require("../../utils/fileSnapshotStore");
const nativeSftpClient = require("../../utils/nativeSftpClient");
const connectionManager = require("../../../modules/connection");
const { IPC_REQUEST_CHANNELS } = require("../schema/channels");

/**
 * SFTP会话和队列相关的IPC处理器
 * 错误统一由 safeHandle/wrapIpcHandler 捕获并生成标准错误响应,处理器内直接 throw
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
    void event;
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
  }

  async enqueueSftpOperation(event, tabId, operation) {
    void event;
    // 复用 connectionManager 中的兼容存根（IPC 传入的 operation 不会是函数）
    return connectionManager.enqueueSftpOperation(tabId, operation);
  }

  async processSftpQueue(event, tabId) {
    void event;
    void tabId;
    return { success: true, processed: true, native: true };
  }

  async readFileContent(event, tabId, filePath) {
    void event;
    return nativeSftpClient.readFileContent(tabId, filePath);
  }

  async readFileAsBase64(event, tabId, filePath) {
    void event;
    return nativeSftpClient.readFileAsBase64(tabId, filePath);
  }

  async saveFileContent(event, tabId, filePath, content) {
    void event;
    return nativeSftpClient.saveFileContent(tabId, filePath, content);
  }

  async listFileSnapshots(event, tabId, filePath) {
    void event;
    const snapshots = await fileSnapshotStore.listSnapshots(tabId, filePath);
    return { success: true, snapshots };
  }

  async createFileSnapshot(event, tabId, filePath, content, options = {}) {
    void event;
    return fileSnapshotStore.createSnapshot(
      tabId,
      filePath,
      content,
      options,
    );
  }

  async getFileSnapshot(event, tabId, filePath, snapshotId) {
    void event;
    const snapshot = await fileSnapshotStore.readSnapshot(
      tabId,
      filePath,
      snapshotId,
    );
    return { success: true, snapshot };
  }

  async restoreFileSnapshot(
    event,
    tabId,
    filePath,
    snapshotId,
    currentContent = null,
  ) {
    void event;
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
      throw new Error(
        saveResult?.error || "Failed to save restored snapshot",
      );
    }

    const snapshots = await fileSnapshotStore.listSnapshots(tabId, filePath);

    return {
      success: true,
      content: restoreResult.content,
      restoredSnapshot: restoreResult.snapshot,
      snapshots,
    };
  }
}

module.exports = SftpHandlers;
