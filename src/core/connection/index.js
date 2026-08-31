/**
 * 连接池统一导出接口
 * 提供了SSH和Telnet连接池的单例实例，以及基础连接池类
 *
 * 使用方式：
 * ```javascript
 * // 使用SSH连接池单例
 * const { sshConnectionPool } = require('./core/connection');
 *
 * // 使用Telnet连接池单例
 * const { telnetConnectionPool } = require('./core/connection');
 *
 * // 创建自定义连接池实例
 * const { SSHConnectionPool, TelnetConnectionPool } = require('./core/connection');
 * const customSSHPool = new SSHConnectionPool({ maxConnections: 100 });
 *
 * // 访问基础连接池类（用于扩展）
 * const { BaseConnectionPool } = require('./core/connection');
 * ```
 */

const BaseConnectionPool = require("./base-connection-pool");
const SSHConnectionPool = require("./ssh-pool"); // 已更新为简化的ssh-pool
const TelnetConnectionPool = require("./telnet-connection-pool");
const SerialConnectionPool = require("./serial-connection-pool");

// 创建单例实例
const sshConnectionPool = new SSHConnectionPool();
const telnetConnectionPool = new TelnetConnectionPool();
const serialConnectionPool = new SerialConnectionPool();

/**
 * 初始化所有连接池
 * 应在应用启动时调用一次
 */
function initializeConnectionPools() {
  sshConnectionPool.initialize();
  telnetConnectionPool.initialize();
  serialConnectionPool.initialize();
}

/**
 * 清理所有连接池
 * 应在应用关闭时调用
 */
function cleanupConnectionPools() {
  sshConnectionPool.cleanup();
  telnetConnectionPool.cleanup();
  serialConnectionPool.cleanup();
}

/**
 * 获取所有连接池的状态
 * @returns {Object} 包含所有连接池状态的对象
 */
function getAllConnectionPoolsStatus() {
  return {
    ssh: sshConnectionPool.getStatus(),
    telnet: telnetConnectionPool.getStatus(),
    serial: serialConnectionPool.getStatus(),
  };
}

/**
 * 获取所有连接池的详细统计
 * @returns {Object} 包含所有连接池详细统计的对象
 */
function getAllConnectionPoolsStats() {
  return {
    ssh: sshConnectionPool.getDetailedStats(),
    telnet: telnetConnectionPool.getDetailedStats(),
    serial: serialConnectionPool.getDetailedStats(),
  };
}

module.exports = {
  // 基础类
  BaseConnectionPool,

  // 具体实现类
  SSHConnectionPool,
  TelnetConnectionPool,
  SerialConnectionPool,

  // 单例实例
  sshConnectionPool,
  telnetConnectionPool,
  serialConnectionPool,

  // 工具函数
  initializeConnectionPools,
  cleanupConnectionPools,
  getAllConnectionPoolsStatus,
  getAllConnectionPoolsStats,
};
