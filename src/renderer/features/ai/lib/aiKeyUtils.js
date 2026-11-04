/**
 * AI API Key 相关的共享工具函数
 * 供 AISettings 与 AIChatWindow 复用。
 */

export const hasConfiguredApiKey = (config) =>
  Boolean(config?.apiKey?.trim()) || Boolean(config?.hasApiKey);

export const buildInlineApiKeyPayload = (config) => {
  const apiKey = typeof config?.apiKey === "string" ? config.apiKey.trim() : "";
  return apiKey ? { apiKey } : {};
};

// 对话可用的最小配置：URL、密钥（内联或主进程已存）与模型均存在。
export const isApiConfigReady = (config) =>
  Boolean(
    config && config.apiUrl && hasConfiguredApiKey(config) && config.model,
  );
