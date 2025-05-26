const { getLocalSystemInfo, getCpuUsage } = require("./local-system");
const { getRemoteSystemInfo } = require("./remote-system");

module.exports = {
  // 本地系统信息
  getLocalSystemInfo,
  getCpuUsage,

  // 远程系统信息
  getRemoteSystemInfo,
};
