/**
 * SimpleShell 新架构核心模块入口
 * 统一导出所有优化后的连接池和传输组件
 */

// 连接管理模块
const connectionManager = require("./connection/connection-manager");
const AdvancedSSHPool = require("./connection/advanced-ssh-pool");
const ConnectionMonitor = require("./connection/connection-monitor");

// 内存管理模块
const memoryPoolManager = require("./memory/memory-pool");

// 传输模块
const zeroCopyEngine = require("./transfer/zero-copy-engine");
const {
  backpressureController,
} = require("./transfer/backpressure-controller");
const { advancedSftpEngine } = require("./transfer/advanced-sftp-engine");
const {
  optimizationMiddleware,
} = require("./transfer/optimization-middleware");

// 工具模块
const { logToFile } = require("./utils/logger");

/**
 * 新架构核心管理器
 * 统一初始化和管理所有子系统
 */
class SimpleShellCore {
  constructor(config = {}) {
    this.config = config;
    this.isInitialized = false;

    // 子系统引用
    this.connectionManager = connectionManager;
    this.memoryPool = memoryPoolManager;
    this.zeroCopy = zeroCopyEngine;
    this.backpressure = backpressureController;
    this.sftpEngine = advancedSftpEngine;
    this.optimization = optimizationMiddleware;

    this.stats = {
      initTime: null,
      totalConnections: 0,
      totalTransfers: 0,
      systemUptime: null,
    };
  }

  /**
   * 初始化所有子系统
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    const startTime = Date.now();
    logToFile("正在初始化SimpleShell新架构...", "INFO");

    try {
      // 按依赖顺序初始化子系统

      // 1. 内存管理（基础设施）
      await this.memoryPool.start();
      logToFile("✓ 内存池管理器已启动", "INFO");

      // 2. 背压控制（流控制）
      await this.backpressure.start();
      logToFile("✓ 背压控制器已启动", "INFO");

      // 3. 连接管理（核心功能）
      await this.connectionManager.initialize();
      logToFile("✓ 连接管理器已启动", "INFO");

      // 4. 传输引擎（应用层）
      await this.sftpEngine.initialize();
      logToFile("✓ SFTP传输引擎已启动", "INFO");

      // 5. 优化中间件（性能层）
      await this.optimization.initialize();
      logToFile("✓ 优化中间件已启动", "INFO");

      this.isInitialized = true;
      this.stats.initTime = Date.now() - startTime;
      this.stats.systemUptime = Date.now();

      logToFile(
        `SimpleShell新架构初始化完成，耗时: ${this.stats.initTime}ms`,
        "INFO",
      );
    } catch (error) {
      logToFile(`初始化失败: ${error.message}`, "ERROR");
      throw error;
    }
  }

  /**
   * 获取SSH连接
   * @param {Object} sshConfig SSH配置
   * @param {Object} options 连接选项
   * @returns {Object} SSH连接对象
   */
  async getConnection(sshConfig, options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    this.stats.totalConnections++;
    return await this.connectionManager.getConnection(sshConfig, options);
  }

  /**
   * 释放SSH连接
   * @param {string} connectionId 连接ID
   * @param {string} sessionId 会话ID
   */
  releaseConnection(connectionId, sessionId = null) {
    this.connectionManager.releaseConnection(connectionId, sessionId);
  }

  /**
   * 文件上传
   * @param {Object} sftpConnection SFTP连接
   * @param {string} localPath 本地文件路径
   * @param {string} remotePath 远程文件路径
   * @param {Object} options 传输选项
   * @returns {Object} 传输统计信息
   */
  async uploadFile(sftpConnection, localPath, remotePath, options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    this.stats.totalTransfers++;
    return await this.sftpEngine.upload(
      sftpConnection,
      localPath,
      remotePath,
      options,
    );
  }

  /**
   * 文件下载
   * @param {Object} sftpConnection SFTP连接
   * @param {string} remotePath 远程文件路径
   * @param {string} localPath 本地文件路径
   * @param {Object} options 传输选项
   * @returns {Object} 传输统计信息
   */
  async downloadFile(sftpConnection, remotePath, localPath, options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    this.stats.totalTransfers++;
    return await this.sftpEngine.download(
      sftpConnection,
      remotePath,
      localPath,
      options,
    );
  }

