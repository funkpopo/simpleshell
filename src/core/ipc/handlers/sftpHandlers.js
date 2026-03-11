const sftpCore = require("../../transfer/sftp-engine");
const fileCache = require("../../utils/fileCache");
const fileSnapshotStore = require("../../utils/fileSnapshotStore");
const { logToFile } = require("../../utils/logger");

/**
 * SFTP会话和队列相关的IPC处理器
 */
class SftpHandlers {
  getHandlers() {
    return [
      {
        channel: "getSftpSession",
        category: "sftp",
        handler: this.getSftpSession.bind(this),
      },
      {
        channel: "enqueueSftpOperation",
        category: "sftp",
        handler: this.enqueueSftpOperation.bind(this),
      },
      {
        channel: "processSftpQueue",
        category: "sftp",
        handler: this.processSftpQueue.bind(this),
      },
      {
        channel: "readFileContent",
        category: "sftp",
        handler: this.readFileContent.bind(this),
      },
      {
        channel: "readFileAsBase64",
        category: "sftp",
        handler: this.readFileAsBase64.bind(this),
      },
      {
        channel: "saveFileContent",
        category: "sftp",
        handler: this.saveFileContent.bind(this),
      },
      {
        channel: "cleanupFileCache",
        category: "sftp",
        handler: this.cleanupFileCache.bind(this),
      },
      {
        channel: "cleanupTabCache",
        category: "sftp",
        handler: this.cleanupTabCache.bind(this),
      },
      {
        channel: "listFileSnapshots",
        category: "sftp",
        handler: this.listFileSnapshots.bind(this),
      },
      {
        channel: "createFileSnapshot",
        category: "sftp",
        handler: this.createFileSnapshot.bind(this),
      },
      {
        channel: "getFileSnapshot",
        category: "sftp",
        handler: this.getFileSnapshot.bind(this),
      },
      {
        channel: "restoreFileSnapshot",
        category: "sftp",
        handler: this.restoreFileSnapshot.bind(this),
      },
    ];
  }

  async getSftpSession(event, tabId) {
    try {
      const session = await sftpCore.getSftpSession(tabId);
      return { success: true, session };
    } catch (error) {
      logToFile(`Error getting SFTP session: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async enqueueSftpOperation(event, tabId, operation) {
    try {
      const result = await sftpCore.enqueueSftpOperation(tabId, operation);
      return result;
    } catch (error) {
      logToFile(`Error enqueueing SFTP operation: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async processSftpQueue(event, tabId) {
    try {
      const result = await sftpCore.processSftpQueue(tabId);
      return result;
    } catch (error) {
      logToFile(`Error processing SFTP queue: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async readFileContent(event, tabId, filePath) {
    try {
      const result = await sftpCore.readFileContent(tabId, filePath);
      return result;
    } catch (error) {
      logToFile(`Error reading file content: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async readFileAsBase64(event, tabId, filePath) {
    try {
      const result = await sftpCore.readFileAsBase64(tabId, filePath);
      return result;
    } catch (error) {
      logToFile(`Error reading file as base64: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async saveFileContent(event, tabId, filePath, content) {
    try {
      const result = await sftpCore.saveFileContent(tabId, filePath, content);
      return result;
    } catch (error) {
      logToFile(`Error saving file content: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async cleanupFileCache(event, cacheFilePath) {
    try {
      await fileCache.cleanup(cacheFilePath);
      return { success: true };
    } catch (error) {
      logToFile(`Error cleaning up file cache: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async cleanupTabCache(event, tabId) {
    try {
      await fileCache.cleanupTabFiles(tabId);
      return { success: true };
    } catch (error) {
      logToFile(`Error cleaning up tab cache: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
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

      const saveResult = await sftpCore.saveFileContent(
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
      return { success: false, error: error.message };
    }
  }
}

module.exports = SftpHandlers;
