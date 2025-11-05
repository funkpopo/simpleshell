const Telnet = require("telnet-client");
const { logToFile } = require("../../core/utils/logger");
const BaseConnectionPool = require("./base-connection-pool");

const CONNECTION_TIMEOUT = 15 * 1000;

class TelnetConnectionPool extends BaseConnectionPool {
  onInitialize() {
    logToFile("Telnet连接池已初始化", "INFO");
  }

  onCleanup() {
    logToFile("Telnet连接池已清理", "INFO");
  }

  onConnectionReused(connectionKey) {
    logToFile(`复用现有Telnet连接: ${connectionKey}`, "INFO");
  }

  generateConnectionKey(config) {
    if (config.tabId) {
      return `telnet:${config.host}:${config.port || 23}:${config.tabId}`;
    }
    return `telnet:${config.host}:${config.port || 23}`;
  }

  async createConnection(telnetConfig, connectionKey) {
    logToFile(`创建新Telnet连接: ${connectionKey}`, "INFO");

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
        listeners: new Set(),
      };

      const params = {
        host: telnetConfig.host,
        port: telnetConfig.port || 23,
        negotiationMandatory: false,
        timeout: CONNECTION_TIMEOUT,
        username: telnetConfig.username,
        password: telnetConfig.password,
        passwordPrompt: /Password:|密码:/i,
        loginPrompt: /login:|用户名:/i,
        shellPrompt: /#|\$|>|\%/,
      };

      telnet.on("error", (err) => {
        logToFile(`Telnet连接错误: ${connectionKey} - ${err.message}`, "ERROR");
        this.connections.delete(connectionKey);

        const enhancedError = new Error(`Telnet连接错误: ${err.message}`);
        enhancedError.originalError = err;
        enhancedError.connectionKey = connectionKey;
        enhancedError.telnetConfig = {
          host: telnetConfig.host,
          port: telnetConfig.port || 23,
          username: telnetConfig.username,
          hasPassword: !!telnetConfig.password,
        };

        reject(enhancedError);
      });

      telnet
        .connect(params)
        .then(() => {
          connectionInfo.ready = true;
          this.connections.set(connectionKey, connectionInfo);
          logToFile(`Telnet连接建立成功: ${connectionKey}`, "INFO");
          resolve(connectionInfo);
        })
        .catch((err) => {
          logToFile(`Telnet连接失败: ${connectionKey} - ${err.message}`, "ERROR");

          const enhancedError = new Error(`Telnet连接失败: ${err.message}`);
          enhancedError.originalError = err;
          enhancedError.connectionKey = connectionKey;
          enhancedError.telnetConfig = {
            host: telnetConfig.host,
            port: telnetConfig.port || 23,
            username: telnetConfig.username,
            hasPassword: !!telnetConfig.password,
          };

          reject(enhancedError);
        });
    });
  }

  doCloseConnection(connectionInfo, connectionKey) {
    try {
      if (connectionInfo.client) {
        connectionInfo.client.end();
        logToFile(`关闭Telnet连接: ${connectionKey}`, "INFO");
      }
    } catch (error) {
      logToFile(`关闭Telnet连接时出错: ${connectionKey} - ${error.message}`, "ERROR");
    }
  }

  isConnectionHealthy(connectionInfo) {
    return connectionInfo && connectionInfo.client && connectionInfo.ready;
  }

  getStatus() {
    const status = super.getStatus();
    status.tabReferences = this.tabReferences.size;
    return status;
  }

  getDetailedStats() {
    const stats = super.getDetailedStats();
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
    stats.connections = connections;
    stats.tabReferences = tabRefs;
    return stats;
  }
}

const telnetConnectionPool = new TelnetConnectionPool();

module.exports = telnetConnectionPool;
