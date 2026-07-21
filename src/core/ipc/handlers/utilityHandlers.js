const ipQuery = require("../../../modules/system-info/ip-query");
const proxyManager = require("../../proxy/proxy-manager");
const { logToFile } = require("../../utils/logger");
const { IPC_REQUEST_CHANNELS } = require("../schema/channels");

/**
 * 实用工具相关的IPC处理器
 * 通用错误由 wrapIpcHandler 处理；IP 查询失败保留上游 API 形态 { ret, msg }
 * （渲染端 IPAddressQuery 依赖 ret/msg，不走标准 success 信封）
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
    void event;
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
