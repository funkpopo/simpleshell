const { parentPort } = require('worker_threads');
const os = require('os');

// 处理来自主线程的消息
parentPort.on('message', async (message) => {
  try {
    const { type, id, ...data } = message;
    
    let result;
    switch (type) {
      case 'getLocalSystemInfo':
        result = getLocalSystemInfo();
        break;
      case 'processRemoteSystemInfo':
        result = processRemoteSystemInfo(data);
        break;
      default:
        throw new Error(`未知操作类型: ${type}`);
    }
    
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ 
      id: message.id, 
      error: { message: error.message, stack: error.stack } 
    });
  }
});

// 获取本地系统信息
function getLocalSystemInfo() {
  const osInfo = {
    type: os.type(),
    platform: os.platform(),
    release: os.release(),
    hostname: os.hostname(),
    distro: '未知',
    version: '未知'
  };

  // 根据平台添加额外信息
  if (osInfo.platform === 'win32') {
    // Windows平台
    const windowsVersions = {
      '10.0': 'Windows 10/11',
      '6.3': 'Windows 8.1',
      '6.2': 'Windows 8',
      '6.1': 'Windows 7',
      '6.0': 'Windows Vista',
      '5.2': 'Windows XP 64-Bit Edition/Windows Server 2003',
      '5.1': 'Windows XP',
      '5.0': 'Windows 2000'
    };

    // 尝试获取Windows版本
    const releaseVersion = osInfo.release.split('.');
    if (releaseVersion.length >= 2) {
      const majorMinor = `${releaseVersion[0]}.${releaseVersion[1]}`;
      osInfo.distro = windowsVersions[majorMinor] || 'Windows';
    } else {
      osInfo.distro = 'Windows';
    }
    
    // 获取更具体的Windows版本信息
    try {
      if (osInfo.release.startsWith('10.0')) {
        // 获取Windows 10/11的具体版本号(如20H2, 21H1等)
        const buildNumber = parseInt(osInfo.release.split('.')[2], 10);
        
        // 根据构建号识别主要Windows版本
        if (buildNumber >= 22000) {
          osInfo.distro = 'Windows 11';
          if (buildNumber >= 22621) {
            osInfo.version = '23H2';
          } else if (buildNumber >= 22000) {
            osInfo.version = '21H2';
          }
        } else {
          osInfo.distro = 'Windows 10';
          if (buildNumber >= 19045) {
            osInfo.version = '22H2';
          } else if (buildNumber >= 19044) {
            osInfo.version = '21H2';
          } else if (buildNumber >= 19043) {
            osInfo.version = '21H1';
          } else if (buildNumber >= 19042) {
            osInfo.version = '20H2';
          } else if (buildNumber >= 19041) {
            osInfo.version = '2004';
          } else if (buildNumber >= 18363) {
            osInfo.version = '1909';
          } else if (buildNumber >= 18362) {
            osInfo.version = '1903';
          }
        }
      }
    } catch (e) {
      console.error('Error determining Windows version:', e);
    }
    
    // 添加架构信息
    try {
      const arch = os.arch();
      osInfo.release = `${osInfo.distro} ${osInfo.release} (${arch})`;
    } catch (e) {
      console.error('Error getting architecture info:', e);
    }
  } else if (osInfo.platform === 'darwin') {
    // macOS平台
    const macVersions = {
      '22': 'Ventura',
      '21': 'Monterey',
      '20': 'Big Sur',
      '19': 'Catalina',
      '18': 'Mojave',
      '17': 'High Sierra',
      '16': 'Sierra',
      '15': 'El Capitan',
      '14': 'Yosemite',
      '13': 'Mavericks',
      '12': 'Mountain Lion',
      '11': 'Lion',
      '10': 'Snow Leopard'
    };

    // 尝试获取macOS版本
    osInfo.distro = 'macOS';
    const darwinVersion = osInfo.release.split('.')[0];
    if (macVersions[darwinVersion]) {
      osInfo.version = macVersions[darwinVersion];
      osInfo.release = `macOS ${osInfo.version} (${osInfo.release})`;
    } else {
      // 尝试通过Darwin版本推断macOS版本
      if (parseInt(darwinVersion, 10) >= 23) {
        osInfo.version = 'Sonoma+';
      }
      osInfo.release = `macOS ${osInfo.version || osInfo.release}`;
    }
  } else if (osInfo.platform === 'linux') {
    // Linux平台，但Electron环境中能获取的信息有限
    osInfo.distro = 'Linux';
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
      usage: getCpuUsage()
    },
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem(),
      usagePercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
    }
  };
}

// 计算CPU使用率
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

