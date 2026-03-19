const path = require("path");
const fs = require("fs");
const { logToFile } = require("../utils/logger");
const {
  mainProcessResourceManager,
} = require("../utils/mainProcessResourceManager");
const processManager = require("../process/processManager");
const connectionManager = require("../../modules/connection");
const fileCache = require("../utils/fileCache");
const fileSnapshotStore = require("../utils/fileSnapshotStore");
const configService = require("../../services/configService");
const commandHistoryService = require("../../modules/terminal/command-history");
const filemanagementService = require("../../modules/filemanagement/filemanagementService");
const externalEditorManager = require("../../modules/sftp/externalEditorManager");

/**
 * 应用清理模块
 * 负责在应用退出前清理所有资源
 */
class AppCleanup {
  constructor(app) {
    this.app = app;
    this.isQuitting = false;
  }

  /**
   * 清理资源管理器
   */
  async cleanupResourceManager() {
    try {
      await mainProcessResourceManager.cleanup();
      logToFile("资源管理器清理完成", "INFO");
    } catch (error) {
      logToFile(`资源管理器清理失败: ${error.message}`, "ERROR");
    }
  }

  /**
   * 清理记忆文件
   */
  async cleanupMemoryFile() {
    try {
      const tempDir = this.app.isPackaged
        ? path.join(path.dirname(this.app.getPath("exe")), "temp")
        : path.join(this.app.getAppPath(), "temp");
      const memFilePath = path.join(tempDir, "mem.json");
      await fs.promises.unlink(memFilePath);
      logToFile("记忆文件已清理", "INFO");
    } catch (error) {
      if (error.code !== "ENOENT") {
        logToFile(`记忆文件清理失败: ${error.message}`, "ERROR");
      }
    }
  }

  /**
   * 清理外部编辑器管理器
   */
  async cleanupExternalEditorManager() {
    if (
      externalEditorManager &&
      typeof externalEditorManager.cleanup === "function"
    ) {
      try {
        await externalEditorManager.cleanup();
        logToFile("External editor manager cleaned up", "INFO");
      } catch (error) {
        logToFile(
          `External editor manager cleanup failed: ${error.message}`,
          "ERROR",
        );
      }
    }
  }

  /**
   * 清理单个进程的SFTP资源
   */
  async cleanupProcessSftp(id, proc) {
    if (
      filemanagementService &&
      typeof filemanagementService.cleanupTransfersForTab === "function"
    ) {
      try {
        const result = filemanagementService.cleanupTransfersForTab(id);
        if (result.cleanedCount > 0) {
          logToFile(
            `Cleaned up ${result.cleanedCount} filemanagement transfers for tab ${id} during app quit`,
            "INFO",
          );
        }

        if (proc.config && proc.config.tabId && proc.config.tabId !== id) {
          const tabResult = filemanagementService.cleanupTransfersForTab(
            proc.config.tabId,
          );
          if (tabResult.cleanedCount > 0) {
            logToFile(
              `Cleaned up ${tabResult.cleanedCount} filemanagement transfers for tabId ${proc.config.tabId} during app quit`,
              "INFO",
            );
          }
        }
      } catch (cleanupError) {
        logToFile(
          `Error initiating filemanagement transfer cleanup for tab ${id}: ${cleanupError.message}`,
          "ERROR",
        );
      }
    }
  }

  /**
   * 释放SSH连接
   */
  releaseSSHConnection(proc) {
    if (proc.type === "ssh2" && proc.connectionInfo) {
      try {
        proc.connectionInfo.closeReason = "system";
        proc.connectionInfo.intentionalClose = false;
        connectionManager.releaseSSHConnection(
          proc.connectionInfo.key,
          proc.config?.tabId,
          { reason: "system", intentional: false },
        );
        if (connectionManager.sshConnectionPool?.removeTabReference) {
          if (proc.config?.tabId) {
            connectionManager.sshConnectionPool.removeTabReference(
              String(proc.config.tabId),
              {
                closeIfIdle: false,
                closeOptions: { reason: "system", intentional: false },
              },
            );
          }
        }
        logToFile(
          `释放SSH连接池引用 (app quit): ${proc.connectionInfo.key}`,
          "INFO",
        );
      } catch (error) {
        logToFile(
          `Error releasing SSH connection during app quit: ${error.message}`,
          "ERROR",
        );
      }
    }
  }