  /**
   * 获取系统状态
   * @returns {Object} 系统状态信息
   */
  getSystemStatus() {
    return {
      isInitialized: this.isInitialized,
      uptime: this.stats.systemUptime
        ? Date.now() - this.stats.systemUptime
        : 0,
      stats: this.stats,

      // 子系统状态
      connectionManager: this.connectionManager.getGlobalStatus(),
      memoryPool: this.memoryPool.getGlobalStats(),
      sftpEngine: this.sftpEngine.getEngineStats(),
      backpressure: this.backpressure.getControllerStatus(),
      optimization: this.optimization.getOptimizationStats(),
    };
  }

  /**
   * 获取性能指标
   * @returns {Object} 性能指标
   */
  getPerformanceMetrics() {
    const systemStatus = this.getSystemStatus();

    return {
      timestamp: Date.now(),

      // 连接指标
      connections: {
        total: systemStatus.connectionManager.totalConnections,
        active: systemStatus.connectionManager.activeConnections,
        pools: systemStatus.connectionManager.totalPools,
      },

      // 内存指标
      memory: {
        poolUsage: systemStatus.memoryPool.currentMemoryUsage,
        efficiency: systemStatus.memoryPool.memoryEfficiency,
        gcCount: systemStatus.memoryPool.gcCount,
      },

      // 传输指标
      transfers: {
        active: systemStatus.sftpEngine.activeTransfers,
        completed: systemStatus.sftpEngine.completedTransfers,
        failed: systemStatus.sftpEngine.failedTransfers,
        avgThroughput: systemStatus.sftpEngine.averageThroughput,
      },

      // 系统指标
      system: {
        uptime: systemStatus.uptime,
        initTime: this.stats.initTime,
        totalConnections: this.stats.totalConnections,
        totalTransfers: this.stats.totalTransfers,
      },
    };
  }

  /**
   * 优雅关闭系统
   */
  async shutdown() {
    if (!this.isInitialized) {
      return;
    }

    logToFile("正在关闭SimpleShell新架构...", "INFO");

    try {
      // 按相反顺序关闭子系统
      await this.optimization.shutdown();
      logToFile("✓ 优化中间件已关闭", "INFO");

      await this.sftpEngine.shutdown();
      logToFile("✓ SFTP传输引擎已关闭", "INFO");

      await this.connectionManager.shutdown();
      logToFile("✓ 连接管理器已关闭", "INFO");

      await this.backpressure.stop();
      logToFile("✓ 背压控制器已关闭", "INFO");

      await this.memoryPool.stop();
      logToFile("✓ 内存池管理器已关闭", "INFO");

      this.isInitialized = false;
      logToFile("SimpleShell新架构已完全关闭", "INFO");
    } catch (error) {
      logToFile(`关闭过程中出错: ${error.message}`, "ERROR");
      throw error;
    }
  }
}

// 创建单例实例
const simpleShellCore = new SimpleShellCore();

// 向后兼容的工厂函数
function createSSHPool(config = {}) {
  return new AdvancedSSHPool(config);
}

function createConnectionMonitor(config = {}) {
  return new ConnectionMonitor(config);
}

// 导出接口
module.exports = {
  // 主要入口
  SimpleShellCore,
  simpleShellCore,

  // 核心组件
  connectionManager,
  memoryPoolManager,
  zeroCopyEngine,
  backpressureController,
  advancedSftpEngine,
  optimizationMiddleware,

  // 工厂函数
  createSSHPool,
  createConnectionMonitor,

  // 向后兼容的方法
  async getConnection(sshConfig, options) {
    return await simpleShellCore.getConnection(sshConfig, options);
  },

  releaseConnection(connectionId, sessionId) {
    return simpleShellCore.releaseConnection(connectionId, sessionId);
  },

  async uploadFile(sftpConnection, localPath, remotePath, options) {
    return await simpleShellCore.uploadFile(
      sftpConnection,
      localPath,
      remotePath,
      options,
    );
  },

  async downloadFile(sftpConnection, remotePath, localPath, options) {
    return await simpleShellCore.downloadFile(
      sftpConnection,
      remotePath,
      localPath,
      options,
    );
  },

  getSystemStatus() {
    return simpleShellCore.getSystemStatus();
  },

  getPerformanceMetrics() {
    return simpleShellCore.getPerformanceMetrics();
  },

  async initialize() {
    return await simpleShellCore.initialize();
  },

  async shutdown() {
    return await simpleShellCore.shutdown();
  },
};
