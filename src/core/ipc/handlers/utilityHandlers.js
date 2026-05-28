const ipQuery = require("../../../modules/system-info/ip-query");
const proxyManager = require("../../proxy/proxy-manager");
const { logToFile } = require("../../utils/logger");
const { IPC_REQUEST_CHANNELS } = require("../schema/channels");

/**
 * 实用工具相关的IPC处理器
 */
class UtilityHandlers {
  /**
   * 获取所有实用工具处理器
   */
  getHandlers() {
    return [
      {
        channel: IPC_REQUEST_CHANNELS.UTILITY_IP_QUERY,
        category: "utility",
        handler: this.queryIp.bind(this),
      },
    ];
  }

  async queryIp(event, ip = "") {
    try {
      const proxyConfig = proxyManager.getDefaultProxyConfig();
      return await ipQuery.queryIpAddress(ip, logToFile, proxyConfig);
    } catch (error) {
      logToFile(`IP地址查询失败: ${error.message}`, "ERROR");
      return {
        ret: "failed",
        msg: error.message,
      };
    }
  }
}

module.exports = UtilityHandlers;
