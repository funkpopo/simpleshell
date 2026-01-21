/**
 * SSH连接池 - 简化版
 * 合并了 ssh-connection-pool.js 和旧 ssh-pool.js 的优点
 * 基于 BaseConnectionPool，提供简洁高效的SSH连接管理
 */

const BaseConnectionPool = require('./base-connection-pool');
const Client = require('ssh2').Client;
const { getBasicSSHAlgorithms } = require('../../constants/sshAlgorithms');
const proxyManager = require('../proxy/proxy-manager');
const { createChannelPoolManager } = require('../utils/ssh-utils');
const ReconnectionManager = require('./reconnection-manager');

// 代理类型常量
const PROXY_TYPES = {
  HTTP: 'http',
  HTTPS: 'https',
  SOCKS4: 'socks4',
  SOCKS5: 'socks5',
  NONE: 'none'
};

/**
 * SSH连接池类
 */
class SSHPool extends BaseConnectionPool {
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

    // SSH特有的属性
    this.proxyManager = null;

    // 简化的请求队列（移除了复杂的路由和负载均衡）
    this.requestQueue = [];
    this.isProcessingQueue = false;

    // 为每个连接初始化通道管理器
    this.channelManagers = new Map();

    // 初始化重连管理器
    this.reconnectionManager = new ReconnectionManager();
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
    this.reconnectionManager.initialize();
    this._setupReconnectionEvents();

