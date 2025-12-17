const path = require("path");
const fs = require("fs").promises;
const { exec } = require("child_process");
const { promisify } = require("util");

const execAsync = promisify(exec);

class TerminalDetector {
  constructor() {
    this.detectedTerminals = [];
    this.isWindows = process.platform === "win32";
    this.isMacOS = process.platform === "darwin";
    this.isLinux = process.platform === "linux";
    this.cacheTime = null;
    this.cacheTTL = 300000; // 5 minutes cache
  }

  /**
   * 检测当前系统中可用的本地终端
   */
  async detectAllTerminals() {
    // 检查缓存
    if (this.cacheTime && Date.now() - this.cacheTime < this.cacheTTL) {
      return this.detectedTerminals;
    }

    this.detectedTerminals = [];

    try {
      if (this.isWindows) {
        await this.detectWindowsTerminals();
      } else if (this.isMacOS) {
        await this.detectMacOSTerminals();
      } else if (this.isLinux) {
        await this.detectLinuxTerminals();
      }
    } catch (error) {
      // 忽略异常，尽力返回已检测到的终端
    }

    this.cacheTime = Date.now();
    return this.detectedTerminals;
  }

  /**
   * 检测 Windows 系统可用的终端
   */
  async detectWindowsTerminals() {
    const terminals = [
      // WSL (Windows Subsystem for Linux)
      {
        name: "WSL (Ubuntu)",
        type: "wsl",
        executable: "wsl.exe",
        priority: 12,
        systemCommand: "wsl.exe",
        launchArgs: ["--distribution", "Ubuntu"],
        adminRequired: false,
      },

      // Windows Terminal
      {
        name: "Windows Terminal",
        type: "windows-terminal",
        executable: "wt.exe",
        priority: 11,
        packageName: "Microsoft.WindowsTerminal_8wekyb3d8bbwe",
      },
    ];

    // 并行检查所有终端
    const results = await Promise.allSettled(
      terminals.map((terminal) => this.checkTerminalAvailability(terminal)),
    );

    results.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value) {
        this.detectedTerminals.push(terminals[index]);
      }
    });

    // 按优先级降序排序
    this.detectedTerminals.sort(
      (a, b) => (b.priority || 0) - (a.priority || 0),
    );
  }

  /**
   * 检测 macOS 系统可用的终端
   */
  async detectMacOSTerminals() {
    const terminals = [
      {
        name: "Terminal",
        type: "terminal",
        executable: "/System/Applications/Utilities/Terminal.app",
        priority: 10,
      },
      {
        name: "iTerm2",
        type: "iterm2",
        executable: "/Applications/iTerm.app",
        priority: 9,
      },
      {
        name: "Hyper",
        type: "hyper",
        executable: "/Applications/Hyper.app",
        priority: 8,
      },
    ];

    // 并行检查所有终端
    const results = await Promise.allSettled(
      terminals.map((terminal) => this.checkTerminalAvailability(terminal)),
    );

    results.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value) {
        this.detectedTerminals.push(terminals[index]);
      }
    });

    this.detectedTerminals.sort(
      (a, b) => (b.priority || 0) - (a.priority || 0),
    );
  }

  /**
   * 检测 Linux 系统可用的终端
   */
  async detectLinuxTerminals() {
    const terminals = [
      {
        name: "GNOME Terminal",
        type: "gnome-terminal",
        executable: "gnome-terminal",
        priority: 10,
      },
      {
        name: "Konsole",
        type: "konsole",
        executable: "konsole",
        priority: 9,
      },
      {
        name: "XFCE Terminal",
        type: "xfce4-terminal",
        executable: "xfce4-terminal",
        priority: 8,
      },
      {
        name: "Terminator",
        type: "terminator",
        executable: "terminator",
        priority: 7,
      },
    ];

    // 并行检查所有终端
    const results = await Promise.allSettled(
      terminals.map((terminal) => this.checkTerminalAvailability(terminal)),
    );

    results.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value) {
        this.detectedTerminals.push(terminals[index]);
      }
    });

    this.detectedTerminals.sort(
      (a, b) => (b.priority || 0) - (a.priority || 0),
    );
  }

  /**
   * 检查给定终端是否可用
   */
  async checkTerminalAvailability(terminal) {
    try {
      // 并行执行多个检查，返回第一个成功的结果
      const checks = [];

      // 1. 检查显式给定的检查路径
      if (terminal.checkPaths) {
        checks.push(
          (async () => {
            for (const checkPath of terminal.checkPaths) {
              if (checkPath && (await this.fileExists(checkPath))) {
                terminal.executablePath = checkPath;
                return true;
              }
            }
            return false;
          })(),
        );
      }

      // 2. 检查环境变量指定的目录
      if (terminal.environmentPaths) {
        checks.push(
          (async () => {
            for (const envVar of terminal.environmentPaths) {
              const envPath = process.env[envVar];
              if (envPath) {
                const possiblePaths = [
                  path.join(envPath, terminal.executable),
                  path.join(envPath, "bin", terminal.executable),
                  path.join(envPath, "cmd", terminal.executable),
                ];

                for (const possiblePath of possiblePaths) {
                  if (await this.fileExists(possiblePath)) {
                    terminal.executablePath = possiblePath;
                    return true;
                  }
                }
              }
            }
            return false;
          })(),
        );
      }

      // 3. WSL 检查
      if (terminal.type === "wsl") {
        checks.push(this.checkWSLAvailability(terminal));
      }

      // 4. 系统命令查询
      if (terminal.systemCommand) {
        checks.push(
          (async () => {
            try {
              const whereCommand = this.isWindows ? "where" : "which";
              const { stdout } = await execAsync(
                `${whereCommand} ${terminal.systemCommand}`,
                {
                  timeout: 2000,
                  windowsHide: true,
                },
              );
              if (stdout.trim()) {
                const firstPath = stdout.trim().split("\n")[0].trim();
                if (firstPath && (await this.fileExists(firstPath))) {
                  terminal.executablePath = firstPath;
                  return true;
                }
              }
            } catch (error) {
              // 忽略
            }
            return false;
          })(),
        );
      }

      // 5. Windows 应用商店检查
      if (this.isWindows && terminal.packageName) {
        checks.push(
          (async () => {
            try {
              const { stdout } = await execAsync(
                `powershell -c "Get-AppxPackage -Name *${terminal.packageName.split("_")[0]}* | Select-Object -First 1 -ExpandProperty InstallLocation"`,
                { timeout: 3000 },
              );
              if (stdout.trim()) {
                terminal.executablePath = terminal.executable;
                return true;
              }
            } catch (error) {
              // 忽略
            }
            return false;
          })(),
        );
      }

      // 6. 直接查找和 PATH 查询（macOS/Linux）
      if (!this.isWindows && terminal.executable) {
        checks.push(
          (async () => {
            if (await this.fileExists(terminal.executable)) {
              terminal.executablePath = terminal.executable;
              return true;
            }

            try {
              const { stdout } = await execAsync(
                `which ${terminal.executable}`,
                { timeout: 2000 },
              );
              if (stdout.trim()) {
                terminal.executablePath = stdout.trim();
                return true;
              }
            } catch (error) {
              // 忽略
            }
            return false;
          })(),
        );
      }

      // 并行执行所有检查，返回第一个成功的
      if (checks.length === 0) return false;

      const results = await Promise.allSettled(checks);
      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          return true;
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * 检查 WSL 是否可用
   */
  async checkWSLAvailability(terminal) {
    try {
      // 通过 wsl -l -v 检查是否已安装（使用 UTF-16LE 编码处理）
      const { stdout: wslList } = await execAsync("wsl -l -v", {
        timeout: 3000,
        encoding: "utf16le", // 指定 UTF-16LE 编码
      });

      // 清理可能包含的空字符
      const cleanOutput = wslList.replace(/\0/g, "");

      if (
        cleanOutput.includes("Ubuntu") ||
        cleanOutput.includes("Debian") ||
        cleanOutput.includes("Alpine") ||
        cleanOutput.includes("Windows Subsystem for Linux") ||
        cleanOutput.includes("docker-desktop") ||
        cleanOutput.includes("SUSE") ||
        cleanOutput.includes("CentOS") ||
        cleanOutput.includes("Fedora") ||
        cleanOutput.includes("NAME")
      ) {
        // 包含 NAME/发行版等关键字说明 WSL 已安装
        terminal.executablePath = "wsl.exe";

        // 解析可用的 WSL 发行版
        const distributions = this.parseWSLDistributions(cleanOutput);

        // 过滤 docker-desktop/podman 等非实际发行版
        const validDistributions = distributions.filter(
          (dist) =>
            !dist.name.toLowerCase().includes("docker-desktop") &&
            !dist.name.toLowerCase().includes("podman-machine"),
        );

        if (validDistributions.length > 0) {
          terminal.availableDistributions = validDistributions;

          // 多个发行版时，后续可提供选择
          if (validDistributions.length > 1) {
            terminal.hasMultipleDistributions = true;
          }

          return true;
        } else {
          return false;
        }
      }

      return false;
    } catch (error) {
      // WSL 不可用或执行失败
      return false;
    }
  }

  /**
   * 解析 WSL 发行版列表输出
   */
  parseWSLDistributions(wslOutput) {
    const lines = wslOutput.split("\n");
    const distributions = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (
        trimmed &&
        !trimmed.startsWith("NAME") &&
        !trimmed.startsWith("Windows Subsystem")
      ) {
        // 去掉开头可能的 * 标记，然后按空白分割
        const cleanLine = trimmed.replace(/^\*\s*/, "");
        const parts = cleanLine.split(/\s+/);

        if (parts.length >= 2) {
          const name = parts[0];
          const state = parts[1];
          const version = parts[2] || "WSL1";

          // 仅在必要字段有效时加入结果
          if (
            name &&
            state &&
            name !== "STATE" &&
            name !== "NAME" &&
            state !== "STATE"
          ) {
            const distribution = {
              name,
              state,
              version,
              isDefault: trimmed.startsWith("*"),
            };
            distributions.push(distribution);
          }
        }
      }
    }

    return distributions;
  }

  /**
   * 文件是否存在
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取已检测到的终端列表
   */
  getDetectedTerminals() {
    return [...this.detectedTerminals];
  }

  /**
   * 根据类型获取终端
   */
  getTerminalByType(type) {
    return this.detectedTerminals.find((terminal) => terminal.type === type);
  }

  /**
   * 获取推荐（默认）的终端
   */
  getRecommendedTerminal() {
    if (this.detectedTerminals.length === 0) {
      return null;
    }
    return this.detectedTerminals[0]; // 已按优先级排序
  }
}

module.exports = TerminalDetector;

