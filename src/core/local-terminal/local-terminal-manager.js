const { spawn } = require("child_process");
const EventEmitter = require("events");

class LocalTerminalManager extends EventEmitter {
  constructor() {
    super();
    this.activeTerminals = new Map();
    this.isWindows = process.platform === "win32";
    this.isMacOS = process.platform === "darwin";
    this.isLinux = process.platform === "linux";
  }

  /**
   * 启动本地终端
   * @param {Object} terminalConfig - 终端配置
   * @param {string} tabId - 标签页ID
   * @param {Object} options - 启动选项 (adminMode, distribution, etc.)
   */
  async launchTerminal(terminalConfig, tabId, options = {}) {
    try {
      // 检查是否已经有相同类型的终端在运行
      const existingTerminal = Array.from(this.activeTerminals.values()).find(
        (terminal) =>
          terminal.config && terminal.config.type === terminalConfig.type,
      );

      if (existingTerminal && existingTerminal.status !== "exited") {
        // Terminal of same type is already running
        // 返回现有终端的信息，而不是启动新的
        return existingTerminal;
      }

      // 如果当前tabId已经存在活动终端，先关闭它
      if (this.activeTerminals.has(tabId)) {
        await this.closeTerminal(tabId);
      }

      const terminalInfo = {
        config: terminalConfig,
        tabId,
        options,
        process: null,
        hwnd: null,
        startTime: Date.now(),
        status: "starting",
        distribution: options.distribution || null,
      };

      // 根据操作系统启动相应的系统终端
      if (this.isWindows) {
        await this.launchWindowsTerminal(terminalInfo);
      } else if (this.isMacOS) {
        await this.launchMacOSTerminal(terminalInfo);
      } else if (this.isLinux) {
        await this.launchLinuxTerminal(terminalInfo);
      }

      this.activeTerminals.set(tabId, terminalInfo);
      this.emit("terminalLaunched", { tabId, terminalInfo });

      return terminalInfo;
    } catch (error) {
      this.emit("terminalError", { tabId, error });
      throw error;
    }
  }

  /**
   * 启动Windows终端
   */
  async launchWindowsTerminal(terminalInfo) {
    const { config, tabId, distribution } = terminalInfo;

    // 统一字段名：支持 executable 和 executablePath
    if (!config.executablePath && config.executable) {
      config.executablePath = config.executable;
    }

    // 根据终端类型设置启动参数
    let spawnArgs = [];
    let spawnOptions = {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: false,
      env: { ...process.env },
    };

    // 根据终端类型配置参数
    switch (config.type) {
      case "wsl": {
        // WSL最好通过Windows Terminal启动以避免闪退
        // 检查是否有Windows Terminal可用
        const hasWindowsTerminal = await this.isWindowsTerminalAvailable();

        if (hasWindowsTerminal) {
          // 使用Windows Terminal启动WSL
          config.executablePath = "wt.exe";
          spawnArgs = ["new-tab"];

          if (distribution) {
            spawnArgs.push(
              "--title",
              `WSL-${distribution}`,
              "wsl",
              "-d",
              distribution,
            );
          } else if (
            config.availableDistributions &&
            config.availableDistributions.length > 0
          ) {
            // 使用默认发行版或第一个可用发行版
            const defaultDist =
              config.availableDistributions.find((d) => d.isDefault) ||
              config.availableDistributions[0];
            spawnArgs.push(
              "--title",
              `WSL-${defaultDist.name}`,
              "wsl",
              "-d",
              defaultDist.name,
            );
          } else if (
            config.launchArgs &&
            config.launchArgs.includes("--distribution")
          ) {
            const distIndex = config.launchArgs.indexOf("--distribution");
            const distName = config.launchArgs[distIndex + 1];
            spawnArgs.push("--title", `WSL-${distName}`, "wsl", "-d", distName);
          } else {
            spawnArgs.push("--title", "WSL", "wsl");
          }

          // Windows Terminal需要不同的spawn选项
          spawnOptions.detached = false;
          spawnOptions.stdio = ["ignore", "ignore", "ignore"];
        } else {
          // 回退方案：使用系统命令或默认路径
          config.executablePath =
            config.systemCommand || config.executable || "wsl.exe";
          spawnArgs = [];
          if (distribution) {
            spawnArgs.push("--distribution", distribution);
          } else if (
            config.availableDistributions &&
            config.availableDistributions.length > 0
          ) {
            const defaultDist =
              config.availableDistributions.find((d) => d.isDefault) ||
              config.availableDistributions[0];
            spawnArgs.push("--distribution", defaultDist.name);
          }
        }
        break;
      }

      case "cmd":
        config.executablePath = config.executable || "cmd.exe";
        spawnArgs = [];
        break;

      case "powershell":
        config.executablePath = config.executable || "powershell.exe";
        spawnArgs = [];
        break;

      case "windows-terminal":
        config.executablePath = "wt.exe";
        spawnArgs = ["new-tab"];
        break;

      default:
        // 默认情况，确保有 executablePath
        if (!config.executablePath && config.executable) {
          config.executablePath = config.executable;
        }
        spawnArgs = config.args || [];
        break;
    }

    if (!config.executablePath) {
      throw new Error("未指定可执行文件路径");
    }

    // 检查文件是否存在
    const fs = require("fs");
    try {
      if (!fs.existsSync(config.executablePath)) {
        throw new Error(`可执行文件不存在: ${config.executablePath}`);
      }
    } catch {
      // File check failed, continue with launch attempt
    }

    let childProcess;
    try {
      childProcess = spawn(config.executablePath, spawnArgs, spawnOptions);
    } catch (spawnError) {
      terminalInfo.status = "error";
      this.emit("terminalError", {
        tabId,
        error: {
          message: `无法启动应用程序: ${config.executablePath}\n错误: ${spawnError.message}`,
          code: spawnError.code || "SPAWN_ERROR",
          executable: config.executablePath,
        },
      });
      return;
    }

    if (!childProcess.pid) {
      terminalInfo.status = "error";
      this.emit("terminalError", {
        tabId,
        error: {
          message: `进程启动失败: ${config.executablePath}`,
          code: "NO_PID",
          executable: config.executablePath,
        },
      });
      return;
    }

    terminalInfo.process = childProcess;
    terminalInfo.pid = childProcess.pid;

    // 等待进程启动并获取窗口句柄
    setTimeout(async () => {
      try {
        const hwnd = await this.findWindowByPid(childProcess.pid);
        if (hwnd) {
          terminalInfo.hwnd = hwnd;
          terminalInfo.status = "ready";
          this.emit("terminalReady", { tabId, hwnd, pid: childProcess.pid });
        }
      } catch {
        // Error finding window handle
      }
    }, 1000);

    // 处理进程事件
    childProcess.on("error", (error) => {
      terminalInfo.status = "error";
      this.emit("terminalError", { tabId, error });
    });

    childProcess.on("exit", (code) => {
      terminalInfo.status = "exited";
      this.activeTerminals.delete(tabId);
      this.emit("terminalExited", { tabId, code });
    });
  }

