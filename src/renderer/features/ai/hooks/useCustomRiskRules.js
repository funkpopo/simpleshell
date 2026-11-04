import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  setCustomRiskRules as applyCustomRiskRules,
  normalizeCustomRiskRules,
  validateCustomRiskPattern,
} from "../lib/aiSystemPrompt";
import { createEmptyCustomRules } from "../lib/aiSettingsModel.js";

const sameRules = (left, right) =>
  JSON.stringify(normalizeCustomRiskRules(left)) ===
  JSON.stringify(normalizeCustomRiskRules(right));

// 自定义风险规则编辑：新增（正则校验）、删除、保存并应用到风险评估模块。
// 保存状态独立于设置对话框的整体加载状态，保存时只禁用保存按钮。
export default function useCustomRiskRules({ setError, setSuccess }) {
  const { t } = useTranslation();
  const [customRules, setCustomRules] = useState(createEmptyCustomRules());
  // 最近一次加载/保存的规则，用于判断是否有未保存的修改
  const [savedRules, setSavedRules] = useState(createEmptyCustomRules());
  const [newRulePattern, setNewRulePattern] = useState("");
  const [newRuleLevel, setNewRuleLevel] = useState("high");
  const [ruleError, setRuleError] = useState("");
  const [saving, setSaving] = useState(false);

  const dirty = !sameRules(customRules, savedRules);

  // 加载自定义风险规则（未保存过规则时保持当前状态）
  const applyStoredRules = (storedRules) => {
    if (storedRules) {
      const normalizedRules = normalizeCustomRiskRules(storedRules);
      setCustomRules(normalizedRules);
      setSavedRules(normalizedRules);
      // 应用到风险评估模块
      applyCustomRiskRules(normalizedRules);
    }
  };

  // 放弃未保存的修改，恢复到最近一次加载/保存的规则
  const discardChanges = () => {
    setCustomRules(savedRules);
    setNewRulePattern("");
    setRuleError("");
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
      setRuleError(t("aiSettings.duplicateRule"));
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
    setSaving(true);
    setError("");
    try {
      if (window.terminalAPI?.saveCustomRiskRules) {
        const normalizedRules = normalizeCustomRiskRules(customRules);
        const result =
          await window.terminalAPI.saveCustomRiskRules(normalizedRules);
        if (result) {
          // 应用到风险评估模块
          setCustomRules(normalizedRules);
          setSavedRules(normalizedRules);
          applyCustomRiskRules(normalizedRules);
          setSuccess(t("aiSettings.rulesSaved"));
        } else {
          setError(t("aiSettings.rulesSaveFailed"));
        }
      }
    } catch {
      setError(t("aiSettings.rulesSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return {
    customRules,
    newRulePattern,
    setNewRulePattern,
    newRuleLevel,
    setNewRuleLevel,
    ruleError,
    saving,
    dirty,
    applyStoredRules,
    discardChanges,
    handleAddRule,
    handleDeleteRule,
    handleSaveRules,
  };
}
