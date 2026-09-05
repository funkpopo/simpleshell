/**
 * 串口连接池 - 继承自BaseConnectionPool
 * 提供串口（Serial/COM）特定的连接管理功能
 *
 * 串口为独占式设备：同一 COM 端口同一时刻只能被一个进程打开，
 * 连接键中包含 tabId，确保每个终端标签页持有独立的串口会话。
 */

const BaseConnectionPool = require("./base-connection-pool");
const { SerialPort } = require("serialport");
const {
  classifyConnectionFailure,
} = require("../../shared/connectionErrorAdvice");

// 常用波特率（供连接池校验与日志使用，UI 另有完整列表）
const SUPPORTED_BAUD_RATES = [
  300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200, 230400,
  460800, 921600,
];

const PARITY_VALUES = ["none", "even", "odd"];
const FLOW_CONTROL_VALUES = ["none", "rtscts", "xonxoff"];

const DEFAULT_SERIAL_OPTIONS = {
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
  flowControl: "none",
};

/**
 * 归一化串口连接配置
 * @param {Object} config - 串口连接配置
 * @returns {Object} 归一化后的配置
 */
function normalizeSerialConfig(config = {}) {
  const baudRate = Number.parseInt(config.baudRate, 10);
  const dataBits = Number.parseInt(config.dataBits, 10);
  const stopBits = Number.parseInt(config.stopBits, 10);
  const parity = String(config.parity || DEFAULT_SERIAL_OPTIONS.parity)
    .trim()
    .toLowerCase();
  const flowControl = String(config.flowControl || "")
    .trim()
    .toLowerCase();

  const options = {
    path: String(config.path || config.host || "").trim(),
    baudRate: SUPPORTED_BAUD_RATES.includes(baudRate)
      ? baudRate
      : DEFAULT_SERIAL_OPTIONS.baudRate,
    dataBits: [7, 8].includes(dataBits)
      ? dataBits
      : DEFAULT_SERIAL_OPTIONS.dataBits,
    stopBits: [1, 2].includes(stopBits)
      ? stopBits
      : DEFAULT_SERIAL_OPTIONS.stopBits,
    parity: PARITY_VALUES.includes(parity)
      ? parity
      : DEFAULT_SERIAL_OPTIONS.parity,
    flowControl: FLOW_CONTROL_VALUES.includes(flowControl)
      ? flowControl
      : DEFAULT_SERIAL_OPTIONS.flowControl,
  };

  return options;
}

/**
 * 将归一化配置转换为 serialport 打开参数
 * @param {Object} options - 归一化后的串口配置
 * @returns {Object} SerialPort open options
 */
function buildSerialOpenOptions(options) {
  const openOptions = {
    path: options.path,
    baudRate: options.baudRate,
    dataBits: options.dataBits,
    stopBits: options.stopBits,
    parity: options.parity,
    autoOpen: true,
  };

  if (options.flowControl === "rtscts") {
    openOptions.rtscts = true;
  } else if (options.flowControl === "xonxoff") {
    openOptions.xon = true;
    openOptions.xoff = true;
    openOptions.xany = true;
  }

  return openOptions;
}

/**
 * 串口连接池类
 */
class SerialConnectionPool extends BaseConnectionPool {
  /**
   * 构造函数
   * @param {Object} config - 连接池配置
   */
  constructor(config = {}) {
    super({
      ...config,
      protocolType: "Serial",
    });
  }

  /**
   * 生成串口连接键
   * @param {Object} config - 串口连接配置
   * @returns {string} 连接键
   */
  generateConnectionKey(config) {
    const path = config.path || config.host || "unknown";

    // 串口为独占设备，按 tabId 隔离会话
    if (config.tabId) {
      return `serial:${path}:${config.tabId}`;
    }

    return `serial:${path}`;
  }

  /**
   * 创建新的串口连接
   * @param {Object} serialConfig - 串口连接配置
   * @param {string} connectionKey - 连接键
   * @returns {Promise<Object>} 连接信息对象
   */
  async createConnection(serialConfig, connectionKey) {
    const options = normalizeSerialConfig(serialConfig);
    this._logInfo(
      `创建新串口连接: ${connectionKey} (baudRate=${options.baudRate}, dataBits=${options.dataBits}, stopBits=${options.stopBits}, parity=${options.parity}, flowControl=${options.flowControl})`,
    );

    return new Promise((resolve, reject) => {
      let settled = false;
      let port;

      const openOptions = buildSerialOpenOptions(options);

      try {
        port = new SerialPort(openOptions);
      } catch (err) {
        reject(this._handleSerialError(err, options, connectionKey));
        return;
      }

      const connectionInfo = {
        client: port,
        config: { ...serialConfig, ...options },
        key: connectionKey,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        refCount: 1,
        ready: false,
        stream: null,
        listeners: new Set(),
      };

      const settleError = (err) => {
        if (settled) return;
        settled = true;
        const enhancedError = this._handleSerialError(
          err,
          options,
          connectionKey,
        );
        this.connections.delete(connectionKey);
        try {
          if (port && port.isOpen) {
            port.close();
          }
        } catch (closeError) {
          this._logError(
            `Error closing failed serial port ${options.path}`,
            closeError,
          );
        }
        reject(enhancedError);
      };

      port.on("error", settleError);

      port.on("open", () => {
        if (settled) return;
        settled = true;
        connectionInfo.ready = true;
        this.connections.set(connectionKey, connectionInfo);

        this._logInfo(`串口连接建立成功: ${connectionKey}`);
        this.emit("connectionCreated", {
          key: connectionKey,
          connection: connectionInfo,
        });

        resolve(connectionInfo);
      });
    });
  }

