const { EventEmitter } = require('events');
const { logToFile } = require('./logger');

class ReconnectionManager extends EventEmitter {
  constructor() {
    super();
    this.failedConnections = new Map(); // connectionId -> connection config
    this.reconnectionAttempts = new Map(); // connectionId -> attempt count
    this.reconnectionTimers = new Map(); // connectionId -> timer
    this.maxReconnectionAttempts = 3;
    this.baseReconnectionDelay = 5000; // 5秒
    this.maxReconnectionDelay = 30000; // 30秒
    this.isEnabled = true;
  }

  // 注册失败的连接
  registerFailedConnection(connectionId, connectionConfig, error) {
    if (!this.isEnabled) {
      return;
    }

    logToFile(`注册失败连接用于重连: ${connectionId} - ${error.message}`, 'INFO');
    
    this.failedConnections.set(connectionId, {
      config: connectionConfig,
      failureTime: Date.now(),
      lastError: error.message,
      originalError: error
    });
    
    this.reconnectionAttempts.set(connectionId, 0);
    
    this.emit('connectionRegistered', {
      connectionId,
      config: connectionConfig,
      error: error.message
    });
  }

  // 开始重连序列
  async startReconnection(connectionId) {
    if (!this.failedConnections.has(connectionId)) {
      logToFile(`重连请求的连接不存在: ${connectionId}`, 'WARN');
      return false;
    }

    const connectionData = this.failedConnections.get(connectionId);
    const currentAttempts = this.reconnectionAttempts.get(connectionId) || 0;

    if (currentAttempts >= this.maxReconnectionAttempts) {
      logToFile(`连接 ${connectionId} 已达到最大重连次数`, 'WARN');
      this.cleanupConnection(connectionId);
      this.emit('reconnectionFailed', {
        connectionId,
        reason: 'Max attempts reached',
        attempts: currentAttempts
      });
      return false;
    }

    // 更新重连尝试次数
    this.reconnectionAttempts.set(connectionId, currentAttempts + 1);

    // 计算延迟时间 (指数退避)
    const delay = Math.min(
      this.baseReconnectionDelay * Math.pow(2, currentAttempts),
      this.maxReconnectionDelay
    );

    logToFile(`开始重连 ${connectionId}, 尝试 ${currentAttempts + 1}/${this.maxReconnectionAttempts}, 延迟 ${delay}ms`, 'INFO');

    // 设置重连定时器
    const timer = setTimeout(async () => {
      await this.attemptReconnection(connectionId);
    }, delay);

    this.reconnectionTimers.set(connectionId, timer);
    
    this.emit('reconnectionStarted', {
      connectionId,
      attempt: currentAttempts + 1,
      maxAttempts: this.maxReconnectionAttempts,
      delay
    });

    return true;
  }

  // 执行重连尝试
  async attemptReconnection(connectionId) {
    const connectionData = this.failedConnections.get(connectionId);
    const currentAttempts = this.reconnectionAttempts.get(connectionId);

    if (!connectionData) {
      logToFile(`重连时连接数据丢失: ${connectionId}`, 'ERROR');
      return false;
    }

    try {
      logToFile(`执行重连尝试: ${connectionId} (第 ${currentAttempts} 次)`, 'INFO');
      
      // 清理定时器
      this.clearReconnectionTimer(connectionId);

      // 发出重连尝试事件
      this.emit('reconnectionAttempting', {
        connectionId,
        attempt: currentAttempts,
        config: connectionData.config
      });

      // 这里需要根据连接类型调用相应的连接方法
      // 由于这是核心服务，我们发出事件让具体的连接管理器处理
      const success = await this.executeReconnection(connectionId, connectionData.config);

      if (success) {
        logToFile(`重连成功: ${connectionId}`, 'INFO');
        this.cleanupConnection(connectionId);
        
        this.emit('reconnectionSuccess', {
          connectionId,
          attempts: currentAttempts,
          totalTime: Date.now() - connectionData.failureTime
        });

        return true;
      } else {
        // 重连失败，准备下一次尝试
        if (currentAttempts < this.maxReconnectionAttempts) {
          await this.startReconnection(connectionId);
        } else {
          logToFile(`连接 ${connectionId} 重连失败，已达到最大尝试次数`, 'ERROR');
          this.cleanupConnection(connectionId);
          
          this.emit('reconnectionFailed', {
            connectionId,
            reason: 'All attempts exhausted',
            attempts: currentAttempts
          });
        }
        return false;
      }
    } catch (error) {
      logToFile(`重连尝试出错: ${connectionId} - ${error.message}`, 'ERROR');
      
      // 更新错误信息
      if (connectionData) {
        connectionData.lastError = error.message;
        connectionData.originalError = error;
      }

      // 继续下一次尝试
      if (currentAttempts < this.maxReconnectionAttempts) {
        await this.startReconnection(connectionId);
      } else {
        this.cleanupConnection(connectionId);
        this.emit('reconnectionFailed', {
          connectionId,
          reason: error.message,
          attempts: currentAttempts
        });
      }
      return false;
    }
  }

