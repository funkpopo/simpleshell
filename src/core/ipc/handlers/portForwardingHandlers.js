const portForwardingService = require("../../services/port-forwarding-service");
const { broadcastToAllWindows } = require("../../window/windowManager");
const {
  IPC_EVENT_CHANNELS,
  IPC_REQUEST_CHANNELS,
} = require("../schema/channels");

/**
 * 端口转发（SSH隧道）相关的IPC处理器
 * 错误统一由 safeHandle/wrapIpcHandler 捕获并生成标准错误响应,处理器内直接 throw
 */
class PortForwardingHandlers {
  constructor() {
    // 转发状态变化时广播到所有窗口
    portForwardingService.on("statusUpdated", () => {
      try {
        broadcastToAllWindows(
          IPC_EVENT_CHANNELS.PF_STATUS_UPDATED,
          portForwardingService.getRulesWithStatus(),
        );
      } catch {
        /* intentionally ignored */
      }
    });
  }

  /**
   * 获取所有端口转发处理器
   */
  getHandlers() {
    return [
      {
        channel: IPC_REQUEST_CHANNELS.PF_GET_RULES,
        category: "port-forward",
        handler: this.getRules.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.PF_SAVE_RULE,
        category: "port-forward",
        handler: this.saveRule.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.PF_DELETE_RULE,
        category: "port-forward",
        handler: this.deleteRule.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.PF_START_RULE,
        category: "port-forward",
        handler: this.startRule.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.PF_STOP_RULE,
        category: "port-forward",
        handler: this.stopRule.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.PF_GET_ACTIVE_SESSIONS,
        category: "port-forward",
        handler: this.getActiveSessions.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.PF_GET_STATUS,
        category: "port-forward",
        handler: this.getStatus.bind(this),
      },
    ];
  }

  async getRules() {
    return portForwardingService.getRulesWithStatus();
  }

  async saveRule(rule) {
    return portForwardingService.saveRule(rule);
  }

  async deleteRule(ruleId) {
    return portForwardingService.deleteRule(ruleId);
  }

  async startRule({ ruleId, tabId }) {
    return portForwardingService.startRule(ruleId, tabId);
  }

  async stopRule(ruleId) {
    return portForwardingService.stopRule(ruleId);
  }

  async getActiveSessions() {
    return portForwardingService.getActiveSessions();
  }

  async getStatus() {
    return portForwardingService.getStatus();
  }
}

module.exports = PortForwardingHandlers;
