const Client = require("ssh2").Client;
const { logToFile } = require("../../core/utils/logger");
const { getBasicSSHAlgorithms } = require("../../constants/sshAlgorithms");

// 连接池配置常量
const MAX_CONNECTIONS = 50; // 最大连接数
const IDLE_TIMEOUT = 30 * 60 * 1000; // 空闲超时时间（30分钟）- 延长以支持标签页切换
const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // 健康检查间隔（5分钟）
const CONNECTION_TIMEOUT = 15 * 1000; // 连接超时时间（15秒）

// 代理类型常量
const PROXY_TYPES = {
  HTTP: 'http',
  SOCKS4: 'socks4',
  SOCKS5: 'socks5',
  NONE: 'none'
};

class SSHConnectionPool {
  constructor(maxConnections = MAX_CONNECTIONS) {
    this.maxConnections = maxConnections;
    this.connections = new Map(); // 存储活跃连接
    this.connectionQueue = new Map(); // 连接请求队列
    this.tabReferences = new Map(); // 存储标签页对连接的引用关系
    this.healthCheckTimer = null;
    this.isInitialized = false;
    this.connectionUsage = new Map();
  }

  initialize() {
    if (this.isInitialized) {
      return;
    }

    this.startHealthCheck();
    this.isInitialized = true;
    logToFile("SSH连接池已初始化", "INFO");
  }

  cleanup() {
    this.stopHealthCheck();

    // 关闭所有连接
    for (const [key, connectionInfo] of this.connections) {
      this.closeConnection(key);
    }

    this.connections.clear();
    this.connectionQueue.clear();
    this.tabReferences.clear();
    this.isInitialized = false;
    logToFile("SSH连接池已清理", "INFO");
  }

  generateConnectionKey(config) {
    // 优先使用 tabId 来确保每个标签页都有独立的连接
    if (config.tabId) {
      // 确保每个标签页使用独立连接，不复用任何连接资源
      // 将tabId作为连接键的第一部分，确保连接不会被复用
      const proxyString = config.proxy ? 
        `proxy:${config.proxy.host}:${config.proxy.port}:${config.proxy.type}` : '';
      
      // 使用唯一的连接键格式，确保每个标签页有独立连接
      return `tab:${config.tabId}:${config.host}:${config.port || 22}:${config.username}${proxyString ? ':' + proxyString : ''}`;
    }
    // 回退到旧的逻辑，以支持可能没有tabId的场景
    return `${config.host}:${config.port || 22}:${config.username}`;
  }

  recordConnectionUsage(connectionId) {
    if (!connectionId) return;
    const currentCount = this.connectionUsage.get(connectionId) || 0;
    this.connectionUsage.set(connectionId, currentCount + 1);
  }

  getTopConnections(count = 5) {
    if (this.connectionUsage.size === 0) return [];

    const sorted = [...this.connectionUsage.entries()].sort((a, b) => b[1] - a[1]);
    return sorted.slice(0, count).map(entry => entry[0]);
  }

  async getConnection(sshConfig) {
    const connectionKey = this.generateConnectionKey(sshConfig);

    this.recordConnectionUsage(sshConfig.id);

    // 检查是否已有可用连接
    if (this.connections.has(connectionKey)) {
      const connectionInfo = this.connections.get(connectionKey);

      // 检查连接是否健康
      if (this.isConnectionHealthy(connectionInfo)) {
        connectionInfo.lastUsed = Date.now();
        connectionInfo.refCount++;
        logToFile(`复用现有SSH连接: ${connectionKey}`, "INFO");
        return connectionInfo;
      } else {
        // 连接不健康，移除并重新创建
        this.closeConnection(connectionKey);
      }
    }

    // 检查连接数限制
    if (this.connections.size >= this.maxConnections) {
      // 尝试清理最旧的空闲连接
      const cleaned = this.cleanupIdleConnections(1);
      if (!cleaned) {
        throw new Error(`连接池已满，最大连接数: ${this.maxConnections}`);
      }
    }

    // 创建新连接
    return await this.createConnection(sshConfig, connectionKey);
  }

