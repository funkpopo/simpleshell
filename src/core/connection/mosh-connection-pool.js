/**
 * Mosh连接池 - 继承自BaseConnectionPool
 * 提供Mosh（mobile shell）协议特定的连接管理功能
 *
 * 设计说明：
 * - Mosh 的核心价值（弱网/漫游下的会话存活、断网自动恢复、SSP 状态同步）由
 *   mosh 客户端二进制自身完成：客户端先经 SSH 引导启动 mosh-server，
 *   再通过 UDP + SSP 同步终端状态。因此本池的职责是按连接配置拉起并托管
 *   一个 mosh 客户端进程（node-pty 伪终端），而不是重新实现协议本身。
 * - mosh 客户端是本地进程：SSH 认证交互（密码/密钥/OTP 提示）直接呈现在
 *   终端里由用户输入，无需复用 SSHAuthDialog。
 * - 连接键包含 tabId：mosh 会话为交互式终端会话，每个标签页持有独立进程
 *   （与串口独占设备的处理方式一致）。
 * - Windows 平台没有原生 mosh 二进制，用户可勾选「经 WSL 运行」
 *   （wsl.exe -- sh -lc "<命令>"），或直接填写 MSYS2/Cygwin 内 mosh 的完整路径。
 */

const BaseConnectionPool = require("./base-connection-pool");
const pty = require("node-pty");
const {
  classifyConnectionFailure,
} = require("../../shared/connectionErrorAdvice");

const PREDICT_VALUES = ["adaptive", "always", "never", "experimental"];

const DEFAULT_MOSH_OPTIONS = {
  moshBinary: "mosh",
  moshUseWsl: false,
  moshPredict: "adaptive",
  moshServerPort: "",
  moshSshCommand: "",
};

const DEFAULT_SSH_PORT = 22;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/**
 * 归一化Mosh连接配置
 * @param {Object} config - Mosh连接配置
 * @returns {Object} 归一化后的配置
 */
function normalizeMoshConfig(config = {}) {
  const port = Number.parseInt(config.port, 10);
  const predict = String(config.moshPredict || DEFAULT_MOSH_OPTIONS.moshPredict)
    .trim()
    .toLowerCase();

  const options = {
    host: String(config.host || "").trim(),
    port:
      Number.isFinite(port) && port > 0 && port <= 65535
        ? port
        : DEFAULT_SSH_PORT,
    username: String(config.username || "").trim(),
    moshBinary:
      String(config.moshBinaryPath || config.moshBinary || "").trim() ||
      DEFAULT_MOSH_OPTIONS.moshBinary,
    moshUseWsl: config.moshUseWsl === true,
    moshPredict: PREDICT_VALUES.includes(predict)
      ? predict
      : DEFAULT_MOSH_OPTIONS.moshPredict,
    moshServerPort: String(config.moshServerPort || "").trim(),
    moshSshCommand: String(config.moshSshCommand || "").trim(),
  };

  return options;
}

/**
 * 简单的 POSIX shell 单引号转义（用于 WSL sh -lc 模式）
 * @param {string} value - 原始字符串
 * @returns {string} 转义后的字符串
 */
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * 构建传递给 mosh 客户端的参数数组（argv 语义）
 * @param {Object} options - 归一化后的Mosh配置
 * @returns {string[]} mosh 参数列表
 */
function buildMoshArgs(options) {
  const args = [];

  // 服务端 UDP 端口/端口范围（mosh-server 监听端口，非 SSH 引导端口）
  if (options.moshServerPort) {
    args.push("-p", options.moshServerPort);
  }

  // 本地回显预测模式：弱网下体验的关键开关
  args.push(`--predict=${options.moshPredict}`);

  // SSH 引导通道：自定义端口或用户显式指定 ssh 命令时覆盖默认值
  if (options.moshSshCommand) {
    args.push(`--ssh=${options.moshSshCommand}`);
  } else if (options.port !== DEFAULT_SSH_PORT) {
    args.push(`--ssh=ssh -p ${options.port}`);
  }

  // 远端目标
  args.push(
    options.username ? `${options.username}@${options.host}` : options.host,
  );

  return args;
}

/**
 * 构建 WSL 模式下的完整命令行（交给发行版内 sh -lc 执行，
 * 保证引号/空格参数按 POSIX 语义解析）
 * @param {Object} options - 归一化后的Mosh配置
 * @returns {string} shell 命令字符串
 */