  /**
   * 终止进程
   */
  terminateProcess(id, proc) {
    if (proc.process) {
      // 移除事件监听器
      if (proc.process.stdout) {
        proc.process.stdout.removeAllListeners();
      }
      if (proc.process.stderr) {
        proc.process.stderr.removeAllListeners();
      }

      // 对于SSH连接，关闭stream
      if (proc.type === "ssh2" && proc.stream) {
        try {
          proc.stream.close();
          logToFile(`关闭SSH stream (app quit): ${id}`, "INFO");
        } catch (error) {
          logToFile(
            `Error closing SSH stream during app quit ${id}: ${error.message}`,
            "ERROR",
          );
        }
      } else {
        // 终止其他类型的进程
        try {
          if (typeof proc.process.kill === "function") {
            proc.process.kill();
          }
        } catch (error) {
          logToFile(`Error killing process ${id}: ${error.message}`, "ERROR");
        }
      }
    }
  }

  /**
   * 清理所有进程
   */
  async cleanupAllProcesses() {
    for (const [id, proc] of processManager.getAllProcesses()) {
      try {
        await this.cleanupProcessSftp(id, proc);
        this.releaseSSHConnection(proc);
        this.terminateProcess(id, proc);
      } catch (error) {
        logToFile(`Error cleaning up process ${id}: ${error.message}`, "ERROR");
      }
    }
    processManager.clearAllProcesses();
  }

  /**
   * 清理连接管理器
   */
  cleanupConnectionManager() {
    connectionManager.cleanup();
  }

  buildCleanupSnapshot(stage) {
    const sshPool = connectionManager.sshConnectionPool;
    const telnetPool = connectionManager.telnetConnectionPool;
    const reconnectManager = sshPool?.reconnectionManager;
    const allProcesses =
      typeof processManager.getAllProcesses === "function"
        ? processManager.getAllProcesses()
        : [];

    return {
      stage,
      processCount: Array.from(allProcesses).length,
      ssh: {
        connections: sshPool?.connections?.size || 0,
        tabReferences: sshPool?.tabReferences?.size || 0,
        healthCheckTimerActive: Boolean(sshPool?.healthCheckTimer),
        reconnectSessions: reconnectManager?.sessions?.size || 0,
        reconnectTimers: reconnectManager?.reconnectTimers?.size || 0,
      },
      telnet: {
        connections: telnetPool?.connections?.size || 0,
        tabReferences: telnetPool?.tabReferences?.size || 0,
        healthCheckTimerActive: Boolean(telnetPool?.healthCheckTimer),
      },
      filemanagementTransfer:
        filemanagementService &&
        typeof filemanagementService.getTransferRuntimeStats === "function"
          ? filemanagementService.getTransferRuntimeStats()
          : null,
    };
  }

  hasResidualRuntimeResources(snapshot) {
    const filemanagementStats = snapshot?.filemanagementTransfer || {};

    return Boolean(
      (snapshot?.processCount || 0) > 0 ||
      (snapshot?.ssh?.connections || 0) > 0 ||
      (snapshot?.ssh?.tabReferences || 0) > 0 ||
      (snapshot?.ssh?.reconnectSessions || 0) > 0 ||
      (snapshot?.ssh?.reconnectTimers || 0) > 0 ||
      snapshot?.ssh?.healthCheckTimerActive ||
      (snapshot?.telnet?.connections || 0) > 0 ||
      (snapshot?.telnet?.tabReferences || 0) > 0 ||
      snapshot?.telnet?.healthCheckTimerActive ||
      (filemanagementStats.activeTransferCount || 0) > 0,
    );
  }

  async cleanupGlobalSftpResources() {
    if (
      filemanagementService &&
      typeof filemanagementService.cleanup === "function"
    ) {
      filemanagementService.cleanup();
    }
  }

