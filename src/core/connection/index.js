/**
 * 连接池统一导出接口
 * 提供SSH/Telnet/串口/Mosh连接池的单例实例
 *
 * 使用方式：
 * ```javascript
 * // 使用SSH连接池单例
 * const { sshConnectionPool } = require('./core/connection');
 *
 * // 使用Telnet连接池单例
 * const { telnetConnectionPool } = require('./core/connection');
 * ```
 *
 * 注意：连接池的初始化/清理统一由 modules/connection 的 ConnectionManager 负责，
 * 需要扩展连接池类时直接 require 对应的实现文件（如 ./base-connection-pool）。
 */

const SSHConnectionPool = require("./ssh-pool");
const TelnetConnectionPool = require("./telnet-connection-pool");
const SerialConnectionPool = require("./serial-connection-pool");
const MoshConnectionPool = require("./mosh-connection-pool");

// 创建单例实例
const sshConnectionPool = new SSHConnectionPool();
const telnetConnectionPool = new TelnetConnectionPool();
const serialConnectionPool = new SerialConnectionPool();
const moshConnectionPool = new MoshConnectionPool();

module.exports = {
  // 单例实例
  sshConnectionPool,
  telnetConnectionPool,
  serialConnectionPool,
  moshConnectionPool,
};