function buildWslCommand(options) {
  const parts = [shellQuote(options.moshBinary)];
  for (const arg of buildMoshArgs(options)) {
    parts.push(shellQuote(arg));
  }
  return parts.join(" ");
}

/**
 * Mosh连接池类
 */
class MoshConnectionPool extends BaseConnectionPool {
  /**
   * 构造函数
   * @param {Object} config - 连接池配置
   */
  constructor(config = {}) {
    super({
      ...config,
      protocolType: "Mosh",
    });
  }

  /**
   * 生成Mosh连接键
   * @param {Object} config - Mosh连接配置
   * @returns {string} 连接键
   */
  generateConnectionKey(config) {
    const host = config.host || "unknown";
    const port = config.port || DEFAULT_SSH_PORT;

    // mosh 会话为交互式终端会话，按 tabId 隔离
    if (config.tabId) {
      return `mosh:${host}:${port}:${config.tabId}`;
    }

    return `mosh:${host}:${port}`;
  }

  /**
   * 创建新的Mosh连接（拉起 mosh 客户端伪终端进程）
   * @param {Object} moshConfig - Mosh连接配置
   * @param {string} connectionKey - 连接键
   * @returns {Promise<Object>} 连接信息对象
   */
  async createConnection(moshConfig, connectionKey) {
    const options = normalizeMoshConfig(moshConfig);
    const useWsl = options.moshUseWsl;

    const spawnCommand = useWsl ? "wsl.exe" : options.moshBinary;
    const spawnArgs = useWsl
      ? ["--", "sh", "-lc", buildWslCommand(options)]
      : buildMoshArgs(options);

    this._logInfo(
      `创建新Mosh连接: ${connectionKey} (binary=${options.moshBinary}, ` +
        `sshPort=${options.port}, predict=${options.moshPredict}` +
        `${options.moshServerPort ? `, serverPort=${options.moshServerPort}` : ""}` +
        `${useWsl ? ", via=WSL" : ""})`,
    );

    const connectionInfo = {
      client: null,
      config: { ...moshConfig, ...options },
      key: connectionKey,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      refCount: 1,
      ready: false,
      stream: null,
      listeners: new Set(),
      ptyListeners: [],
      exited: false,
    };

    let ptyProcess;
    try {
      ptyProcess = pty.spawn(spawnCommand, spawnArgs, {
        name: "xterm-256color",
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        cwd: undefined,
        env: process.env,
      });
    } catch (err) {
      this.connections.delete(connectionKey);
      throw this._handleMoshError(err, options, connectionKey, {
        useWsl,
        spawnCommand,
      });
    }

    connectionInfo.client = ptyProcess;
    connectionInfo.ready = true;
    this.connections.set(connectionKey, connectionInfo);

    this._logInfo(`Mosh连接建立成功: ${connectionKey} (pid=${ptyProcess.pid})`);
    this.emit("connectionCreated", {
      key: connectionKey,
      connection: connectionInfo,
    });

    return connectionInfo;
  }

  /**
   * 检查Mosh连接是否健康
   * @param {Object} connectionInfo - 连接信息对象
   * @returns {boolean} 是否健康
   */
  isConnectionHealthy(connectionInfo) {
    return Boolean(
      connectionInfo && connectionInfo.client && !connectionInfo.exited,
    );
  }

  /**
   * 关闭Mosh连接（覆盖父类：node-pty 进程没有 end()/destroy()，使用 kill()）
   * @param {string} key - 连接键
   * @param {Object} options - 关闭选项
   */
  closeConnection(key, options = {}) {
    const conn = this.connections.get(key);

    if (!conn) {
      this._logInfo(`Tried to close non-existent connection: ${key}`);
      return;
    }

    const closeOptions = this._normalizeCloseOptions(
      options,
      BaseConnectionPool.CLOSE_REASON.SYSTEM,
    );
    this._logInfo(`Closing connection: ${key}, reason=${closeOptions.reason}`);

    conn.intentionalClose = closeOptions.intentional;
    conn.closeReason = closeOptions.reason;

    this.connections.delete(key);
    const removedTabIds = this._removeTabReferencesForConnection(key);

    if (conn.listeners && conn.listeners.size > 0) {
      conn.listeners.clear();
    }
    if (Array.isArray(conn.ptyListeners)) {
      const staleListeners = conn.ptyListeners.splice(0);
      for (const stale of staleListeners) {
        try {
          stale?.dispose?.();
        } catch {
          // ignore
        }
      }
    }

    const ptyProcess = conn.client;
    try {
      if (ptyProcess && !conn.exited && typeof ptyProcess.kill === "function") {
        ptyProcess.kill();
      }
    } catch (error) {
      this._logError(`Error killing mosh process: ${key}`, error);
    }

    this.emit("connectionClosed", {
      key,
      connection: conn,
      reason: closeOptions.reason,
      intentional: closeOptions.intentional,
      removedTabIds,
    });
  }

