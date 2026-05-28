const proxyManager = require("../../proxy/proxy-manager");
const { logToFile } = require("../../utils/logger");
const { IPC_REQUEST_CHANNELS } = require("../schema/channels");

/**
 * 代理配置相关的IPC处理器
 */
class ProxyHandlers {
  /**
   * 获取所有代理处理器
   */
  getHandlers() {
    return [
      {
        channel: IPC_REQUEST_CHANNELS.PROXY_GET_STATUS,
        category: "proxy",
        handler: this.getStatus.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.PROXY_GET_DEFAULT_CONFIG,
        category: "proxy",
        handler: this.getDefaultConfig.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.PROXY_SAVE_DEFAULT_CONFIG,
        category: "proxy",
        handler: this.saveDefaultConfig.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.PROXY_GET_SYSTEM_CONFIG,
        category: "proxy",
        handler: this.getSystemConfig.bind(this),
      },
    ];
  }

  async getStatus() {
    try {
      return proxyManager.getProxyStatus();
    } catch (error) {
      logToFile(`Error getting proxy status: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async getDefaultConfig() {
    try {
      return proxyManager.getDefaultProxyConfig();
    } catch (error) {
      logToFile(
        `Error getting default proxy config: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: error.message };
    }
  }

  async saveDefaultConfig(proxyConfig) {
    try {
      return proxyManager.saveDefaultProxyConfig(proxyConfig);
    } catch (error) {
      logToFile(`Error saving default proxy config: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async getSystemConfig() {
    try {
      return proxyManager.getSystemProxyConfig();
    } catch (error) {
      logToFile(`Error getting system proxy config: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }
}

module.exports = ProxyHandlers;
