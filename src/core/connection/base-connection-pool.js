/**
 * 基础连接池抽象类
 * 提供通用的连接池管理功能，所有协议特定的连接池都应继承此类
 */

const EventEmitter = require('events');
const { logToFile } = require('../utils/logger');

class BaseConnectionPool extends EventEmitter {
  /**
   * 构造函数
   * @param {Object} config - 连接池配置
   * @param {number} config.maxConnections - 最大连接数
   * @param {number} config.idleTimeout - 空闲超时时间（毫秒）
   * @param {number} config.healthCheckInterval - 健康检查间隔（毫秒）
   * @param {number} config.connectionTimeout - 连接超时时间（毫秒）
   * @param {string} config.protocolType - 协议类型（SSH、Telnet等）
   */
  constructor(config = {}) {
    super();

    this.config = {
      maxConnections: config.maxConnections || 50,
      idleTimeout: config.idleTimeout || 30 * 60 * 1000, // 30分钟
      healthCheckInterval: config.healthCheckInterval || 5 * 60 * 1000, // 5分钟
      connectionTimeout: config.connectionTimeout || 15 * 1000, // 15秒
      protocolType: config.protocolType || 'UNKNOWN',
      ...config
    };

    // 通用数据结构
    this.connections = new Map(); // 所有活跃连接
    this.connectionQueue = new Map(); // 连接请求队列
    this.tabReferences = new Map(); // 标签页引用关系
    this.connectionUsage = new Map(); // 连接使用统计
    this.lastConnections = []; // 最近连接列表（存储连接ID）
    this.lastConnectionConfigs = new Map(); // 最近连接的配置缓存

    // 定时器
    this.healthCheckTimer = null;

    // 初始化状态
    this.isInitialized = false;
  }

  /**
   * 初始化连接池
   * 子类可以覆盖此方法以添加特定初始化逻辑
   */
  initialize() {
    if (this.isInitialized) {
      this._logInfo(`${this.config.protocolType}连接池已经初始化`);
      return;
    }

    this._logInfo(`初始化${this.config.protocolType}连接池...`);

    // 启动健康检查
    this.startHealthCheck();

    this.isInitialized = true;
    this.emit('initialized');

    this._logInfo(`${this.config.protocolType}连接池初始化完成`);
  }

  /**
   * 清理连接池资源
   */
  cleanup() {
    this._logInfo(`清理${this.config.protocolType}连接池资源...`);

    // 停止健康检查
    this.stopHealthCheck();

    // 关闭所有连接
    for (const key of this.connections.keys()) {
      this.closeConnection(key);
    }

    // 清理数据结构
    this.connections.clear();
    this.connectionQueue.clear();
    this.tabReferences.clear();

    this.isInitialized = false;
    this.emit('cleanup');

    this._logInfo(`${this.config.protocolType}连接池资源清理完成`);
  }

  /**
   * 获取或创建连接
   * @param {Object} config - 连接配置
   * @returns {Promise<Object>} 连接信息对象
   */
  async getConnection(config) {
    const key = this.generateConnectionKey(config);

    this._logInfo(`获取连接: ${key}`);

    // 记录连接使用 - 使用 serverKey 而不是 config.id
    const serverKey = this.generateServerKey(config);
    this.recordConnectionUsage(serverKey);

    // 缓存连接配置，用于后续获取详细信息
    this.lastConnectionConfigs.set(serverKey, {
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password || '',
      privateKeyPath: config.privateKeyPath || '',
      // 关键：保留代理配置，避免“最近连接/快捷连接”丢失 proxy 导致退化为直连
      proxy: config.proxy || null,
      name: config.name || `${config.host}:${config.port}`,
      protocol: this.config.protocolType.toLowerCase()
    });

    // 检查是否存在现有连接
    if (this.connections.has(key)) {
      const conn = this.connections.get(key);

      if (this.isConnectionHealthy(conn)) {
        this._logInfo(`复用现有连接: ${key}`);
        return this._reuseConnection(conn);
      } else {
        this._logInfo(`连接不健康，尝试处理: ${key}`);
        await this._handleUnhealthyConnection(conn, config);
      }
    }

    // 检查连接数限制
    if (this.connections.size >= this.config.maxConnections) {
      this._logInfo(`连接池已满（${this.connections.size}/${this.config.maxConnections}），尝试清理空闲连接`);
      const cleaned = this.cleanupIdleConnections(1);

      if (!cleaned) {
        const error = new Error(`连接池已满，最大连接数: ${this.config.maxConnections}`);
        this._logError('连接池已满', error);
        throw error;
      }
    }

    // 创建新连接（调用子类实现）
    this._logInfo(`创建新连接: ${key}`);
    return await this.createConnection(config, key);
  }

