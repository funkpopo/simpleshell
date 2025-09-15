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
  }

  /**
   * 检测系统中所有可用的终端
   */
  async detectAllTerminals() {
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
      // 即使发生错误也返回已检测到的终端
    }

    return this.detectedTerminals;
  }

  /**
   * 检测Windows系统中的终端
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

    for (const terminal of terminals) {
      try {
        if (await this.checkTerminalAvailability(terminal)) {
          this.detectedTerminals.push(terminal);
        }
      } catch (error) {
        // 继续检测其他终端
      }
    }

    // 按优先级排序
    this.detectedTerminals.sort(
      (a, b) => (b.priority || 0) - (a.priority || 0),
    );
  }

  /**
   * 检测macOS系统中的终端
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

    for (const terminal of terminals) {
      try {
        if (await this.checkTerminalAvailability(terminal)) {
          this.detectedTerminals.push(terminal);
        }
      } catch (error) {
        // 继续检测其他终端
      }
    }

    this.detectedTerminals.sort(
      (a, b) => (b.priority || 0) - (a.priority || 0),
    );
  }

  /**
   * 检测Linux系统中的终端
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

    for (const terminal of terminals) {
      try {
        if (await this.checkTerminalAvailability(terminal)) {
          this.detectedTerminals.push(terminal);
        }
      } catch (error) {
        // 继续检测其他终端
      }
    }

    this.detectedTerminals.sort(
      (a, b) => (b.priority || 0) - (a.priority || 0),
    );
  }

  /**
   * 检查终端是否可用
   */
  async checkTerminalAvailability(terminal) {
    try {

      // 1. 首先检查指定路径
      if (terminal.checkPaths) {
        for (const checkPath of terminal.checkPaths) {
          if (checkPath && (await this.fileExists(checkPath))) {
            terminal.executablePath = checkPath;
            return true;
          }
        }
      }

      // 2. 检查环境变量指定的路径
      if (terminal.environmentPaths) {
        for (const envVar of terminal.environmentPaths) {
          const envPath = process.env[envVar];
          if (envPath) {
            // 检查环境变量路径下的可执行文件
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
      }

      // 3. WSL特殊检查
      if (terminal.type === "wsl") {
        return await this.checkWSLAvailability(terminal);
      }

      // 4. 检查系统命令
      if (terminal.systemCommand) {
        try {
          const whereCommand = this.isWindows ? "where" : "which";
          const { stdout } = await execAsync(
            `${whereCommand} ${terminal.systemCommand}`,
            {
              timeout: 5000,
              windowsHide: true,
            },
          );
          if (stdout.trim()) {
            const foundPaths = stdout.trim().split("\n");
            // 取第一个找到的路径
            const firstPath = foundPaths[0].trim();
            if (firstPath && (await this.fileExists(firstPath))) {
              terminal.executablePath = firstPath;
              return true;
            }
          }
        } catch (error) {
          // 命令不存在，继续尝试其他方法
        }
      }

      // 5. 检查Windows应用包
      if (this.isWindows && terminal.packageName) {
        try {
          const { stdout } = await execAsync(
            `powershell -c "Get-AppxPackage -Name *${terminal.packageName.split("_")[0]}* | Select-Object -First 1 -ExpandProperty InstallLocation"`,
            { timeout: 8000 },
          );
          if (stdout.trim()) {
            terminal.executablePath = terminal.executable;
            return true;
          }
        } catch (error) {
          // 包不存在
        }
      }

      // 6. 通用可执行文件检查 (macOS/Linux)
      if (!this.isWindows && terminal.executable) {
        if (await this.fileExists(terminal.executable)) {
          terminal.executablePath = terminal.executable;
          return true;
        }

        // 尝试在PATH中查找
        try {
          const { stdout } = await execAsync(`which ${terminal.executable}`, {
            timeout: 5000,
          });
          if (stdout.trim()) {
            terminal.executablePath = stdout.trim();
            return true;
          }
        } catch (error) {
          // 不在PATH中
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * 检查WSL是否可用
   */
  async checkWSLAvailability(terminal) {
    try {
      // 检查WSL是否安装，使用特定的编码处理
      const { stdout: wslList } = await execAsync("wsl -l -v", {
        timeout: 8000,
        encoding: "utf16le", // 指定UTF-16LE编码
      });

      // 清理输出中可能的null字节
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
        // NAME表示WSL已安装且有发行版列表
        terminal.executablePath = "wsl.exe";

        // 检测所有可用的WSL发行版
        const distributions = this.parseWSLDistributions(cleanOutput);

        // 过滤掉docker-desktop等非Linux发行版
        const validDistributions = distributions.filter(
          (dist) =>
            !dist.name.toLowerCase().includes("docker-desktop") &&
            !dist.name.toLowerCase().includes("podman-machine"),
        );

        if (validDistributions.length > 0) {
          terminal.availableDistributions = validDistributions;

          // 如果有多个发行版，创建多个终端选项
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
      // WSL不可用
      return false;
    }
  }

  /**
   * 解析WSL发行版列表
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
        // 移除可能的 * 标记并分割
        const cleanLine = trimmed.replace(/^\*\s*/, "");
        const parts = cleanLine.split(/\s+/);

        if (parts.length >= 2) {
          const name = parts[0];
          const state = parts[1];
          const version = parts[2] || "WSL1";

          // 跳过标题行和无效条目
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
   * 检查文件是否存在
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
   * 获取已检测的终端列表
   */
  getDetectedTerminals() {
    return [...this.detectedTerminals];
  }

  /**
   * 按类型获取终端
   */
  getTerminalByType(type) {
    return this.detectedTerminals.find((terminal) => terminal.type === type);
  }

  /**
   * 获取推荐的默认终端
   */
  getRecommendedTerminal() {
    if (this.detectedTerminals.length === 0) {
      return null;
    }
    return this.detectedTerminals[0]; // 已经按优先级排序
  }
}

module.exports = TerminalDetector;
