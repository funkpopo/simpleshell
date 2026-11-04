import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  setCustomRiskRules as applyCustomRiskRules,
  normalizeCustomRiskRules,
  validateCustomRiskPattern,
} from "../lib/aiSystemPrompt";
import { createEmptyCustomRules } from "../lib/aiSettingsModel.js";

// 自定义风险规则编辑：新增（正则校验）、删除、保存并应用到风险评估模块。
// 保存期间复用设置对话框共享的 loading / 提示状态。
export default function useCustomRiskRules({
  setLoading,
  setError,
  setSuccess,
}) {
  const { t } = useTranslation();
  const [customRules, setCustomRules] = useState(createEmptyCustomRules());
  const [newRulePattern, setNewRulePattern] = useState("");
  const [newRuleLevel, setNewRuleLevel] = useState("high");
  const [ruleError, setRuleError] = useState("");

  // 加载自定义风险规则（未保存过规则时保持当前状态）
  const applyStoredRules = (storedRules) => {
    if (storedRules) {
      const normalizedRules = normalizeCustomRiskRules(storedRules);
      setCustomRules(normalizedRules);
      // 应用到风险评估模块
      applyCustomRiskRules(normalizedRules);
    }
  };

  // 添加自定义规则
  const handleAddRule = () => {
    const validation = validateCustomRiskPattern(newRulePattern);

    if (validation.reason === "empty") {
      setRuleError(t("aiSettings.rulePatternRequired"));
      return;
    }

    if (!validation.valid) {
      setRuleError(t("aiSettings.invalidRegex"));
      return;
    }

    if (customRules[newRuleLevel]?.includes(validation.pattern)) {
      setRuleError(t("aiSettings.invalidRegex"));
      return;
    }

    setCustomRules((prev) => ({
      ...prev,
      [newRuleLevel]: [...prev[newRuleLevel], validation.pattern],
    }));
    setNewRulePattern("");
    setRuleError("");
  };

  // 删除自定义规则
  const handleDeleteRule = (level, index) => {
    setCustomRules((prev) => ({
      ...prev,
      [level]: prev[level].filter((_, i) => i !== index),
    }));
  };

  // 保存自定义规则
  const handleSaveRules = async () => {
    setLoading(true);
    setError("");
    try {
      if (window.terminalAPI?.saveCustomRiskRules) {
        const normalizedRules = normalizeCustomRiskRules(customRules);
        const result =
          await window.terminalAPI.saveCustomRiskRules(normalizedRules);
        if (result) {
          // 应用到风险评估模块
          setCustomRules(normalizedRules);
          applyCustomRiskRules(normalizedRules);
          setSuccess(t("aiSettings.rulesSaved"));
        } else {
          setError(t("aiSettings.rulesSaveFailed"));
        }
      }
    } catch {
      setError(t("aiSettings.rulesSaveFailed"));
    } finally {
      setLoading(false);
    }
  };

  return {
    customRules,
    newRulePattern,
    setNewRulePattern,
    newRuleLevel,
    setNewRuleLevel,
    ruleError,
    applyStoredRules,
    handleAddRule,
    handleDeleteRule,
    handleSaveRules,
  };
}