  /**
   * 创建新连接（抽象方法，必须由子类实现）
   * @param {Object} config - 连接配置
   * @param {string} key - 连接键
   * @returns {Promise<Object>} 连接信息对象
   */
  async createConnection(config, key) {
    throw new Error('createConnection() 必须由子类实现');
  }

  /**
   * 生成连接键（抽象方法，必须由子类实现）
   * @param {Object} config - 连接配置
   * @returns {string} 连接键
   */
  generateConnectionKey(config) {
    throw new Error('generateConnectionKey() 必须由子类实现');
  }

  /**
   * 检查连接是否健康（抽象方法，必须由子类实现）
   * @param {Object} connectionInfo - 连接信息对象
   * @returns {boolean} 是否健康
   */
  isConnectionHealthy(connectionInfo) {
    throw new Error('isConnectionHealthy() 必须由子类实现');
  }

  /**
   * 释放连接
   * @param {string} key - 连接键
   * @param {string|null} tabId - 标签页ID
   */
  releaseConnection(key, tabId = null) {
    const conn = this.connections.get(key);

    if (!conn) {
      this._logInfo(`尝试释放不存在的连接: ${key}`);
      return;
    }

    // 减少引用计数
    conn.refCount = Math.max(0, conn.refCount - 1);
    conn.lastUsed = Date.now();

    this._logInfo(`释放连接: ${key}, 当前引用计数: ${conn.refCount}`);

    // 删除标签页引用
    if (tabId && this.tabReferences.has(tabId)) {
      this.tabReferences.delete(tabId);
      this._logInfo(`删除标签页引用: ${tabId} -> ${key}`);
    }

    // 如果没有引用且没有标签页关联，关闭连接
    if (conn.refCount === 0 && !this.isConnectionReferencedByTabs(key)) {
      this._logInfo(`连接无引用，准备关闭: ${key}`);
      this.closeConnection(key);
    }

    this.emit('connectionReleased', { key, refCount: conn.refCount });
  }

  /**
   * 关闭连接
   * @param {string} key - 连接键
   */
  closeConnection(key) {
    const conn = this.connections.get(key);

    if (!conn) {
      this._logInfo(`尝试关闭不存在的连接: ${key}`);
      return;
    }

    this._logInfo(`关闭连接: ${key}`);

    // 标记为有意关闭，避免触发重连
    conn.intentionalClose = true;

    // 先从连接池中删除，避免重复关闭
    this.connections.delete(key);

    // 清理监听器
    if (conn.listeners && conn.listeners.size > 0) {
      conn.listeners.clear();
    }

    try {
      // 优先使用 end() 方法发送正确的断开信号
      // end() 会发送 SSH_MSG_DISCONNECT 消息给服务器
      if (conn.client && typeof conn.client.end === 'function') {
        conn.client.end();
        // 设置超时，如果 end() 没有在合理时间内完成，强制销毁
        setTimeout(() => {
          if (conn.client && !conn.client.destroyed && typeof conn.client.destroy === 'function') {
            this._logInfo(`连接 ${key} 的 end() 超时，强制销毁`);
            conn.client.destroy();
          }
        }, 3000);
      } else if (conn.client && typeof conn.client.destroy === 'function') {
        // 如果没有 end() 方法，直接销毁
        conn.client.destroy();
      }
    } catch (error) {
      this._logError(`关闭连接时出错: ${key}`, error);
      // 出错时尝试强制销毁
      try {
        if (conn.client && typeof conn.client.destroy === 'function') {
          conn.client.destroy();
        }
      } catch (_) {
        // 忽略销毁时的错误
      }
    }

    this.emit('connectionClosed', { key, connection: conn });
  }

