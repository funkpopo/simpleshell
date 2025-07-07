async function getRemoteSystemInfo(sshClient) {
  return new Promise((resolve, reject) => {
    const result = {
      isLocal: false,
      os: {
        type: "未知",
        platform: "未知",
        release: "未知",
        hostname: "未知",
        distro: "未知",
        version: "未知",
      },
      cpu: { model: "未知", cores: 0, usage: 0 },
      memory: { total: 0, free: 0, used: 0, usagePercent: 0 },
      processes: [], // Initially empty, will be fetched on demand
    };

    // 获取基本操作系统信息
    sshClient.exec("uname -a", (err, stream) => {
      if (err) {
        resolve(result);
        return;
      }

      let output = "";
      stream.on("data", (data) => {
        output += data.toString();
      });

      stream.on("close", () => {
        // 解析基本操作系统信息
        const osInfo = output.trim();

        // 检测操作系统类型
        if (osInfo.includes("Linux")) {
          result.os.type = "Linux";
          result.os.platform = "linux";

          // 获取详细的Linux发行版信息
          getLinuxDistro();
        } else if (osInfo.includes("Windows")) {
          result.os.type = "Windows";
          result.os.platform = "win32";
          getWindowsVersion();
        } else {
          // 未识别的系统，直接保存uname信息
          result.os.release = osInfo;
          getHostname();
        }

        // 获取Linux发行版信息
        function getLinuxDistro() {
          // 尝试多种方法获取Linux发行版信息
          const distroCommands = [
            'cat /etc/os-release | grep -E "^(NAME|VERSION)="',
            "lsb_release -a 2>/dev/null",
            "cat /etc/redhat-release 2>/dev/null",
            "cat /etc/debian_version 2>/dev/null",
          ];

          let commandIndex = 0;
          tryNextCommand();

          function tryNextCommand() {
            if (commandIndex >= distroCommands.length) {
              // 所有命令都尝试过了，保存现有信息然后继续
              result.os.release = osInfo;
              getHostname();
              return;
            }

            const command = distroCommands[commandIndex++];
            sshClient.exec(command, (err, stream) => {
              if (err) {
                tryNextCommand();
                return;
              }

              let distroOutput = "";
              stream.on("data", (data) => {
                distroOutput += data.toString();
              });

              stream.on("close", () => {
                const output = distroOutput.trim();
                if (output) {
                  // 解析不同格式的输出
                  if (command.includes("/etc/os-release")) {
                    // 解析os-release格式
                    const nameMatch = output.match(/NAME="([^"]+)"/);
                    const versionMatch = output.match(/VERSION="([^"]+)"/);

                    if (nameMatch) {
                      result.os.distro = nameMatch[1];
                    }
                    if (versionMatch) {
                      result.os.version = versionMatch[1];
                    }

                    result.os.release =
                      `${result.os.distro || "Linux"} ${result.os.version || ""}`.trim();
                    getHostname();
                  } else if (command.includes("lsb_release")) {
                    // 解析lsb_release格式
                    const distroMatch = output.match(/Distributor ID:\s+(.+)/);
                    const versionMatch = output.match(/Release:\s+(.+)/);

                    if (distroMatch) {
                      result.os.distro = distroMatch[1].trim();
                    }
                    if (versionMatch) {
                      result.os.version = versionMatch[1].trim();
                    }

                    result.os.release =
                      `${result.os.distro || "Linux"} ${result.os.version || ""}`.trim();
                    getHostname();
                  } else if (
                    command.includes("/etc/redhat-release") ||
                    command.includes("/etc/debian_version")
                  ) {
                    // 直接使用文件内容
                    result.os.release = output;
                    result.os.distro = output.split(" ")[0] || "Linux";

                    // 尝试提取版本号
                    const versionMatch = output.match(/(\d+(\.\d+)+)/);
                    if (versionMatch) {
                      result.os.version = versionMatch[1];
                    }

                    getHostname();
                  } else {
                    tryNextCommand();
                  }
                } else {
                  tryNextCommand();
                }
              });
            });
          }
        }

        // 获取macOS版本
        function getMacOSVersion() {
          sshClient.exec("sw_vers", (err, stream) => {
            if (err) {
              getHostname();
              return;
            }

            let macOutput = "";
            stream.on("data", (data) => {
              macOutput += data.toString();
            });

            stream.on("close", () => {
              const productMatch = macOutput.match(/ProductName:\s+(.+)/);
              const versionMatch = macOutput.match(/ProductVersion:\s+(.+)/);

              if (productMatch) {
                result.os.distro = productMatch[1].trim();
              }
              if (versionMatch) {
                result.os.version = versionMatch[1].trim();
              }

              result.os.release =
                `${result.os.distro || "macOS"} ${result.os.version || ""}`.trim();
              getHostname();
            });
          });
        }

        // 获取Windows版本
        function getWindowsVersion() {
          sshClient.exec(
            "wmic os get Caption,Version,OSArchitecture /value",
            (err, stream) => {
              if (err) {
                getHostname();
                return;
              }

              let winOutput = "";
              stream.on("data", (data) => {
                winOutput += data.toString();
              });

              stream.on("close", () => {
                const captionMatch = winOutput.match(/Caption=(.+)/);
                const versionMatch = winOutput.match(/Version=(.+)/);
                const archMatch = winOutput.match(/OSArchitecture=(.+)/);

                if (captionMatch) {
                  result.os.distro = captionMatch[1].trim();
                }
                if (versionMatch) {
                  result.os.version = versionMatch[1].trim();
                }

                let archInfo = "";
                if (archMatch) {
                  archInfo = ` (${archMatch[1].trim()})`;
                }

                result.os.release =
                  `${result.os.distro || "Windows"} ${result.os.version || ""}${archInfo}`.trim();
                getHostname();
              });
            },
          );
        }

        // 获取主机名
        function getHostname() {
          sshClient.exec("hostname", (err, stream) => {
            if (err) {
              getMemoryInfo();
              return;
            }

            let hostnameOutput = "";
            stream.on("data", (data) => {
              hostnameOutput += data.toString();
            });

            stream.on("close", () => {
              result.os.hostname = hostnameOutput.trim();
              getMemoryInfo();
            });
          });
        }

        function getMemoryInfo() {
          // 根据平台决定获取内存命令
          const memCommand =
            result.os.platform === "win32"
              ? "wmic OS get FreePhysicalMemory,TotalVisibleMemorySize /Value"
              : "free -b";

          sshClient.exec(memCommand, (err, stream) => {
            if (err) {
              getCpuInfo();
              return;
            }

            let memOutput = "";
            stream.on("data", (data) => {
              memOutput += data.toString();
            });

            stream.on("close", () => {
              try {
                if (result.os.platform === "win32") {
                  // 解析Windows内存信息
                  const freeMatch = memOutput.match(/FreePhysicalMemory=(\d+)/);
                  const totalMatch = memOutput.match(
                    /TotalVisibleMemorySize=(\d+)/,
                  );

                  if (freeMatch && totalMatch) {
                    // Windows返回的是KB，需要转换为字节
                    const free = parseInt(freeMatch[1], 10) * 1024;
                    const total = parseInt(totalMatch[1], 10) * 1024;
                    const used = total - free;

                    result.memory.total = total;
                    result.memory.free = free;
                    result.memory.used = used;
                    result.memory.usagePercent = Math.round(
                      (used / total) * 100,
                    );
                  }
                } else {
                  // 解析Linux内存信息
                  const memLines = memOutput.split("\n");
                  if (memLines.length > 1) {
                    const memInfo = memLines[1].split(/\s+/);
                    if (memInfo.length >= 4) {
                      result.memory.total = parseInt(memInfo[1], 10);
                      result.memory.used = parseInt(memInfo[2], 10);
                      result.memory.free = parseInt(memInfo[3], 10);
                      result.memory.usagePercent = Math.round(
                        (result.memory.used / result.memory.total) * 100,
                      );
                    }
                  }
                }
              } catch (error) {}

              getCpuInfo();
            });
          });
        }

        function getCpuInfo() {
          // 根据平台选择不同命令
          const cpuCommand =
            result.os.platform === "win32"
              ? "wmic cpu get NumberOfCores,Name"
              : 'cat /proc/cpuinfo | grep -E "model name|processor" | wc -l';

          sshClient.exec(cpuCommand, (err, stream) => {
            if (err) {
              getCpuModel();
              return;
            }

            let cpuOutput = "";
            stream.on("data", (data) => {
              cpuOutput += data.toString();
            });

            stream.on("close", () => {
              try {
                if (result.os.platform === "win32") {
                  // 解析Windows CPU核心数
                  const lines = cpuOutput.trim().split("\n");
                  if (lines.length >= 2) {
                    const coresLine = lines[1].trim();
                    result.cpu.cores = parseInt(coresLine, 10) || 1;
                  }
                } else {
                  // 解析Linux CPU核心数
                  result.cpu.cores = parseInt(cpuOutput.trim(), 10) / 2; // 除以2因为每个处理器有两行信息
                }
              } catch (error) {}

              getCpuModel();
            });
          });
        }

        function getCpuModel() {
          const modelCommand =
            result.os.platform === "win32"
              ? "wmic cpu get Name"
              : 'cat /proc/cpuinfo | grep "model name" | head -1';

          sshClient.exec(modelCommand, (err, stream) => {
            if (err) {
              getCpuUsage();
              return;
            }

            let modelOutput = "";
            stream.on("data", (data) => {
              modelOutput += data.toString();
            });

            stream.on("close", () => {
              try {
                if (result.os.platform === "win32") {
                  // 解析Windows CPU型号
                  const lines = modelOutput.trim().split("\n");
                  if (lines.length >= 2) {
                    result.cpu.model = lines[1].trim();
                  }
                } else {
                  // 解析Linux CPU型号
                  const match = modelOutput.match(/model name\s*:\s*(.*)/);
                  if (match && match[1]) {
                    result.cpu.model = match[1].trim();
                  }
                }
              } catch (error) {}

              getCpuUsage();
            });
          });
        }

        function getCpuUsage() {
          const usageCommand =
            result.os.platform === "win32"
              ? "wmic cpu get LoadPercentage"
              : 'top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk \'{print 100 - $1}\'';

          sshClient.exec(usageCommand, (err, stream) => {
            if (err) {
              finalize();
              return;
            }

            let usageOutput = "";
            stream.on("data", (data) => {
              usageOutput += data.toString();
            });

            stream.on("close", () => {
              try {
                if (result.os.platform === "win32") {
                  // 解析Windows CPU使用率
                  const lines = usageOutput.trim().split("\n");
                  if (lines.length >= 2) {
                    result.cpu.usage = parseInt(lines[1].trim(), 10);
                  }
                } else {
                  // 解析Linux CPU使用率
                  result.cpu.usage = parseFloat(usageOutput.trim());
                }
              } catch (error) {}

              finalize();
            });
          });
        }

        function finalize() {
          resolve(result);
        }
      });
    });
  });
}

