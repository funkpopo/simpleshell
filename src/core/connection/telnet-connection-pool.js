/**
 * Telnet连接池 - 继承自BaseConnectionPool
 * 提供Telnet协议特定的连接管理功能
 */

const BaseConnectionPool = require('./base-connection-pool');
const Telnet = require('telnet-client');

/**
 * Telnet连接池类
 */
class TelnetConnectionPool extends BaseConnectionPool {
  /**
   * 构造函数
   * @param {Object} config - 连接池配置
   */
  constructor(config = {}) {
    super({
      ...config,
      protocolType: 'Telnet',
      maxConnections: config.maxConnections || 50,
      idleTimeout: config.idleTimeout || 30 * 60 * 1000, // 30分钟
      healthCheckInterval: config.healthCheckInterval || 5 * 60 * 1000, // 5分钟
      connectionTimeout: config.connectionTimeout || 15 * 1000 // 15秒
    });
  }

  /**
   * 生成Telnet连接键
   * @param {Object} config - Telnet连接配置
   * @returns {string} 连接键
   */
  generateConnectionKey(config) {
    // 优先使用 tabId 来确保每个标签页都有独立的连接
    if (config.tabId) {
      return `telnet:${config.host}:${config.port || 23}:${config.tabId}`;
    }

    // 回退到旧的逻辑，以支持可能没有tabId的场景
    return `telnet:${config.host}:${config.port || 23}`;
  }

  /**
   * 创建新的Telnet连接
   * @param {Object} telnetConfig - Telnet连接配置
   * @param {string} connectionKey - 连接键
   * @returns {Promise<Object>} 连接信息对象
   */
  async createConnection(telnetConfig, connectionKey) {
    this._logInfo(`创建新Telnet连接: ${connectionKey}`);

    return new Promise((resolve, reject) => {
      const telnet = new Telnet();
      const connectionInfo = {
        client: telnet,
        config: telnetConfig,
        key: connectionKey,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        refCount: 1,
        ready: false,
        stream: null,
        listeners: new Set()
      };

      // Telnet连接参数
      const params = {
        host: telnetConfig.host,
        port: telnetConfig.port || 23,
        negotiationMandatory: false,
        timeout: this.config.connectionTimeout,
        username: telnetConfig.username,
        password: telnetConfig.password,
        passwordPrompt: /Password:|密码:/i,
        loginPrompt: /login:|用户名:/i,
        shellPrompt: /#|\$|>|%/
      };

      // 监听错误事件
      telnet.on('error', (err) => {
        const enhancedError = this._handleTelnetError(
          err,
          telnetConfig,
          connectionKey
        );

        this.connections.delete(connectionKey);
        reject(enhancedError);
      });

      // 连接Telnet服务器
      telnet
        .connect(params)
        .then(() => {
          connectionInfo.ready = true;
          this.connections.set(connectionKey, connectionInfo);

          this._logInfo(`Telnet连接建立成功: ${connectionKey}`);
          this.emit('connectionCreated', { key: connectionKey, connection: connectionInfo });

          resolve(connectionInfo);
        })
        .catch((err) => {
          const enhancedError = this._handleTelnetError(
            err,
            telnetConfig,
            connectionKey
          );

          this.connections.delete(connectionKey);
          reject(enhancedError);
        });
    });
  }

  /**
   * 检查Telnet连接是否健康
   * @param {Object} connectionInfo - 连接信息对象
   * @returns {boolean} 是否健康
   */
  isConnectionHealthy(connectionInfo) {
    return (
      connectionInfo &&
      connectionInfo.client &&
      connectionInfo.ready
    );
  }

  /**
   * 获取详细统计信息（扩展父类方法）
   * @returns {Object} 统计信息
   */
  getDetailedStats() {
    const stats = super.getDetailedStats();

    // 添加Telnet特有的连接详情
    const connections = [];
    for (const [key, info] of this.connections) {
      connections.push({
        key,
        host: info.config.host,
        port: info.config.port || 23,
        username: info.config.username,
        createdAt: info.createdAt,
        lastUsed: info.lastUsed,
        refCount: info.refCount,
        ready: info.ready,
        idleTime: Date.now() - info.lastUsed
      });
    }

    // 添加标签页引用详情
    const tabRefs = [];
    for (const [tabId, connKey] of this.tabReferences) {
      tabRefs.push({
        tabId,
        connectionKey: connKey
      });
    }

    return {
      ...stats,
      connections,
      tabReferences: tabRefs
    };
  }

  /**
   * 处理Telnet错误
   * @param {Error} err - 原始错误
   * @param {Object} telnetConfig - Telnet配置
   * @param {string} connectionKey - 连接键
   * @returns {Error} 增强的错误对象
   * @private
   */
  _handleTelnetError(err, telnetConfig, connectionKey) {
    let errorMessage = `Telnet连接错误: ${err.message}`;

    // 检测常见Telnet错误
    if (err.message.includes('ECONNREFUSED')) {
      errorMessage = `连接被拒绝: 无法连接到 ${telnetConfig.host}:${telnetConfig.port || 23}`;
    } else if (err.message.includes('ENOTFOUND')) {
      errorMessage = `主机不存在: 无法解析主机名 ${telnetConfig.host}`;
    } else if (err.message.includes('ETIMEDOUT') || err.message.includes('timeout')) {
      errorMessage = `连接超时: 无法在指定时间内连接到 ${telnetConfig.host}:${telnetConfig.port || 23}`;
    } else if (err.message.includes('authentication') || err.message.includes('login')) {
      errorMessage = `Telnet认证失败: 请检查用户名和密码是否正确`;
    }

    // 日志中记录详细信息（包含connectionKey），但不影响用户看到的错误
    this._logInfo(`Telnet连接错误详情: ${connectionKey} - ${errorMessage}`);

    // 创建增强的错误对象（使用简洁的错误消息）
    const enhancedError = new Error(errorMessage);
    enhancedError.originalError = err;
    enhancedError.connectionKey = connectionKey;
    enhancedError.telnetConfig = {
      host: telnetConfig.host,
      port: telnetConfig.port || 23,
      username: telnetConfig.username,
      hasPassword: !!telnetConfig.password
    };

    return enhancedError;
  }
}

module.exports = TelnetConnectionPool;