  /**
   * 创建SSH连接，支持代理配置
   * @param {object} sshConfig - SSH连接配置
   * @param {string} connectionKey - 连接键
   * @returns {Promise<object>} 连接信息
   */
  async createConnection(sshConfig, connectionKey) {
    logToFile(`创建新SSH连接: ${connectionKey}`, "INFO");
    
    // 检查是否需要通过代理
    const usingProxy = this.isProxyConfigValid(sshConfig.proxy);
    if (usingProxy) {
      logToFile(`使用代理: ${sshConfig.proxy.type} ${sshConfig.proxy.host}:${sshConfig.proxy.port}`, "INFO");
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

      // 设置连接超时
      const timeout = setTimeout(() => {
        logToFile(`SSH连接超时: ${connectionKey}`, "ERROR");
        reject(new Error("SSH连接超时"));
      }, CONNECTION_TIMEOUT);

      // 监听就绪事件
      ssh.on("ready", () => {
        clearTimeout(timeout);
        connectionInfo.ready = true;
        this.connections.set(connectionKey, connectionInfo);

        logToFile(`SSH连接建立成功: ${connectionKey}${usingProxy ? ' (通过代理)' : ''}`, "INFO");
        resolve(connectionInfo);
      });

      // 监听错误事件
      ssh.on("error", (err) => {
        clearTimeout(timeout);

        // 增强错误信息
        let errorMessage = err.message;
        let isProxyError = false;

        // 检测代理相关错误
        if (usingProxy) {
          if (
            err.message.includes("proxy") ||
            err.message.includes("socket") ||
            err.message.includes("ECONNREFUSED") ||
            err.message.includes("timeout")
          ) {
            errorMessage = `代理连接失败: ${err.message}. 请检查代理配置或代理状态`;
            isProxyError = true;
          }
        }
        
        // 检测常见SSH错误
        if (!isProxyError) {
          if (
            err.message.includes("All configured authentication methods failed")
          ) {
            errorMessage = `SSH认证失败: ${err.message}. 请检查用户名、密码或私钥文件是否正确`;

            // 如果配置了私钥路径但没有私钥内容，提供具体提示
            if (sshConfig.privateKeyPath && !processedConfig.privateKey) {
              errorMessage += `. 私钥文件路径: ${sshConfig.privateKeyPath} 可能无法读取`;
            }
          } else if (err.message.includes("connect ECONNREFUSED")) {
            errorMessage = `连接被拒绝: 无法连接到 ${sshConfig.host}:${sshConfig.port || 22}${usingProxy ? ' (通过代理)' : ''}`;
          } else if (err.message.includes("getaddrinfo ENOTFOUND")) {
            errorMessage = `主机不存在: 无法解析主机名 ${sshConfig.host}`;
          }
        }

        logToFile(`SSH连接错误: ${connectionKey} - ${errorMessage}`, "ERROR");
        this.connections.delete(connectionKey);

        // 创建增强的错误对象
        const enhancedError = new Error(errorMessage);
        enhancedError.originalError = err;
        enhancedError.connectionKey = connectionKey;
        enhancedError.sshConfig = {
          host: sshConfig.host,
          port: sshConfig.port || 22,
          username: sshConfig.username,
          hasPassword: !!sshConfig.password,
          hasPrivateKey: !!processedConfig.privateKey,
          hasPrivateKeyPath: !!sshConfig.privateKeyPath,
          usingProxy: usingProxy,
          proxyType: usingProxy ? sshConfig.proxy.type : null,
          isProxyError: isProxyError
        };

        reject(enhancedError);
      });

      // 监听关闭事件
      ssh.on("close", () => {
        logToFile(`SSH连接关闭: ${connectionKey}`, "INFO");
        this.connections.delete(connectionKey);
      });

      // 建立连接
      const connectionOptions = {
        host: sshConfig.host,
        port: sshConfig.port || 22,
        username: sshConfig.username,
        algorithms: getBasicSSHAlgorithms(),
      };

      // 处理私钥文件路径
      const { processSSHPrivateKey } = require("../../core/utils/ssh-utils");
      const processedConfig = processSSHPrivateKey(sshConfig);

      // 添加认证方式
      if (processedConfig.password) {
        connectionOptions.password = processedConfig.password;
      }

      if (processedConfig.privateKey) {
        connectionOptions.privateKey = processedConfig.privateKey;
        if (processedConfig.passphrase) {
          connectionOptions.passphrase = processedConfig.passphrase;
        }
      }

      // 处理代理配置
      if (usingProxy) {
        const proxyConfig = sshConfig.proxy;
        
        connectionOptions.proxy = {
          host: proxyConfig.host,
          port: proxyConfig.port,
          type: this.getProxyProtocol(proxyConfig.type)
        };
        
        // 处理代理身份认证
        if (proxyConfig.username) {
          connectionOptions.proxy.username = proxyConfig.username;
          if (proxyConfig.password) {
            connectionOptions.proxy.password = proxyConfig.password;
          }
        }
      }

      ssh.connect(connectionOptions);
    });
  }
  
  /**
   * 检查代理配置是否有效
   * @param {object|null} proxyConfig - 代理配置对象
   * @returns {boolean} 配置是否有效
   */
  isProxyConfigValid(proxyConfig) {
    return (
      proxyConfig &&
      typeof proxyConfig === 'object' &&
      proxyConfig.host &&
      proxyConfig.port &&
      proxyConfig.type &&
      Object.values(PROXY_TYPES).includes(proxyConfig.type.toLowerCase())
    );
  }
  
  /**
   * 获取适合ssh2库的代理协议字符串
   * @param {string} proxyType - 代理类型
   * @returns {string} ssh2库支持的代理协议字符串
   */
  getProxyProtocol(proxyType) {
    const type = proxyType.toLowerCase();
    
    switch (type) {
      case PROXY_TYPES.HTTP:
        return 'http';
      case PROXY_TYPES.SOCKS4:
        return 'socks4';
      case PROXY_TYPES.SOCKS5:
        return 'socks5';
      default:
        // 默认返回http
        return 'http';
    }
  }

  releaseConnection(connectionKey, tabId = null) {
    const connectionInfo = this.connections.get(connectionKey);
    if (connectionInfo) {
      connectionInfo.refCount = Math.max(0, connectionInfo.refCount - 1);
      connectionInfo.lastUsed = Date.now();
      if (tabId && this.tabReferences.has(tabId)) {
        this.tabReferences.delete(tabId);
        logToFile(`移除标签页引用: ${tabId} -> ${connectionKey}`, "INFO");
      }
      logToFile(
        `释放连接引用: ${connectionKey}, 剩余引用: ${connectionInfo.refCount}`,
        "INFO",
      );
      // 若refCount为0且无tab引用，自动关闭连接
      if (connectionInfo.refCount === 0 && !this.isConnectionReferencedByTabs(connectionKey)) {
        this.closeConnection(connectionKey);
      }
    }
  }

  // 添加标签页引用追踪
  addTabReference(tabId, connectionKey) {
    this.tabReferences.set(tabId, connectionKey);
    logToFile(`添加标签页引用: ${tabId} -> ${connectionKey}`, "INFO");
  }

  // 检查连接是否被标签页引用
  isConnectionReferencedByTabs(connectionKey) {
    for (const [tabId, connKey] of this.tabReferences) {
      if (connKey === connectionKey) {
        return true;
      }
    }
    return false;
  }

  /**
   * 根据标签页ID查找关联的连接
   * @param {string} tabId - 标签页ID
   * @returns {object|null} - 连接信息或null
   */
  getConnectionByTabId(tabId) {
    if (!tabId) return null;
    
    // 查找标签页引用
    if (this.tabReferences.has(tabId)) {
      const connectionKey = this.tabReferences.get(tabId);
      if (this.connections.has(connectionKey)) {
        return this.connections.get(connectionKey);
      }
    }
    
    // 直接通过连接键前缀查找
    const tabPrefix = `tab:${tabId}:`;
    for (const [key, connection] of this.connections.entries()) {
      if (key.startsWith(tabPrefix)) {
        return connection;
      }
    }
    
    return null;
  }

  closeConnection(connectionKey) {
    const connectionInfo = this.connections.get(connectionKey);
    if (connectionInfo) {
      try {
        if (
          connectionInfo.client &&
          typeof connectionInfo.client.end === "function"
        ) {
          connectionInfo.client.end();
        }
      } catch (error) {
        logToFile(
          `关闭连接时出错: ${connectionKey} - ${error.message}`,
          "ERROR",
        );
      }

      this.connections.delete(connectionKey);
      logToFile(`连接已关闭: ${connectionKey}`, "INFO");
    }
  }

  isConnectionHealthy(connectionInfo) {
    return (
      connectionInfo &&
      connectionInfo.ready &&
      connectionInfo.client &&
      !connectionInfo.client.destroyed
    );
  }

  cleanupIdleConnections(count = 1) {
    const now = Date.now();
    const idleConnections = [];

    // 找出空闲连接
    for (const [key, connectionInfo] of this.connections) {
      // 检查连接是否真正空闲：无引用计数且未被标签页引用且超过空闲时间
      const hasTabReference = this.isConnectionReferencedByTabs(key);
      const isIdle =
        connectionInfo.refCount === 0 &&
        !hasTabReference &&
        now - connectionInfo.lastUsed > IDLE_TIMEOUT;

      if (isIdle) {
        idleConnections.push({ key, lastUsed: connectionInfo.lastUsed });
      }
    }

    // 按最后使用时间排序，优先清理最旧的
    idleConnections.sort((a, b) => a.lastUsed - b.lastUsed);

    // 清理指定数量的连接
    let cleaned = 0;
    for (let i = 0; i < Math.min(count, idleConnections.length); i++) {
      this.closeConnection(idleConnections[i].key);
      cleaned++;
    }

    if (cleaned > 0) {
      logToFile(`清理了 ${cleaned} 个空闲连接`, "INFO");
    }

    return cleaned > 0;
  }

  startHealthCheck() {
    if (this.healthCheckTimer) {
      return;
    }

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, HEALTH_CHECK_INTERVAL);

    logToFile("SSH连接池健康检查已启动", "INFO");
  }

  stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
      logToFile("SSH连接池健康检查已停止", "INFO");
    }
  }

  performHealthCheck() {
    const now = Date.now();
    const unhealthyConnections = [];

    for (const [key, connectionInfo] of this.connections) {
      // 检查连接健康状态
      if (!this.isConnectionHealthy(connectionInfo)) {
        unhealthyConnections.push(key);
        continue;
      }

      // 检查是否超过空闲时间且无引用且未被标签页引用
      const hasTabReference = this.isConnectionReferencedByTabs(key);
      if (
        connectionInfo.refCount === 0 &&
        !hasTabReference &&
        now - connectionInfo.lastUsed > IDLE_TIMEOUT
      ) {
        unhealthyConnections.push(key);
      }
    }

    // 清理不健康的连接
    for (const key of unhealthyConnections) {
      this.closeConnection(key);
    }

    if (unhealthyConnections.length > 0) {
      logToFile(`健康检查清理了 ${unhealthyConnections.length} 个连接`, "INFO");
    }
  }

  getStatus() {
    const activeConnections = this.connections.size;
    const connectionsWithRefs = Array.from(this.connections.values()).filter(
      (conn) => conn.refCount > 0,
    ).length;
    const idleConnections = Array.from(this.connections.values()).filter(
      (conn) => conn.refCount === 0,
    ).length;
    const proxyConnections = Array.from(this.connections.values()).filter(
      (conn) => conn.usingProxy,
    ).length;

    const status = {
      activeConnections,
      connectionsWithRefs,
      idleConnections,
      proxyConnections,
      maxConnections: this.maxConnections,
      isInitialized: this.isInitialized,
      connectionDetails: Array.from(this.connections.entries()).map(
        ([key, conn]) => ({
          key,
          refCount: conn.refCount,
          createdAt: new Date(conn.createdAt).toISOString(),
          lastUsed: new Date(conn.lastUsed).toISOString(),
          ready: conn.ready,
          host: conn.config.host,
          usingProxy: conn.usingProxy,
          proxyType: conn.usingProxy ? conn.config.proxy.type : null
        }),
      ),
    };

    // 定期记录连接池状态
    if (activeConnections > 0) {
      logToFile(
        `连接池状态 - 活跃: ${activeConnections}, 使用中: ${connectionsWithRefs}, 空闲: ${idleConnections}, 代理连接: ${proxyConnections}`,
        "INFO",
      );
    }

    return status;
  }

  getDetailedStats() {
    const now = Date.now();
    const connections = Array.from(this.connections.values());

    const stats = {
      totalConnections: connections.length,
      healthyConnections: connections.filter((conn) =>
        this.isConnectionHealthy(conn),
      ).length,
      connectionsWithRefs: connections.filter((conn) => conn.refCount > 0)
        .length,
      proxyConnections: connections.filter((conn) => conn.usingProxy).length,
      oldestConnection:
        connections.length > 0
          ? Math.min(...connections.map((conn) => conn.createdAt))
          : null,
      newestConnection:
        connections.length > 0
          ? Math.max(...connections.map((conn) => conn.createdAt))
          : null,
      averageAge:
        connections.length > 0
          ? connections.reduce((sum, conn) => sum + (now - conn.createdAt), 0) /
            connections.length
          : 0,
      totalRefCount: connections.reduce((sum, conn) => sum + conn.refCount, 0),
    };

    return stats;
  }
}

// 创建单例实例
const sshConnectionPool = new SSHConnectionPool();

module.exports = sshConnectionPool;
