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
