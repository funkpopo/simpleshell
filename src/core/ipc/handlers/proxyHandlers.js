const proxyManager = require("../../proxy/proxy-manager");
const { IPC_REQUEST_CHANNELS } = require("../schema/channels");

/**
 * 代理配置相关的IPC处理器
 * 错误统一由 safeHandle/wrapIpcHandler 捕获并生成标准错误响应,处理器内直接 throw
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
    return proxyManager.getProxyStatus();
  }

  async getDefaultConfig() {
    return proxyManager.getDefaultProxyConfig();
  }

  async saveDefaultConfig(proxyConfig) {
    return proxyManager.saveDefaultProxyConfig(proxyConfig);
  }

  async getSystemConfig() {
    return proxyManager.getSystemProxyConfig();
  }
}

module.exports = ProxyHandlers;
