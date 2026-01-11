const { logToFile } = require("../utils/logger");
const configService = require("../../services/configService");

class ProxyManager {
  constructor() {
    this.defaultProxyConfig = null;
    this.systemProxyConfig = null;
    this.initialized = false;
  }

  initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // 加载默认代理配置
      this.loadDefaultProxyConfig();

      // 检测系统代理配置
      this.detectSystemProxy();

      this.initialized = true;
      logToFile("ProxyManager initialized", "INFO");
    } catch (error) {
      logToFile(
        `ProxyManager initialization failed: ${error.message}`,
        "ERROR",
      );
    }
  }

  /**
   * 加载默认代理配置
   */
  loadDefaultProxyConfig() {
    try {
      const config = configService.get("defaultProxyConfig");
      if (config && this.isValidProxyConfig(config)) {
        this.defaultProxyConfig = config;
        logToFile("Default proxy config loaded", "INFO");
      }
    } catch (error) {
      logToFile(
        `Failed to load default proxy config: ${error.message}`,
        "ERROR",
      );
    }
  }

  /**
   * 保存默认代理配置
   * @param {object} proxyConfig - 代理配置
   */
  saveDefaultProxyConfig(proxyConfig) {
    try {
      if (this.isValidProxyConfig(proxyConfig)) {
        this.defaultProxyConfig = proxyConfig;
        configService.set("defaultProxyConfig", proxyConfig);
        logToFile("Default proxy config saved", "INFO");
        return true;
      } else {
        throw new Error("Invalid proxy configuration");
      }
    } catch (error) {
      logToFile(
        `Failed to save default proxy config: ${error.message}`,
        "ERROR",
      );
      return false;
    }
  }

  /**
   * 获取默认代理配置
   * @returns {object|null} 代理配置或null
   */
  getDefaultProxyConfig() {
    return this.defaultProxyConfig;
  }

  /**
   * 检测系统代理配置
   */
  detectSystemProxy() {
    try {
      // Windows系统代理检测
      if (process.platform === "win32") {
        this.detectWindowsProxy();
      }
      // macOS系统代理检测
      else if (process.platform === "darwin") {
        this.detectMacOSProxy();
      }
      // Linux系统代理检测
      else if (process.platform === "linux") {
        this.detectLinuxProxy();
      }
    } catch (error) {
      logToFile(`System proxy detection failed: ${error.message}`, "ERROR");
    }
  }

  /**
   * Windows系统代理检测
   */
  detectWindowsProxy() {
    try {
      // 检查环境变量
      const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
      const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;

      if (httpProxy || httpsProxy) {
        const proxyUrl = new URL(httpProxy || httpsProxy);
        this.systemProxyConfig = {
          type: proxyUrl.protocol.replace(":", ""),
          host: proxyUrl.hostname,
          port:
            parseInt(proxyUrl.port) ||
            (proxyUrl.protocol === "http:" ? 80 : 443),
          username: proxyUrl.username || undefined,
          password: proxyUrl.password || undefined,
          source: "environment",
        };
        logToFile(
          "Windows system proxy detected from environment variables",
          "INFO",
        );
      }
    } catch (error) {
      logToFile(`Windows proxy detection error: ${error.message}`, "ERROR");
    }
  }

  /**
   * macOS系统代理检测
   */
  detectMacOSProxy() {
    try {
      // 检查环境变量
      const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
      const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;

      if (httpProxy || httpsProxy) {
        const proxyUrl = new URL(httpProxy || httpsProxy);
        this.systemProxyConfig = {
          type: proxyUrl.protocol.replace(":", ""),
          host: proxyUrl.hostname,
          port:
            parseInt(proxyUrl.port) ||
            (proxyUrl.protocol === "http:" ? 80 : 443),
          username: proxyUrl.username || undefined,
          password: proxyUrl.password || undefined,
          source: "environment",
        };
        logToFile(
          "macOS system proxy detected from environment variables",
          "INFO",
        );
      }
    } catch (error) {
      logToFile(`macOS proxy detection error: ${error.message}`, "ERROR");
    }
  }

  /**
   * Linux系统代理检测
   */
  detectLinuxProxy() {
    try {
      // 检查环境变量
      const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
      const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
      const socksProxy = process.env.SOCKS_PROXY || process.env.socks_proxy;

      const proxyUrl = new URL(httpProxy || httpsProxy || socksProxy);
      if (proxyUrl) {
        this.systemProxyConfig = {
          type: proxyUrl.protocol.replace(":", ""),
          host: proxyUrl.hostname,
          port:
            parseInt(proxyUrl.port) ||
            this.getDefaultPortForProtocol(proxyUrl.protocol),
          username: proxyUrl.username || undefined,
          password: proxyUrl.password || undefined,
          source: "environment",
        };
        logToFile(
          "Linux system proxy detected from environment variables",
          "INFO",
        );
      }
    } catch (error) {
      logToFile(`Linux proxy detection error: ${error.message}`, "ERROR");
    }
  }

  /**
   * 获取协议默认端口
   * @param {string} protocol - 协议类型
   * @returns {number} 默认端口
   */
  getDefaultPortForProtocol(protocol) {
    switch (protocol) {
      case "http:":
        return 80;
      case "https:":
        return 443;
      case "socks4:":
        return 1080;
      case "socks5:":
        return 1080;
      default:
        return 8080;
    }
  }

  /**
   * 获取系统代理配置
   * @returns {object|null} 系统代理配置或null
   */
  getSystemProxyConfig() {
    return this.systemProxyConfig;
  }

  /**
   * 解析连接的代理配置
   * @param {object} sshConfig - SSH连接配置
   * @returns {object|null} 最终使用的代理配置
   */
  resolveProxyConfig(sshConfig) {
    // 如果连接明确配置了代理
    if (sshConfig.proxy && !sshConfig.proxy.useDefault) {
      logToFile(
        `Using connection-specific proxy: ${sshConfig.proxy.host}:${sshConfig.proxy.port}`,
        "INFO",
      );
      return sshConfig.proxy;
    }

    // 如果连接配置了使用默认代理或没有配置代理信息
    if (!sshConfig.proxy || sshConfig.proxy.useDefault) {
      // 优先使用默认配置
      if (this.defaultProxyConfig) {
        logToFile(
          `Using default proxy config: ${this.defaultProxyConfig.host}:${this.defaultProxyConfig.port}`,
          "INFO",
        );
        return this.defaultProxyConfig;
      }

      // 其次使用系统代理配置
      if (this.systemProxyConfig) {
        logToFile(
          `Using system proxy config: ${this.systemProxyConfig.host}:${this.systemProxyConfig.port}`,
          "INFO",
        );
        return this.systemProxyConfig;
      }
    }

    return null;
  }

  /**
   * 验证代理配置是否有效
   * @param {object} proxyConfig - 代理配置
   * @returns {boolean} 是否有效
   */
  isValidProxyConfig(proxyConfig) {
    return (
      proxyConfig &&
      typeof proxyConfig === "object" &&
      proxyConfig.host &&
      proxyConfig.port &&
      proxyConfig.type &&
      ["http", "https", "socks4", "socks5"].includes(
        proxyConfig.type.toLowerCase(),
      )
    );
  }

  /**
   * 获取代理配置状态
   * @returns {object} 代理配置状态
   */
  getProxyStatus() {
    return {
      initialized: this.initialized,
      hasDefaultProxy: !!this.defaultProxyConfig,
      hasSystemProxy: !!this.systemProxyConfig,
      defaultProxy: this.defaultProxyConfig
        ? {
            type: this.defaultProxyConfig.type,
            host: this.defaultProxyConfig.host,
            port: this.defaultProxyConfig.port,
            hasAuth: !!(
              this.defaultProxyConfig.username &&
              this.defaultProxyConfig.password
            ),
          }
        : null,
      systemProxy: this.systemProxyConfig
        ? {
            type: this.systemProxyConfig.type,
            host: this.systemProxyConfig.host,
            port: this.systemProxyConfig.port,
            source: this.systemProxyConfig.source,
            hasAuth: !!(
              this.systemProxyConfig.username && this.systemProxyConfig.password
            ),
          }
        : null,
    };
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.defaultProxyConfig = null;
    this.systemProxyConfig = null;
    this.initialized = false;
    logToFile("ProxyManager cleanup completed", "INFO");
  }
}

// 创建单例实例
const proxyManager = new ProxyManager();

module.exports = proxyManager;