    // 调用父类初始化
    super.initialize();
  }

  /**
   * 设置重连管理器事件监听
   * @private
   */
  _setupReconnectionEvents() {
    // 监听重连成功事件，更新连接池中的连接
    this.reconnectionManager.on('connectionReplaced', ({ sessionId, newConnection }) => {
      this._logInfo(`重连成功，更新连接: ${sessionId}`);
      const conn = this.connections.get(sessionId);
      if (conn) {
        conn.client = newConnection;
        conn.ready = true;
        conn.lastUsed = Date.now();
        this.emit('connectionReconnected', { key: sessionId, connection: conn });
      }
    });

    // 监听重连放弃事件
    this.reconnectionManager.on('reconnectAbandoned', ({ sessionId, reason }) => {
      this._logInfo(`重连放弃: ${sessionId} - ${reason}`);
      // 从连接池中移除
      this.connections.delete(sessionId);
      this.emit('connectionAbandoned', { key: sessionId, reason });
    });
  }

  /**
   * 清理SSH连接池资源
   */
  cleanup() {
    // 拒绝所有等待中的请求
    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      if (request && request.reject) {
        request.reject(new Error('连接池正在关闭'));
      }
    }

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
   * 获取或创建SSH连接（增强版，支持队列）
   * @param {Object} sshConfig - SSH连接配置
   * @param {Object} options - 可选参数
   * @returns {Promise<Object>} 连接信息对象
   */
  async getConnection(sshConfig, options = {}) {
    try {
      // 先尝试使用父类方法获取连接
      return await super.getConnection(sshConfig);
    } catch (error) {
      // 如果连接池已满，加入队列等待
      if (error.message.includes('连接池已满')) {
        this._logInfo(`连接池已满，加入等待队列`);
        return await this.queueConnectionRequest(sshConfig, options);
      }
      throw error;
    }
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
    const resolvedProxyConfig = await this.proxyManager.resolveProxyConfigAsync(sshConfig);
    const usingProxy =
      this._isProxyConfigValid(resolvedProxyConfig) &&
      String(resolvedProxyConfig.type || '').toLowerCase() !== PROXY_TYPES.NONE;

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
        usingProxy: usingProxy,
        proxySocket: null,
        channelManager: createChannelPoolManager(30) // 最多30个并发通道
      };

      // 设置连接超时
      const timeout = setTimeout(() => {
        this._logInfo(`SSH连接超时: ${connectionKey}`);
        try {
          if (connectionInfo.proxySocket) connectionInfo.proxySocket.destroy();
        } catch (_) {}
        try {
          ssh.end();
        } catch (_) {}
        reject(new Error(`连接超时: ${sshConfig.host}:${sshConfig.port || 22}`));
      }, this.config.connectionTimeout);

      // 监听就绪事件
      ssh.on('ready', () => {
        clearTimeout(timeout);
        connectionInfo.ready = true;
        this.connections.set(connectionKey, connectionInfo);

        this._logInfo(
          `SSH连接建立成功: ${connectionKey}${usingProxy ? ' (通过代理)' : ''}`
        );

        this.emit('connectionCreated', { key: connectionKey, connection: connectionInfo });
        resolve(connectionInfo);

        // 处理等待队列
        this.processRequestQueue();
      });

      // 监听错误事件
      ssh.on('error', (err) => {
        clearTimeout(timeout);
        try {
          if (connectionInfo.proxySocket) connectionInfo.proxySocket.destroy();
        } catch (_) {}

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
      const connectionOptions = this._buildSSHOptions(sshConfig);

      // 关键：ssh2 不支持 options.proxy，必须传入已建立好的代理隧道 socket（sock）
      if (usingProxy) {
        (async () => {
          try {
            const targetPort = sshConfig.port || 22;
            const sock = await this.proxyManager.createTunnelSocket(
              resolvedProxyConfig,
              sshConfig.host,
              targetPort,
              { timeoutMs: this.config.connectionTimeout }
            );
            connectionInfo.proxySocket = sock;
            connectionOptions.sock = sock;
            ssh.connect(connectionOptions);
          } catch (e) {
            clearTimeout(timeout);
            try {
              if (connectionInfo.proxySocket) connectionInfo.proxySocket.destroy();
            } catch (_) {}
            reject(e);
          }
        })();
      } else {
        ssh.connect(connectionOptions);
      }
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
   * 关闭SSH连接（覆盖父类方法以标记有意关闭）
   * @param {string} key - 连接键
   */
  closeConnection(key) {
    const conn = this.connections.get(key);

    if (conn) {
      // 标记为有意关闭，避免触发重连
      conn.intentionalClose = true;
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
      proxyConnections: proxyConns,
      queueLength: this.requestQueue.length
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
   * 根据标签页ID获取连接键
   * @param {string} tabId - 标签页ID
   * @returns {string|null} 连接键
   */
  getConnectionKeyByTabId(tabId) {
    if (!tabId) return null;

    // 先从标签页引用中查找
    const key = this.tabReferences.get(tabId);
    if (key) return key;

    // 直接通过连接键前缀查找（向后兼容）
    const tabPrefix = `tab:${tabId}:`;
    for (const [connectionKey] of this.connections.entries()) {
      if (connectionKey.startsWith(tabPrefix)) {
        return connectionKey;
      }
    }

    return null;
  }

  /**
   * 获取连接状态
   * @param {string} connectionKey - 连接键
   * @returns {Object|null} 连接状态
   */
  getConnectionStatus(connectionKey) {
    const conn = this.connections.get(connectionKey);
    if (!conn) return null;

    // 获取重连状态
    const reconnectStatus = this.reconnectionManager.getSessionStatus(connectionKey);

    return {
      key: connectionKey,
      ready: conn.ready,
      refCount: conn.refCount,
      createdAt: conn.createdAt,
      lastUsed: conn.lastUsed,
      reconnectStatus
    };
  }

  /**
   * 将连接请求加入队列
   * @param {Object} sshConfig - SSH连接配置
   * @param {Object} options - 可选参数
   * @returns {Promise<Object>} 连接信息对象
   */
  async queueConnectionRequest(sshConfig, options = {}) {
    return new Promise((resolve, reject) => {
      const request = {
        sshConfig,
        options,
        resolve,
        reject,
        timestamp: Date.now(),
      };

      this.requestQueue.push(request);
      this.processRequestQueue();
    });
  }

  /**
   * 处理请求队列
   */
  async processRequestQueue() {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }

    // 检查是否有可用的连接槽位
    if (this.connections.size >= this.config.maxConnections) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      while (this.requestQueue.length > 0 && this.connections.size < this.config.maxConnections) {
        const request = this.requestQueue.shift();

        try {
          const connection = await super.getConnection(request.sshConfig);
          request.resolve(connection);
        } catch (error) {
          request.reject(error);
        }

        // 避免阻塞事件循环
        await new Promise((resolve) => setImmediate(resolve));
      }
    } finally {
      this.isProcessingQueue = false;
    }
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
      case PROXY_TYPES.HTTPS:
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
  _buildSSHOptions(sshConfig) {
    const { processSSHPrivateKey } = require('../utils/ssh-utils');
    const processedConfig = processSSHPrivateKey(sshConfig);

    const options = {
      host: sshConfig.host,
      port: sshConfig.port || 22,
      username: sshConfig.username,
      algorithms: getBasicSSHAlgorithms(),
      keepaliveInterval: 15000,
      keepaliveCountMax: 6,
      // 增加通道管理配置以支持更多并发操作
      readyTimeout: 20000, // 连接就绪超时
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

    // 提取简洁的错误信息（去除嵌套的错误前缀）
    const extractCleanError = (msg) => {
      // 移除嵌套的 "Unhandled error" 包装
      if (msg.includes('Unhandled error. ({')) {
        const match = msg.match(/message: '([^']+)'/);
        if (match) return match[1];
      }
      // 移除重复的 "SSH连接错误:" 或 "SSH认证失败:" 前缀
      const patterns = [
        /^SSH连接错误:\s*/,
        /^SSH认证失败:\s*/,
        /^代理连接失败:\s*/
      ];
      let cleaned = msg;
      for (const pattern of patterns) {
        cleaned = cleaned.replace(pattern, '');
      }
      return cleaned;
    };

    errorMessage = extractCleanError(errorMessage);

    // 检测代理相关错误
    if (usingProxy) {
      if (
        errorMessage.includes('proxy') ||
        errorMessage.includes('socket') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('timeout')
      ) {
        errorMessage = `代理连接失败: ${errorMessage}. 请检查代理配置或代理状态`;
        isProxyError = true;
      }
    }

    // 检测常见SSH错误
    if (!isProxyError) {
      if (errorMessage.includes('All configured authentication methods failed')) {
        errorMessage = `SSH认证失败: 所有认证方式均失败，请检查用户名、密码或私钥文件`;

        // 如果配置了私钥路径但没有私钥内容，提供具体提示
        if (sshConfig.privateKeyPath && !processedConfig.privateKey) {
          errorMessage += `. 私钥文件路径 ${sshConfig.privateKeyPath} 可能无法读取`;
        }
      } else if (errorMessage.includes('connect ECONNREFUSED')) {
        errorMessage = `连接被拒绝: 无法连接到 ${sshConfig.host}:${sshConfig.port || 22}${usingProxy ? ' (通过代理)' : ''}`;
      } else if (errorMessage.includes('getaddrinfo ENOTFOUND')) {
        errorMessage = `主机不存在: 无法解析主机名 ${sshConfig.host}`;
      } else if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('timeout')) {
        errorMessage = `连接超时: ${sshConfig.host}:${sshConfig.port || 22}`;
      }
    }

    // 日志中记录详细信息（包含connectionKey），但不影响用户看到的错误
    this._logInfo(`SSH连接错误详情: ${connectionKey} - ${errorMessage}`);

    // 创建增强的错误对象（使用简洁的错误消息，不包含技术细节）
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

    // 如果是有意关闭，直接清理
    if (connectionInfo.intentionalClose) {
      this._logInfo(`有意关闭连接: ${connectionKey}`);
      try {
        if (connectionInfo.proxySocket) connectionInfo.proxySocket.destroy();
      } catch (_) {}
      this.connections.delete(connectionKey);
      this.processRequestQueue();
      return;
    }

    // 如果连接意外关闭且还有引用，尝试重连
    if (connectionInfo.refCount > 0 || this.isConnectionReferencedByTabs(connectionKey)) {
      this._logInfo(`检测到意外断开，尝试重连: ${connectionKey}`);

      // 注册到重连管理器
      this.reconnectionManager.registerSession(
        connectionKey,
        connectionInfo.client,
        connectionInfo.config,
        { state: 'pending', autoStart: true, failureReason: 'network' }
      );

      // 发出连接丢失事件
      this.emit('connectionLost', { key: connectionKey, connection: connectionInfo });
    } else {
      // 没有引用的连接直接清理
      this.connections.delete(connectionKey);
    }

    // 处理等待队列
    this.processRequestQueue();
  }

  /**
   * 关闭连接池
   */
  async shutdown() {
    this._logInfo('开始关闭SSH连接池...');

    // 拒绝所有等待中的请求
    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      if (request && request.reject) {
        request.reject(new Error('连接池正在关闭'));
      }
    }

    // 调用父类cleanup
    this.cleanup();

    this._logInfo('SSH连接池已关闭');
  }
}

module.exports = SSHPool;
