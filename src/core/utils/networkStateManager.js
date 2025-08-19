const { EventEmitter } = require("events");
const { logToFile } = require("./logger");

class NetworkStateManager extends EventEmitter {
  constructor() {
    super();
    this.isOnline = true;
    this.isInitialized = false;
    this.retryAttempts = 0;
    this.maxRetryAttempts = 3;
    this.retryInterval = 5000; // 5秒
    this.checkInterval = 30000; // 30秒
    this.lastOnlineTime = Date.now();
    this.offlineDuration = 0;
    
    // 连接质量状态
    this.connectionQuality = 'excellent'; // excellent, good, poor, offline
    this.latencyThresholds = {
      excellent: 100,
      good: 300,
      poor: 1000
    };
    
    this.checkTimer = null;
    this.retryTimer = null;
    
    // 离线时的功能限制配置
    this.offlineCapabilities = {
      localTerminal: true,
      fileOperations: false,
      sshConnections: false,
      fileTransfer: false,
      systemMonitoring: true, // 本地监控仍可用
      aiChat: false,
      settingsSync: false
    };
  }

  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      // 初始化网络状态检测
      await this.checkNetworkStatus();
      
      // 开始定期检测
      this.startPeriodicCheck();
      
      this.isInitialized = true;
      this.emit('initialized', { isOnline: this.isOnline });
      
