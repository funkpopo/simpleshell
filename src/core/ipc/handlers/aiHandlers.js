const configService = require("../../../services/configService");
const { logToFile } = require("../../utils/logger");
const aiWorkerManager = require("../../workers/aiWorkerManager");
const { BrowserWindow } = require("electron");

/**
 * AI相关的IPC处理器
 */
class AIHandlers {
  constructor() {
    // 使用aiWorkerManager管理状态
  }

  /**
   * 获取所有AI处理器
   */
  getHandlers() {
    return [
      {
        channel: "ai:loadSettings",
        category: "ai",
        handler: this.loadSettings.bind(this),
      },
      {
        channel: "ai:saveSettings",
        category: "ai",
        handler: this.saveSettings.bind(this),
      },
      {
        channel: "ai:saveApiConfig",
        category: "ai",
        handler: this.saveApiConfig.bind(this),
      },
      {
        channel: "ai:deleteApiConfig",
        category: "ai",
        handler: this.deleteApiConfig.bind(this),
      },
      {
        channel: "ai:setCurrentApiConfig",
        category: "ai",
        handler: this.setCurrentApiConfig.bind(this),
      },
      {
        channel: "ai:sendPrompt",
        category: "ai",
        handler: this.sendPrompt.bind(this),
      },
      {
        channel: "ai:sendAPIRequest",
        category: "ai",
        handler: this.sendAPIRequest.bind(this),
      },
      {
        channel: "ai:abortAPIRequest",
        category: "ai",
        handler: this.abortAPIRequest.bind(this),
      },
      {
        channel: "ai:fetchModels",
        category: "ai",
        handler: this.fetchModels.bind(this),
      },
      {
        channel: "ai:saveCustomRiskRules",
        category: "ai",
        handler: this.saveCustomRiskRules.bind(this),
      },
    ];
  }

  async loadSettings() {
    return configService.loadAISettings();
  }

  async saveSettings(event, settings) {
    return configService.saveAISettings(settings);
  }

  async saveApiConfig(event, config) {
    try {
      logToFile(
        `Saving API config: ${JSON.stringify({
          id: config.id,
          name: config.name,
          model: config.model,
        })}`,
        "INFO"
      );
      const settings = configService.loadAISettings();
      if (!settings.configs) settings.configs = [];
      if (!config.id) config.id = Date.now().toString();
      const existingIndex = settings.configs.findIndex(
        (c) => c.id === config.id
      );
      if (existingIndex >= 0) {
        settings.configs[existingIndex] = config;
      } else {
        settings.configs.push(config);
      }
      return configService.saveAISettings(settings);
    } catch (error) {
      logToFile(`Failed to save API config: ${error.message}`, "ERROR");
      return false;
    }
  }

  async deleteApiConfig(event, configId) {
    try {
      const settings = configService.loadAISettings();
      if (!settings.configs) settings.configs = [];
      const originalLength = settings.configs.length;
      settings.configs = settings.configs.filter((c) => c.id !== configId);
      if (settings.current && settings.current.id === configId) {
        if (settings.configs.length > 0) {
          settings.current = { ...settings.configs[0] };
        } else {
          settings.current = {
            apiUrl: "",
            apiKey: "",
            model: "",
            streamEnabled: true,
          };
        }
      }
      if (settings.configs.length !== originalLength) {
        return configService.saveAISettings(settings);
      }
      return true;
    } catch (error) {
      logToFile(`Failed to delete API config: ${error.message}`, "ERROR");
      return false;
    }
  }

  async setCurrentApiConfig(event, configId) {
    try {
      logToFile(`Setting current API config with ID: ${configId}`, "INFO");
      const settings = configService.loadAISettings();
      if (!settings.configs) settings.configs = [];
      const selectedConfig = settings.configs.find((c) => c.id === configId);
      if (selectedConfig) {
        settings.current = { ...selectedConfig };
        return configService.saveAISettings(settings);
      }
      return false;
    } catch (error) {
      logToFile(`Failed to set current API config: ${error.message}`, "ERROR");
      return false;
    }
  }

  async sendPrompt(event, prompt, settings) {
    try {
      return await configService.sendAIPrompt(prompt, settings);
    } catch (error) {
      logToFile(`Error sending AI prompt: ${error.message}`, "ERROR");
      return { error: error.message || "发送请求时出错" };
    }
  }

