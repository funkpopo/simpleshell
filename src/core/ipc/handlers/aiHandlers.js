const configService = require("../../../services/configService");
const { logToFile } = require("../../utils/logger");
const aiWorkerManager = require("../../workers/aiWorkerManager");
const { IPC_REQUEST_CHANNELS } = require("../schema/channels");
const {
  t: translateLocale,
  getUiLanguage,
} = require("../../../shared/mainI18n");

// Wrapper keeps call sites static for check-i18n; implementation uses a non-t name.
const aiText = (key, params = {}) =>
  translateLocale(key, { lng: getUiLanguage(configService), ...params });

const CUSTOM_RULE_LEVELS = ["critical", "high", "medium", "low"];
const MAX_CUSTOM_RULES_PER_LEVEL = 50;
const MAX_CUSTOM_RULE_PATTERN_LENGTH = 200;
const AI_PROXY_TYPES = new Set(["http", "https"]);
const MAX_AI_PROXY_HOST_LENGTH = 255;

const hasNestedQuantifier = (pattern) =>
  /\((?:[^()\\]|\\.|\[[^\]]*\])*(?:[+*]|\{\d+(?:,\d*)?\})(?:[^()\\]|\\.|\[[^\]]*\])*\)(?:[+*]|\{\d+(?:,\d*)?\})/.test(
    pattern,
  );

const hasRepeatedWildcard = (pattern) => /(?:\.\*){2,}/.test(pattern);

const hasControlCharacter = (pattern) => /[\u0000-\u001f\u007f]/.test(pattern);

const validateCustomRiskPattern = (pattern) => {
  const normalizedPattern = typeof pattern === "string" ? pattern.trim() : "";

  if (
    !normalizedPattern ||
    normalizedPattern.length > MAX_CUSTOM_RULE_PATTERN_LENGTH ||
    hasControlCharacter(normalizedPattern) ||
    hasNestedQuantifier(normalizedPattern) ||
    hasRepeatedWildcard(normalizedPattern)
  ) {
    return null;
  }

  try {
    new RegExp(normalizedPattern, "i");
  } catch {
    return null;
  }

  return normalizedPattern;
};

