/**
 * SSH连接池 - 继承自BaseConnectionPool
 * 提供SSH协议特定的连接管理功能，包括代理支持和自动重连
 */

const BaseConnectionPool = require('./base-connection-pool');
const Client = require('ssh2').Client;
const { getBasicSSHAlgorithms } = require('../../constants/sshAlgorithms');
const proxyManager = require('../proxy/proxy-manager');
const ReconnectionManager = require('./reconnection-manager');

// 代理类型常量
const PROXY_TYPES = {
  HTTP: 'http',
  SOCKS4: 'socks4',
  SOCKS5: 'socks5',
  NONE: 'none'
};

/**
 * SSH连接池类
 */
class SSHConnectionPool extends BaseConnectionPool {
  /**
   * 构造函数
   * @param {Object} config - 连接池配置
   */
  constructor(config = {}) {
    super({
      ...config,
      protocolType: 'SSH',
      maxConnections: config.maxConnections || 50,
      idleTimeout: config.idleTimeout || 30 * 60 * 1000, // 30分钟
      healthCheckInterval: config.healthCheckInterval || 5 * 60 * 1000, // 5分钟
      connectionTimeout: config.connectionTimeout || 15 * 1000 // 15秒
    });

    // SSH特有的管理器
    this.reconnectionManager = null;
    this.proxyManager = null;
  }

  /**
   * 初始化SSH连接池
   */
  initialize() {
    if (this.isInitialized) {
      this._logInfo('SSH连接池已经初始化');
      return;
    }

    // 初始化代理管理器
    proxyManager.initialize();
    this.proxyManager = proxyManager;

    // 初始化重连管理器
    this.reconnectionManager = new ReconnectionManager({
      maxRetries: 5,
      fixedDelay: 3000,
      useFixedInterval: true
    });
    this.reconnectionManager.initialize();

    // 设置重连监听器
    this._setupReconnectionListeners();

    // 调用父类初始化
    super.initialize();
  }

  /**
   * 清理SSH连接池资源
   */
  cleanup() {
    // 关闭重连管理器
    if (this.reconnectionManager) {
      this.reconnectionManager.shutdown();
    }

    // 调用父类清理
    super.cleanup();
  }

  /**
   * 生成SSH连接键
   * @param {Object} config - SSH连接配置
   * @returns {string} 连接键
   */
  generateConnectionKey(config) {
    // 优先使用 tabId 来确保每个标签页都有独立的连接
    if (config.tabId) {
      const proxyString = config.proxy
        ? `proxy:${config.proxy.host}:${config.proxy.port}:${config.proxy.type}`
        : '';

      // 使用唯一的连接键格式，确保每个标签页有独立连接
      return `tab:${config.tabId}:${config.host}:${config.port || 22}:${config.username}${proxyString ? ':' + proxyString : ''}`;
    }

    // 回退到旧的逻辑，以支持可能没有tabId的场景
    return `${config.host}:${config.port || 22}:${config.username}`;
  }

