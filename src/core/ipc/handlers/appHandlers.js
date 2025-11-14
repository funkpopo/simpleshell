const { app, BrowserWindow, shell } = require("electron");
const { logToFile } = require("../../utils/logger");
const updateService = require("../../update/updateService");

/**
 * 应用级别的IPC处理器
 */
class AppHandlers {
  /**
   * 获取所有应用处理器
   */
  getHandlers() {
    return [
      {
        channel: "app:getVersion",
        category: "app",
        handler: this.getVersion.bind(this),
      },
      {
        channel: "app:close",
        category: "app",
        handler: this.closeApp.bind(this),
      },
      {
        channel: "app:reloadWindow",
        category: "app",
        handler: this.reloadWindow.bind(this),
      },
      {
        channel: "app:openExternal",
        category: "app",
        handler: this.openExternal.bind(this),
      },
      {
        channel: "app:checkForUpdate",
        category: "app",
        handler: this.checkForUpdate.bind(this),
      },
      {
        channel: "app:downloadUpdate",
        category: "app",
        handler: this.downloadUpdate.bind(this),
      },
      {
        channel: "app:installUpdate",
        category: "app",
        handler: this.installUpdate.bind(this),
      },
      {
        channel: "app:getDownloadProgress",
        category: "app",
        handler: this.getDownloadProgress.bind(this),
      },
      {
        channel: "app:cancelDownload",
        category: "app",
        handler: this.cancelDownload.bind(this),
      },
    ];
  }

  // 实现各个处理器方法
  async getVersion(event) {
    try {
      return {
        success: true,
        version: app.getVersion(),
      };
    } catch (error) {
      logToFile(`Error getting app version: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async closeApp(event) {
    try {
      logToFile("Application closing via IPC", "INFO");
      app.quit();
      return { success: true };
    } catch (error) {
      logToFile(`Error closing app: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async reloadWindow(event) {
    try {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.reload();
        logToFile("Window reloaded", "INFO");
        return { success: true };
      }
      return { success: false, error: "No window found" };
    } catch (error) {
      logToFile(`Error reloading window: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async openExternal(event, url) {
    try {
      if (!url || typeof url !== "string") {
        return { success: false, error: "Invalid URL" };
      }

      // 验证URL安全性
      const allowedProtocols = ["http:", "https:", "mailto:"];
      const urlObj = new URL(url);

      if (!allowedProtocols.includes(urlObj.protocol)) {
        logToFile(
          `Blocked external URL with protocol: ${urlObj.protocol}`,
          "WARN",
        );
        return { success: false, error: "Unsupported protocol" };
      }

      await shell.openExternal(url);
      logToFile(`Opened external URL: ${url}`, "INFO");
      return { success: true };
    } catch (error) {
      logToFile(`Error opening external URL: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async checkForUpdate(event) {
    try {
      return await updateService.checkForUpdate();
    } catch (error) {
      logToFile(`Error checking for updates: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async downloadUpdate(event, downloadUrl) {
    try {
      if (!downloadUrl || typeof downloadUrl !== "string") {
        return { success: false, error: "Invalid download URL" };
      }

      // 设置进度回调
      const onProgress = (progressData) => {
        // 发送进度事件到渲染进程
        event.sender.send("update:downloadProgress", progressData);
      };

      const filePath = await updateService.downloadUpdate(
        downloadUrl,
        onProgress,
      );

      return {
        success: true,
        filePath,
        message: "Download completed successfully",
      };
    } catch (error) {
      logToFile(`Error downloading update: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async installUpdate(event, filePath) {
    try {
      if (!filePath || typeof filePath !== "string") {
        return { success: false, error: "Invalid file path" };
      }

      const result = await updateService.installUpdate(filePath);

      if (result.success) {
        logToFile("Update installation initiated", "INFO");
      }

      return result;
    } catch (error) {
      logToFile(`Error installing update: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async getDownloadProgress(event) {
    try {
      const progress = updateService.getDownloadProgress();
      return { success: true, progress };
    } catch (error) {
      logToFile(`Error getting download progress: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async cancelDownload(event) {
    try {
      updateService.cancelDownload();
      return { success: true, message: "Download cancelled" };
    } catch (error) {
      logToFile(`Error cancelling download: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }
}

module.exports = AppHandlers;