const normalizeCustomRiskRules = (rules) => {
  const normalizedRules = {
    critical: [],
    high: [],
    medium: [],
    low: [],
  };

  if (!rules || typeof rules !== "object") {
    return normalizedRules;
  }

  for (const level of CUSTOM_RULE_LEVELS) {
    const patterns = Array.isArray(rules[level]) ? rules[level] : [];
    const seenPatterns = new Set();

    for (const rawPattern of patterns) {
      if (normalizedRules[level].length >= MAX_CUSTOM_RULES_PER_LEVEL) {
        break;
      }

      const pattern = validateCustomRiskPattern(rawPattern);
      if (!pattern || seenPatterns.has(pattern)) {
        continue;
      }

      seenPatterns.add(pattern);
      normalizedRules[level].push(pattern);
    }
  }

  return normalizedRules;
};

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

    safeSettings.customRiskRules = normalizeCustomRiskRules(
      safeSettings.customRiskRules,
    );

    // 代理配置脱敏：不回显密码，仅以 hasProxyPassword 标记是否已保存密码
    if (
      safeSettings.proxyConfig &&
      typeof safeSettings.proxyConfig === "object"
    ) {
      safeSettings.proxyConfig = {
        ...safeSettings.proxyConfig,
        hasProxyPassword: Boolean(safeSettings.proxyConfig.password),
        password: "",
      };
    }

    return safeSettings;
  }

  _stripProxyMeta(proxyConfig) {
    if (!proxyConfig || typeof proxyConfig !== "object") {
      return proxyConfig;
    }
    const normalized = { ...proxyConfig };
    delete normalized.hasProxyPassword;
    return normalized;
  }

  _normalizeProxyConfig(proxyConfig) {
    const cfg =
      proxyConfig && typeof proxyConfig === "object" ? proxyConfig : {};
    const enabled = cfg.enabled === true;

    if (!enabled) {
      return {
        enabled: false,
        type: "http",
        host: "",
        port: 0,
        username: "",
        password: "",
      };
    }

    const type = String(cfg.type || "http").toLowerCase();
    const host = typeof cfg.host === "string" ? cfg.host.trim() : "";
    const port = Number(cfg.port);
    const validPort = Number.isInteger(port) && port >= 1 && port <= 65535;
    if (
      !AI_PROXY_TYPES.has(type) ||
      !host ||
      host.length > MAX_AI_PROXY_HOST_LENGTH ||
      /[\u0000-\u0020\u007f]/.test(host) ||
      host.includes("/") ||
      host.includes("@") ||
      !validPort
    ) {
      throw new Error("Invalid AI proxy configuration");
    }

    return {
      enabled: true,
      type,
      host,
      port,
      username: this._isNonEmptyString(cfg.username)
        ? String(cfg.username)
        : "",
      password: this._isProvidedString(cfg.password)
        ? String(cfg.password)
        : "",
    };
  }

  /**
   * 解析 AI 请求应使用的代理。
   * 若 AI 设置中启用了代理则返回该代理；否则返回 null（回退到默认/系统代理）。
   * @returns {object|null}
   */
  _resolveAIActiveProxy() {
    const settings = configService.loadAISettings() || {};
    const aiProxy = settings.proxyConfig;
    if (!aiProxy || aiProxy.enabled !== true) {
      return null;
    }
    let normalized;
    try {
      normalized = this._normalizeProxyConfig(aiProxy);
    } catch {
      return null;
    }

    if (!normalized.enabled) return null;

    return {
      type: normalized.type,
      host: normalized.host,
      port: normalized.port,
      username: normalized.username ? normalized.username : undefined,
      password: this._isProvidedString(normalized.password)
        ? normalized.password
        : undefined,
    };
  }

  _applyAIActiveProxy() {
    try {
      aiWorkerManager.updateAIProxy(this._resolveAIActiveProxy());
    } catch (error) {
      logToFile(`Failed to apply AI proxy: ${error.message}`, "WARN");
    }
  }

  _stripApiConfigMeta(config) {
    if (!config || typeof config !== "object") {
      return config;
    }

    const normalizedConfig = { ...config };
    delete normalizedConfig.hasApiKey;
    delete normalizedConfig.maxTokens;
    delete normalizedConfig.temperature;
    if (this._isNonEmptyString(normalizedConfig.model)) {
      normalizedConfig.model = normalizedConfig.model.trim();
      normalizedConfig.name = normalizedConfig.model;
    }
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

    if (normalizedSettings.proxyConfig) {
      normalizedSettings.proxyConfig = this._normalizeProxyConfig(
        normalizedSettings.proxyConfig,
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(
        normalizedSettings,
        "customRiskRules",
      )
    ) {
      normalizedSettings.customRiskRules = normalizeCustomRiskRules(
        normalizedSettings.customRiskRules,
      );
    }

    return normalizedSettings;
  }

  _isNonEmptyString(value) {
    return typeof value === "string" && value.trim() !== "";
  }

  _isProvidedString(value) {
    return typeof value === "string" && value.length > 0;
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

  _preserveStoredProxyPassword(rawSettings, normalizedSettings) {
    const rawProxy = rawSettings?.proxyConfig;
    const normalizedProxy = normalizedSettings?.proxyConfig;
    if (
      !rawProxy ||
      typeof rawProxy !== "object" ||
      !normalizedProxy ||
      typeof normalizedProxy !== "object" ||
      rawProxy.hasProxyPassword !== true ||
      !normalizedProxy.enabled ||
      this._isProvidedString(normalizedProxy.password)
    ) {
      return normalizedSettings;
    }

    const existingProxy = configService.loadAISettings()?.proxyConfig;
    if (this._isProvidedString(existingProxy?.password)) {
      normalizedSettings.proxyConfig = {
        ...normalizedProxy,
        password: existingProxy.password,
      };
    }

    return normalizedSettings;
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
    }

    return resolvedData;
  }

  /**
   * 获取所有AI处理器
   */
  getHandlers() {
    return [
      {
        channel: IPC_REQUEST_CHANNELS.AI_LOAD_SETTINGS,
        category: "ai",
        handler: this.loadSettings.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.AI_SAVE_SETTINGS,
        category: "ai",
        handler: this.saveSettings.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.AI_SAVE_API_CONFIG,
        category: "ai",
        handler: this.saveApiConfig.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.AI_DELETE_API_CONFIG,
        category: "ai",
        handler: this.deleteApiConfig.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.AI_SET_CURRENT_API_CONFIG,
        category: "ai",
        handler: this.setCurrentApiConfig.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.AI_SEND_PROMPT,
        category: "ai",
        handler: this.sendPrompt.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.AI_SEND_API_REQUEST,
        category: "ai",
        handler: this.sendAPIRequest.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.AI_ABORT_API_REQUEST,
        category: "ai",
        handler: this.abortAPIRequest.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.AI_FETCH_MODELS,
        category: "ai",
        handler: this.fetchModels.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.AI_SAVE_CUSTOM_RISK_RULES,
        category: "ai",
        handler: this.saveCustomRiskRules.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.AI_GET_PROXY_CONFIG,
        category: "ai",
        handler: this.getProxyConfig.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.AI_SAVE_PROXY_CONFIG,
        category: "ai",
        handler: this.saveProxyConfig.bind(this),
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
    this._preserveStoredProxyPassword(settings, mergedInputSettings);
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
      const normalizedConfig = this._stripApiConfigMeta(config);
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
        delete settings.configs[existingIndex].maxTokens;
        delete settings.configs[existingIndex].temperature;
        if (settings.current?.id === normalizedConfig.id) {
          settings.current = { ...settings.configs[existingIndex] };
        }
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
      return {
        error: error.message || aiText("mainProcess.ai.sendError"),
      };
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
        throw new Error(aiText("mainProcess.ai.configRequired"));
      }

      if (!resolvedRequestData.messages) {
        throw new Error(aiText("mainProcess.ai.invalidRequest"));
      }

      // 确保Worker已创建
      const aiWorker = aiWorkerManager.ensureAIWorker();
      if (!aiWorker) {
        throw new Error(aiText("mainProcess.ai.workerCreateFailed"));
      }

      // 应用 AI 代理配置
      this._applyAIActiveProxy();

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
          reject(new Error(aiText("mainProcess.ai.requestTimeout")));
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
        aiWorkerManager.postMessage({
          kind: "request",
          requestId,
          payload: workerData,
        });

        // 如果是流式请求，立即返回成功
        if (isStream) {
          resolve({
            success: true,
            message: aiText("mainProcess.ai.streamStarted"),
          });
        }
      });
    } catch (error) {
      // 透传 statusCode 供错误分类/前端展示；统一错误响应由 wrapIpcHandler 生成
      if (error && typeof error === "object") {
        if (error.statusCode == null && error.raw?.statusCode != null) {
          error.statusCode = error.raw.statusCode;
        }
      }
      throw error;
    }
  }

  async abortAPIRequest() {
    const currentSessionId = aiWorkerManager.getCurrentSessionId();
    const aiWorker = aiWorkerManager.getAIWorker();
    // 检查是否有当前会话ID
    if (!currentSessionId || !aiWorker) {
      throw new Error(aiText("mainProcess.ai.noActiveRequest"));
    }

    // 生成取消请求ID
    const cancelRequestId = `cancel_${Date.now()}`;

    // 尝试通过Worker取消请求
    aiWorkerManager.postMessage({
      kind: "cancel",
      requestId: cancelRequestId,
      sessionId: currentSessionId,
    });

    return {
      success: true,
      message: aiText("mainProcess.ai.requestAborted"),
    };
  }

  async fetchModels(event, requestData) {
    void event;
    const resolvedRequestData = this._resolveApiRequestData(requestData || {});
    if (!resolvedRequestData.url || !resolvedRequestData.apiKey) {
      throw new Error(aiText("mainProcess.ai.apiConfigRequired"));
    }

    // 确保Worker已创建
    const aiWorker = aiWorkerManager.ensureAIWorker();
    if (!aiWorker) {
      throw new Error(aiText("mainProcess.ai.workerCreateFailed"));
    }

    // 应用 AI 代理配置
    this._applyAIActiveProxy();

    const requestId = aiWorkerManager.getNextRequestId();
    const timeout = 30000; // 30秒超时

    return new Promise((resolve, reject) => {
      // 存储回调
      aiWorkerManager.setRequestCallback(requestId, { resolve, reject });

      // 发送消息到worker
      aiWorkerManager.postMessage({
        kind: "request",
        requestId,
        payload: {
          ...resolvedRequestData,
          type: "models",
        },
      });

      // 设置超时
      setTimeout(() => {
        if (aiWorkerManager.hasRequest(requestId)) {
          aiWorkerManager.deleteRequestCallback(requestId);
          reject(new Error(aiText("mainProcess.ai.fetchModelsTimeout")));
        }
      }, timeout);
    });
  }

  async saveCustomRiskRules(event, rules) {
    void event;
    const currentSettings = configService.loadAISettings() || {};
    currentSettings.customRiskRules = normalizeCustomRiskRules(rules);
    configService.saveAISettings(currentSettings);
    logToFile("Custom risk rules saved", "INFO");
    return { success: true };
  }

  async getProxyConfig() {
    const settings = configService.loadAISettings() || {};
    const proxyConfig = settings.proxyConfig || null;
    if (proxyConfig && typeof proxyConfig === "object") {
      return {
        ...proxyConfig,
        hasProxyPassword: Boolean(proxyConfig.password),
        password: "",
      };
    }
    return null;
  }

  async saveProxyConfig(event, proxyConfig) {
    void event;
    try {
      const normalized = this._normalizeProxyConfig(proxyConfig);
      const settings = configService.loadAISettings() || {};
      const stored = settings.proxyConfig || {};

      // 若前端未回传密码但后端已保存，则保留原密码
      if (
        normalized.enabled &&
        !this._isProvidedString(normalized.password) &&
        proxyConfig?.hasProxyPassword === true &&
        this._isProvidedString(stored.password)
      ) {
        normalized.password = stored.password;
      }

      settings.proxyConfig = this._stripProxyMeta(normalized);
      const saved = configService.saveAISettings(settings);

      // 保存后立即应用到 Rust AI sidecar
      this._applyAIActiveProxy();

      logToFile(
        `AI proxy config saved: ${JSON.stringify({
          enabled: normalized.enabled,
          type: normalized.type,
          host: normalized.enabled ? normalized.host : "",
          port: normalized.enabled ? normalized.port : 0,
          hasAuth: Boolean(normalized.username && normalized.password),
        })}`,
        "INFO",
      );
      return saved;
    } catch (error) {
      logToFile(`Failed to save AI proxy config: ${error.message}`, "ERROR");
      return false;
    }
  }
}

module.exports = AIHandlers;