  /**
   * 清理缓存文件
   */
  async cleanupCacheFiles() {
    try {
      const cleanedCount = await fileCache.cleanupAllCaches();
      logToFile(`Cleaned up ${cleanedCount} cache files on app quit`, "INFO");
    } catch (error) {
      logToFile(
        `Failed to cleanup cache files on quit: ${error.message}`,
        "ERROR",
      );
    }

    try {
      const cleared = await fileCache.clearCacheDirectory();
      if (cleared) {
        logToFile(
          `Cleared temp directory on app quit: ${fileCache.cacheDir}`,
          "INFO",
        );
      }
    } catch (error) {
      logToFile(
        `Failed to clear temp directory on quit: ${error.message}`,
        "ERROR",
      );
    }

    try {
      const cleared = await fileSnapshotStore.clearAllSnapshots();
      if (cleared) {
        logToFile(
          `Cleared snapshot directory on app quit: ${fileSnapshotStore.snapshotRoot}`,
          "INFO",
        );
      }
    } catch (error) {
      logToFile(`Failed to clear snapshots on quit: ${error.message}`, "ERROR");
    }
  }

  /**
   * 保存命令历史
   */
  saveCommandHistory() {
    try {
      const historyToSave = commandHistoryService.exportHistory();
      configService.saveCommandHistory(historyToSave);
      logToFile(
        `Saved ${historyToSave.length} command history entries on app quit`,
        "INFO",
      );
    } catch (error) {
      logToFile(
        `Failed to save command history on quit: ${error.message}`,
        "ERROR",
      );
    }
  }

  /**
   * 保存最近连接
   */
  saveLastConnections() {
    try {
      const lastConnections = connectionManager.getLastConnections(5);
      logToFile(
        `App quit: Got ${lastConnections.length} last connections: ${JSON.stringify(lastConnections)}`,
        "DEBUG",
      );

      const saved = configService.saveLastConnections(lastConnections);

      if (lastConnections && lastConnections.length > 0) {
        logToFile(
          `Saved ${lastConnections.length} last connections on app quit${saved ? " successfully" : " - save returned false"}`,
          "INFO",
        );
      } else {
        logToFile(
          `Saved empty last connections list on app quit${saved ? " successfully" : " - save returned false"}`,
          "INFO",
        );
      }
    } catch (error) {
      logToFile(
        `Failed to save last connections on quit: ${error.message}`,
        "ERROR",
      );
    }
  }

  /**
   * 执行完整的清理流程
   * @param {Object} ipcSetup - IPC设置模块实例
   */
  async performCleanup(ipcSetup) {
    logToFile("应用开始退出流程，执行清理操作...", "INFO");
    const beforeSnapshot = this.buildCleanupSnapshot("before-cleanup");
    logToFile(
      `App quit runtime snapshot(before): ${JSON.stringify(beforeSnapshot)}`,
      "INFO",
    );

    await this.cleanupResourceManager();

    // 清理IPC相关资源
    if (ipcSetup) {
      await ipcSetup.cleanup();
    }

    await this.cleanupMemoryFile();
    await this.cleanupExternalEditorManager();
    await this.cleanupAllProcesses();
    await this.cleanupGlobalSftpResources();
    this.cleanupConnectionManager();
    await this.cleanupCacheFiles();
    this.saveCommandHistory();
    this.saveLastConnections();

    const afterSnapshot = this.buildCleanupSnapshot("after-cleanup");
    logToFile(
      `App quit runtime snapshot(after): ${JSON.stringify(afterSnapshot)}`,
      "INFO",
    );
    if (this.hasResidualRuntimeResources(afterSnapshot)) {
      logToFile(
        `App quit cleanup residual resources detected: ${JSON.stringify(afterSnapshot)}`,
        "WARN",
      );
    }

    logToFile("所有清理操作完成，应用即将退出", "INFO");
  }

  /**
   * 处理before-quit事件
   * @param {Event} event - Electron事件对象
   * @param {Object} ipcSetup - IPC设置模块实例
   */
  async handleBeforeQuit(event, ipcSetup) {
    if (this.isQuitting) {
      return;
    }

    event.preventDefault();
    this.isQuitting = true;

    await this.performCleanup(ipcSetup);
    this.app.quit();
  }
}

module.exports = AppCleanup;
