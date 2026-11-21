const {
  t: translateLocale,
  getUiLanguage,
} = require("../../../shared/mainI18n");
const configService = require("../../settings/configService");
const { redactConnectionSecrets } = require("../../settings/connectionSecrets");
const processManager = require("../../process/processManager");
const { logToFile } = require("../../utils/logger");
const { isSshClientUsable } = require("../../connection/ssh-utils");
const {
  IPC_REQUEST_CHANNELS,
} = require("../../../shared/contracts/ipc/channels");

const systemInfoText = (key) =>
  translateLocale(key, { lng: getUiLanguage(configService) });

/**
 * 连接列表与本地/远程系统信息查询 IPC 处理器。
 * 错误统一由 safeHandle/wrapIpcHandler 捕获并生成标准错误响应。
 */
class SystemInfoHandlers {
  getHandlers() {
    return [
      {
        channel: IPC_REQUEST_CHANNELS.TERMINAL_LOAD_CONNECTIONS,
        category: "terminal",
        handler: this.loadConnections.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.TERMINAL_GET_CONNECTION_PASSWORD,
        category: "terminal",
        handler: this.getConnectionPassword.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.TERMINAL_LOAD_TOP_CONNECTIONS,
        category: "terminal",
        handler: this.loadTopConnections.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.TERMINAL_GET_SYSTEM_INFO,
        category: "terminal",
        handler: this._createRemoteAwareInfoHandler({
          getLocal: (systemInfo) => systemInfo.getLocalSystemInfo(),
          getRemote: (systemInfo, sshClient) =>
            systemInfo.getRemoteSystemInfo(sshClient),
          awaitLocal: true,
          fallbackTarget: "local system info",
          failureSubject: "system info",
          getFailureMessage: () =>
            systemInfoText("mainProcess.systemInfo.getSystemInfoFailed"),
        }),
      },
      {
        channel: IPC_REQUEST_CHANNELS.TERMINAL_GET_METRICS_SAMPLE,
        category: "terminal",
        handler: this._createRemoteAwareInfoHandler({
          getLocal: (systemInfo) => systemInfo.getLocalMetricsSample(),
          getRemote: (systemInfo, sshClient) =>
            systemInfo.getRemoteMetricsSample(sshClient),
          awaitLocal: true,
          fallbackTarget: "local metrics sample",
          failureSubject: "metrics sample",
          getFailureMessage: () =>
            systemInfoText("mainProcess.systemInfo.getSystemInfoFailed"),
        }),
      },
      {
        channel: IPC_REQUEST_CHANNELS.TERMINAL_GET_RESOURCE_SNAPSHOT,
        category: "terminal",
        handler: this._createRemoteAwareInfoHandler({
          getLocal: (systemInfo) =>
            Promise.all([
              systemInfo.getLocalSystemInfo(),
              systemInfo.getLocalMetricsSample(),
            ]).then(([info, sample]) => ({ info, sample })),
          getRemote: (systemInfo, sshClient) =>
            systemInfo.getRemoteResourceSnapshot(sshClient),
          awaitLocal: true,
          fallbackTarget: "local resource snapshot",
          failureSubject: "resource snapshot",
          getFailureMessage: () =>
            systemInfoText("mainProcess.systemInfo.getSystemInfoFailed"),
        }),
      },
      {
        channel: IPC_REQUEST_CHANNELS.TERMINAL_GET_PROCESS_LIST,
        category: "terminal",
        handler: this._createRemoteAwareInfoHandler({
          getLocal: (systemInfo) => systemInfo.getProcessList(),
          getRemote: (systemInfo, sshClient) =>
            systemInfo.getRemoteProcessList(sshClient),
          awaitLocal: false,
          fallbackTarget: "local process list",
          failureSubject: "process list",
          getFailureMessage: () =>
            systemInfoText("mainProcess.systemInfo.getProcessListFailed"),
        }),
      },
    ];
  }

  async loadConnections() {
    return redactConnectionSecrets(configService.loadConnections());
  }

  async getConnectionPassword(event, connectionId) {
    void event;
    return configService.getSavedConnectionPassword(connectionId);
  }

  async loadTopConnections() {
    try {
      return redactConnectionSecrets(configService.loadLastConnections());
    } catch {
      return [];
    }
  }

  /**
   * 创建"本地/远程二选一"的系统信息类处理器。
   */
  _createRemoteAwareInfoHandler({
    getLocal,
    getRemote,
    awaitLocal,
    fallbackTarget,
    failureSubject,
    getFailureMessage,
  }) {
    // awaitLocal 保持与原实现一致：
    // TERMINAL_GET_SYSTEM_INFO 原实现 `return await getLocalSystemInfo()`（本地调用的拒绝会被捕获并降级），
    // TERMINAL_GET_PROCESS_LIST 原实现 `return getProcessList()`（拒绝直接向调用方传播）。
    return async (event, processId) => {
      void event;
      try {
        const systemInfo = require("../../system-info");
        if (!processId || !processManager.hasProcess(processId)) {
          return awaitLocal ? await getLocal(systemInfo) : getLocal(systemInfo);
        } else {
          const processObj = processManager.getProcess(processId);
          if (
            processObj.type === "ssh" &&
            (processObj.process || processObj.client || processObj.channel)
          ) {
            const sshClient =
              processObj.client || processObj.process || processObj.channel;
            if (!isSshClientUsable(sshClient)) {
              logToFile(
                `SSH connection not available for process ${processId}, falling back to ${fallbackTarget}`,
                "WARN",
              );
              return awaitLocal
                ? await getLocal(systemInfo)
                : getLocal(systemInfo);
            }
            return getRemote(systemInfo, sshClient);
          } else {
            return awaitLocal
              ? await getLocal(systemInfo)
              : getLocal(systemInfo);
          }
        }
      } catch (error) {
        logToFile(`Failed to get ${failureSubject}: ${error.message}`, "ERROR");
        try {
          const systemInfo = require("../../system-info");
          return awaitLocal ? await getLocal(systemInfo) : getLocal(systemInfo);
        } catch {
          return {
            error:
              typeof getFailureMessage === "function"
                ? getFailureMessage()
                : getFailureMessage,
            message: error.message,
          };
        }
      }
    };
  }
}

module.exports = SystemInfoHandlers;