  /**
   * 创建新的SSH连接
   * @param {Object} sshConfig - SSH连接配置
   * @param {string} connectionKey - 连接键
   * @returns {Promise<Object>} 连接信息对象
   */
  async createConnection(sshConfig, connectionKey) {
    this._logInfo(`创建新SSH连接: ${connectionKey}`);

    // 解析代理配置
    const resolvedProxyConfig = this.proxyManager.resolveProxyConfig(sshConfig);
    const usingProxy = this._isProxyConfigValid(resolvedProxyConfig);

    if (usingProxy) {
      this._logInfo(
        `使用代理: ${resolvedProxyConfig.type} ${resolvedProxyConfig.host}:${resolvedProxyConfig.port}`
      );
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
        usingProxy: usingProxy
      };

      // 设置连接超时
      const timeout = setTimeout(() => {
        this._logError('SSH连接超时', new Error(`连接键: ${connectionKey}`));
        reject(new Error('SSH连接超时'));
      }, this.config.connectionTimeout);

      // 监听就绪事件
      ssh.on('ready', () => {
        clearTimeout(timeout);
        connectionInfo.ready = true;
        this.connections.set(connectionKey, connectionInfo);

        // 注册到重连管理器
        if (this.reconnectionManager) {
          this.reconnectionManager.registerSession(connectionKey, ssh, sshConfig);
        }

        this._logInfo(
          `SSH连接建立成功: ${connectionKey}${usingProxy ? ' (通过代理)' : ''}`
        );

        this.emit('connectionCreated', { key: connectionKey, connection: connectionInfo });
        resolve(connectionInfo);
      });

      // 监听错误事件
      ssh.on('error', (err) => {
        clearTimeout(timeout);

        const enhancedError = this._handleSSHError(
          err,
          sshConfig,
          connectionKey,
          usingProxy,
          resolvedProxyConfig
        );

        this.connections.delete(connectionKey);
        reject(enhancedError);
      });

      // 监听关闭事件
      ssh.on('close', () => {
        this._handleSSHClose(connectionInfo, connectionKey);
      });

      // 建立连接
      const connectionOptions = this._buildSSHOptions(
        sshConfig,
        resolvedProxyConfig,
        usingProxy
      );

      ssh.connect(connectionOptions);
    });
  }

  /**
   * 检查SSH连接是否健康
   * @param {Object} connectionInfo - 连接信息对象
   * @returns {boolean} 是否健康
   */
  isConnectionHealthy(connectionInfo) {
    return (
      connectionInfo &&
      connectionInfo.ready &&
      connectionInfo.client &&
      !connectionInfo.client.destroyed
    );
  }

  /**
   * 处理不健康的连接（覆盖父类方法以支持重连）
   * @param {Object} conn - 连接信息对象
   * @param {Object} config - 连接配置
   * @private
   */
  async _handleUnhealthyConnection(conn, config) {
    this._logInfo(`检测到不健康连接，尝试重连: ${conn.key}`);

    // SSH特有的重连逻辑
    if (this.reconnectionManager) {
      // 注册到重连管理器
      this.reconnectionManager.registerSession(conn.key, conn.client, config);

      // 手动触发重连
      try {
        await this.reconnectionManager.manualReconnect(conn.key);

        // 重连成功，检查连接健康状态
        if (this.isConnectionHealthy(conn)) {
          this._logInfo(`重连成功: ${conn.key}`);
          return conn;
        }
      } catch (error) {
        this._logError('重连失败，创建新连接', error);
      }
    }

    // 重连失败或不支持重连，关闭连接
    this.closeConnection(conn.key);
  }

  /**
   * 关闭SSH连接（覆盖父类方法以支持重连管理器）
   * @param {string} key - 连接键
   */
  closeConnection(key) {
    const conn = this.connections.get(key);

    if (conn) {
      // 标记为有意关闭，避免触发重连
      conn.intentionalClose = true;

      // 从重连管理器中移除
      if (this.reconnectionManager) {
        this.reconnectionManager.pauseReconnection(key);
      }
    }

    // 调用父类方法
    super.closeConnection(key);
  }

  /**
   * 获取连接池状态（扩展父类方法）
   * @returns {Object} 状态信息
   */
  getStatus() {
    const status = super.getStatus();

    // 添加SSH特有的统计
    const proxyConns = Array.from(this.connections.values()).filter(
      (c) => c.usingProxy
    ).length;

    return {
      ...status,
      proxyConnections: proxyConns
    };
  }

  /**
   * 根据标签页ID获取连接（扩展父类方法以支持前缀匹配）
   * @param {string} tabId - 标签页ID
   * @returns {Object|null} 连接信息对象
   */
  getConnectionByTabId(tabId) {
    if (!tabId) return null;

    // 先调用父类方法查找标签页引用
    const conn = super.getConnectionByTabId(tabId);
    if (conn) return conn;

    // 直接通过连接键前缀查找（向后兼容）
    const tabPrefix = `tab:${tabId}:`;
    for (const [key, connection] of this.connections.entries()) {
      if (key.startsWith(tabPrefix)) {
        return connection;
      }
    }

    return null;
  }

  /**
   * 设置重连监听器
   * @private
   */
  _setupReconnectionListeners() {
    if (!this.reconnectionManager) return;

    // 重连成功事件
    this.reconnectionManager.on('reconnectSuccess', ({ sessionId, attempts }) => {
      this._logInfo(`连接重连成功: ${sessionId}, 尝试次数: ${attempts}`);

      // 更新连接状态
      if (this.connections.has(sessionId)) {
        const connectionInfo = this.connections.get(sessionId);
        connectionInfo.ready = true;
        connectionInfo.lastUsed = Date.now();
      }
    });

    // 重连失败事件
    this.reconnectionManager.on('reconnectFailed', ({ sessionId, error, attempts }) => {
      this._logError(
        `连接重连失败: ${sessionId}, 尝试次数: ${attempts}`,
        error
      );

      // 清理失败的连接（达到最大重试次数）
      if (attempts >= 5) {
        this.closeConnection(sessionId);
      }
    });

    // 连接替换事件
    this.reconnectionManager.on('connectionReplaced', ({ sessionId, newConnection }) => {
      this._logInfo(`连接已替换: ${sessionId}`);

      // 更新连接池中的连接
      if (this.connections.has(sessionId)) {
        const connectionInfo = this.connections.get(sessionId);
        connectionInfo.client = newConnection;
        connectionInfo.ready = true;
      }
    });
  }

  /**
   * 检查代理配置是否有效
   * @param {Object|null} proxyConfig - 代理配置对象
   * @returns {boolean} 配置是否有效
   * @private
   */
  _isProxyConfigValid(proxyConfig) {
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
   * @private
   */
  _getProxyProtocol(proxyType) {
    const type = proxyType.toLowerCase();

    switch (type) {
      case PROXY_TYPES.HTTP:
        return 'http';
      case PROXY_TYPES.SOCKS4:
        return 'socks4';
      case PROXY_TYPES.SOCKS5:
        return 'socks5';
      default:
        return 'http';
    }
  }

  /**
   * 构建SSH连接选项
   * @param {Object} sshConfig - SSH配置
   * @param {Object} proxyConfig - 代理配置
   * @param {boolean} usingProxy - 是否使用代理
   * @returns {Object} SSH连接选项
   * @private
   */
  _buildSSHOptions(sshConfig, proxyConfig, usingProxy) {
    const { processSSHPrivateKey } = require('../utils/ssh-utils');
    const processedConfig = processSSHPrivateKey(sshConfig);

    const options = {
      host: sshConfig.host,
      port: sshConfig.port || 22,
      username: sshConfig.username,
      algorithms: getBasicSSHAlgorithms(),
      keepaliveInterval: 15000,
      keepaliveCountMax: 6
    };

    // 启用压缩（如果配置）
    if (sshConfig && sshConfig.enableCompression === true) {
      options.compress = true;
      this._logInfo('SSH连接启用压缩(compress=true)');
    }

    // 添加认证方式
    if (processedConfig.password) {
      options.password = processedConfig.password;
    }

    if (processedConfig.privateKey) {
      options.privateKey = processedConfig.privateKey;
      if (processedConfig.passphrase) {
        options.passphrase = processedConfig.passphrase;
      }
    }

    // 处理代理配置
    if (usingProxy) {
      options.proxy = {
        host: proxyConfig.host,
        port: proxyConfig.port,
        type: this._getProxyProtocol(proxyConfig.type)
      };

      // 处理代理身份认证
      if (proxyConfig.username) {
        options.proxy.username = proxyConfig.username;
        if (proxyConfig.password) {
          options.proxy.password = proxyConfig.password;
        }
      }
    }

    return options;
  }

  /**
   * 处理SSH错误
   * @param {Error} err - 原始错误
   * @param {Object} sshConfig - SSH配置
   * @param {string} connectionKey - 连接键
   * @param {boolean} usingProxy - 是否使用代理
   * @param {Object} resolvedProxyConfig - 解析后的代理配置
   * @returns {Error} 增强的错误对象
   * @private
   */
  _handleSSHError(err, sshConfig, connectionKey, usingProxy, resolvedProxyConfig) {
    const { processSSHPrivateKey } = require('../utils/ssh-utils');
    const processedConfig = processSSHPrivateKey(sshConfig);

    let errorMessage = err.message;
    let isProxyError = false;

    // 检测代理相关错误
    if (usingProxy) {
      if (
        err.message.includes('proxy') ||
        err.message.includes('socket') ||
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('timeout')
      ) {
        errorMessage = `代理连接失败: ${err.message}. 请检查代理配置或代理状态`;
        isProxyError = true;
      }
    }

    // 检测常见SSH错误
    if (!isProxyError) {
      if (err.message.includes('All configured authentication methods failed')) {
        errorMessage = `SSH认证失败: ${err.message}. 请检查用户名、密码或私钥文件是否正确`;

        // 如果配置了私钥路径但没有私钥内容，提供具体提示
        if (sshConfig.privateKeyPath && !processedConfig.privateKey) {
          errorMessage += `. 私钥文件路径: ${sshConfig.privateKeyPath} 可能无法读取`;
        }
      } else if (err.message.includes('connect ECONNREFUSED')) {
        errorMessage = `连接被拒绝: 无法连接到 ${sshConfig.host}:${sshConfig.port || 22}${usingProxy ? ' (通过代理)' : ''}`;
      } else if (err.message.includes('getaddrinfo ENOTFOUND')) {
        errorMessage = `主机不存在: 无法解析主机名 ${sshConfig.host}`;
      }
    }

    this._logError(`SSH连接错误: ${connectionKey}`, new Error(errorMessage));

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
      proxyType: usingProxy ? resolvedProxyConfig.type : null,
      isProxyError: isProxyError
    };

    return enhancedError;
  }

  /**
   * 处理SSH连接关闭事件
   * @param {Object} connectionInfo - 连接信息对象
   * @param {string} connectionKey - 连接键
   * @private
   */
  _handleSSHClose(connectionInfo, connectionKey) {
    this._logInfo(`SSH连接关闭: ${connectionKey}`);

    // 如果连接意外关闭且还有引用，触发自动重连
    if (connectionInfo.refCount > 0 && !connectionInfo.intentionalClose) {
      this._logInfo(`检测到意外断开，触发自动重连: ${connectionKey}`);
      // 重连管理器会自动处理重连
    }

    this.connections.delete(connectionKey);
  }
}

module.exports = SSHConnectionPool;
