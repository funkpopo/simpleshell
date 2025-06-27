const Client = require("ssh2").Client;
const { logToFile } = require("../../core/utils/logger");
const { getBasicSSHAlgorithms } = require("../../constants/sshAlgorithms");

// 连接池配置常量
const MAX_CONNECTIONS = 10; // 最大连接数
const IDLE_TIMEOUT = 30 * 60 * 1000; // 空闲超时时间（30分钟）- 延长以支持标签页切换
const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // 健康检查间隔（5分钟）
const CONNECTION_TIMEOUT = 15 * 1000; // 连接超时时间（15秒）

class SSHConnectionPool {
  constructor(maxConnections = MAX_CONNECTIONS) {
    this.maxConnections = maxConnections;
    this.connections = new Map(); // 存储活跃连接
    this.connectionQueue = new Map(); // 连接请求队列
    this.tabReferences = new Map(); // 存储标签页对连接的引用关系
    this.healthCheckTimer = null;
    this.isInitialized = false;
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
      return `${config.host}:${config.port || 22}:${config.username}:${config.tabId}`;
    }
    // 回退到旧的逻辑，以支持可能没有tabId的场景
    return `${config.host}:${config.port || 22}:${config.username}`;
  }

  async getConnection(sshConfig) {
    const connectionKey = this.generateConnectionKey(sshConfig);

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

  async createConnection(sshConfig, connectionKey) {
    logToFile(`创建新SSH连接: ${connectionKey}`, "INFO");

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

        logToFile(`SSH连接建立成功: ${connectionKey}`, "INFO");
        resolve(connectionInfo);
      });

      // 监听错误事件
      ssh.on("error", (err) => {
        clearTimeout(timeout);

        // 增强错误信息
        let errorMessage = err.message;
        if (
          err.message.includes("All configured authentication methods failed")
        ) {
          errorMessage = `SSH认证失败: ${err.message}. 请检查用户名、密码或私钥文件是否正确`;

          // 如果配置了私钥路径但没有私钥内容，提供具体提示
          if (sshConfig.privateKeyPath && !processedConfig.privateKey) {
            errorMessage += `. 私钥文件路径: ${sshConfig.privateKeyPath} 可能无法读取`;
          }
        } else if (err.message.includes("connect ECONNREFUSED")) {
          errorMessage = `连接被拒绝: 无法连接到 ${sshConfig.host}:${sshConfig.port || 22}`;
        } else if (err.message.includes("getaddrinfo ENOTFOUND")) {
          errorMessage = `主机不存在: 无法解析主机名 ${sshConfig.host}`;
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

      ssh.connect(connectionOptions);
    });
  }

  releaseConnection(connectionKey, tabId = null) {
    const connectionInfo = this.connections.get(connectionKey);
    if (connectionInfo) {
      connectionInfo.refCount = Math.max(0, connectionInfo.refCount - 1);
      connectionInfo.lastUsed = Date.now();

      // 如果提供了tabId，从标签页引用中移除
      if (tabId && this.tabReferences.has(tabId)) {
        this.tabReferences.delete(tabId);
        logToFile(`移除标签页引用: ${tabId} -> ${connectionKey}`, "INFO");
      }

      logToFile(
        `释放连接引用: ${connectionKey}, 剩余引用: ${connectionInfo.refCount}`,
        "INFO",
      );
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

    const status = {
      activeConnections,
      connectionsWithRefs,
      idleConnections,
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
        }),
      ),
    };

    // 定期记录连接池状态
    if (activeConnections > 0) {
      logToFile(
        `连接池状态 - 活跃: ${activeConnections}, 使用中: ${connectionsWithRefs}, 空闲: ${idleConnections}`,
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
