const { app, BrowserWindow, shell } = require("electron");
const { logToFile } = require("../../utils/logger");
const ipQuery = require("../../../modules/system-info/ip-query");

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
        channel: "ip:query",
        category: "app",
        handler: this.queryIP.bind(this),
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
      // 这里可以实现实际的更新检查逻辑
      // 例如调用 electron-updater 或自定义更新服务
      logToFile("Checking for updates...", "INFO");

      // 模拟检查更新
      const currentVersion = app.getVersion();
      const updateInfo = {
        hasUpdate: false,
        currentVersion: currentVersion,
        latestVersion: currentVersion,
        releaseNotes: "",
      };

      return { success: true, updateInfo };
    } catch (error) {
      logToFile(`Error checking for updates: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async queryIP(event, ip = "") {
    try {
      const result = await ipQuery.query(ip);
      return { success: true, data: result };
    } catch (error) {
      logToFile(`Error querying IP: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }
}

module.exports = AppHandlers;