// 处理来自主线程的远程系统信息数据
function processRemoteSystemInfo(data) {
  const { sshOutputs } = data;
  
  // 初始化结果对象
  const result = {
    isLocal: false,
    os: { type: '未知', platform: '未知', release: '未知', hostname: '未知', distro: '未知', version: '未知' },
    cpu: { model: '未知', cores: 0, usage: 0 },
    memory: { total: 0, free: 0, used: 0, usagePercent: 0 }
  };
  
  try {
    // 处理uname信息
    if (sshOutputs.uname) {
      const osInfo = sshOutputs.uname.trim();
      
      // 检测操作系统类型
      if (osInfo.includes('Linux')) {
        result.os.type = 'Linux';
        result.os.platform = 'linux';
      } else if (osInfo.includes('Darwin')) {
        result.os.type = 'macOS';
        result.os.platform = 'darwin';
      } else if (osInfo.includes('FreeBSD')) {
        result.os.type = 'FreeBSD';
        result.os.platform = 'freebsd';
      } else if (osInfo.includes('Windows')) {
        result.os.type = 'Windows';
        result.os.platform = 'win32';
      }
      
      result.os.release = osInfo;
    }
    
    // 处理发行版信息
    if (sshOutputs.distro) {
      // 处理Linux发行版信息
      const distroOutput = sshOutputs.distro.trim();
      if (distroOutput) {
        // 尝试从不同格式中提取信息
        // os-release格式
        const nameMatch = distroOutput.match(/NAME="([^"]+)"/);
        const versionMatch = distroOutput.match(/VERSION="([^"]+)"/);
        
        if (nameMatch) {
          result.os.distro = nameMatch[1];
        }
        
        if (versionMatch) {
          result.os.version = versionMatch[1];
        }
        
        // lsb_release格式
        if (!result.os.distro && distroOutput.includes('Description:')) {
          const descMatch = distroOutput.match(/Description:\s+(.+)/);
          if (descMatch) {
            const desc = descMatch[1];
            // 尝试分割发行版名称和版本
            const parts = desc.split(/\s+/);
            if (parts.length > 0) {
              result.os.distro = parts[0];
              result.os.version = parts.slice(1).join(' ');
            }
          }
        }
      }
    }
    
    // 处理主机名
    if (sshOutputs.hostname) {
      result.os.hostname = sshOutputs.hostname.trim();
    }
    
    // 处理CPU信息
    if (sshOutputs.cpu) {
      const cpuOutput = sshOutputs.cpu.trim();
      
      // 解析CPU信息 (model, cores, etc.)
      if (cpuOutput) {
        // 处理型号 - 通常是在第一行或包含"model name"的行
        const modelMatch = cpuOutput.match(/model\s+name\s*:\s*(.+)/i);
        if (modelMatch) {
          result.cpu.model = modelMatch[1].trim();
        }
        
        // 处理核心数 - 计算"processor"行数量
        const processorLines = cpuOutput.match(/processor\s*:/g);
        if (processorLines) {
          result.cpu.cores = processorLines.length;
        }
      }
    }
    
    // 处理CPU使用率
    if (sshOutputs.cpuUsage) {
      // 尝试提取CPU使用率数字
      const usageMatch = sshOutputs.cpuUsage.match(/(\d+(\.\d+)?)/);
      if (usageMatch) {
        result.cpu.usage = parseFloat(usageMatch[1]);
      }
    }
    
    // 处理内存信息
    if (sshOutputs.memory) {
      const memOutput = sshOutputs.memory.trim();
      
      if (result.os.platform === 'win32') {
        // 处理Windows内存信息
        const freeMatch = memOutput.match(/FreePhysicalMemory=(\d+)/);
        const totalMatch = memOutput.match(/TotalVisibleMemorySize=(\d+)/);
        
        if (freeMatch && totalMatch) {
          // Windows返回的是KB，需要转换为字节
          const free = parseInt(freeMatch[1], 10) * 1024;
          const total = parseInt(totalMatch[1], 10) * 1024;
          const used = total - free;
          
          result.memory.total = total;
          result.memory.free = free;
          result.memory.used = used;
          result.memory.usagePercent = Math.round((used / total) * 100);
        }
      } else {
        // 处理Linux内存信息 (free命令输出)
        const memLines = memOutput.split('\n');
        if (memLines.length > 1) {
          const memInfo = memLines[1].split(/\s+/);
          if (memInfo.length >= 4) {
            result.memory.total = parseInt(memInfo[1], 10);
            result.memory.used = parseInt(memInfo[2], 10);
            result.memory.free = parseInt(memInfo[3], 10);
            result.memory.usagePercent = Math.round((result.memory.used / result.memory.total) * 100);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error processing remote system info:', error);
  }
  
  return result;
} 