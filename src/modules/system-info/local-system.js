const os = require("os");

/**
 * 计算CPU使用率
 * @returns {number} CPU使用率百分比
 */
function getCpuUsage() {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }

  const usage = 100 - Math.round((totalIdle / totalTick) * 100);
  return usage;
}

/**
 * 获取本地系统信息
 * @returns {Object} 包含操作系统、CPU和内存信息的对象
 */
function getLocalSystemInfo() {
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
    } catch (e) {
      console.error("Error determining Windows version:", e);
    }

    // 添加架构信息
    try {
      const arch = os.arch();
      osInfo.release = `${osInfo.distro} ${osInfo.release} (${arch})`;
    } catch (e) {
      console.error("Error getting architecture info:", e);
    }
  } else if (osInfo.platform === "darwin") {
    // macOS平台
    const macVersions = {
      22: "Ventura",
      21: "Monterey",
      20: "Big Sur",
      19: "Catalina",
      18: "Mojave",
      17: "High Sierra",
      16: "Sierra",
      15: "El Capitan",
      14: "Yosemite",
      13: "Mavericks",
      12: "Mountain Lion",
      11: "Lion",
      10: "Snow Leopard",
    };

    // 尝试获取macOS版本
    osInfo.distro = "macOS";
    const darwinVersion = osInfo.release.split(".")[0];
    if (macVersions[darwinVersion]) {
      osInfo.version = macVersions[darwinVersion];
      osInfo.release = `macOS ${osInfo.version} (${osInfo.release})`;
    } else {
      // 尝试通过Darwin版本推断macOS版本
      if (parseInt(darwinVersion, 10) >= 23) {
        osInfo.version = "Sonoma+";
      }
      osInfo.release = `macOS ${osInfo.version || osInfo.release}`;
    }
  } else if (osInfo.platform === "linux") {
    // Linux平台，但Electron环境中能获取的信息有限
    osInfo.distro = "Linux";
    // 在Electron中我们无法轻松运行命令获取发行版信息
    // 所以这里只提供基本信息
    osInfo.release = `Linux ${osInfo.release}`;
  }

  return {
    isLocal: true,
    os: osInfo,
    cpu: {
      model: os.cpus()[0].model,
      cores: os.cpus().length,
      speed: os.cpus()[0].speed,
      usage: getCpuUsage(),
    },
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem(),
      usagePercent: Math.round(
        ((os.totalmem() - os.freemem()) / os.totalmem()) * 100,
      ),
    },
  };
}

module.exports = {
  getLocalSystemInfo,
  getCpuUsage,
};
