import { RISK_LEVELS } from "./aiSystemPrompt";

// AI 设置对话框的纯数据模型：表单默认值、存储格式映射与展示辅助。

// 渠道类型常量 - 定义在组件外部以保持稳定引用
export const PROVIDER_TYPES = {
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  GEMINI: "gemini",
};

// 自定义/内置风险规则的展示顺序
export const RISK_RULE_LEVELS = ["critical", "high", "medium", "low"];

export const createEmptyCustomRules = () => ({
  critical: [],
  high: [],
  medium: [],
  low: [],
});

export const createEmptyConfig = () => ({
  id: "",
  name: "",
  provider: PROVIDER_TYPES.OPENAI,
  apiUrl: "",
  apiKey: "",
  hasApiKey: false,
  model: "",
  streamEnabled: true,
});

export const createEmptyProxyConfig = () => ({
  enabled: false,
  type: "http",
  host: "",
  port: "",
  username: "",
  password: "",
  hasProxyPassword: false,
});

export const buildSavableApiConfig = (config) => {
  const { maxTokens, temperature, ...savableConfig } = config || {};
  void maxTokens;
  void temperature;

  const model =
    typeof savableConfig.model === "string" ? savableConfig.model.trim() : "";

  return {
    ...savableConfig,
    model,
    name: model,
  };
};

// 从已保存的“当前配置”还原编辑表单（缺省字段回落为空串）
export const configFromStoredCurrent = (current) => ({
  id: current.id || "",
  name: current.model || current.name || "",
  provider: current.provider || PROVIDER_TYPES.OPENAI,
  apiUrl: current.apiUrl || "",
  apiKey: current.apiKey || "",
  hasApiKey: current.hasApiKey === true,
  model: current.model || "",
  streamEnabled: current.streamEnabled !== false,
});

// 从列表中的某条配置进入编辑（保留原字段值，不做空串回落）
export const configFromListEntry = (apiConfig) => ({
  id: apiConfig.id,
  name: apiConfig.model || apiConfig.name || "",
  provider: apiConfig.provider || PROVIDER_TYPES.OPENAI,
  apiUrl: apiConfig.apiUrl,
  apiKey: apiConfig.apiKey,
  hasApiKey: apiConfig.hasApiKey === true,
  model: apiConfig.model,
  streamEnabled: apiConfig.streamEnabled !== false,
});

// 已保存的代理配置 → 表单状态（密码从不回显，仅保留“已存储”标记）
export const proxyFormFromStored = (storedProxy) => ({
  enabled: storedProxy?.enabled === true,
  type: storedProxy?.type === "https" ? "https" : "http",
  host: storedProxy?.host || "",
  port: storedProxy?.port ? String(storedProxy.port) : "",
  username: storedProxy?.username || "",
  password: "",
  hasProxyPassword: storedProxy?.hasProxyPassword === true,
});

// 模型列表去空白、去空、去重
export const normalizeModelList = (models) => [
  ...new Set(
    models
      .map((model) => (typeof model === "string" ? model.trim() : ""))
      .filter(Boolean),
  ),
];

// 处理不同的错误格式
export const describeRequestError = (err, unknownMessage) => {
  let errorMessage = unknownMessage;
  if (err?.error?.message) {
    // 从Worker返回的错误对象格式: {error: {message: "..."}}
    errorMessage = err.error.message;
  } else if (err?.message) {
    // 标准的Error对象
    errorMessage = err.message;
  } else if (typeof err === "string") {
    // 字符串错误
    errorMessage = err;
  } else {
    // 其他对象，转为字符串
    errorMessage = String(err);
  }
  return errorMessage;
};

// 获取风险等级颜色
export const getRiskLevelColor = (level) => {
  const riskKey = level.toUpperCase();
  return RISK_LEVELS[riskKey]?.color || "#666";
};

// 获取风险等级标签
export const getRiskLevelLabel = (t, level) => {
  switch (String(level || "").toLowerCase()) {
    case "safe":
      return t("ai.riskLevels.safe");
    case "low":
      return t("ai.riskLevels.low");
    case "medium":
      return t("ai.riskLevels.medium");
    case "high":
      return t("ai.riskLevels.high");
    case "critical":
      return t("ai.riskLevels.critical");
    default:
      return level;
  }
};