  /**
   * 获取详细统计信息（扩展父类方法）
   * @returns {Object} 统计信息
   */
  getDetailedStats() {
    const stats = super.getDetailedStats();

    const connections = [];
    for (const [key, info] of this.connections) {
      connections.push({
        key,
        host: info.config.host,
        port: info.config.port || DEFAULT_SSH_PORT,
        username: info.config.username,
        predict: info.config.moshPredict,
        useWsl: info.config.moshUseWsl === true,
        createdAt: info.createdAt,
        lastUsed: info.lastUsed,
        refCount: info.refCount,
        ready: info.ready,
        idleTime: Date.now() - info.lastUsed,
      });
    }

    const tabRefs = [];
    for (const [tabId, connKey] of this.tabReferences) {
      tabRefs.push({
        tabId,
        connectionKey: connKey,
      });
    }

    return {
      ...stats,
      connections,
      tabReferences: tabRefs,
    };
  }

  /**
   * 处理Mosh错误
   * @param {Error} err - 原始错误
   * @param {Object} options - 归一化的Mosh配置
   * @param {string} connectionKey - 连接键
   * @param {Object} context - 额外上下文（useWsl/spawnCommand）
   * @returns {Error} 增强的错误对象
   * @private
   */
  _handleMoshError(err, options, connectionKey, context = {}) {
    const { t: mainT, normalizeLanguage } = require("../../shared/mainI18n");
    const lng = normalizeLanguage(options?.language);
    const host = options?.host || "unknown";
    const rawMessage = String(err?.message || err || "");
    const lowerMessage = rawMessage.toLowerCase();
    const code = String(err?.code || "").toUpperCase();
    const binary = options?.moshBinary || "mosh";

    let errorMessage = mainT("mainProcess.mosh.genericError", {
      lng,
      message: rawMessage,
    });

    // mosh 客户端二进制不存在（直接 spawn 失败 / ENOENT / PATH 找不到命令）
    if (
      code === "ENOENT" ||
      code === "EACCES" ||
      lowerMessage.includes("no such file") ||
      lowerMessage.includes("not recognized") ||
      lowerMessage.includes("is not recognized") ||
      lowerMessage.includes("command not found") ||
      lowerMessage.includes("cannot find")
    ) {
      errorMessage = context?.useWsl
        ? mainT("mainProcess.mosh.binaryNotFoundInWsl", { lng, binary })
        : mainT("mainProcess.mosh.binaryNotFound", { lng, binary });
    } else if (
      code === "ETIMEDOUT" ||
      lowerMessage.includes("timeout") ||
      lowerMessage.includes("timed out")
    ) {
      errorMessage = mainT("mainProcess.mosh.connectionTimeout", {
        lng,
        host,
      });
    }

    // 日志中记录详细信息（包含connectionKey），但不影响用户看到的错误
    this._logInfo(
      `Mosh connection error detail: ${connectionKey} - ${rawMessage}`,
    );

    // 创建增强的错误对象（使用简洁的错误消息）
    const enhancedError = new Error(errorMessage);
    enhancedError.code = err?.code || null;
    enhancedError.originalError = err;
    enhancedError.connectionKey = connectionKey;
    enhancedError.moshConfig = {
      host,
      port: options?.port || DEFAULT_SSH_PORT,
      username: options?.username || "",
      moshBinary: binary,
      moshUseWsl: options?.moshUseWsl === true,
      language: options?.language || null,
      protocol: "mosh",
    };
    enhancedError.connectionFailure = classifyConnectionFailure(enhancedError, {
      ...enhancedError.moshConfig,
      protocol: "mosh",
    });
    enhancedError.connectionFailureKind = enhancedError.connectionFailure.kind;
    enhancedError.connectionAdvice = enhancedError.connectionFailure.suggestion;

    return enhancedError;
  }
}

module.exports = MoshConnectionPool;
module.exports.PREDICT_VALUES = PREDICT_VALUES;
module.exports.normalizeMoshConfig = normalizeMoshConfig;
module.exports.buildMoshArgs = buildMoshArgs;
module.exports.buildWslCommand = buildWslCommand;
