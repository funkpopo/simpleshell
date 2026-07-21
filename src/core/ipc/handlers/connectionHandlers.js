const processManager = require("../../process/processManager");
const { IPC_REQUEST_CHANNELS } = require("../schema/channels");
const { isSshStreamUsable } = require("../../utils/ssh-utils");

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
        channel: IPC_REQUEST_CHANNELS.CONNECTION_GET_TAB_STATUS,
        category: "connection",
        handler: this.getTabStatus.bind(this),
      },
    ];
  }

  async getTabStatus(event, tabId) {
    if (!tabId || tabId === "welcome") {
      return { success: true, data: null };
    }

    const processInfo = processManager.getProcess(tabId);

    if (!processInfo) {
      return { success: true, data: null };
    }

    if (processInfo.type === "ssh2") {
      const isConnected = isSshStreamUsable(processInfo.stream);
      const connectionState = {
        isConnected,
        isConnecting: !isConnected && processInfo.ready !== false,
        quality: isConnected ? "excellent" : "offline",
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
  }
}

module.exports = ConnectionHandlers;