      logToFile('网络状态管理器已初始化', 'INFO');
    } catch (error) {
      logToFile(`网络状态管理器初始化失败: ${error.message}`, 'ERROR');
      throw error;
    }
  }

  async checkNetworkStatus() {
    const startTime = Date.now();
    let isOnline = false;
    let latency = 0;

    try {
      // 尝试多个检测方法
      const results = await Promise.allSettled([
        this.pingDNSServer(),
        this.testHTTPConnectivity(),
        this.checkLocalNetworkInterface()
      ]);

      // 如果至少有一个方法成功，认为网络在线
      const successful = results.filter(result => result.status === 'fulfilled');
      isOnline = successful.length > 0;
      
      if (isOnline) {
        // 计算平均延迟
        const latencies = successful
          .map(result => result.value.latency)
          .filter(l => l > 0);
        latency = latencies.length > 0 
          ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
          : 0;
      }
      
    } catch (error) {
      logToFile(`网络状态检测失败: ${error.message}`, 'WARN');
      isOnline = false;
    }

    const wasOnline = this.isOnline;
    this.isOnline = isOnline;
    
    // 更新连接质量
    this.updateConnectionQuality(latency);
    
    // 处理状态变化
    if (wasOnline !== isOnline) {
      await this.handleNetworkStateChange(isOnline);
    }

    return {
      isOnline,
      latency,
      quality: this.connectionQuality,
      checkDuration: Date.now() - startTime
    };
  }

  async pingDNSServer() {
    return new Promise((resolve, reject) => {
      const dns = require('dns');
      const startTime = Date.now();
      
      dns.resolve('google.com', (err) => {
        const latency = Date.now() - startTime;
        if (err) {
          reject(new Error(`DNS解析失败: ${err.message}`));
        } else {
          resolve({ success: true, latency });
        }
      });
    });
  }

  async testHTTPConnectivity() {
    return new Promise((resolve, reject) => {
      const https = require('https');
      const startTime = Date.now();
      
      const req = https.request({
        hostname: 'google.com',
        port: 443,
        path: '/',
        method: 'HEAD',
        timeout: 5000
      }, (res) => {
        const latency = Date.now() - startTime;
        resolve({ success: true, latency });
        req.destroy();
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('HTTP连接超时'));
      });

      req.on('error', (err) => {
        reject(new Error(`HTTP连接失败: ${err.message}`));
      });

      req.end();
    });
  }

  async checkLocalNetworkInterface() {
    return new Promise((resolve, reject) => {
      const os = require('os');
      const interfaces = os.networkInterfaces();
      
      let hasActiveInterface = false;
      
      for (const name of Object.keys(interfaces)) {
        const iface = interfaces[name];
        for (const config of iface) {
          if (!config.internal && config.family === 'IPv4' && config.address !== '127.0.0.1') {
            hasActiveInterface = true;
            break;
          }
        }
        if (hasActiveInterface) break;
      }
      
      if (hasActiveInterface) {
        resolve({ success: true, latency: 1 }); // 本地检测延迟很低
      } else {
        reject(new Error('没有活跃的网络接口'));
      }
    });
  }

  updateConnectionQuality(latency) {
    if (!this.isOnline) {
      this.connectionQuality = 'offline';
    } else if (latency <= this.latencyThresholds.excellent) {
      this.connectionQuality = 'excellent';
    } else if (latency <= this.latencyThresholds.good) {
      this.connectionQuality = 'good';
    } else {
      this.connectionQuality = 'poor';
    }
  }

  async handleNetworkStateChange(isOnline) {
    const now = Date.now();
    
    if (isOnline) {
      // 网络恢复
      this.offlineDuration = this.lastOnlineTime > 0 ? now - this.lastOnlineTime : 0;
      this.lastOnlineTime = now;
      this.retryAttempts = 0;
      
      logToFile(`网络已恢复，离线时长: ${Math.round(this.offlineDuration / 1000)}秒`, 'INFO');
      
      // 停止重试定时器
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      
      this.emit('online', {
        offlineDuration: this.offlineDuration,
        quality: this.connectionQuality
      });
      
      // 尝试重新连接失败的连接
      await this.attemptReconnections();
      
    } else {
      // 网络断开
      this.lastOnlineTime = now;
      
      logToFile('网络连接已断开', 'WARN');
      
      this.emit('offline', {
        timestamp: now,
        capabilities: this.offlineCapabilities
      });
      
      // 开始重试机制
      this.startRetryMechanism();
      
      // 激活离线模式
      await this.activateOfflineMode();
    }
  }

  startRetryMechanism() {
    if (this.retryTimer || this.retryAttempts >= this.maxRetryAttempts) {
      return;
    }
    
    this.retryTimer = setTimeout(async () => {
      this.retryAttempts++;
      logToFile(`网络重连尝试 ${this.retryAttempts}/${this.maxRetryAttempts}`, 'INFO');
      
      await this.checkNetworkStatus();
      
      if (!this.isOnline && this.retryAttempts < this.maxRetryAttempts) {
        this.retryTimer = null;
        this.startRetryMechanism();
      }
    }, this.retryInterval);
  }

  startPeriodicCheck() {
    if (this.checkTimer) {
      return;
    }
    
    this.checkTimer = setInterval(async () => {
      await this.checkNetworkStatus();
    }, this.checkInterval);
  }

  stopPeriodicCheck() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  async activateOfflineMode() {
    // 通知所有连接管理器进入离线模式
    this.emit('activateOfflineMode', {
      capabilities: this.offlineCapabilities,
      message: '应用已切换到离线模式，部分功能将不可用'
    });
  }

  async attemptReconnections() {
    // 通知连接管理器尝试重连
    this.emit('attemptReconnections', {
      quality: this.connectionQuality,
      message: '网络已恢复，正在尝试重新连接...'
    });
  }

  // 公共接口
  getNetworkState() {
    return {
      isOnline: this.isOnline,
      quality: this.connectionQuality,
      lastOnlineTime: this.lastOnlineTime,
      offlineDuration: this.isOnline ? 0 : Date.now() - this.lastOnlineTime,
      retryAttempts: this.retryAttempts,
      maxRetryAttempts: this.maxRetryAttempts,
      capabilities: this.isOnline ? null : this.offlineCapabilities
    };
  }

  isFeatureAvailable(feature) {
    if (this.isOnline) {
      return true;
    }
    return this.offlineCapabilities[feature] === true;
  }

  getOfflineMessage(feature) {
    if (this.isOnline) {
      return null;
    }
    
    const messages = {
      sshConnections: '离线模式下无法建立SSH连接',
      fileTransfer: '离线模式下无法进行文件传输',
      aiChat: '离线模式下AI聊天功能不可用',
      settingsSync: '离线模式下设置无法同步到云端'
    };
    
    return messages[feature] || '该功能在离线模式下不可用';
  }

  // 手动触发网络检测
  async forceCheck() {
    logToFile('手动触发网络状态检测', 'INFO');
    return await this.checkNetworkStatus();
  }

  // 设置连接质量阈值
  setLatencyThresholds(thresholds) {
    this.latencyThresholds = { ...this.latencyThresholds, ...thresholds };
    logToFile(`连接质量阈值已更新: ${JSON.stringify(this.latencyThresholds)}`, 'INFO');
  }

  // 设置离线功能配置
  setOfflineCapabilities(capabilities) {
    this.offlineCapabilities = { ...this.offlineCapabilities, ...capabilities };
    logToFile(`离线功能配置已更新: ${JSON.stringify(this.offlineCapabilities)}`, 'INFO');
  }

  destroy() {
    this.stopPeriodicCheck();
    this.removeAllListeners();
    this.isInitialized = false;
    logToFile('网络状态管理器已销毁', 'INFO');
  }
}

// 单例模式
let instance = null;

function getNetworkStateManager() {
  if (!instance) {
    instance = new NetworkStateManager();
  }
  return instance;
}

module.exports = {
  NetworkStateManager,
  getNetworkStateManager
};