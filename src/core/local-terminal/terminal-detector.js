const path = require("path");
const fs = require("fs").promises;
const { exec } = require("child_process");
const { promisify } = require("util");
const {
  POSIX_SHELL_CANDIDATES,
  SUPPORTED_LOCAL_TERMINAL_TYPES,
  getDefaultPosixShell,
  isSupportedLocalTerminalType,
} = require("./local-terminal-config");

const execAsync = promisify(exec);

class TerminalDetector {
  constructor() {
    this.detectedTerminals = [];
    this.isWindows = process.platform === "win32";
    this.isMacOS = process.platform === "darwin";
    this.isLinux = process.platform === "linux";
    this.cacheTime = null;
    this.cacheTTL = 300000; // 5 minutes cache
    this.wslStatusCacheTime = null;
    this.wslStatusCacheTTL = 10000; // 10 seconds cache
  }

  normalizeDetectOptions(options = {}) {
    const normalizedOptions =
      options && typeof options === "object" ? options : {};

    return {
      forceRefresh: normalizedOptions.forceRefresh === true,
      refreshRuntimeStatus: normalizedOptions.refreshRuntimeStatus !== false,
    };
  }

  /**
   * 检测当前系统中可用的本地终端
   */
  async detectAllTerminals(options = {}) {
    const { forceRefresh, refreshRuntimeStatus } =
      this.normalizeDetectOptions(options);

    // 检查缓存
    if (
      !forceRefresh &&
      this.cacheTime &&
      Date.now() - this.cacheTime < this.cacheTTL &&
      this.detectedTerminals.length > 0
    ) {
      if (refreshRuntimeStatus) {
        await this.refreshRuntimeStatus();
      }
      return this.getDetectedTerminals();
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
    } catch {
      // 忽略异常，尽力返回已检测到的终端
    }

    this.cacheTime = Date.now();

    if (refreshRuntimeStatus) {
      await this.refreshRuntimeStatus();
    }

    return this.getDetectedTerminals();
  }