  /**
   * 添加标签页引用
   * @param {string} tabId - 标签页ID
   * @param {string} key - 连接键
   */
  addTabReference(tabId, key) {
    this.tabReferences.set(tabId, key);
    this._logInfo(`添加标签页引用: ${tabId} -> ${key}`);
    this.emit('tabReferenceAdded', { tabId, key });
  }

  /**
   * 检查连接是否被标签页引用
   * @param {string} key - 连接键
   * @returns {boolean} 是否被引用
   */
  isConnectionReferencedByTabs(key) {
    for (const [tabId, connKey] of this.tabReferences) {
      if (connKey === key) {
        return true;
      }
    }
    return false;
  }

  /**
   * 根据标签页ID获取连接
   * @param {string} tabId - 标签页ID
   * @returns {Object|null} 连接信息对象
   */
  getConnectionByTabId(tabId) {
    const key = this.tabReferences.get(tabId);
    return key ? this.connections.get(key) : null;
  }

  /**
   * 移除标签页引用
   * @param {string} tabId - 标签页ID
   */
  removeTabReference(tabId) {
    const key = this.tabReferences.get(tabId);
    if (key) {
      this.tabReferences.delete(tabId);
      this._logInfo(`移除标签页引用: ${tabId} -> ${key}`);
      this.emit('tabReferenceRemoved', { tabId, key });

      // 检查连接是否还有其他引用
      const conn = this.connections.get(key);
      if (conn && conn.refCount === 0 && !this.isConnectionReferencedByTabs(key)) {
        this.closeConnection(key);
      }
    }
  }

  /**
   * 启动健康检查
   */
  startHealthCheck() {
    if (this.healthCheckTimer) {
      this._logInfo('健康检查已经在运行');
      return;
    }

    this._logInfo(`启动健康检查，间隔: ${this.config.healthCheckInterval}ms`);

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);

