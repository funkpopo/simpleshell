const os = require("os");
const si = require("systeminformation");

async function getProcessList() {
  try {
    const processes = await si.processes();
    return processes.list
      .map((p) => ({
        pid: p.pid,
        name: p.name,
        cpu: p.cpu,
        memory: p.mem, // Memory usage in percent
        memoryBytes: p.mem_rss * 1024, // mem_rss is in KB
      }))
      .sort((a, b) => b.memory - a.memory);
  } catch (error) {
    console.error("Error getting process list:", error);
    return [];
  }
}

async function getCpuUsage() {
  try {
    // 使用systeminformation库获取实时CPU使用率
    const currentLoad = await si.currentLoad();
    return Math.round(currentLoad.currentLoad);
  } catch (error) {
    console.error("Error getting CPU usage with systeminformation:", error);
  }
}

async function getLocalSystemInfo() {
  const osInfo = {
    type: os.type(),
    platform: os.platform(),
    release: os.release(),
    hostname: os.hostname(),
    distro: "未知",
    version: "未知",
  };

  // 根据平台添加额外信息
  if (osInfo.platform === "win32") {
    // Windows平台
    const windowsVersions = {
      "10.0": "Windows 10/11",
      6.3: "Windows 8.1",
      6.2: "Windows 8",
      6.1: "Windows 7",
      "6.0": "Windows Vista",
      5.2: "Windows XP 64-Bit Edition/Windows Server 2003",
      5.1: "Windows XP",
      "5.0": "Windows 2000",
    };

    // 尝试获取Windows版本
    const releaseVersion = osInfo.release.split(".");
    if (releaseVersion.length >= 2) {
      const majorMinor = `${releaseVersion[0]}.${releaseVersion[1]}`;
      osInfo.distro = windowsVersions[majorMinor] || "Windows";
    } else {
      osInfo.distro = "Windows";
    }

    // 获取更具体的Windows版本信息
    try {
      if (osInfo.release.startsWith("10.0")) {
        // 获取Windows 10/11的具体版本号(如20H2, 21H1等)
        const buildNumber = parseInt(osInfo.release.split(".")[2], 10);

        // 根据构建号识别主要Windows版本
        if (buildNumber >= 22000) {
          osInfo.distro = "Windows 11";
          if (buildNumber >= 22621) {
            osInfo.version = "23H2";
          } else if (buildNumber >= 22000) {
            osInfo.version = "21H2";
          }
        } else {
          osInfo.distro = "Windows 10";
          if (buildNumber >= 19045) {
            osInfo.version = "22H2";
          } else if (buildNumber >= 19044) {
            osInfo.version = "21H2";
          } else if (buildNumber >= 19043) {
            osInfo.version = "21H1";
          } else if (buildNumber >= 19042) {
            osInfo.version = "20H2";
          } else if (buildNumber >= 19041) {
            osInfo.version = "2004";
          } else if (buildNumber >= 18363) {
            osInfo.version = "1909";
          } else if (buildNumber >= 18362) {
            osInfo.version = "1903";
          }
        }
      }
    } catch (e) {}

    // 添加架构信息
    try {
      const arch = os.arch();
      osInfo.release = `${osInfo.distro} ${osInfo.release} (${arch})`;
    } catch (e) {}
  } else if (osInfo.platform === "linux") {
    osInfo.distro = "Linux";
    os;
  }

  return {
    isLocal: true,
    os: osInfo,
    cpu: {
      model: os.cpus()[0].model,
      cores: os.cpus().length,
      speed: os.cpus()[0].speed,
      usage: await getCpuUsage(),
    },
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem(),
      usagePercent: Math.round(
        ((os.totalmem() - os.freemem()) / os.totalmem()) * 100,
      ),
    },
    processes: [], // Initially empty, will be fetched on demand
  };
}

module.exports = {
  getLocalSystemInfo,
  getCpuUsage,
  getProcessList,
};
