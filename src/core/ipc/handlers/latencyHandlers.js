const NetworkLatencyService = require("../../services/networkLatencyService");
const { logToFile } = require("../../utils/logger");

/**
 * 网络延迟检测相关的IPC处理器
 */
class LatencyHandlers {
  constructor() {
    this.latencyService = new NetworkLatencyService();

    // 启动延迟服务
    this.latencyService.start();

    // 监听延迟更新事件
    this.latencyService.on("latency:updated", (data) => {
      this.broadcastLatencyUpdate(data);
    });

    this.latencyService.on("latency:error", (data) => {
      this.broadcastLatencyError(data);
    });

    this.latencyService.on("latency:disconnected", (data) => {
      this.broadcastLatencyDisconnected(data);
    });
  }

  /**
   * 获取所有延迟处理器
   */
  getHandlers() {
    return [
      {
        channel: "latency:register",
        category: "latency",
        handler: this.registerConnection.bind(this),
      },
      {
        channel: "latency:unregister",
        category: "latency",
        handler: this.unregisterConnection.bind(this),
      },
      {
        channel: "latency:getInfo",
        category: "latency",
        handler: this.getLatencyInfo.bind(this),
      },
      {
        channel: "latency:getAllInfo",
        category: "latency",
        handler: this.getAllLatencyInfo.bind(this),
      },
      {
        channel: "latency:getServiceStatus",
        category: "latency",
        handler: this.getServiceStatus.bind(this),
      },
      {
        channel: "latency:testNow",
        category: "latency",
        handler: this.testLatencyNow.bind(this),
      },
    ];
  }

  /**
   * 注册SSH连接的延迟检测
   */
  async registerConnection(event, { tabId, host, port, sshConnection }) {
    try {
      // 从连接管理器获取SSH连接实例
      const connectionManager = require("../../modules/connection");
      const connection = await connectionManager.getConnection(tabId);

      if (!connection || !connection.client) {
        throw new Error("SSH连接不存在或未建立");
      }

      this.latencyService.registerSSHConnection(
        tabId,
        connection.client,
        host,
        port,
      );

      return {
        success: true,
        message: "已注册延迟检测",
        tabId,
      };
    } catch (error) {
      logToFile(`注册延迟检测失败: ${error.message}`, "ERROR");
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 注销连接的延迟检测
   */
  async unregisterConnection(event, { tabId }) {
    try {
      this.latencyService.unregisterConnection(tabId);

      return {
        success: true,
        message: "已注销延迟检测",
        tabId,
      };
    } catch (error) {
      logToFile(`注销延迟检测失败: ${error.message}`, "ERROR");
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 获取指定连接的延迟信息
   */
  async getLatencyInfo(event, { tabId }) {
    try {
      const info = this.latencyService.getLatencyInfo(tabId);

      return {
        success: true,
        data: info,
      };
    } catch (error) {
      logToFile(`获取延迟信息失败: ${error.message}`, "ERROR");
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 获取所有连接的延迟信息
   */
  async getAllLatencyInfo(event) {
    try {
      const info = this.latencyService.getAllLatencyInfo();

      return {
        success: true,
        data: info,
      };
    } catch (error) {
      logToFile(`获取所有延迟信息失败: ${error.message}`, "ERROR");
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 获取服务状态
   */
  async getServiceStatus(event) {
    try {
      const status = this.latencyService.getServiceStatus();

      return {
        success: true,
        data: status,
      };
    } catch (error) {
      logToFile(`获取服务状态失败: ${error.message}`, "ERROR");
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 立即测试指定连接的延迟
   */
  async testLatencyNow(event, { tabId }) {
    try {
      await this.latencyService.testLatencyNow(tabId);

      return {
        success: true,
        message: "延迟测试已触发",
        tabId,
      };
    } catch (error) {
      logToFile(`立即测试延迟失败: ${error.message}`, "ERROR");
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 广播延迟更新到所有窗口
   */
  broadcastLatencyUpdate(data) {
    const { BrowserWindow } = require("electron");
    const windows = BrowserWindow.getAllWindows();

    windows.forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send("latency:updated", data);
      }
    });
  }

  /**
   * 广播延迟错误到所有窗口
   */
  broadcastLatencyError(data) {
    const { BrowserWindow } = require("electron");
    const windows = BrowserWindow.getAllWindows();

    windows.forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send("latency:error", data);
      }
    });
  }

  /**
   * 广播连接断开到所有窗口
   */
  broadcastLatencyDisconnected(data) {
    const { BrowserWindow } = require("electron");
    const windows = BrowserWindow.getAllWindows();

    windows.forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send("latency:disconnected", data);
      }
    });
  }

  /**
   * 清理资源
   */
  cleanup() {
    if (this.latencyService) {
      this.latencyService.stop();
    }
  }
}

module.exports = LatencyHandlers;