  // 执行具体的重连操作 (需要被子类或通过事件处理)
  async executeReconnection(connectionId, config) {
    return new Promise((resolve) => {
      // 发出重连请求，等待响应
      const timeout = setTimeout(() => {
        this.removeAllListeners(`reconnection-result-${connectionId}`);
        resolve(false);
      }, 10000); // 10秒超时

      this.once(`reconnection-result-${connectionId}`, (success) => {
        clearTimeout(timeout);
        resolve(success);
      });

      // 发出重连请求事件
      this.emit('execute-reconnection', {
        connectionId,
        config,
        resultEvent: `reconnection-result-${connectionId}`
      });
    });
  }

  // 网络恢复时触发所有连接重连
  async onNetworkRestored() {
    if (!this.isEnabled || this.failedConnections.size === 0) {
      return;
    }

    logToFile(`网络恢复，开始重连 ${this.failedConnections.size} 个失败的连接`, 'INFO');

    const reconnectionPromises = [];
    
    for (const [connectionId] of this.failedConnections) {
      // 重置重连尝试次数，给每个连接新的机会
      this.reconnectionAttempts.set(connectionId, 0);
      reconnectionPromises.push(this.startReconnection(connectionId));
    }

    // 等待所有重连启动
    const results = await Promise.allSettled(reconnectionPromises);
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
    
    logToFile(`网络恢复重连启动完成: ${successCount}/${this.failedConnections.size} 个连接开始重连`, 'INFO');
    
    this.emit('networkRestoreReconnection', {
      totalConnections: this.failedConnections.size,
      startedReconnections: successCount
    });
  }

  // 手动重连指定连接
  async manualReconnect(connectionId) {
    if (!this.failedConnections.has(connectionId)) {
      logToFile(`手动重连请求的连接不存在: ${connectionId}`, 'WARN');
      return false;
    }

    // 取消现有的重连定时器
    this.clearReconnectionTimer(connectionId);
    
    // 重置重连次数
    this.reconnectionAttempts.set(connectionId, 0);
    
    logToFile(`手动触发重连: ${connectionId}`, 'INFO');
    return await this.startReconnection(connectionId);
  }

  // 取消指定连接的重连
  cancelReconnection(connectionId) {
    if (this.failedConnections.has(connectionId)) {
      logToFile(`取消连接重连: ${connectionId}`, 'INFO');
      this.cleanupConnection(connectionId);
      
      this.emit('reconnectionCancelled', { connectionId });
      return true;
    }
    return false;
  }

  // 取消所有重连
  cancelAllReconnections() {
    const connectionIds = Array.from(this.failedConnections.keys());
    logToFile(`取消所有重连: ${connectionIds.length} 个连接`, 'INFO');
    
    for (const connectionId of connectionIds) {
      this.cleanupConnection(connectionId);
    }
    
    this.emit('allReconnectionsCancelled', { count: connectionIds.length });
  }

  // 清理连接数据
  cleanupConnection(connectionId) {
    this.clearReconnectionTimer(connectionId);
    this.failedConnections.delete(connectionId);
    this.reconnectionAttempts.delete(connectionId);
  }

  // 清理重连定时器
  clearReconnectionTimer(connectionId) {
    const timer = this.reconnectionTimers.get(connectionId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectionTimers.delete(connectionId);
    }
  }

  // 获取重连状态
  getReconnectionStatus() {
    const status = {
      isEnabled: this.isEnabled,
      failedConnections: this.failedConnections.size,
      activeReconnections: this.reconnectionTimers.size,
      connections: []
    };

    for (const [connectionId, connectionData] of this.failedConnections) {
      const attempts = this.reconnectionAttempts.get(connectionId) || 0;
      const hasActiveTimer = this.reconnectionTimers.has(connectionId);
      
      status.connections.push({
        connectionId,
        config: connectionData.config,
        failureTime: connectionData.failureTime,
        lastError: connectionData.lastError,
        attempts,
        maxAttempts: this.maxReconnectionAttempts,
        isRetrying: hasActiveTimer
      });
    }

    return status;
  }

  // 设置配置
  setConfiguration(config) {
    if (config.maxReconnectionAttempts !== undefined) {
      this.maxReconnectionAttempts = config.maxReconnectionAttempts;
    }
    if (config.baseReconnectionDelay !== undefined) {
      this.baseReconnectionDelay = config.baseReconnectionDelay;
    }
    if (config.maxReconnectionDelay !== undefined) {
      this.maxReconnectionDelay = config.maxReconnectionDelay;
    }
    
    logToFile(`重连管理器配置已更新: ${JSON.stringify(config)}`, 'INFO');
  }

  // 启用/禁用重连功能
  setEnabled(enabled) {
    this.isEnabled = enabled;
    
    if (!enabled) {
      this.cancelAllReconnections();
    }
    
    logToFile(`重连功能${enabled ? '启用' : '禁用'}`, 'INFO');
  }

  // 清理所有资源
  destroy() {
    this.cancelAllReconnections();
    this.removeAllListeners();
    this.isEnabled = false;
    logToFile('重连管理器已销毁', 'INFO');
  }
}

// 单例模式
let instance = null;

function getReconnectionManager() {
  if (!instance) {
    instance = new ReconnectionManager();
  }
  return instance;
}

module.exports = {
  ReconnectionManager,
  getReconnectionManager
};