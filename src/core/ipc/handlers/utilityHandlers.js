const ipQuery = require("../../../modules/system-info/ip-query");
const proxyManager = require("../../proxy/proxy-manager");
const { logToFile } = require("../../utils/logger");

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
        channel: "ip:query",
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
