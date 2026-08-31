const {
  getLocalSystemInfo,
  getCpuUsage,
  getProcessList,
} = require("./local-system");
const {
  getRemoteSystemInfo,
  getRemoteProcessList,
} = require("./remote-system");
const {
  getLocalMetricsSample,
  getRemoteMetricsSample,
  getLocalDiskUsage,
  getRemoteDiskUsage,
  getLocalHostname,
} = require("./metrics-sample");

module.exports = {
  // 本地系统信息
  getLocalSystemInfo,
  getCpuUsage,
  getProcessList,
  getLocalMetricsSample,
  getLocalDiskUsage,
  getLocalHostname,

  // 远程系统信息
  getRemoteSystemInfo,
  getRemoteProcessList,
  getRemoteMetricsSample,
  getRemoteDiskUsage,
};
