import React, { useState, useEffect } from "react";
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
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Divider,
  Tabs,
  Tab,
  Chip,
  Tooltip,
  Card,
  CardContent,
  CardActions,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { useTranslation } from "react-i18next";

const AISettings = ({ open, onClose }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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

  // 加载AI设置
  useEffect(() => {
    if (open) {
      loadSettings();
    }
  }, [open]);

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

  // 删除API配置
  const handleDeleteApi = async (apiId) => {
    if (!window.confirm(t("aiSettings.deleteConfirm"))) {
      return;
    }

    try {
      const result = await window.terminalAPI.deleteApiConfig(apiId);
      if (result) {
        setSuccess(t("aiSettings.deleteSuccess"));
        await loadSettings(); // 重新加载设置
      } else {
        setError(t("aiSettings.deleteFailed"));
      }
    } catch (err) {
      setError(t("aiSettings.deleteFailed"));
    }
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
      setError(t("aiSettings.testFailed") + ": " + err.message);
    } finally {
      setTesting(false);
    }
  };

  const handleClose = () => {
    setError("");
    setSuccess("");
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
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
                                sx={{ pt: 0, justifyContent: "flex-end" }}
                              >
                                {currentApiId !== apiConfig.id && (
                                  <Button
                                    size="small"
                                    onClick={() =>
                                      handleSetCurrent(apiConfig.id)
                                    }
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
                      <Box
                        sx={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <Typography variant="h6">
                          {editingConfig
                            ? t("aiSettings.editApi")
                            : t("aiSettings.addApi")}
                        </Typography>
                      </Box>

                      <TextField
                        label={t("aiSettings.apiName")}
                        value={config.name}
                        onChange={(e) =>
                          handleConfigChange("name", e.target.value)
                        }
                        fullWidth
                        placeholder="My API"
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
                        placeholder="https://api.openai.com/v1/chat/completions"
                        variant="outlined"
                        required
                      />

                      <TextField
                        label={t("aiSettings.apiKey")}
                        value={config.apiKey}
                        onChange={(e) =>
                          handleConfigChange("apiKey", e.target.value)
                        }
                        fullWidth
                        type="password"
                        placeholder="sk-..."
                        variant="outlined"
                        required
                      />

                      <TextField
                        label={t("aiSettings.model")}
                        value={config.model}
                        onChange={(e) =>
                          handleConfigChange("model", e.target.value)
                        }
                        fullWidth
                        placeholder="gpt-3.5-turbo"
                        variant="outlined"
                        required
                      />

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
    </Dialog>
  );
};

export default AISettings;
