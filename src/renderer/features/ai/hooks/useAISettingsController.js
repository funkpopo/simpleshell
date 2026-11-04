import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  hasConfiguredApiKey,
  buildInlineApiKeyPayload,
} from "../lib/aiKeyUtils.js";
import {
  buildSavableApiConfig,
  configFromListEntry,
  configFromStoredCurrent,
  createEmptyConfig,
  describeRequestError,
  normalizeModelList,
} from "../lib/aiSettingsModel.js";
import useAIProxySettings from "./useAIProxySettings.js";
import useCustomRiskRules from "./useCustomRiskRules.js";

// AI 设置对话框的状态与动作：加载设置、API 配置列表/编辑（测试、获取模型、
// 保存、删除确认、设为当前），并组合代理与自定义风险规则子状态。
export default function useAISettingsController({ open, onClose }) {
  const { t } = useTranslation();
  const firstInputRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [availableModels, setAvailableModels] = useState([]);

  // 标签页状态
  const [tabValue, setTabValue] = useState(0);

  // API配置列表状态
  const [apiConfigs, setApiConfigs] = useState([]);
  const [currentApiId, setCurrentApiId] = useState(null);

  // 编辑模式状态
  const [editMode, setEditMode] = useState(false); // false: 列表模式, true: 编辑模式
  const [editingConfig, setEditingConfig] = useState(null); // 正在编辑的配置

  // AI配置状态
  const [config, setConfig] = useState(createEmptyConfig());

  // AI代理配置状态
  const proxy = useAIProxySettings({ setError, setSuccess });

  // 自定义风险规则状态
  const rules = useCustomRiskRules({ setLoading, setError, setSuccess });

  // 删除确认对话框状态
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState(null);

  // 加载AI设置并管理焦点 - 只在对话框打开时执行
  useEffect(() => {
    if (open) {
      setEditMode(false);
      setEditingConfig(null);
      loadSettings();

      // 在对话框完全渲染后设置焦点到添加按钮
      setTimeout(() => {
        const addButton = document.querySelector(
          '[data-testid="add-api-button"]',
        );
        if (addButton) {
          addButton.focus();
        }
      }, 100);
    }
  }, [open]); // 只依赖 open，移除 editMode 依赖

  // 当切换到编辑模式时设置焦点
  useEffect(() => {
    if (editMode && open) {
      // 延迟设置焦点，确保DOM更新完成
      setTimeout(() => {
        if (firstInputRef.current) {
          firstInputRef.current.focus();
        }
      }, 100);
    }
  }, [editMode, open]);

  const loadSettings = async () => {
    setLoading(true);
    setError("");
    try {
      if (window.terminalAPI?.loadAISettings) {
        const settings = await window.terminalAPI.loadAISettings();

        // 设置API配置列表
        setApiConfigs(settings.configs || []);

        // 设置当前API
        if (settings.current) {
          setCurrentApiId(settings.current.id || null);
          setConfig(configFromStoredCurrent(settings.current));
        } else {
          // 如果没有当前配置，重置表单
          resetConfig();
        }

        // 加载自定义风险规则
        rules.applyStoredRules(settings.customRiskRules);

        // 加载代理配置
        proxy.applyStoredProxy(settings.proxyConfig);
      }
    } catch {
      setError(t("aiSettings.configSaveFailed"));
    } finally {
      setLoading(false);
    }
  };

  // 重置配置表单
  const resetConfig = () => {
    setConfig(createEmptyConfig());
  };

  const handleConfigChange = (field, value) => {
    setConfig((prev) => {
      if (field === "apiKey") {
        const typedApiKey = typeof value === "string" ? value.trim() : "";
        const keepStoredKey = Boolean(
          prev.id && prev.hasApiKey && !typedApiKey,
        );
        return {
          ...prev,
          apiKey: value,
          hasApiKey: keepStoredKey || Boolean(typedApiKey),
        };
      }

      if (field === "provider" || field === "apiUrl") {
        setAvailableModels([]);
        return {
          ...prev,
          [field]: value,
          model: "",
          name: "",
        };
      }

      if (field === "model") {
        return {
          ...prev,
          model: value,
          name: value,
        };
      }

      return {
        ...prev,
        [field]: value,
      };
    });
    setError("");
    setSuccess("");
  };

  // 添加新API配置
  const handleAddApi = () => {
    resetConfig();
    setAvailableModels([]);
    setEditMode(true);
    setEditingConfig(null);
  };

  // 编辑API配置
  const handleEditApi = (apiConfig) => {
    setConfig(configFromListEntry(apiConfig));
    setAvailableModels(apiConfig.model ? [apiConfig.model] : []);
    setEditMode(true);
    setEditingConfig(apiConfig);
  };

  // 执行配置动作并统一处理成功/失败提示（失败时 setError 并重新加载设置）
  const runConfigAction = async (action, successMessage, failedMessage) => {
    try {
      const result = await action();
      if (result) {
        setSuccess(successMessage);
        await loadSettings(); // 重新加载设置
        return true;
      }
      setError(failedMessage);
      return false;
    } catch {
      setError(failedMessage);
      return false;
    }
  };

  // 删除API配置 - 打开确认对话框
  const handleDeleteApi = (apiId) => {
    setDeleteTargetId(apiId);
    setDeleteConfirmOpen(true);
  };

  // 确认删除API配置
  const handleConfirmDelete = async () => {
    if (!deleteTargetId) return;

    await runConfigAction(
      () => window.terminalAPI.deleteApiConfig(deleteTargetId),
      t("aiSettings.deleteSuccess"),
      t("aiSettings.deleteFailed"),
    );

    setDeleteConfirmOpen(false);
    setDeleteTargetId(null);
  };

  // 取消删除
  const handleCancelDelete = () => {
    setDeleteConfirmOpen(false);
    setDeleteTargetId(null);
  };

  // 设置为当前API
  const handleSetCurrent = async (apiId) => {
    await runConfigAction(
      () => window.terminalAPI.setCurrentApiConfig(apiId),
      t("aiSettings.setCurrentSuccess"),
      t("aiSettings.setCurrentFailed"),
    );
  };

  // 取消编辑
  const handleCancelEdit = () => {
    setEditMode(false);
    setEditingConfig(null);
    loadSettings(); // 重新加载当前设置
  };

  const validateConfig = () => {
    if (!config.apiUrl.trim()) {
      setError(t("aiSettings.apiUrlRequired"));
      return false;
    }
    if (!hasConfiguredApiKey(config)) {
      setError(t("aiSettings.apiKeyRequired"));
      return false;
    }
    if (!config.model.trim()) {
      setError(t("aiSettings.modelRequired"));
      return false;
    }

    // 验证URL格式
    try {
      new URL(config.apiUrl);
    } catch {
      setError(t("aiSettings.invalidUrl"));
      return false;
    }

    return true;
  };

  const handleSave = async () => {
    if (!validateConfig()) return;

    setLoading(true);
    setError("");
    try {
      if (editMode) {
        // 编辑模式：保存单个API配置
        const apiConfig = buildSavableApiConfig({
          ...config,
          id: config.id || Date.now().toString(),
        });

        const result = await window.terminalAPI.saveApiConfig(apiConfig);
        if (result) {
          setSuccess(t("aiSettings.configSaved"));
          setEditMode(false);
          setEditingConfig(null);
          await loadSettings(); // 重新加载设置
        } else {
          setError(t("aiSettings.configSaveFailed"));
        }
      } else {
        // 列表模式：保存整体设置（兼容旧版本）
        const apiConfig = buildSavableApiConfig({
          ...config,
          id: Date.now().toString(),
        });
        const settings = {
          current: apiConfig,
          configs: [apiConfig],
        };

        const result = await window.terminalAPI.saveAISettings(settings);
        if (result) {
          setSuccess(t("aiSettings.configSaved"));
          setTimeout(() => {
            onClose();
          }, 1500);
        } else {
          setError(t("aiSettings.configSaveFailed"));
        }
      }
    } catch {
      setError(t("aiSettings.configSaveFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    if (!validateConfig()) return;

    setTesting(true);
    setError("");
    setSuccess("");

    try {
      if (window.terminalAPI?.sendAPIRequest) {
        const requestData = {
          apiConfigId: config.id || undefined,
          url: config.apiUrl,
          ...buildInlineApiKeyPayload(config),
          model: config.model,
          provider: config.provider,
          messages: [{ role: "user", content: "Hello" }],
        };

        const result = await window.terminalAPI.sendAPIRequest(
          requestData,
          false,
        );
        if (result && !result.error) {
          setSuccess(t("aiSettings.testSuccess"));
        } else {
          setError(
            t("aiSettings.testFailed") +
              ": " +
              (result?.error || t("errors.common.unknownError")),
          );
        }
      }
    } catch (err) {
      const errorMessage = describeRequestError(
        err,
        t("errors.common.unknownError"),
      );
      setError(t("aiSettings.testFailed") + ": " + errorMessage);
    } finally {
      setTesting(false);
    }
  };

  const handleClose = () => {
    setError("");
    setSuccess("");
    setEditMode(false);
    setEditingConfig(null);
    onClose();
  };

  // 获取可用模型列表
  const handleFetchModels = async () => {
    if (!config.apiUrl.trim() || !hasConfiguredApiKey(config)) {
      setError(t("aiSettings.apiUrlAndKeyRequired"));
      return;
    }

    if (!window.terminalAPI?.fetchModels) {
      setError(
        t("aiSettings.fetchModelsFailed") +
          ": " +
          t("aiSettings.apiUnavailable"),
      );
      return;
    }

    setFetchingModels(true);
    setError("");

    try {
      const result = await window.terminalAPI.fetchModels({
        apiConfigId: config.id || undefined,
        url: config.apiUrl,
        ...buildInlineApiKeyPayload(config),
        provider: config.provider,
      });

      if (result && result.models && Array.isArray(result.models)) {
        const models = normalizeModelList(result.models);
        setAvailableModels(models);
        if (config.model && !models.includes(config.model)) {
          handleConfigChange("model", "");
        }
        setSuccess(t("aiSettings.modelsFetched"));
      } else {
        setError(t("aiSettings.fetchModelsFailed"));
      }
    } catch (err) {
      const errorMessage = describeRequestError(
        err,
        t("errors.common.unknownError"),
      );
      setError(t("aiSettings.fetchModelsFailed") + ": " + errorMessage);
    } finally {
      setFetchingModels(false);
    }
  };

  return {
    firstInputRef,
    loading,
    testing,
    fetchingModels,
    error,
    success,
    availableModels,
    tabValue,
    setTabValue,
    apiConfigs,
    currentApiId,
    editMode,
    editingConfig,
    config,
    proxy,
    rules,
    deleteConfirmOpen,
    handleConfigChange,
    handleAddApi,
    handleEditApi,
    handleDeleteApi,
    handleConfirmDelete,
    handleCancelDelete,
    handleSetCurrent,
    handleCancelEdit,
    handleSave,
    handleTest,
    handleClose,
    handleFetchModels,
  };
}
