const configService = require("../../ConfigService");
const { logToFile } = require("../../utils/logger");

/**
 * AI相关的IPC处理器
 */
class AIHandlers {
  constructor(aiWorker, mainWindow) {
    this.aiWorker = aiWorker;
    this.mainWindow = mainWindow;
    this.aiRequestMap = new Map();
    this.streamSessions = new Map();
    this.nextRequestId = 1;
    this.currentSessionId = null;
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
    ];
  }

  // 实现各个处理器方法
  async loadSettings(event) {
    try {
      const settings = configService.getAISettings();
      return settings || {};
    } catch (error) {
      logToFile(`Error loading AI settings: ${error.message}`, "ERROR");
      throw error;
    }
  }

  async saveSettings(event, settings) {
    try {
      configService.saveAISettings(settings);
      logToFile("AI settings saved", "INFO");
      return { success: true };
    } catch (error) {
      logToFile(`Error saving AI settings: ${error.message}`, "ERROR");
      throw error;
    }
  }

  async saveApiConfig(event, config) {
    try {
      const currentSettings = configService.getAISettings() || {};

      if (!currentSettings.apiConfigs) {
        currentSettings.apiConfigs = [];
      }

      // 如果配置有ID，更新现有配置；否则添加新配置
      if (config.id) {
        const index = currentSettings.apiConfigs.findIndex(
          (c) => c.id === config.id,
        );
        if (index !== -1) {
          currentSettings.apiConfigs[index] = config;
        } else {
          currentSettings.apiConfigs.push(config);
        }
      } else {
        config.id = Date.now().toString();
        currentSettings.apiConfigs.push(config);
      }

      configService.saveAISettings(currentSettings);
      logToFile(`API config saved: ${config.name || config.id}`, "INFO");

      return { success: true, config };
    } catch (error) {
      logToFile(`Error saving API config: ${error.message}`, "ERROR");
      throw error;
    }
  }

  async deleteApiConfig(event, configId) {
    try {
      const currentSettings = configService.getAISettings() || {};

      if (!currentSettings.apiConfigs) {
        return { success: false, error: "No API configs found" };
      }

      const initialLength = currentSettings.apiConfigs.length;
      currentSettings.apiConfigs = currentSettings.apiConfigs.filter(
        (c) => c.id !== configId,
      );

      if (currentSettings.apiConfigs.length < initialLength) {
        // 如果删除的是当前配置，清除当前配置ID
        if (currentSettings.currentApiConfigId === configId) {
          delete currentSettings.currentApiConfigId;
        }

        configService.saveAISettings(currentSettings);
        logToFile(`API config deleted: ${configId}`, "INFO");
        return { success: true };
      }

      return { success: false, error: "Config not found" };
    } catch (error) {
      logToFile(`Error deleting API config: ${error.message}`, "ERROR");
      throw error;
    }
  }

  async setCurrentApiConfig(event, configId) {
    try {
      const currentSettings = configService.getAISettings() || {};

      if (!currentSettings.apiConfigs) {
        return { success: false, error: "No API configs found" };
      }

      const config = currentSettings.apiConfigs.find((c) => c.id === configId);
      if (!config) {
        return { success: false, error: "Config not found" };
      }

      currentSettings.currentApiConfigId = configId;
      configService.saveAISettings(currentSettings);
      logToFile(
        `Current API config set to: ${config.name || configId}`,
        "INFO",
      );

      return { success: true };
    } catch (error) {
      logToFile(`Error setting current API config: ${error.message}`, "ERROR");
      throw error;
    }
  }

  async sendPrompt(event, prompt, settings) {
    if (!this.aiWorker) {
      throw new Error("AI Worker not initialized");
    }

    try {
      const requestId = this.nextRequestId++;

      return new Promise((resolve, reject) => {
        // 存储回调
        this.aiRequestMap.set(requestId, { resolve, reject });

        // 发送消息到worker
        this.aiWorker.postMessage({
          id: requestId,
          type: "prompt",
          prompt: prompt,
          settings: settings,
        });

        // 设置超时
        setTimeout(() => {
          if (this.aiRequestMap.has(requestId)) {
            this.aiRequestMap.delete(requestId);
            reject(new Error("Request timeout"));
          }
        }, 120000); // 2分钟超时
      });
    } catch (error) {
      logToFile(`Error sending prompt to AI: ${error.message}`, "ERROR");
      throw error;
    }
  }

  async sendAPIRequest(event, requestData, isStream) {
    if (!this.aiWorker) {
      throw new Error("AI Worker not initialized");
    }

    try {
      const requestId = this.nextRequestId++;
      const sessionId = Date.now().toString();

      if (isStream) {
        // 存储流式会话
        this.streamSessions.set(sessionId, requestId);
        this.currentSessionId = sessionId;

        // 发送消息到worker
        this.aiWorker.postMessage({
          id: requestId,
          type: "stream",
          sessionId: sessionId,
          requestData: requestData,
        });

        return { sessionId: sessionId };
      } else {
        // 非流式请求
        return new Promise((resolve, reject) => {
          this.aiRequestMap.set(requestId, { resolve, reject });

          this.aiWorker.postMessage({
            id: requestId,
            type: "api",
            requestData: requestData,
          });

          setTimeout(() => {
            if (this.aiRequestMap.has(requestId)) {
              this.aiRequestMap.delete(requestId);
              reject(new Error("Request timeout"));
            }
          }, 120000);
        });
      }
    } catch (error) {
      logToFile(`Error sending API request: ${error.message}`, "ERROR");
      throw error;
    }
  }

  async abortAPIRequest(event) {
    try {
      if (!this.currentSessionId) {
        return { success: false, error: "No active session" };
      }

      const requestId = this.streamSessions.get(this.currentSessionId);
      if (!requestId) {
        return { success: false, error: "Session not found" };
      }

      // 发送中止消息到worker
      if (this.aiWorker) {
        this.aiWorker.postMessage({
          type: "abort",
          sessionId: this.currentSessionId,
          requestId: requestId,
        });
      }

      // 清理会话
      this.streamSessions.delete(this.currentSessionId);
      this.currentSessionId = null;

      logToFile(
        `Aborted AI request for session: ${this.currentSessionId}`,
        "INFO",
      );
      return { success: true };
    } catch (error) {
      logToFile(`Error aborting API request: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async fetchModels(event, requestData) {
    if (!this.aiWorker) {
      throw new Error("AI Worker not initialized");
    }

    try {
      const requestId = this.nextRequestId++;

      return new Promise((resolve, reject) => {
        this.aiRequestMap.set(requestId, { resolve, reject });

        this.aiWorker.postMessage({
          id: requestId,
          type: "api_request",
          data: {
            ...requestData,
            type: "models",
          },
        });

        setTimeout(() => {
          if (this.aiRequestMap.has(requestId)) {
            this.aiRequestMap.delete(requestId);
            reject(new Error("Request timeout"));
          }
        }, 30000); // 30秒超时，获取模型列表可能需要更长时间
      });
    } catch (error) {
      logToFile(`Error fetching models: ${error.message}`, "ERROR");
      throw error;
    }
  }

  /**
   * 处理Worker消息
   */
  handleWorkerMessage(message) {
    const { id, type, result, error, data } = message;

    if (type === "stream") {
      // 处理流式响应
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send("ai:streamData", {
          sessionId: data.sessionId,
          data: data.content,
          done: data.done,
        });

        if (data.done) {
          this.streamSessions.delete(data.sessionId);
          if (this.currentSessionId === data.sessionId) {
            this.currentSessionId = null;
          }
        }
      }
    } else {
      // 处理普通请求响应
      const callback = this.aiRequestMap.get(id);
      if (callback) {
        if (error) {
          callback.reject(error);
        } else {
          callback.resolve(result);
        }
        this.aiRequestMap.delete(id);
      }
    }
  }

  /**
   * 清理AI处理器
   */
  cleanup() {
    // 清理所有待处理的请求
    for (const [id, callback] of this.aiRequestMap) {
      callback.reject(new Error("AI handler cleanup"));
    }
    this.aiRequestMap.clear();

    // 清理流式会话
    this.streamSessions.clear();
    this.currentSessionId = null;

    // 终止Worker
    if (this.aiWorker) {
      try {
        this.aiWorker.terminate();
        this.aiWorker = null;
        logToFile("AI Worker terminated", "INFO");
      } catch (error) {
        logToFile(`Error terminating AI Worker: ${error.message}`, "ERROR");
      }
    }
  }
}

module.exports = AIHandlers;
