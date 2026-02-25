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

  _toRendererSafeApiConfig(config) {
    if (!config || typeof config !== "object") {
      return config;
    }

    return {
      ...config,
      hasApiKey: Boolean(config.apiKey),
      apiKey: "",
    };
  }

  _toRendererSafeSettings(settings) {
    const safeSettings =
      settings && typeof settings === "object" ? { ...settings } : {};

    const configs = Array.isArray(safeSettings.configs)
      ? safeSettings.configs
      : [];
    safeSettings.configs = configs.map((config) =>
      this._toRendererSafeApiConfig(config),
    );

    safeSettings.current = safeSettings.current
      ? this._toRendererSafeApiConfig(safeSettings.current)
      : null;

    return safeSettings;
  }

  _stripApiConfigMeta(config) {
    if (!config || typeof config !== "object") {
      return config;
    }

    const normalizedConfig = { ...config };
    delete normalizedConfig.hasApiKey;
    return normalizedConfig;
  }

  _normalizeSettingsForStorage(settings) {
    const normalizedSettings =
      settings && typeof settings === "object" ? { ...settings } : {};
    const configs = Array.isArray(normalizedSettings.configs)
      ? normalizedSettings.configs
      : [];

    normalizedSettings.configs = configs.map((config) =>
      this._stripApiConfigMeta(config),
    );
    normalizedSettings.current = normalizedSettings.current
      ? this._stripApiConfigMeta(normalizedSettings.current)
      : null;

    return normalizedSettings;
  }

  _isNonEmptyString(value) {
    return typeof value === "string" && value.trim() !== "";
  }

  _findStoredApiConfig(settings, apiConfigId) {
    const configs = Array.isArray(settings?.configs) ? settings.configs : [];

    if (this._isNonEmptyString(apiConfigId)) {
      return configs.find((config) => config.id === apiConfigId) || null;
    }

    if (settings?.current?.id) {
      return (
        configs.find((config) => config.id === settings.current.id) ||
        settings.current
      );
    }

    return settings?.current || null;
  }

  _preserveStoredApiKeys(rawSettings, normalizedSettings) {
    const mergedSettings =
      normalizedSettings && typeof normalizedSettings === "object"
        ? { ...normalizedSettings }
        : {};
    const existingSettings = configService.loadAISettings();
    const existingConfigs = Array.isArray(existingSettings?.configs)
      ? existingSettings.configs
      : [];
    const existingApiKeyById = new Map(
      existingConfigs
        .filter((config) => this._isNonEmptyString(config?.id))
        .map((config) => [config.id, config.apiKey]),
    );

    const rawConfigs = Array.isArray(rawSettings?.configs)
      ? rawSettings.configs
      : [];
    const normalizedConfigs = Array.isArray(mergedSettings.configs)
      ? mergedSettings.configs
      : [];

    mergedSettings.configs = normalizedConfigs.map((config, index) => {
      const rawConfig = rawConfigs[index];
      const shouldPreserveExistingKey =
        rawConfig?.hasApiKey === true &&
        !this._isNonEmptyString(config?.apiKey);

      if (!shouldPreserveExistingKey || !this._isNonEmptyString(config?.id)) {
        return config;
      }

      const existingKey = existingApiKeyById.get(config.id);
      if (!this._isNonEmptyString(existingKey)) {
        return config;
      }

      return {
        ...config,
        apiKey: existingKey,
      };
    });

    const rawCurrent = rawSettings?.current;
    const normalizedCurrent = mergedSettings.current;
    if (
      normalizedCurrent &&
      rawCurrent?.hasApiKey === true &&
      !this._isNonEmptyString(normalizedCurrent.apiKey)
    ) {
      let existingKey = null;
      if (this._isNonEmptyString(normalizedCurrent.id)) {
        existingKey = existingApiKeyById.get(normalizedCurrent.id) || null;
      }

      if (!this._isNonEmptyString(existingKey)) {
        const existingCurrent = existingSettings?.current;
        existingKey = existingCurrent?.apiKey || null;
      }

      if (this._isNonEmptyString(existingKey)) {
        mergedSettings.current = {
          ...normalizedCurrent,
          apiKey: existingKey,
        };
      }
    }

    return mergedSettings;
  }

  _resolveApiRequestData(requestData) {
    const resolvedData = {
      ...requestData,
    };
    if (typeof resolvedData.apiKey === "string") {
      resolvedData.apiKey = resolvedData.apiKey.trim();
    }

    const settings = configService.loadAISettings();
    const targetConfig = this._findStoredApiConfig(
      settings,
      resolvedData.apiConfigId,
    );
    const hasInlineApiKey = this._isNonEmptyString(resolvedData.apiKey);

    if (targetConfig) {
      // When using a stored API key, keep endpoint/model pinned to saved config.
      if (!hasInlineApiKey) {
        resolvedData.url = targetConfig.apiUrl;
        resolvedData.model = targetConfig.model;
        resolvedData.provider = targetConfig.provider;
        resolvedData.apiKey = targetConfig.apiKey;
      } else {
        resolvedData.url = resolvedData.url || targetConfig.apiUrl;
        resolvedData.model = resolvedData.model || targetConfig.model;
        resolvedData.provider = resolvedData.provider || targetConfig.provider;
      }
      if (
        resolvedData.maxTokens === undefined &&
        targetConfig.maxTokens !== undefined
      ) {
        resolvedData.maxTokens = targetConfig.maxTokens;
      }
      if (
        resolvedData.temperature === undefined &&
        targetConfig.temperature !== undefined
      ) {
        resolvedData.temperature = targetConfig.temperature;
      }
    }

    return resolvedData;
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
    const settings = configService.loadAISettings();
    return this._toRendererSafeSettings(settings);
  }

  async saveSettings(event, settings) {
    const existingSettings = configService.loadAISettings() || {};
    const normalizedSettings = this._normalizeSettingsForStorage(settings);
    const mergedInputSettings = this._preserveStoredApiKeys(
      settings,
      normalizedSettings,
    );
    const mergedSettings = {
      ...existingSettings,
      ...mergedInputSettings,
    };
    return configService.saveAISettings(mergedSettings);
  }

  async saveApiConfig(event, config) {
    try {
      logToFile(
        `Saving API config: ${JSON.stringify({
          id: config.id,
          name: config.name,
          model: config.model,
        })}`,
        "INFO",
      );
      const settings = configService.loadAISettings();
      if (!settings.configs) settings.configs = [];
      if (!config.id) config.id = Date.now().toString();
      const existingIndex = settings.configs.findIndex(
        (c) => c.id === config.id,
      );
      const normalizedConfig = { ...config };
      delete normalizedConfig.hasApiKey;

      if (existingIndex >= 0) {
        const existingConfig = settings.configs[existingIndex];
        if (!normalizedConfig.apiKey && existingConfig?.apiKey) {
          normalizedConfig.apiKey = existingConfig.apiKey;
        }
        settings.configs[existingIndex] = {
          ...existingConfig,
          ...normalizedConfig,
        };
      } else {
        if (!normalizedConfig.apiKey) {
          throw new Error("API Key is required for a new API config");
        }
        settings.configs.push(normalizedConfig);
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
      const resolvedRequestData = this._resolveApiRequestData(
        requestData || {},
      );

      // 验证请求数据
      if (
        !resolvedRequestData ||
        !resolvedRequestData.url ||
        !resolvedRequestData.apiKey ||
        !resolvedRequestData.model
      ) {
        throw new Error("请先配置 AI API，包括 API 地址、密钥和模型");
      }

      if (!resolvedRequestData.messages) {
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
        aiWorkerManager.setCurrentSessionId(resolvedRequestData.sessionId);
      }

      // 准备发送到Worker的数据
      const workerData = {
        ...resolvedRequestData,
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
      const resolvedRequestData = this._resolveApiRequestData(
        requestData || {},
      );
      if (!resolvedRequestData.url || !resolvedRequestData.apiKey) {
        throw new Error("请先配置有效的 API 地址和密钥");
      }

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
            ...resolvedRequestData,
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