async function getRemoteProcessList(sshClient) {
  return new Promise((resolve, reject) => {
    // 使用ps命令获取进程列表，--no-headers避免输出标题行
    // 输出格式：PID,PPID,CPU使用率,内存使用率,用户,命令名
    const command = "ps -axo pid,ppid,%cpu,%mem,user:20,comm --no-headers";

    sshClient.exec(command, (err, stream) => {
      if (err) {
        return reject(
          new Error(`Failed to execute process list command: ${err.message}`),
        );
      }

      let output = "";
      stream.on("data", (data) => {
        output += data.toString();
      });

      stream.on("close", () => {
        try {
          const processes = output
            .trim()
            .split("\n")
            .map((line) => {
              const parts = line.trim().split(/\s+/);
              if (parts.length < 6) return null;

              // 最后一个元素是命令，前面的都是固定列
              const commandName = parts.slice(5).join(" ");

              return {
                pid: parseInt(parts[0], 10),
                ppid: parseInt(parts[1], 10),
                cpu: parseFloat(parts[2]),
                memory: parseFloat(parts[3]),
                user: parts[4],
                name: commandName,
              };
            })
            .filter(Boolean) // 过滤掉解析失败的行
            .sort((a, b) => b.memory - a.memory);

          resolve(processes);
        } catch (parseError) {
          reject(new Error(`Failed to parse process list: ${parseError.message}`));
        }
      });
    });
  });
}

module.exports = {
  getRemoteSystemInfo,
  getRemoteProcessList,
};
