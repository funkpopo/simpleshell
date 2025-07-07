const {
  getLocalSystemInfo,
  getCpuUsage,
  getProcessList,
} = require("./local-system");
const {
  getRemoteSystemInfo,
  getRemoteProcessList,
} = require("./remote-system");

module.exports = {
  // 本地系统信息
  getLocalSystemInfo,
  getCpuUsage,
  getProcessList,

  // 远程系统信息
  getRemoteSystemInfo,
  getRemoteProcessList,
};