    this.emit('healthCheckStarted');
  }

  /**
   * 停止健康检查
   */
  stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
      this._logInfo('健康检查已停止');
      this.emit('healthCheckStopped');
    }
  }

  /**
   * 执行健康检查
   */
  performHealthCheck() {
    const now = Date.now();
    const unhealthy = [];

    this._logInfo(`执行健康检查，当前连接数: ${this.connections.size}`);

    for (const [key, conn] of this.connections) {
      // 检查连接健康状态
      if (!this.isConnectionHealthy(conn)) {
        this._logInfo(`发现不健康的连接: ${key}`);
        unhealthy.push(key);
      }
      // 检查空闲超时
      else if (
        conn.refCount === 0 &&
        !this.isConnectionReferencedByTabs(key) &&
        now - conn.lastUsed > this.config.idleTimeout
      ) {
        this._logInfo(`发现空闲超时的连接: ${key}, 空闲时间: ${now - conn.lastUsed}ms`);
        unhealthy.push(key);
      }
    }

    // 关闭不健康的连接
    unhealthy.forEach(key => this.closeConnection(key));

    this.emit('healthCheckCompleted', {
      totalConnections: this.connections.size,
      unhealthyCount: unhealthy.length
    });
  }

  /**
   * 清理空闲连接
   * @param {number} count - 要清理的连接数
   * @returns {boolean} 是否清理成功
   */
  cleanupIdleConnections(count = 1) {
    const now = Date.now();
    const idle = [];

    // 查找空闲连接
    for (const [key, conn] of this.connections) {
      if (
        conn.refCount === 0 &&
        !this.isConnectionReferencedByTabs(key) &&
        now - conn.lastUsed > this.config.idleTimeout
      ) {
        idle.push({ key, lastUsed: conn.lastUsed });
      }
    }

    // 按最后使用时间排序（最久未使用的优先）
    idle.sort((a, b) => a.lastUsed - b.lastUsed);

    // 清理指定数量的连接
    let cleaned = 0;
    for (let i = 0; i < Math.min(count, idle.length); i++) {
      this.closeConnection(idle[i].key);
      cleaned++;
    }

    if (cleaned > 0) {
      this._logInfo(`清理了 ${cleaned} 个空闲连接`);
      this.emit('idleConnectionsCleaned', { count: cleaned });
    }

    return cleaned > 0;
  }

  /**
   * 记录连接使用
   * @param {string} connectionId - 连接ID
   */
  recordConnectionUsage(connectionId) {
    if (!connectionId) return;

    const count = this.connectionUsage.get(connectionId) || 0;
    this.connectionUsage.set(connectionId, count + 1);

    this.recordLastConnection(connectionId);
  }

  /**
   * 记录最近连接
   * @param {string} connectionId - 连接ID
   */
  recordLastConnection(connectionId) {
    if (!connectionId) return;

    // 如果已存在，先删除
    const index = this.lastConnections.indexOf(connectionId);
    if (index > -1) {
      this.lastConnections.splice(index, 1);
    }

    // 添加到开头
    this.lastConnections.unshift(connectionId);

    // 保持列表长度不超过10
    if (this.lastConnections.length > 10) {
      this.lastConnections = this.lastConnections.slice(0, 10);
    }
  }

  /**
   * 获取最近连接列表（带详细信息）
   * @param {number} count - 返回数量
   * @returns {Array<Object>} 连接配置对象列表
   */
  getLastConnectionsWithDetails(count = 5) {
    const result = [];

    for (const serverKey of this.lastConnections.slice(0, count)) {
      // 优先从缓存中获取配置
      const cachedConfig = this.lastConnectionConfigs.get(serverKey);

      if (cachedConfig) {
        result.push({
          id: serverKey,
          name: cachedConfig.name,
          type: 'connection',
          protocol: cachedConfig.protocol,
          host: cachedConfig.host,
          port: cachedConfig.port,
          username: cachedConfig.username,
          password: cachedConfig.password,
          privateKeyPath: cachedConfig.privateKeyPath,
          proxy: cachedConfig.proxy || null,
          lastUsed: Date.now()
        });
      } else {
        // 如果缓存中没有，尝试从活跃连接中获取
        const conn = this.connections.get(serverKey);
        if (conn && conn.config) {
          result.push({
            id: serverKey,
            name: conn.config.name || `${conn.config.host}:${conn.config.port}`,
            type: 'connection',
            protocol: this.config.protocolType.toLowerCase(),
            host: conn.config.host,
            port: conn.config.port,
            username: conn.config.username,
            password: conn.config.password || '',
            privateKeyPath: conn.config.privateKeyPath || '',
            proxy: conn.config.proxy || null,
            lastUsed: conn.lastUsedAt || conn.createdAt
          });
        }
      }
    }

    return result;
  }

  /**
   * 从配置加载最近连接列表
   * @param {Array<Object>} connections - 连接配置对象列表
   */
  loadLastConnectionsFromConfig(connections) {
    if (!Array.isArray(connections)) return;

    // 只保存连接ID，不创建实际连接
    // 实际连接会在用户点击时创建
    this.lastConnections = [];

    // 同时缓存连接配置，以便后续使用
    if (!this.lastConnectionConfigs) {
      this.lastConnectionConfigs = new Map();
    }

    for (const conn of connections) {
      if (conn.host && conn.username) {
        const key = this.generateServerKey(conn);
        this.lastConnections.push(key);

        // 缓存连接配置
        this.lastConnectionConfigs.set(key, {
          host: conn.host,
          port: conn.port,
          username: conn.username,
          password: conn.password || '',
          privateKeyPath: conn.privateKeyPath || '',
          proxy: conn.proxy || null,
          name: conn.name || `${conn.host}:${conn.port}`,
          protocol: conn.protocol || this.config.protocolType.toLowerCase()
        });
      }
    }

    // 限制为最多10个
    this.lastConnections = this.lastConnections.slice(0, 10);

    this._logInfo(`从配置加载了 ${this.lastConnections.length} 个最近连接`);
  }

  /**
   * 获取最近连接列表
   * @param {number} count - 返回数量
   * @returns {Array<string>} 连接ID列表
   */
  getLastConnections(count = 5) {
    return this.lastConnections.slice(0, count);
  }

  /**
   * 设置最近连接列表
   * @param {Array<string>} connections - 连接ID列表
   */
  setLastConnections(connections) {
    if (Array.isArray(connections)) {
      this.lastConnections = connections.slice(0, 10);
    }
  }

  /**
   * 获取最常用的连接列表
   * @param {number} count - 返回数量
   * @returns {Array<string>} 连接ID列表
   */
  getTopConnections(count = 5) {
    if (this.connectionUsage.size === 0) return [];

    return [...this.connectionUsage.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(entry => entry[0]);
  }

  /**
   * 获取连接池状态
   * @returns {Object} 状态信息
   */
  getStatus() {
    const active = this.connections.size;
    const withRefs = Array.from(this.connections.values())
      .filter(c => c.refCount > 0).length;
    const idle = Array.from(this.connections.values())
      .filter(c => c.refCount === 0).length;

    return {
      protocolType: this.config.protocolType,
      activeConnections: active,
      connectionsWithRefs: withRefs,
      idleConnections: idle,
      maxConnections: this.config.maxConnections,
      isInitialized: this.isInitialized,
      tabReferences: this.tabReferences.size,
      connectionDetails: this._getConnectionDetails()
    };
  }

  /**
   * 获取详细统计信息
   * @returns {Object} 统计信息
   */
  getDetailedStats() {
    const now = Date.now();
    const conns = Array.from(this.connections.values());

    const stats = {
      protocolType: this.config.protocolType,
      totalConnections: conns.length,
      healthyConnections: conns.filter(c => this.isConnectionHealthy(c)).length,
      connectionsWithRefs: conns.filter(c => c.refCount > 0).length,
      idleConnections: conns.filter(c => c.refCount === 0).length,
      totalRefCount: conns.reduce((sum, c) => sum + c.refCount, 0),
      oldestConnection: conns.length > 0 ? Math.min(...conns.map(c => c.createdAt)) : null,
      newestConnection: conns.length > 0 ? Math.max(...conns.map(c => c.createdAt)) : null,
      averageAge: conns.length > 0
        ? conns.reduce((sum, c) => sum + (now - c.createdAt), 0) / conns.length
        : 0,
      tabReferences: this.tabReferences.size,
      topConnections: this.getTopConnections(5),
      lastConnections: this.getLastConnections(5)
    };

    return stats;
  }

  /**
   * 复用现有连接
   * @param {Object} conn - 连接信息对象
   * @returns {Object} 连接信息对象
   * @private
   */
  _reuseConnection(conn) {
    conn.lastUsed = Date.now();
    conn.refCount++;
    this.emit('connectionReused', { key: conn.key, refCount: conn.refCount });
    return conn;
  }

  /**
   * 处理不健康的连接
   * @param {Object} conn - 连接信息对象
   * @param {Object} config - 连接配置
   * @private
   */
  async _handleUnhealthyConnection(conn, config) {
    // 默认实现：直接关闭连接
    // 子类可以覆盖此方法以实现重连逻辑
    this._logInfo(`关闭不健康的连接: ${conn.key}`);
    this.closeConnection(conn.key);
  }

  /**
   * 获取连接详细信息列表
   * @returns {Array<Object>} 连接详细信息
   * @private
   */
  _getConnectionDetails() {
    return Array.from(this.connections.entries()).map(([key, conn]) => ({
      key,
      refCount: conn.refCount,
      createdAt: new Date(conn.createdAt).toISOString(),
      lastUsed: new Date(conn.lastUsed).toISOString(),
      ready: conn.ready,
      host: conn.config.host,
      port: conn.config.port
    }));
  }

  /**
   * 生成服务器标识键
   * @param {Object} config - 连接配置
   * @returns {string} 服务器标识键
   * @protected
   */
  generateServerKey(config) {
    return `${config.host}:${config.port || 22}:${config.username}`;
  }

  /**
   * 记录错误日志
   * @param {string} message - 错误消息
   * @param {Error} error - 错误对象
   * @private
   */
  _logError(message, error) {
    const fullMessage = `[${this.config.protocolType}连接池] ${message} - ${error.message}`;
    logToFile(fullMessage, 'ERROR');
    this.emit('error', { message, error });
  }

  /**
   * 记录信息日志
   * @param {string} message - 信息消息
   * @private
   */
  _logInfo(message) {
    const fullMessage = `[${this.config.protocolType}连接池] ${message}`;
    logToFile(fullMessage, 'INFO');
  }
}

module.exports = BaseConnectionPool;
