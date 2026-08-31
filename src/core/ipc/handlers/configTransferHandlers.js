const { BrowserWindow } = require("electron");
const configTransferService = require("../../../services/configTransferService");
const { logToFile } = require("../../utils/logger");
const { broadcastToAllWindows } = require("../../window/windowManager");
const {
  IPC_REQUEST_CHANNELS,
  IPC_EVENT_CHANNELS,
} = require("../schema/channels");

/**
 * 配置导入/导出/同步 IPC 处理器
 * 错误统一由 safeHandle/wrapIpcHandler 捕获并生成标准错误响应,处理器内直接 throw
 */
class ConfigTransferHandlers {
  constructor() {
    // 自动同步结果通知 → 渲染层事件
    configTransferService.setAutoSyncNotifier((payload) => {
      broadcastToAllWindows(IPC_EVENT_CHANNELS.CONFIG_SYNC_AUTO_EVENT, payload);
    });
  }

  getHandlers() {
    return [
      {
        channel: IPC_REQUEST_CHANNELS.CONFIG_TRANSFER_EXPORT,
        category: "settings",
        handler: this.exportConfig.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.CONFIG_TRANSFER_IMPORT,
        category: "settings",
        handler: this.importConfig.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.CONFIG_TRANSFER_LIST_SECTIONS,
        category: "settings",
        handler: this.listSections.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.CONFIG_SYNC_LOAD_SETTINGS,
        category: "settings",
        handler: this.loadSyncSettings.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.CONFIG_SYNC_SAVE_SETTINGS,
        category: "settings",
        handler: this.saveSyncSettings.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.CONFIG_SYNC_TEST,
        category: "settings",
        handler: this.syncTest.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.CONFIG_SYNC_UPLOAD,
        category: "settings",
        handler: this.syncUpload.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.CONFIG_SYNC_DOWNLOAD,
        category: "settings",
        handler: this.syncDownload.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.CONFIG_SYNC_GET_STATUS,
        category: "settings",
        handler: this.getSyncStatus.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.CONFIG_SYNC_PULL_NOW,
        category: "settings",
        handler: this.syncPullNow.bind(this),
      },
    ];
  }

  _notifyConfigImported(appliedSections = []) {
    if (appliedSections.includes("connections") || appliedSections.includes("aiSettings")) {
      broadcastToAllWindows(IPC_EVENT_CHANNELS.CONNECTIONS_CHANGED);
    }
    if (appliedSections.includes("commandHistory")) {
      broadcastToAllWindows(IPC_EVENT_CHANNELS.COMMAND_HISTORY_CHANGED, {
        reason: "config-import",
        history: [],
        count: 0,
        timestamp: Date.now(),
      });
    }
    if (appliedSections.length > 0) {
      // 设置类变更（uiSettings 等）通过窗口重载前的事件通知渲染层刷新
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (win && !win.isDestroyed() && win.webContents) {
          try {
            win.webContents.send(
              IPC_EVENT_CHANNELS.CONFIG_TRANSFER_IMPORTED,
              { sections: appliedSections, timestamp: Date.now() },
            );
          } catch (error) {
            logToFile(
              `Error broadcasting config import event: ${error.message}`,
              "WARN",
            );
          }
        }
      }
    }
  }

  async exportConfig(event, options = {}) {
    void event;
    const result = configTransferService.exportToFile(options);
    return result;
  }

  async importConfig(event, options = {}) {
    void event;
    const result = configTransferService.importFromFile(options);
    this._notifyConfigImported(result.applied || []);
    return result;
  }

  async listSections() {
    return {
      success: true,
      sections: configTransferService.getSupportedSections(),
      defaultRemoteFileName: configTransferService.getDefaultRemoteFileName(),
    };
  }

  async loadSyncSettings() {
    return { success: true, settings: configTransferService.loadSyncSettings() };
  }

  async saveSyncSettings(event, settings = {}) {
    void event;
    const result = configTransferService.saveSyncSettings(settings);
    // 自动同步设置可能变化，重建调度器
    configTransferService.restartAutoSyncScheduler();
    return result;
  }

  async syncTest(event, settings = {}) {
    void event;
    return configTransferService.webdavTest(settings);
  }

  async syncUpload(event, options = {}) {
    void event;
    const result = await configTransferService.webdavUpload(options);
    return result;
  }

  async syncDownload(event, options = {}) {
    void event;
    const result = await configTransferService.webdavDownload(options);
    if (Array.isArray(result.applied)) {
      this._notifyConfigImported(result.applied);
    }
    return result;
  }

  async getSyncStatus() {
    return { success: true, status: configTransferService.getAutoSyncStatus() };
  }

  async syncPullNow() {
    const result = await configTransferService.autoSyncPull("manual");
    if (result?.applied) {
      this._notifyConfigImported(result.applied);
    }
    return result;
  }
}

module.exports = ConfigTransferHandlers;
