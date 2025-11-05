const EventEmitter = require("events");
const { logToFile } = require("../../core/utils/logger");

const MAX_CONNECTIONS = 50;
const IDLE_TIMEOUT = 30 * 60 * 1000;
const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000;

class BaseConnectionPool extends EventEmitter {
  constructor(maxConnections = MAX_CONNECTIONS) {
    super();
    this.maxConnections = maxConnections;
    this.connections = new Map();
    this.connectionQueue = new Map();
    this.tabReferences = new Map();
    this.healthCheckTimer = null;
    this.isInitialized = false;
    this.connectionUsage = new Map();
    this.lastConnections = [];
  }

  initialize() {
    if (this.isInitialized) return;
    this.startHealthCheck();
    this.isInitialized = true;
    this.onInitialize();
  }

  cleanup() {
    this.stopHealthCheck();
    for (const [key] of this.connections) {
      this.closeConnection(key);
    }
    this.connections.clear();
    this.connectionQueue.clear();
    this.tabReferences.clear();
    this.isInitialized = false;
    this.onCleanup();
  }

  generateConnectionKey(config) {
    throw new Error("generateConnectionKey must be implemented");
  }

  recordConnectionUsage(connectionId) {
    if (!connectionId) return;
    const currentCount = this.connectionUsage.get(connectionId) || 0;
    this.connectionUsage.set(connectionId, currentCount + 1);
    this.recordLastConnection(connectionId);
  }

  recordLastConnection(connectionId) {
    if (!connectionId) return;
    const index = this.lastConnections.indexOf(connectionId);
    if (index > -1) this.lastConnections.splice(index, 1);
    this.lastConnections.unshift(connectionId);
    if (this.lastConnections.length > 10) {
      this.lastConnections = this.lastConnections.slice(0, 10);
    }
  }

  getLastConnections(count = 5) {
    return this.lastConnections.slice(0, count);
  }

  setLastConnections(connections) {
    if (Array.isArray(connections)) {
      this.lastConnections = connections.slice(0, 10);
    }
  }

  getTopConnections(count = 5) {
    if (this.connectionUsage.size === 0) return [];
    const sorted = [...this.connectionUsage.entries()].sort((a, b) => b[1] - a[1]);
    return sorted.slice(0, count).map((entry) => entry[0]);
  }

  async getConnection(config) {
    const connectionKey = this.generateConnectionKey(config);
    this.recordConnectionUsage(config.id);

    if (this.connections.has(connectionKey)) {
      const connectionInfo = this.connections.get(connectionKey);
      if (this.isConnectionHealthy(connectionInfo)) {
        connectionInfo.lastUsed = Date.now();
        connectionInfo.refCount++;
        this.onConnectionReused(connectionKey);
        return connectionInfo;
      } else {
        await this.handleUnhealthyConnection(connectionKey, connectionInfo, config);
      }
    }

    if (this.connections.size >= this.maxConnections) {
      const cleaned = this.cleanupIdleConnections(1);
      if (!cleaned) {
        throw new Error(`连接池已满，最大连接数: ${this.maxConnections}`);
      }
    }

    return await this.createConnection(config, connectionKey);
  }

  async createConnection(config, connectionKey) {
    throw new Error("createConnection must be implemented");
  }

  async handleUnhealthyConnection(connectionKey, connectionInfo, config) {
    this.closeConnection(connectionKey);
  }

  releaseConnection(connectionKey, tabId = null) {
    const connectionInfo = this.connections.get(connectionKey);
    if (connectionInfo) {
      connectionInfo.refCount = Math.max(0, connectionInfo.refCount - 1);
      connectionInfo.lastUsed = Date.now();
      if (tabId && this.tabReferences.has(tabId)) {
        this.tabReferences.delete(tabId);
      }
      if (connectionInfo.refCount === 0 && !this.isConnectionReferencedByTabs(connectionKey)) {
        this.closeConnection(connectionKey);
      }
    }
  }

  addTabReference(tabId, connectionKey) {
    this.tabReferences.set(tabId, connectionKey);
  }