  /**
   * 启动macOS终端
   */
  async launchMacOSTerminal(terminalInfo) {
    const { config, tabId } = terminalInfo;

    let spawnArgs = [];
    let executablePath = config.executablePath;

    if (config.type === "terminal") {
      executablePath = "open";
      spawnArgs = ["-a", "Terminal"];
    } else if (config.type === "iterm") {
      executablePath = "open";
      spawnArgs = ["-a", "iTerm"];
    }

    const childProcess = spawn(executablePath, spawnArgs, {
      detached: true,
      stdio: "ignore",
    });

    terminalInfo.process = childProcess;
    terminalInfo.pid = childProcess.pid;
    terminalInfo.status = "ready";

    this.emit("terminalReady", { tabId, pid: childProcess.pid });
  }

  /**
   * 启动Linux终端
   */
  async launchLinuxTerminal(terminalInfo) {
    const { config, tabId } = terminalInfo;

    const childProcess = spawn(config.executablePath, [], {
      detached: true,
      stdio: "ignore",
    });

    terminalInfo.process = childProcess;
    terminalInfo.pid = childProcess.pid;
    terminalInfo.status = "ready";

    this.emit("terminalReady", { tabId, pid: childProcess.pid });
  }

  /**
   * 检查Windows Terminal是否可用
   */
  async isWindowsTerminalAvailable() {
    return new Promise((resolve) => {
      const testProcess = spawn("wt.exe", ["--version"], {
        stdio: "ignore",
        windowsHide: true,
      });

      testProcess.on("error", () => {
        resolve(false);
      });

      testProcess.on("exit", (code) => {
        resolve(code === 0);
      });

      // 超时处理
      setTimeout(() => {
        testProcess.kill();
        resolve(false);
      }, 3000);
    });
  }

  /**
   * 查找窗口句柄
   */
  async findWindowByPid(pid) {
    if (!this.isWindows) return null;

    return new Promise((resolve) => {
      const { exec } = require("child_process");

      // 使用 tasklist 命令获取进程信息
      exec(`tasklist /FI "PID eq ${pid}" /FO CSV`, (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }

        // 如果找到进程，返回PID作为句柄标识
        if (stdout.includes(`"${pid}"`)) {
          resolve(pid);
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * 关闭终端
   */
  async closeTerminal(tabId) {
    const terminalInfo = this.activeTerminals.get(tabId);
    if (!terminalInfo) {
      return;
    }

    try {
      if (terminalInfo.process && !terminalInfo.process.killed) {
        terminalInfo.process.kill();
      }

      this.activeTerminals.delete(tabId);
      this.emit("terminalClosed", { tabId });
    } catch {
      // Error closing terminal
    }
  }

  /**
   * 获取活动终端信息
   */
  getActiveTerminals() {
    return Array.from(this.activeTerminals.entries()).map(([tabId, info]) => ({
      tabId,
      pid: info.pid,
      status: info.status,
      type: info.config.type,
      startTime: info.startTime,
    }));
  }

  /**
   * 获取终端信息
   */
  getTerminalInfo(tabId) {
    return this.activeTerminals.get(tabId);
  }

  /**
   * 检查终端是否活跃
   */
  isTerminalActive(tabId) {
    const info = this.activeTerminals.get(tabId);
    return info && info.status === "ready";
  }

  /**
   * 获取所有活动终端
   */
  getAllActiveTerminals() {
    return Array.from(this.activeTerminals.values());
  }

  /**
   * 获取单个活动终端
   */
  getActiveTerminal(tabId) {
    return this.activeTerminals.get(tabId);
  }

  /**
   * 清理所有终端
   */
  async cleanup() {
    try {
      // 关闭所有活动的终端
      for (const [, terminalInfo] of this.activeTerminals.entries()) {
        try {
          if (terminalInfo.process && !terminalInfo.process.killed) {
            terminalInfo.process.kill();
          }
        } catch {
          // Error closing individual terminal
        }
      }

      this.activeTerminals.clear();
      this.removeAllListeners();
    } catch {
      // Error during terminal manager cleanup
    }
  }
}

module.exports = LocalTerminalManager;
