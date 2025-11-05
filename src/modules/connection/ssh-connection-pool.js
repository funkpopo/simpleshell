const Client = require("ssh2").Client;
const { logToFile } = require("../../core/utils/logger");
const { getBasicSSHAlgorithms } = require("../../constants/sshAlgorithms");
const proxyManager = require("../../core/proxy/proxy-manager");
const ReconnectionManager = require("../../core/connection/reconnection-manager");
const BaseConnectionPool = require("./base-connection-pool");

const CONNECTION_TIMEOUT = 15 * 1000;

const PROXY_TYPES = {
  HTTP: "http",
  SOCKS4: "socks4",
  SOCKS5: "socks5",
  NONE: "none",
};

class SSHConnectionPool extends BaseConnectionPool {
  constructor(maxConnections = 50) {
    super(maxConnections);
    this.reconnectionManager = new ReconnectionManager({
      maxRetries: 5,
      fixedDelay: 3000,
      useFixedInterval: true,
    });
  }

  onInitialize() {
    proxyManager.initialize();
    this.reconnectionManager.initialize();
    this.setupReconnectionListeners();
    logToFile("SSH连接池已初始化", "INFO");
  }

  onCleanup() {
    if (this.reconnectionManager) {
      this.reconnectionManager.shutdown();
    }
    logToFile("SSH连接池已清理", "INFO");
  }

  onConnectionReused(connectionKey) {
    logToFile(`复用现有SSH连接: ${connectionKey}`, "INFO");
  }

  setupReconnectionListeners() {
    this.reconnectionManager.on("reconnectSuccess", ({ sessionId, attempts }) => {
      logToFile(`连接重连成功: ${sessionId}, 尝试次数: ${attempts}`, "INFO");
      if (this.connections.has(sessionId)) {
        const connectionInfo = this.connections.get(sessionId);
        connectionInfo.ready = true;
        connectionInfo.lastUsed = Date.now();
      }
    });

    this.reconnectionManager.on("reconnectFailed", ({ sessionId, error, attempts }) => {
      logToFile(`连接重连失败: ${sessionId}, 错误: ${error}, 尝试次数: ${attempts}`, "ERROR");
      if (attempts >= 5) {
        this.closeConnection(sessionId);
      }
    });

    this.reconnectionManager.on("connectionReplaced", ({ sessionId, newConnection }) => {
      if (this.connections.has(sessionId)) {
        const connectionInfo = this.connections.get(sessionId);
        connectionInfo.client = newConnection;
        connectionInfo.ready = true;
      }
    });
  }

  generateConnectionKey(config) {
    if (config.tabId) {
      const proxyString = config.proxy ? `proxy:${config.proxy.host}:${config.proxy.port}:${config.proxy.type}` : "";
      return `tab:${config.tabId}:${config.host}:${config.port || 22}:${config.username}${proxyString ? ":" + proxyString : ""}`;
    }
    return `${config.host}:${config.port || 22}:${config.username}`;
  }

  async handleUnhealthyConnection(connectionKey, connectionInfo, sshConfig) {
    logToFile(`检测到不健康连接，尝试重连: ${connectionKey}`, "WARN");
    this.reconnectionManager.registerSession(connectionKey, connectionInfo.client, sshConfig);
    try {
      await this.reconnectionManager.manualReconnect(connectionKey);
      if (this.isConnectionHealthy(connectionInfo)) {
        return;
      }
    } catch (error) {
      logToFile(`重连失败，创建新连接: ${connectionKey}`, "ERROR");
    }
    this.closeConnection(connectionKey);
  }

