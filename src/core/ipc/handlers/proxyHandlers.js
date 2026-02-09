const proxyManager = require("../../proxy/proxy-manager");
const { logToFile } = require("../../utils/logger");

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
        channel: "proxy:getStatus",
        category: "proxy",
        handler: this.getStatus.bind(this),
      },
      {
        channel: "proxy:getDefaultConfig",
        category: "proxy",
        handler: this.getDefaultConfig.bind(this),
      },
      {
        channel: "proxy:saveDefaultConfig",
        category: "proxy",
        handler: this.saveDefaultConfig.bind(this),
      },
      {
        channel: "proxy:getSystemConfig",
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
      logToFile(`Error getting default proxy config: ${error.message}`, "ERROR");
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