  isConnectionReferencedByTabs(connectionKey) {
    for (const [, connKey] of this.tabReferences) {
      if (connKey === connectionKey) return true;
    }
    return false;
  }

  getConnectionByTabId(tabId) {
    if (!tabId) return null;
    if (this.tabReferences.has(tabId)) {
      const connectionKey = this.tabReferences.get(tabId);
      if (this.connections.has(connectionKey)) {
        return this.connections.get(connectionKey);
      }
    }
    const tabPrefix = `tab:${tabId}:`;
    for (const [key, connection] of this.connections.entries()) {
      if (key.startsWith(tabPrefix)) return connection;
    }
    return null;
  }

  closeConnection(connectionKey) {
    const connectionInfo = this.connections.get(connectionKey);
    if (connectionInfo) {
      this.doCloseConnection(connectionInfo, connectionKey);
      this.connections.delete(connectionKey);
    }
  }

  doCloseConnection(connectionInfo, connectionKey) {
    throw new Error("doCloseConnection must be implemented");
  }

  isConnectionHealthy(connectionInfo) {
    throw new Error("isConnectionHealthy must be implemented");
  }

  cleanupIdleConnections(count = 1) {
    const now = Date.now();
    const idleConnections = [];
    for (const [key, connectionInfo] of this.connections) {
      const hasTabReference = this.isConnectionReferencedByTabs(key);
      const isIdle = connectionInfo.refCount === 0 && !hasTabReference && now - connectionInfo.lastUsed > IDLE_TIMEOUT;
      if (isIdle) {
        idleConnections.push({ key, lastUsed: connectionInfo.lastUsed });
      }
    }
    idleConnections.sort((a, b) => a.lastUsed - b.lastUsed);
    let cleaned = 0;
    for (let i = 0; i < Math.min(count, idleConnections.length); i++) {
      this.closeConnection(idleConnections[i].key);
      cleaned++;
    }
    return cleaned > 0;
  }

  startHealthCheck() {
    if (this.healthCheckTimer) return;
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, HEALTH_CHECK_INTERVAL);
  }

  stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  performHealthCheck() {
    const now = Date.now();
    const unhealthyConnections = [];
    for (const [key, connectionInfo] of this.connections) {
      if (!this.isConnectionHealthy(connectionInfo)) {
        unhealthyConnections.push(key);
        continue;
      }
      const hasTabReference = this.isConnectionReferencedByTabs(key);
      if (connectionInfo.refCount === 0 && !hasTabReference && now - connectionInfo.lastUsed > IDLE_TIMEOUT) {
        unhealthyConnections.push(key);
      }
    }
    for (const key of unhealthyConnections) {
      this.closeConnection(key);
    }
  }

  getStatus() {
    const activeConnections = this.connections.size;
    const connectionsWithRefs = Array.from(this.connections.values()).filter((conn) => conn.refCount > 0).length;
    const idleConnections = Array.from(this.connections.values()).filter((conn) => conn.refCount === 0).length;
    return {
      activeConnections,
      connectionsWithRefs,
      idleConnections,
      maxConnections: this.maxConnections,
      isInitialized: this.isInitialized,
    };
  }

  getDetailedStats() {
    const now = Date.now();
    const connections = Array.from(this.connections.values());
    return {
      totalConnections: connections.length,
      healthyConnections: connections.filter((conn) => this.isConnectionHealthy(conn)).length,
      connectionsWithRefs: connections.filter((conn) => conn.refCount > 0).length,
      oldestConnection: connections.length > 0 ? Math.min(...connections.map((conn) => conn.createdAt)) : null,
      newestConnection: connections.length > 0 ? Math.max(...connections.map((conn) => conn.createdAt)) : null,
      averageAge: connections.length > 0 ? connections.reduce((sum, conn) => sum + (now - conn.createdAt), 0) / connections.length : 0,
      totalRefCount: connections.reduce((sum, conn) => sum + conn.refCount, 0),
    };
  }

  onInitialize() {}
  onCleanup() {}
  onConnectionReused(connectionKey) {}
}

module.exports = BaseConnectionPool;
