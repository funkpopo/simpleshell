const { getLocalSystemInfo, getCpuUsage } = require("./local-system");
const { getRemoteSystemInfo } = require("./remote-system");

/**
 * 系统信息模块
 * 提供本地和远程系统信息获取功能
 */
module.exports = {
  // 本地系统信息
  getLocalSystemInfo,
  getCpuUsage,

  // 远程系统信息
  getRemoteSystemInfo,
};