  async sendAPIRequest(event, requestData, isStream) {
    try {
      // 验证请求数据
      if (
        !requestData ||
        !requestData.url ||
        !requestData.apiKey ||
        !requestData.model
      ) {
        throw new Error("请先配置 AI API，包括 API 地址、密钥和模型");
      }

      if (!requestData.messages) {
        throw new Error("请求数据无效，缺少消息内容");
      }

      // 确保Worker已创建
      const aiWorker = aiWorkerManager.ensureAIWorker();
      if (!aiWorker) {
        throw new Error("无法创建AI Worker");
      }

      // 生成请求ID
      const requestId = aiWorkerManager.getNextRequestId();

      // 如果是流式请求，保存会话ID
      if (isStream) {
        aiWorkerManager.setCurrentSessionId(requestData.sessionId);
      }

      // 准备发送到Worker的数据
      const workerData = {
        ...requestData,
        isStream,
      };

      // 发送请求到Worker
      return new Promise((resolve, reject) => {
        // 设置请求超时
        const timeoutId = setTimeout(() => {
          aiWorkerManager.deleteRequestCallback(requestId);
          reject(new Error("请求超时"));
        }, 60000); // 60秒超时

        // 存储回调函数
        aiWorkerManager.setRequestCallback(requestId, {
          resolve: (result) => {
            clearTimeout(timeoutId);
            resolve(result);
          },
          reject: (error) => {
            clearTimeout(timeoutId);
            reject(error);
          },
          timestamp: Date.now(),
        });

        // 发送消息到Worker
        aiWorker.postMessage({
          type: "api_request",
          id: requestId,
          data: workerData,
        });

        // 如果是流式请求，立即返回成功
        if (isStream) {
          resolve({ success: true, message: "流式请求已开始" });
        }
      });
    } catch (error) {
      logToFile(`处理AI请求时出错: ${error.message}`, "ERROR");
      return { error: error.message || "处理请求时出错" };
    }
  }

  async abortAPIRequest() {
    try {
      const currentSessionId = aiWorkerManager.getCurrentSessionId();
      const aiWorker = aiWorkerManager.getAIWorker();
      // 检查是否有当前会话ID
      if (currentSessionId && aiWorker) {
        // 生成取消请求ID
        const cancelRequestId = `cancel_${Date.now()}`;

        // 尝试通过Worker取消请求
        aiWorker.postMessage({
          type: "cancel_request",
          id: cancelRequestId,
          data: {
            sessionId: currentSessionId,
          },
        });

        // 获取主窗口
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow && !mainWindow.webContents.isDestroyed()) {
          // 发送中断消息给渲染进程
          mainWindow.webContents.send("stream-end", {
            tabId: "ai",
            aborted: true,
            sessionId: currentSessionId,
          });
        }

        // 清理会话ID和映射
        aiWorkerManager.deleteStreamSession(currentSessionId);
        aiWorkerManager.clearCurrentSessionId();

        return { success: true, message: "请求已中断" };
      } else {
        return { success: false, message: "没有活跃的请求" };
      }
    } catch (error) {
      logToFile(`中断API请求时出错: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async fetchModels(event, requestData) {
    try {
      // 确保Worker已创建
      const aiWorker = aiWorkerManager.ensureAIWorker();
      if (!aiWorker) {
        throw new Error("无法创建AI Worker");
      }

      const requestId = aiWorkerManager.getNextRequestId();
      const timeout = 30000; // 30秒超时

      return new Promise((resolve, reject) => {
        // 存储回调
        aiWorkerManager.setRequestCallback(requestId, { resolve, reject });

        // 发送消息到worker
        aiWorker.postMessage({
          id: requestId,
          type: "api_request",
          data: {
            ...requestData,
            type: "models",
          },
        });

        // 设置超时
        setTimeout(() => {
          if (aiWorkerManager.hasRequest(requestId)) {
            aiWorkerManager.deleteRequestCallback(requestId);
            reject(new Error("获取模型列表请求超时"));
          }
        }, timeout);
      });
    } catch (error) {
      logToFile(`获取模型列表失败: ${error.message}`, "ERROR");
      throw error;
    }
  }

  async saveCustomRiskRules(event, rules) {
    try {
      const currentSettings = configService.loadAISettings() || {};
      currentSettings.customRiskRules = rules;
      configService.saveAISettings(currentSettings);
      logToFile("Custom risk rules saved", "INFO");
      return { success: true };
    } catch (error) {
      logToFile(`Error saving custom risk rules: ${error.message}`, "ERROR");
      throw error;
    }
  }
}

module.exports = AIHandlers;
