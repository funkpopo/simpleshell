import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createEmptyProxyConfig,
  proxyFormFromStored,
} from "../lib/aiSettingsModel.js";

// AI 请求代理表单：字段编辑、校验与保存（密码只写不读，保留“已存储”标记）。
// 错误/成功提示写入设置对话框共享的提示状态。
export default function useAIProxySettings({ setError, setSuccess }) {
  const { t } = useTranslation();
  const [proxyConfig, setProxyConfig] = useState(createEmptyProxyConfig());
  const [proxySaving, setProxySaving] = useState(false);
  const [proxyExpanded, setProxyExpanded] = useState(false);

  // 加载代理配置
  const applyStoredProxy = (storedProxy) => {
    setProxyConfig(proxyFormFromStored(storedProxy));
  };

  // 更新代理配置字段
  const handleProxyChange = (field, value) => {
    setProxyConfig((prev) => ({ ...prev, [field]: value }));
    setError("");
    setSuccess("");
  };

  // 保存代理配置并应用到AI请求
  const handleSaveProxy = async () => {
    if (proxyConfig.enabled) {
      if (!proxyConfig.host.trim()) {
        setError(t("aiSettings.proxyHostRequired"));
        return;
      }
      const port = Number(proxyConfig.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        setError(t("aiSettings.proxyPortRequired"));
        return;
      }
    }

    setProxySaving(true);
    setError("");
    setSuccess("");
    try {
      if (!window.terminalAPI?.saveAISettingsProxy) {
        setError(
          t("aiSettings.proxySaveFailed") +
            ": " +
            t("aiSettings.apiUnavailable"),
        );
        return;
      }
      const typedPassword =
        typeof proxyConfig.password === "string" ? proxyConfig.password : "";
      const keepStoredPassword = proxyConfig.hasProxyPassword && !typedPassword;
      const payload = {
        enabled: proxyConfig.enabled,
        type: proxyConfig.type || "http",
        host: proxyConfig.enabled ? proxyConfig.host.trim() : "",
        port: proxyConfig.enabled ? Number(proxyConfig.port) : 0,
        username: proxyConfig.enabled ? proxyConfig.username : "",
        password: proxyConfig.enabled ? typedPassword : "",
        hasProxyPassword: keepStoredPassword,
      };

      const result = await window.terminalAPI.saveAISettingsProxy(payload);
      if (result) {
        setProxyConfig((prev) => ({
          ...prev,
          password: "",
          hasProxyPassword: keepStoredPassword || Boolean(typedPassword),
        }));
        setSuccess(t("aiSettings.proxySaved"));
      } else {
        setError(t("aiSettings.proxySaveFailed"));
      }
    } catch {
      setError(t("aiSettings.proxySaveFailed"));
    } finally {
      setProxySaving(false);
    }
  };

  return {
    proxyConfig,
    proxySaving,
    proxyExpanded,
    setProxyExpanded,
    applyStoredProxy,
    handleProxyChange,
    handleSaveProxy,
  };
}
