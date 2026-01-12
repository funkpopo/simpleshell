const processManager = require("../../process/processManager");
const { logToFile } = require("../../utils/logger");

/**
 * 连接状态相关的IPC处理器
 */
class ConnectionHandlers {
  /**
   * 获取所有连接处理器
   */
  getHandlers() {
    return [
      {
        channel: "connection:getTabStatus",
        category: "connection",
        handler: this.getTabStatus.bind(this),
      },
    ];
  }

  async getTabStatus(event, tabId) {
    try {
      if (!tabId || tabId === "welcome") {
        return { success: true, data: null };
      }

      const processInfo = processManager.getProcess(tabId);

      if (!processInfo) {
        return { success: true, data: null };
      }

      if (processInfo.type === "ssh2") {
        const connectionState = {
          isConnected: processInfo.ready && !!processInfo.stream,
          isConnecting: !processInfo.ready,
          quality: processInfo.ready ? "excellent" : "offline",
          lastUpdate: Date.now(),
          connectionType: "SSH",
          host: processInfo.config?.host,
          port: processInfo.config?.port,
          username: processInfo.config?.username,
        };
        return { success: true, data: connectionState };
      } else if (processInfo.type === "powershell") {
        const connectionState = {
          isConnected: true,
          isConnecting: false,
          quality: "excellent",
          lastUpdate: Date.now(),
          connectionType: "Local",
          host: "localhost",
        };
        return { success: true, data: connectionState };
      } else if (processInfo.type === "telnet") {
        const connectionState = {
          isConnected: processInfo.ready && !!processInfo.process,
          isConnecting: !processInfo.ready,
          quality: processInfo.ready ? "good" : "offline",
          lastUpdate: Date.now(),
          connectionType: "Telnet",
          host: processInfo.config?.host,
          port: processInfo.config?.port,
        };
        return { success: true, data: connectionState };
      }

      return { success: true, data: null };
    } catch (error) {
      logToFile(`获取标签页连接状态失败: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }
}

module.exports = ConnectionHandlers;
