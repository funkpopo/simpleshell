const {
  getLocalSystemInfo,
  getCpuUsage,
  getProcessList,
} = require("./local-system");
const {
  getRemoteSystemInfo,
  getRemoteProcessList,
} = require("./remote-system");
const { getRemoteResourceSnapshot } = require("./resource-snapshot");
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

  // 合并快照（单次远程调用同时获取系统信息与指标样本）
  getRemoteResourceSnapshot,
};
