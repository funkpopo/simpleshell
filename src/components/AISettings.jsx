import React, { useState, useEffect, useRef, memo } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  Typography,
  Switch,
  FormControlLabel,
  Slider,
  Alert,
  CircularProgress,
  IconButton,
  Tabs,
  Tab,
  Chip,
  Tooltip,
  Card,
  CardContent,
  CardActions,
  Autocomplete,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useTranslation } from "react-i18next";
import {
  RISK_LEVELS,
  setCustomRiskRules as applyCustomRiskRules,
  getBuiltinRiskPatterns,
} from "../utils/aiSystemPrompt";
import LockIcon from "@mui/icons-material/Lock";

const AISettings = ({ open, onClose }) => {
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
  const [config, setConfig] = useState({
    id: "",
    name: "",
    apiUrl: "",
    apiKey: "",
    model: "",
    maxTokens: 2000,
    temperature: 0.7,
    streamEnabled: true,
  });

  // 自定义风险规则状态
  const [customRules, setCustomRules] = useState({
    critical: [],
    high: [],
    medium: [],
    low: [],
  });
  const [newRulePattern, setNewRulePattern] = useState("");
  const [newRuleLevel, setNewRuleLevel] = useState("high");
  const [ruleError, setRuleError] = useState("");

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
        const addButton = document.querySelector('[data-testid="add-api-button"]');
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
          setConfig({
            id: settings.current.id || "",
            name: settings.current.name || "",
            apiUrl: settings.current.apiUrl || "",
            apiKey: settings.current.apiKey || "",
            model: settings.current.model || "",
            maxTokens: settings.current.maxTokens || 2000,
            temperature: settings.current.temperature || 0.7,
            streamEnabled: settings.current.streamEnabled !== false,
          });
        } else {
          // 如果没有当前配置，重置表单
          resetConfig();
        }

        // 加载自定义风险规则
        if (settings.customRiskRules) {
          setCustomRules(settings.customRiskRules);
          // 应用到风险评估模块
          applyCustomRiskRules(settings.customRiskRules);
        }
      }
    } catch (err) {
      setError(t("aiSettings.configSaveFailed"));
    } finally {
      setLoading(false);
    }
  };

  // 重置配置表单
  const resetConfig = () => {
    setConfig({
      id: "",
      name: "",
      apiUrl: "",
      apiKey: "",
      model: "",
      maxTokens: 2000,
      temperature: 0.7,
      streamEnabled: true,
    });
  };

  const handleConfigChange = (field, value) => {
    setConfig((prev) => ({
      ...prev,
      [field]: value,
    }));
    setError("");
    setSuccess("");
  };

  // 添加新API配置
  const handleAddApi = () => {
    resetConfig();
    setEditMode(true);
    setEditingConfig(null);
  };

  // 编辑API配置
  const handleEditApi = (apiConfig) => {
    setConfig({
      id: apiConfig.id,
      name: apiConfig.name,
      apiUrl: apiConfig.apiUrl,
      apiKey: apiConfig.apiKey,
      model: apiConfig.model,
      maxTokens: apiConfig.maxTokens || 2000,
      temperature: apiConfig.temperature || 0.7,
      streamEnabled: apiConfig.streamEnabled !== false,
    });
    setEditMode(true);
    setEditingConfig(apiConfig);
  };

  // 克隆API配置（基于现有配置快速创建新配置）
  const handleCloneApi = (apiConfig) => {
    setConfig({
      id: "", // 新配置ID为空
      name: `${apiConfig.name} (副本)`, // 添加副本标识
      apiUrl: apiConfig.apiUrl, // 保持相同的API URL
      apiKey: apiConfig.apiKey, // 保持相同的API Key
      model: apiConfig.model, // 可以使用相同的模型或修改
      maxTokens: apiConfig.maxTokens || 2000,
      temperature: apiConfig.temperature || 0.7,
      streamEnabled: apiConfig.streamEnabled !== false,
    });
    setEditMode(true);
    setEditingConfig(null); // 不是编辑现有配置，而是创建新配置
  };

  // 删除API配置 - 打开确认对话框
  const handleDeleteApi = (apiId) => {
    setDeleteTargetId(apiId);
    setDeleteConfirmOpen(true);
  };

  // 确认删除API配置
  const handleConfirmDelete = async () => {
    if (!deleteTargetId) return;

    try {
      const result = await window.terminalAPI.deleteApiConfig(deleteTargetId);
      if (result) {
        setSuccess(t("aiSettings.deleteSuccess"));
        await loadSettings(); // 重新加载设置
      } else {
        setError(t("aiSettings.deleteFailed"));
      }
    } catch (err) {
      setError(t("aiSettings.deleteFailed"));
    } finally {
      setDeleteConfirmOpen(false);
      setDeleteTargetId(null);
    }
  };

  // 取消删除
  const handleCancelDelete = () => {
    setDeleteConfirmOpen(false);
    setDeleteTargetId(null);
  };

  // 设置为当前API
  const handleSetCurrent = async (apiId) => {
    try {
      const result = await window.terminalAPI.setCurrentApiConfig(apiId);
      if (result) {
        setSuccess(t("aiSettings.setCurrentSuccess"));
        await loadSettings(); // 重新加载设置
      } else {
        setError(t("aiSettings.setCurrentFailed"));
      }
    } catch (err) {
      setError(t("aiSettings.setCurrentFailed"));
    }
  };

  // 取消编辑
  const handleCancelEdit = () => {
    setEditMode(false);
    setEditingConfig(null);
    loadSettings(); // 重新加载当前设置
  };

  const validateConfig = () => {
    // 在编辑模式下验证名称
    if (editMode && !config.name.trim()) {
      setError(t("aiSettings.apiNameRequired"));
      return false;
    }

    if (!config.apiUrl.trim()) {
      setError(t("aiSettings.apiUrlRequired"));
      return false;
    }
    if (!config.apiKey.trim()) {
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

    // 验证温度范围
    if (config.temperature < 0 || config.temperature > 2) {
      setError(t("aiSettings.temperatureRange"));
      return false;
    }

    // 验证最大令牌数范围
    if (config.maxTokens < 1 || config.maxTokens > 32000) {
      setError(t("aiSettings.maxTokensRange"));
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
        const apiConfig = {
          ...config,
          id: config.id || Date.now().toString(),
        };

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
        const settings = {
          current: config,
          configs: [
            {
              ...config,
              id: Date.now().toString(),
              name: config.name || "Default",
            },
          ],
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
    } catch (err) {
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
          url: config.apiUrl,
          apiKey: config.apiKey,
          model: config.model,
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
              (result?.error || "Unknown error"),
          );
        }
      }
    } catch (err) {
      // 处理不同的错误格式
      let errorMessage = "Unknown error";
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
    if (!config.apiUrl.trim() || !config.apiKey.trim()) {
      setError(t("aiSettings.apiUrlAndKeyRequired"));
      return;
    }

    setFetchingModels(true);
    setError("");

    try {
      const result = await window.terminalAPI.fetchModels({
        url: config.apiUrl,
        apiKey: config.apiKey,
      });

      if (result && result.models && Array.isArray(result.models)) {
        setAvailableModels(result.models);
        setSuccess(t("aiSettings.modelsFetched"));
      } else {
        setError(t("aiSettings.fetchModelsFailed"));
      }
    } catch (err) {
      // 处理不同的错误格式
      let errorMessage = "Unknown error";
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
      setError(t("aiSettings.fetchModelsFailed") + ": " + errorMessage);
    } finally {
      setFetchingModels(false);
    }
  };

  // 添加自定义规则
  const handleAddRule = () => {
    if (!newRulePattern.trim()) {
      setRuleError(t("aiSettings.rulePatternRequired"));
      return;
    }

    // 验证正则表达式
    try {
      new RegExp(newRulePattern, 'i');
    } catch (e) {
      setRuleError(t("aiSettings.invalidRegex"));
      return;
    }

    setCustomRules(prev => ({
      ...prev,
      [newRuleLevel]: [...prev[newRuleLevel], newRulePattern],
    }));
    setNewRulePattern("");
    setRuleError("");
  };

  // 删除自定义规则
  const handleDeleteRule = (level, index) => {
    setCustomRules(prev => ({
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
        const result = await window.terminalAPI.saveCustomRiskRules(customRules);
        if (result) {
          // 应用到风险评估模块
          applyCustomRiskRules(customRules);
          setSuccess(t("aiSettings.rulesSaved"));
        } else {
          setError(t("aiSettings.rulesSaveFailed"));
        }
      }
    } catch (err) {
      setError(t("aiSettings.rulesSaveFailed"));
    } finally {
      setLoading(false);
    }
  };

  // 获取风险等级颜色
  const getRiskLevelColor = (level) => {
    const riskKey = level.toUpperCase();
    return RISK_LEVELS[riskKey]?.color || '#666';
  };

  // 获取风险等级标签
  const getRiskLevelLabel = (level) => {
    const riskKey = level.toUpperCase();
    return RISK_LEVELS[riskKey]?.label || level;
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      disableEnforceFocus={false}
      disableAutoFocus={false}
      PaperProps={{
        sx: {
          borderRadius: 2,
          backdropFilter: "blur(10px)",
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Typography variant="h6">{t("aiSettings.title")}</Typography>
        <IconButton onClick={handleClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {loading && (
          <Box display="flex" justifyContent="center" p={4}>
            <CircularProgress />
          </Box>
        )}

        {!loading && (
          <Box>
            {/* 标签页 */}
            <Tabs
              value={tabValue}
              onChange={(e, newValue) => setTabValue(newValue)}
              sx={{ borderBottom: 1, borderColor: "divider" }}
            >
              <Tab label={t("aiSettings.apiManagement")} />
              <Tab label={t("aiSettings.customRules")} />
            </Tabs>

            {/* 标签页内容 */}
            <Box sx={{ p: 3 }}>
              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}
              {success && (
                <Alert severity="success" sx={{ mb: 2 }}>
                  {success}
                </Alert>
              )}

              {tabValue === 0 && (
                <Box>
                  {!editMode ? (
                    // API列表模式
                    <Box>
                      <Box
                        sx={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          mb: 2,
                        }}
                      >
                        <Typography variant="h6">
                          {t("aiSettings.apiList")}
                        </Typography>
                        <Button
                          variant="contained"
                          startIcon={<AddIcon />}
                          onClick={handleAddApi}
                          size="small"
                          data-testid="add-api-button"
                        >
                          {t("aiSettings.addApi")}
                        </Button>
                      </Box>
                      {apiConfigs.length === 0 ? (
                        <Box sx={{ textAlign: "center", py: 4 }}>
                          <Typography color="text.secondary">
                            {t("aiSettings.noApiConfigs")}
                          </Typography>
                        </Box>
                      ) : (
                        <Box
                          sx={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                          }}
                        >
                          {apiConfigs.map((apiConfig) => (
                            <Card key={apiConfig.id} variant="outlined">
                              <CardContent sx={{ pb: 1 }}>
                                <Box
                                  sx={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "flex-start",
                                  }}
                                >
                                  <Box sx={{ flex: 1 }}>
                                    <Box
                                      sx={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 1,
                                        mb: 1,
                                      }}
                                    >
                                      <Typography
                                        variant="subtitle1"
                                        fontWeight="medium"
                                      >
                                        {apiConfig.name}
                                      </Typography>
                                      {currentApiId === apiConfig.id && (
                                        <Chip
                                          label={t("aiSettings.currentApi")}
                                          size="small"
                                          color="primary"
                                          icon={<CheckCircleIcon />}
                                        />
                                      )}
                                    </Box>
                                    <Typography
                                      variant="body2"
                                      color="text.secondary"
                                      sx={{ mb: 0.5 }}
                                    >
                                      {t("aiSettings.model")}: {apiConfig.model}
                                    </Typography>
                                    <Typography
                                      variant="body2"
                                      color="text.secondary"
                                    >
                                      {t("aiSettings.apiUrl")}:{" "}
                                      {apiConfig.apiUrl}
                                    </Typography>
                                  </Box>
                                </Box>
                              </CardContent>
                              <CardActions
                                sx={{ pt: 0, justifyContent: "space-between" }}
                              >
                                <Box>
                                  <Tooltip title={t("aiSettings.cloneApi")}>
                                    <IconButton
                                      size="small"
                                      onClick={() => handleCloneApi(apiConfig)}
                                      color="primary"
                                    >
                                      <ContentCopyIcon />
                                    </IconButton>
                                  </Tooltip>
                                </Box>
                                <Box>
                                  {currentApiId !== apiConfig.id && (
                                    <Button
                                      size="small"
                                      onClick={() =>
                                        handleSetCurrent(apiConfig.id)
                                      }
                                      sx={{ mr: 1 }}
                                    >
                                      {t("aiSettings.setAsCurrent")}
                                    </Button>
                                  )}
                                  <Tooltip title={t("aiSettings.editApi")}>
                                    <IconButton
                                      size="small"
                                      onClick={() => handleEditApi(apiConfig)}
                                    >
                                      <EditIcon />
                                    </IconButton>
                                  </Tooltip>
                                  <Tooltip title={t("aiSettings.deleteApi")}>
                                    <IconButton
                                      size="small"
                                      onClick={() =>
                                        handleDeleteApi(apiConfig.id)
                                      }
                                      color="error"
                                    >
                                      <DeleteIcon />
                                    </IconButton>
                                  </Tooltip>
                                </Box>
                              </CardActions>
                            </Card>
                          ))}
                        </Box>
                      )}
                    </Box>
                  ) : (
                    // 编辑模式
                    <Box
                      sx={{ display: "flex", flexDirection: "column", gap: 3 }}
                    >
                      <Box>
                        <Box
                          sx={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            mb: editingConfig ? 0 : 2,
                          }}
                        >
                          <Typography variant="h6">
                            {editingConfig
                              ? t("aiSettings.editApi")
                              : t("aiSettings.addApi")}
                          </Typography>
                        </Box>
                        {editingConfig && (
                          <Alert severity="info" sx={{ mb: 2 }}>
                            {t("aiSettings.editingExistingConfig")}
                          </Alert>
                        )}
                        {!editingConfig && config.apiUrl && config.apiKey && (
                          <Alert severity="success" sx={{ mb: 2 }}>
                            {t("aiSettings.clonedConfigHint")}
                          </Alert>
                        )}
                      </Box>
                      <TextField
                        inputRef={firstInputRef}
                        label={t("aiSettings.apiName")}
                        value={config.name}
                        onChange={(e) =>
                          handleConfigChange("name", e.target.value)
                        }
                        fullWidth
                        placeholder={t("aiSettings.placeholders.name")}
                        variant="outlined"
                        required
                      />
                      <TextField
                        label={t("aiSettings.apiUrl")}
                        value={config.apiUrl}
                        onChange={(e) =>
                          handleConfigChange("apiUrl", e.target.value)
                        }
                        fullWidth
                        placeholder={t("aiSettings.placeholders.baseUrl")}
                        variant="outlined"
                        required
                        helperText={t("aiSettings.apiUrlHelp")}
                      />
                      <TextField
                        label={t("aiSettings.apiKey")}
                        value={config.apiKey}
                        onChange={(e) =>
                          handleConfigChange("apiKey", e.target.value)
                        }
                        fullWidth
                        type="password"
                        placeholder={t("aiSettings.placeholders.apiKey")}
                        variant="outlined"
                        required
                      />
                      <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                        <Autocomplete
                          value={config.model}
                          onChange={(event, newValue) => {
                            handleConfigChange("model", newValue || "");
                          }}
                          onInputChange={(event, newInputValue) => {
                            handleConfigChange("model", newInputValue);
                          }}
                          options={availableModels}
                          freeSolo
                          fullWidth
                          slotProps={{
                            paper: {
                              sx: {
                                border: 1,
                                borderColor: "divider",
                                boxShadow: 3,
                              },
                            },
                          }}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              label={t("aiSettings.model")}
                              placeholder={t("aiSettings.placeholders.model")}
                              variant="outlined"
                              required
                            />
                          )}
                          renderOption={(props, option) => (
                            <li {...props} key={option}>
                              {option}
                            </li>
                          )}
                        />
                        <Tooltip title={t("aiSettings.fetchModels")}>
                          <IconButton
                            onClick={handleFetchModels}
                            disabled={fetchingModels || !config.apiUrl.trim() || !config.apiKey.trim()}
                            sx={{ mt: 1 }}
                          >
                            {fetchingModels ? (
                              <CircularProgress size={20} />
                            ) : (
                              <RefreshIcon />
                            )}
                          </IconButton>
                        </Tooltip>
                      </Box>
                      <Box>
                        <Typography gutterBottom>
                          {t("aiSettings.maxTokens")}: {config.maxTokens}
                        </Typography>
                        <Slider
                          value={config.maxTokens}
                          onChange={(_, value) =>
                            handleConfigChange("maxTokens", value)
                          }
                          min={100}
                          max={32000}
                          step={100}
                          marks={[
                            { value: 1000, label: "1000" },
                            { value: 4000, label: "4000" },
                            { value: 8000, label: "8000" },
                            { value: 12000, label: "12000" },
                            { value: 16000, label: "16000" },
                            { value: 32000, label: "32000" },
                          ]}
                        />
                      </Box>
                      <Box>
                        <Typography gutterBottom>
                          {t("aiSettings.temperature")}: {config.temperature}
                        </Typography>
                        <Slider
                          value={config.temperature}
                          onChange={(_, value) =>
                            handleConfigChange("temperature", value)
                          }
                          min={0}
                          max={2}
                          step={0.1}
                          marks={[
                            { value: 0, label: "0" },
                            { value: 0.5, label: "0.5" },
                            { value: 1, label: "1" },
                            { value: 1.5, label: "1.5" },
                            { value: 2, label: "2" },
                          ]}
                        />
                      </Box>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={config.streamEnabled}
                            onChange={(e) =>
                              handleConfigChange(
                                "streamEnabled",
                                e.target.checked,
                              )
                            }
                          />
                        }
                        label={t("aiSettings.streamEnabled")}
                      />
                    </Box>
                  )}
                </Box>
              )}

              {/* 自定义风险规则标签页 */}
              {tabValue === 1 && (
                <Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    {t("aiSettings.customRulesDescription")}
                  </Typography>

                  {/* 添加新规则 */}
                  <Card variant="outlined" sx={{ mb: 3, p: 2 }}>
                    <Typography variant="subtitle2" sx={{ mb: 2 }}>
                      {t("aiSettings.addNewRule")}
                    </Typography>
                    <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-start" }}>
                      <TextField
                        value={newRulePattern}
                        onChange={(e) => setNewRulePattern(e.target.value)}
                        placeholder={t("aiSettings.rulePatternPlaceholder")}
                        size="small"
                        sx={{ flex: 1 }}
                        error={!!ruleError}
                        helperText={ruleError || " "}
                      />
                      <FormControl size="small" sx={{ minWidth: 130 }}>
                        <InputLabel>{t("aiSettings.riskLevel")}</InputLabel>
                        <Select
                          value={newRuleLevel}
                          onChange={(e) => setNewRuleLevel(e.target.value)}
                          label={t("aiSettings.riskLevel")}
                        >
                          <MenuItem value="critical">
                            <Chip
                              label={t("ai.riskLevels.critical")}
                              size="small"
                              sx={{ bgcolor: RISK_LEVELS.CRITICAL.color, color: "white" }}
                            />
                          </MenuItem>
                          <MenuItem value="high">
                            <Chip
                              label={t("ai.riskLevels.high")}
                              size="small"
                              sx={{ bgcolor: RISK_LEVELS.HIGH.color, color: "white" }}
                            />
                          </MenuItem>
                          <MenuItem value="medium">
                            <Chip
                              label={t("ai.riskLevels.medium")}
                              size="small"
                              sx={{ bgcolor: RISK_LEVELS.MEDIUM.color, color: "white" }}
                            />
                          </MenuItem>
                          <MenuItem value="low">
                            <Chip
                              label={t("ai.riskLevels.low")}
                              size="small"
                              sx={{ bgcolor: RISK_LEVELS.LOW.color, color: "white" }}
                            />
                          </MenuItem>
                        </Select>
                      </FormControl>
                      <Tooltip title={t("aiSettings.addNewRule")}>
                        <IconButton
                          onClick={handleAddRule}
                          color="primary"
                          sx={{ mt: 0.5 }}
                        >
                          <AddIcon />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Card>

                  {/* 自定义规则列表 */}
                  <Typography variant="subtitle1" sx={{ mb: 1.5, fontWeight: 500 }}>
                    {t("aiSettings.customRulesList")}
                  </Typography>
                  {Object.values(customRules).every(arr => arr.length === 0) ? (
                    <Box sx={{ textAlign: "center", py: 3, bgcolor: "action.hover", borderRadius: 1 }}>
                      <Typography color="text.secondary">
                        {t("aiSettings.noCustomRules")}
                      </Typography>
                    </Box>
                  ) : (
                    ["critical", "high", "medium", "low"].map((level) => (
                      customRules[level]?.length > 0 && (
                        <Box key={level} sx={{ mb: 2 }}>
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                              mb: 0.5,
                            }}
                          >
                            <Chip
                              label={getRiskLevelLabel(level)}
                              size="small"
                              sx={{ bgcolor: getRiskLevelColor(level), color: "white" }}
                            />
                            <Typography variant="body2" color="text.secondary">
                              ({customRules[level].length})
                            </Typography>
                          </Box>
                          <List dense sx={{ bgcolor: "action.hover", borderRadius: 1 }}>
                            {customRules[level].map((pattern, index) => (
                              <ListItem key={index} sx={{ py: 0.5 }}>
                                <ListItemText
                                  primary={pattern}
                                  primaryTypographyProps={{
                                    fontFamily: "monospace",
                                    fontSize: "0.85rem",
                                  }}
                                />
                                <ListItemSecondaryAction>
                                  <IconButton
                                    edge="end"
                                    size="small"
                                    onClick={() => handleDeleteRule(level, index)}
                                  >
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </ListItemSecondaryAction>
                              </ListItem>
                            ))}
                          </List>
                        </Box>
                      )
                    ))
                  )}

                  {/* 保存按钮 */}
                  <Box sx={{ mt: 2, display: "flex", justifyContent: "flex-end" }}>
                    <Button
                      variant="contained"
                      onClick={handleSaveRules}
                      disabled={loading}
                    >
                      {t("aiSettings.saveRules")}
                    </Button>
                  </Box>

                  {/* 内置规则（只读） */}
                  <Box sx={{ mt: 4 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
                      <LockIcon fontSize="small" color="action" />
                      <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
                        {t("aiSettings.builtinRules")}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        ({t("aiSettings.readOnly")})
                      </Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      {t("aiSettings.builtinRulesDescription")}
                    </Typography>
                    {["critical", "high", "medium", "low"].map((level) => {
                      const builtinPatterns = getBuiltinRiskPatterns()[level] || [];
                      return builtinPatterns.length > 0 && (
                        <Box key={`builtin-${level}`} sx={{ mb: 2 }}>
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                              mb: 0.5,
                            }}
                          >
                            <Chip
                              label={getRiskLevelLabel(level)}
                              size="small"
                              sx={{ bgcolor: getRiskLevelColor(level), color: "white" }}
                            />
                            <Typography variant="body2" color="text.secondary">
                              ({builtinPatterns.length})
                            </Typography>
                          </Box>
                          <List
                            dense
                            sx={{
                              bgcolor: "action.hover",
                              borderRadius: 1,
                              maxHeight: 200,
                              overflow: "auto",
                              opacity: 0.8,
                            }}
                          >
                            {builtinPatterns.map((pattern, index) => (
                              <ListItem key={index} sx={{ py: 0.25 }}>
                                <ListItemText
                                  primary={pattern}
                                  primaryTypographyProps={{
                                    fontFamily: "monospace",
                                    fontSize: "0.8rem",
                                    color: "text.secondary",
                                  }}
                                />
                              </ListItem>
                            ))}
                          </List>
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
              )}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        {editMode ? (
          // 编辑模式的按钮
          <>
            <Button
              onClick={handleTest}
              disabled={loading || testing}
              variant="outlined"
            >
              {testing ? t("aiSettings.testing") : t("aiSettings.test")}
            </Button>
            <Button onClick={handleCancelEdit} disabled={loading}>
              {t("aiSettings.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={loading} variant="contained">
              {t("aiSettings.save")}
            </Button>
          </>
        ) : (
          // 列表模式的按钮
          <Button onClick={handleClose} disabled={loading}>
            {t("aiSettings.cancel")}
          </Button>
        )}
      </DialogActions>

      {/* 删除确认对话框 */}
      <Dialog
        open={deleteConfirmOpen}
        onClose={handleCancelDelete}
        maxWidth="xs"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              borderRadius: 2,
            },
          },
        }}
      >
        <DialogTitle>{t("aiSettings.deleteConfirmTitle")}</DialogTitle>
        <DialogContent>
          <Typography>{t("aiSettings.deleteConfirm")}</Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button onClick={handleCancelDelete} color="inherit">
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleConfirmDelete}
            variant="contained"
            color="error"
          >
            {t("common.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
};

export default memo(AISettings);