  /**
   * 检查串口连接是否健康
   * @param {Object} connectionInfo - 连接信息对象
   * @returns {boolean} 是否健康
   */
  isConnectionHealthy(connectionInfo) {
    return Boolean(
      connectionInfo && connectionInfo.client && connectionInfo.client.isOpen,
    );
  }

  /**
   * 关闭串口连接（覆盖父类：串口没有 end()，使用 close() 释放独占句柄）
   * @param {string} key - 连接键
   * @param {Object} options - 关闭选项
   */
  closeConnection(key, options = {}) {
    const closed = this._beginConnectionClose(key, options);
    if (!closed) {
      return;
    }

    const { conn, closeOptions, removedTabIds } = closed;

    const port = conn.client;
    try {
      if (port && typeof port.close === "function") {
        port.close((error) => {
          if (error) {
            this._logError(`Error closing serial port ${key}`, error);
          }
          // close() 之后确保底层句柄释放
          if (port && typeof port.destroy === "function" && !port.destroyed) {
            try {
              port.destroy();
            } catch {
              // 忽略销毁时的错误
            }
          }
        });
      } else if (port && typeof port.destroy === "function") {
        port.destroy();
      }
    } catch (error) {
      this._logError(`Error closing connection: ${key}`, error);
      try {
        if (port && typeof port.destroy === "function") {
          port.destroy();
        }
      } catch {
        // 忽略销毁时的错误
      }
    }

    this._finishConnectionClose(key, conn, closeOptions, removedTabIds);
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
        path: info.config.path || info.config.host,
        baudRate: info.config.baudRate,
        parity: info.config.parity,
        dataBits: info.config.dataBits,
        stopBits: info.config.stopBits,
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
   * 处理串口错误
   * @param {Error} err - 原始错误
   * @param {Object} options - 归一化的串口配置
   * @param {string} connectionKey - 连接键
   * @returns {Error} 增强的错误对象
   * @private
   */
  _handleSerialError(err, options, connectionKey) {
    const { t: mainT, normalizeLanguage } = require("../../shared/mainI18n");
    // 串口配置无语言字段时回退到系统语言
    const lng = normalizeLanguage(options?.language);
    const path = options?.path || "unknown";
    const rawMessage = String(err?.message || err || "");
    const lowerMessage = rawMessage.toLowerCase();
    const code = String(err?.code || "").toUpperCase();

    let errorMessage = mainT("mainProcess.serial.genericError", {
      lng,
      path,
      message: rawMessage,
    });

    if (
      code === "ENOENT" ||
      lowerMessage.includes("file not found") ||
      lowerMessage.includes("no such file") ||
      lowerMessage.includes("cannot find") ||
      // USB 断开/句柄失效（serialport v12 @serialport/stream unix-read
      // 标记 err.disconnected == true，C++ 层报错文本含 strerror(errno)）
      err?.disconnected === true ||
      code === "EBADF" ||
      code === "ENXIO" ||
      code === "EIO" ||
      lowerMessage.includes("bad file descriptor") ||
      lowerMessage.includes("no such device or address") ||
      lowerMessage.includes("input/output error") ||
      lowerMessage.includes("device not configured")
    ) {
      errorMessage = mainT("mainProcess.serial.portNotFound", { lng, path });
    } else if (
      code === "EBUSY" ||
      code === "EACCES" ||
      code === "EPERM" ||
      lowerMessage.includes("access denied") ||
      lowerMessage.includes("access is denied") ||
      lowerMessage.includes("permission denied") ||
      lowerMessage.includes("device busy") ||
      lowerMessage.includes("resource busy") ||
      lowerMessage.includes("device or resource busy") ||
      lowerMessage.includes("locked")
    ) {
      errorMessage = mainT("mainProcess.serial.portBusy", { lng, path });
    } else if (
      lowerMessage.includes("invalid") &&
      (lowerMessage.includes("baud") ||
        lowerMessage.includes("parity") ||
        lowerMessage.includes("databit") ||
        lowerMessage.includes("data bit") ||
        lowerMessage.includes("stopbit") ||
        lowerMessage.includes("stop bit"))
    ) {
      errorMessage = mainT("mainProcess.serial.invalidParameters", {
        lng,
        path,
      });
    }

    // 日志中记录详细信息（包含connectionKey），但不影响用户看到的错误
    this._logInfo(
      `Serial connection error detail: ${connectionKey} - ${rawMessage}`,
    );

    // 创建增强的错误对象（使用简洁的错误消息）
    const enhancedError = new Error(errorMessage);
    enhancedError.code =
      err?.code || (err?.disconnected ? "EDISCONNECT" : null);
    enhancedError.originalError = err;
    enhancedError.connectionKey = connectionKey;
    enhancedError.serialConfig = {
      path,
      baudRate: options?.baudRate || null,
      parity: options?.parity || null,
      dataBits: options?.dataBits || null,
      stopBits: options?.stopBits || null,
      language: options?.language || null,
      protocol: "serial",
    };
    enhancedError.connectionFailure = classifyConnectionFailure(enhancedError, {
      ...enhancedError.serialConfig,
      protocol: "serial",
    });
    enhancedError.connectionFailureKind = enhancedError.connectionFailure.kind;
    enhancedError.connectionAdvice = enhancedError.connectionFailure.suggestion;

    return enhancedError;
  }
}

module.exports = SerialConnectionPool;
module.exports.SUPPORTED_BAUD_RATES = SUPPORTED_BAUD_RATES;
module.exports.normalizeSerialConfig = normalizeSerialConfig;
module.exports.buildSerialOpenOptions = buildSerialOpenOptions;