  /**
   * 检测 Windows 系统可用的终端
   */
  async detectWindowsTerminals() {
    const terminals = [
      {
        name: "PowerShell",
        type: SUPPORTED_LOCAL_TERMINAL_TYPES.WINDOWS_POWERSHELL,
        executable: "pwsh.exe",
        systemCommand: "pwsh.exe",
        priority: 13,
        adminRequired: false,
      },
      {
        name: "Windows PowerShell",
        type: SUPPORTED_LOCAL_TERMINAL_TYPES.WINDOWS_POWERSHELL,
        executable: "powershell.exe",
        systemCommand: "powershell.exe",
        priority: 12,
        adminRequired: false,
      },
      {
        name: "Command Prompt",
        type: SUPPORTED_LOCAL_TERMINAL_TYPES.WINDOWS_CMD,
        executable: "cmd.exe",
        systemCommand: "cmd.exe",
        priority: 11,
        adminRequired: false,
      },
      // WSL (Windows Subsystem for Linux)
      // 注意：可用性完全由 checkWSLAvailability 判定（wsl.exe 本体即使
      // 没有任何已安装发行版也会存在），名称与发行版在检测时动态填充
      {
        name: "WSL",
        type: SUPPORTED_LOCAL_TERMINAL_TYPES.WINDOWS_WSL,
        executable: "wsl.exe",
        systemCommand: "wsl.exe",
        priority: 10,
        adminRequired: false,
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
    const shellPath = getDefaultPosixShell();
    const terminals = [
      {
        name: path.basename(shellPath),
        type: SUPPORTED_LOCAL_TERMINAL_TYPES.POSIX_SHELL,
        executable: shellPath,
        priority: 10,
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
    const shellPath = getDefaultPosixShell();
    const terminals = [
      {
        name: path.basename(shellPath),
        type: SUPPORTED_LOCAL_TERMINAL_TYPES.POSIX_SHELL,
        executable: shellPath,
        priority: 10,
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
      if (!isSupportedLocalTerminalType(terminal.type, process.platform)) {
        return false;
      }

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
      //    WSL 类型除外：wsl.exe 在没有任何已安装发行版时依然可以被
      //    where 解析到，若参与判定会导致已注销的发行版仍显示为可用，
      //    其可用性完全由 checkWSLAvailability 决定
      if (terminal.systemCommand && terminal.type !== "wsl") {
        checks.push(
          (async () => {
            const resolvedPath = await this.resolveSystemCommandPath(
              terminal.systemCommand,
            );
            if (resolvedPath) {
              terminal.executablePath = resolvedPath;
              return true;
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
            } catch {
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
            } catch {
              // 忽略
            }
            return false;
          })(),
        );
      }

      if (!this.isWindows && terminal.type === "shell") {
        checks.push(
          (async () => {
            const candidatePaths = [
              terminal.executable,
              process.env.SHELL,
              ...POSIX_SHELL_CANDIDATES,
            ].filter(Boolean);

            for (const candidatePath of candidatePaths) {
              if (await this.fileExists(candidatePath)) {
                terminal.executablePath = candidatePath;
                terminal.executable = candidatePath;
                terminal.name = path.basename(candidatePath);
                return true;
              }
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
    } catch {
      return false;
    }
  }

  async refreshRuntimeStatus(options = {}) {
    const { forceRefresh } = this.normalizeDetectOptions(options);
    if (!this.isWindows) {
      return;
    }

    const wslTerminal = this.detectedTerminals.find(
      (terminal) => terminal.type === "wsl",
    );
    if (!wslTerminal) {
      return;
    }

    if (
      !forceRefresh &&
      this.wslStatusCacheTime &&
      Date.now() - this.wslStatusCacheTime < this.wslStatusCacheTTL
    ) {
      return;
    }

    const available = await this.checkWSLAvailability(wslTerminal);
    if (!available) {
      // 所有发行版均已被移除（或 WSL 不可用），从检测列表中剔除，
      // 避免侧边栏继续显示已不存在的发行版
      this.detectedTerminals = this.detectedTerminals.filter(
        (terminal) => terminal !== wslTerminal,
      );
    }
  }

  async resolveSystemCommandPath(command, timeout = 2000) {
    try {
      const whereCommand = this.isWindows ? "where" : "which";
      const { stdout } = await execAsync(`${whereCommand} ${command}`, {
        timeout,
        windowsHide: true,
      });
      const output = (stdout || "").replace(/\0/g, "").trim();
      if (!output) {
        return null;
      }

      const firstPath = output.split(/\r?\n/)[0].trim();
      if (!firstPath) {
        return null;
      }

      // Windows App Execution Alias 在 where 可解析时可直接使用
      if (this.isWindows) {
        return firstPath;
      }

      if (await this.fileExists(firstPath)) {
        return firstPath;
      }
    } catch {
      // 忽略
    }

    return null;
  }

  /**
   * 检查 WSL 是否可用
   */
  async checkWSLAvailability(terminal) {
    try {
      const executablePath =
        (await this.resolveSystemCommandPath("wsl.exe", 1200)) || "wsl.exe";
      terminal.executablePath = executablePath;

      // 通过 wsl -l -v 检查是否已安装（使用 UTF-16LE 编码处理）
      const { stdout: wslList } = await execAsync("wsl.exe --list --verbose", {
        timeout: 2000,
        encoding: "utf16le", // 指定 UTF-16LE 编码
        windowsHide: true,
      });

      // 清理可能包含的空字符
      const cleanOutput = wslList.replace(/\0/g, "");

      // 直接解析发行版列表：没有已安装发行版时 wsl.exe 输出的是错误
      // 提示（如 "Windows Subsystem for Linux has no installed
      // distributions"），不会产生有效的发行版条目
      const distributions = this.parseWSLDistributions(cleanOutput);

      // 过滤 docker-desktop/podman 等非实际发行版
      const validDistributions = distributions.filter(
        (dist) =>
          !dist.name.toLowerCase().includes("docker-desktop") &&
          !dist.name.toLowerCase().includes("podman-machine"),
      );

      if (validDistributions.length === 0) {
        // 没有任何可用的发行版（可能已被全部注销），
        // 清理残留的旧状态，避免 UI 继续显示已移除的发行版
        this.clearWSLState(terminal);
        this.wslStatusCacheTime = Date.now();
        return false;
      }

      const runningCount = validDistributions.filter(
        (dist) => dist.runtimeState === "running",
      ).length;
      const checkedAt = Date.now();

      terminal.availableDistributions = validDistributions;
      terminal.runtimeStatus = {
        state: runningCount > 0 ? "running" : "stopped",
        runningCount,
        totalCount: validDistributions.length,
        checkedAt,
      };

      // 多个发行版时，后续可提供选择
      if (validDistributions.length > 1) {
        terminal.hasMultipleDistributions = true;
      }

      const defaultDistribution =
        validDistributions.find((dist) => dist.isDefault) ||
        validDistributions[0];
      if (defaultDistribution?.name) {
        terminal.name = `WSL (${defaultDistribution.name})`;
      }

      this.wslStatusCacheTime = checkedAt;

      return true;
    } catch {
      // WSL 不可用或执行失败
      this.clearWSLState(terminal);
      return false;
    }
  }

  /**
   * 清理 WSL 终端条目上的残留状态
   */
  clearWSLState(terminal) {
    delete terminal.availableDistributions;
    delete terminal.runtimeStatus;
    delete terminal.hasMultipleDistributions;
    terminal.name = "WSL";
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

        if (parts.length >= 3 && /^\d+$/.test(parts[2])) {
          const name = parts[0];
          const state = parts[1];
          const version = parts[2];
          const runtimeState = state.toLowerCase();

          // 仅在必要字段有效时加入结果。
          // 要求第三列为数字（VERSION），可过滤掉错误提示文本
          //（如中英文的 "没有已安装的分发" 提示）被误解析为发行版
          if (name && state && name !== "STATE" && name !== "NAME") {
            const distribution = {
              name,
              state,
              runtimeState,
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
    } catch {
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