  async createConnection(sshConfig, connectionKey) {
    logToFile(`创建新SSH连接: ${connectionKey}`, "INFO");

    const resolvedProxyConfig = proxyManager.resolveProxyConfig(sshConfig);
    const usingProxy = this.isProxyConfigValid(resolvedProxyConfig);

    if (usingProxy) {
      logToFile(`使用代理: ${resolvedProxyConfig.type} ${resolvedProxyConfig.host}:${resolvedProxyConfig.port}`, "INFO");
    }

    return new Promise((resolve, reject) => {
      const ssh = new Client();
      const connectionInfo = {
        client: ssh,
        config: sshConfig,
        key: connectionKey,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        refCount: 1,
        ready: false,
        stream: null,
        listeners: new Set(),
        usingProxy: usingProxy,
      };

      const timeout = setTimeout(() => {
        logToFile(`SSH连接超时: ${connectionKey}`, "ERROR");
        reject(new Error("SSH连接超时"));
      }, CONNECTION_TIMEOUT);

      ssh.on("ready", () => {
        clearTimeout(timeout);
        connectionInfo.ready = true;
        this.connections.set(connectionKey, connectionInfo);
        this.reconnectionManager.registerSession(connectionKey, ssh, sshConfig);
        logToFile(`SSH连接建立成功: ${connectionKey}${usingProxy ? " (通过代理)" : ""}`, "INFO");
        resolve(connectionInfo);
      });

      ssh.on("error", (err) => {
        clearTimeout(timeout);
        let errorMessage = err.message;
        let isProxyError = false;

        if (usingProxy) {
          if (err.message.includes("proxy") || err.message.includes("socket") || err.message.includes("ECONNREFUSED") || err.message.includes("timeout")) {
            errorMessage = `代理连接失败: ${err.message}. 请检查代理配置或代理状态`;
            isProxyError = true;
          }
        }

        if (!isProxyError) {
          if (err.message.includes("All configured authentication methods failed")) {
            errorMessage = `SSH认证失败: ${err.message}. 请检查用户名、密码或私钥文件是否正确`;
            const { processSSHPrivateKey } = require("../../core/utils/ssh-utils");
            const processedConfig = processSSHPrivateKey(sshConfig);
            if (sshConfig.privateKeyPath && !processedConfig.privateKey) {
              errorMessage += `. 私钥文件路径: ${sshConfig.privateKeyPath} 可能无法读取`;
            }
          } else if (err.message.includes("connect ECONNREFUSED")) {
            errorMessage = `连接被拒绝: 无法连接到 ${sshConfig.host}:${sshConfig.port || 22}${usingProxy ? " (通过代理)" : ""}`;
          } else if (err.message.includes("getaddrinfo ENOTFOUND")) {
            errorMessage = `主机不存在: 无法解析主机名 ${sshConfig.host}`;
          }
        }

        logToFile(`SSH连接错误: ${connectionKey} - ${errorMessage}`, "ERROR");
        this.connections.delete(connectionKey);

        const enhancedError = new Error(errorMessage);
        enhancedError.originalError = err;
        enhancedError.connectionKey = connectionKey;
        enhancedError.sshConfig = {
          host: sshConfig.host,
          port: sshConfig.port || 22,
          username: sshConfig.username,
          usingProxy: usingProxy,
          proxyType: usingProxy ? resolvedProxyConfig.type : null,
          isProxyError: isProxyError,
        };

        reject(enhancedError);
      });

      ssh.on("close", () => {
        logToFile(`SSH连接关闭: ${connectionKey}`, "INFO");
        if (connectionInfo.refCount > 0 && !connectionInfo.intentionalClose) {
          logToFile(`检测到意外断开，触发自动重连: ${connectionKey}`, "WARN");
        }
        this.connections.delete(connectionKey);
      });

      const connectionOptions = {
        host: sshConfig.host,
        port: sshConfig.port || 22,
        username: sshConfig.username,
        algorithms: getBasicSSHAlgorithms(),
        keepaliveInterval: 15000,
        keepaliveCountMax: 6,
      };

      if (sshConfig && sshConfig.enableCompression === true) {
        connectionOptions.compress = true;
        logToFile("SSH连接启用压缩(compress=true)", "INFO");
      }

      const { processSSHPrivateKey } = require("../../core/utils/ssh-utils");
      const processedConfig = processSSHPrivateKey(sshConfig);

      if (processedConfig.password) {
        connectionOptions.password = processedConfig.password;
      }

      if (processedConfig.privateKey) {
        connectionOptions.privateKey = processedConfig.privateKey;
        if (processedConfig.passphrase) {
          connectionOptions.passphrase = processedConfig.passphrase;
        }
      }

      if (usingProxy) {
        connectionOptions.proxy = {
          host: resolvedProxyConfig.host,
          port: resolvedProxyConfig.port,
          type: this.getProxyProtocol(resolvedProxyConfig.type),
        };

        if (resolvedProxyConfig.username) {
          connectionOptions.proxy.username = resolvedProxyConfig.username;
          if (resolvedProxyConfig.password) {
            connectionOptions.proxy.password = resolvedProxyConfig.password;
          }
        }
      }

      ssh.connect(connectionOptions);
    });
  }

  isProxyConfigValid(proxyConfig) {
    return proxyConfig && typeof proxyConfig === "object" && proxyConfig.host && proxyConfig.port && proxyConfig.type && Object.values(PROXY_TYPES).includes(proxyConfig.type.toLowerCase());
  }

  getProxyProtocol(proxyType) {
    const type = proxyType.toLowerCase();
    switch (type) {
      case PROXY_TYPES.HTTP:
        return "http";
      case PROXY_TYPES.SOCKS4:
        return "socks4";
      case PROXY_TYPES.SOCKS5:
        return "socks5";
      default:
        return "http";
    }
  }

  doCloseConnection(connectionInfo, connectionKey) {
    connectionInfo.intentionalClose = true;
    if (this.reconnectionManager) {
      this.reconnectionManager.pauseReconnection(connectionKey);
    }
    try {
      if (connectionInfo.client && typeof connectionInfo.client.end === "function") {
        connectionInfo.client.end();
      }
    } catch (error) {
      logToFile(`关闭连接时出错: ${connectionKey} - ${error.message}`, "ERROR");
    }
    logToFile(`连接已关闭: ${connectionKey}`, "INFO");
  }

  isConnectionHealthy(connectionInfo) {
    return connectionInfo && connectionInfo.ready && connectionInfo.client && !connectionInfo.client.destroyed;
  }

  getStatus() {
    const status = super.getStatus();
    const proxyConnections = Array.from(this.connections.values()).filter((conn) => conn.usingProxy).length;
    status.proxyConnections = proxyConnections;
    status.connectionDetails = Array.from(this.connections.entries()).map(([key, conn]) => ({
      key,
      refCount: conn.refCount,
      createdAt: new Date(conn.createdAt).toISOString(),
      lastUsed: new Date(conn.lastUsed).toISOString(),
      ready: conn.ready,
      host: conn.config.host,
      usingProxy: conn.usingProxy,
      proxyType: conn.usingProxy ? conn.config.proxy.type : null,
    }));
    const { activeConnections, connectionsWithRefs, idleConnections } = status;
    if (activeConnections > 0) {
      logToFile(`连接池状态 - 活跃: ${activeConnections}, 使用中: ${connectionsWithRefs}, 空闲: ${idleConnections}, 代理连接: ${proxyConnections}`, "INFO");
    }
    return status;
  }

  getDetailedStats() {
    const stats = super.getDetailedStats();
    const connections = Array.from(this.connections.values());
    stats.proxyConnections = connections.filter((conn) => conn.usingProxy).length;
    return stats;
  }
}

const sshConnectionPool = new SSHConnectionPool();

module.exports = sshConnectionPool;
